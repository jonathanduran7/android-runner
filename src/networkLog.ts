import * as vscode from "vscode";

export interface HttpTransaction {
  id: string;
  tid: string;
  method: string;
  url: string;
  timestamp: string;
  statusCode?: number;
  durationMs?: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  error?: string;
  complete: boolean;
}

// Matches a full logcat line from okhttp.OkHttpClient
// Format: MM-DD HH:MM:SS.mmm PID TID LEVEL okhttp.OkHttpClient: message
const OKHTTP_LINE_RE =
  /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+(\d+)\s+\w+\s+okhttp\.OkHttpClient:\s+(.*)$/;

// <-- 200 https://host/path (521ms)
const RESPONSE_START_RE = /^<--\s+(\d+)\s+(https?:\/\/\S+)\s+\((\d+)ms\)/;

// --> GET https://host/path
const REQUEST_START_RE = /^-->\s+(\w+)\s+(https?:\/\/\S+)/;

// --> END GET
const REQUEST_END_RE = /^-->\s+END\s+\w+/;

// <-- END HTTP (N-byte body)
const RESPONSE_END_RE = /^<--\s+END\s+HTTP/;

// <-- HTTP FAILED: message
const HTTP_FAILED_RE = /^<--\s+HTTP\s+FAILED:\s+(.+)$/;

// header: value (must have ": " separator, not start with { or <)
const HEADER_RE = /^([a-zA-Z0-9_\-]+):\s+(.+)$/;

type PendingTx = {
  tx: Partial<HttpTransaction>;
  phase: "request" | "response_headers" | "response_body";
};

const MAX_TRANSACTIONS = 100;

/**
 * Parses OkHttp logcat lines and assembles complete HttpTransaction objects.
 * Matching between request and response is done by thread ID (TID).
 */
export class OkHttpParser {
  private pending = new Map<string, PendingTx>();
  private counter = 0;

  constructor(
    private readonly onComplete: (tx: HttpTransaction) => void
  ) {}

  processLine(rawLogcatLine: string): void {
    const m = OKHTTP_LINE_RE.exec(rawLogcatLine);
    if (!m) {
      return;
    }

    const tid = m[1];
    const msg = m[2].trim();

    // Extract timestamp from the raw line (MM-DD HH:MM:SS.mmm)
    const tsMatch = rawLogcatLine.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
    const timestamp = tsMatch ? tsMatch[1] : "";

    const requestStart = REQUEST_START_RE.exec(msg);
    if (requestStart) {
      this.pending.set(tid, {
        tx: {
          id: String(++this.counter),
          tid,
          method: requestStart[1],
          url: requestStart[2],
          timestamp,
          responseHeaders: {},
          responseBody: "",
          complete: false,
        },
        phase: "request",
      });
      return;
    }

    if (REQUEST_END_RE.test(msg)) {
      // Request headers phase ends; wait for response
      return;
    }

    const pending = this.pending.get(tid);

    if (!pending) {
      return;
    }

    const failed = HTTP_FAILED_RE.exec(msg);
    if (failed) {
      pending.tx.error = failed[1];
      pending.tx.complete = true;
      this.emit(pending.tx, tid);
      return;
    }

    const respStart = RESPONSE_START_RE.exec(msg);
    if (respStart) {
      pending.tx.statusCode = parseInt(respStart[1], 10);
      pending.tx.durationMs = parseInt(respStart[3], 10);
      pending.phase = "response_headers";
      return;
    }

    if (RESPONSE_END_RE.test(msg)) {
      pending.tx.complete = true;
      this.emit(pending.tx, tid);
      return;
    }

    if (pending.phase === "response_headers") {
      const header = HEADER_RE.exec(msg);
      if (header) {
        pending.tx.responseHeaders![header[1].toLowerCase()] = header[2];
        return;
      }
      // First non-header line → body starts
      pending.phase = "response_body";
    }

    if (pending.phase === "response_body") {
      const current = pending.tx.responseBody ?? "";
      pending.tx.responseBody = current ? current + "\n" + msg : msg;
    }
  }

  private emit(tx: Partial<HttpTransaction>, tid: string): void {
    this.pending.delete(tid);
    if (tx.method && tx.url) {
      this.onComplete(tx as HttpTransaction);
    }
  }

  reset(): void {
    this.pending.clear();
    this.counter = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// Pretty printer for the Output Channel
// ─────────────────────────────────────────────────────────────

const DIVIDER = "─".repeat(60);

function statusLabel(code: number): string {
  if (code >= 500) {return `${code} SERVER ERROR`;}
  if (code >= 400) {return `${code} CLIENT ERROR`;}
  if (code >= 300) {return `${code} REDIRECT`;}
  if (code >= 200) {return `${code} OK`;}
  return String(code);
}

function formatUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname + (u.search || "") };
  } catch {
    return { host: "", path: url };
  }
}

export function printTransaction(
  tx: HttpTransaction,
  output: vscode.OutputChannel
): void {
  const { host, path } = formatUrl(tx.url);
  const time = tx.timestamp.split(" ")[1] ?? tx.timestamp;

  output.appendLine(DIVIDER);

  if (tx.error) {
    output.appendLine(`✗ ${tx.method}  ${path}`);
    if (host) {output.appendLine(`  Host: ${host}  |  ${time}`);}
    output.appendLine(`  FAILED: ${tx.error}`);
    output.appendLine(DIVIDER);
    output.appendLine("");
    return;
  }

  output.appendLine(`→ ${tx.method}  ${path}`);
  if (host) {output.appendLine(`  Host: ${host}  |  ${time}`);}

  if (tx.statusCode !== undefined) {
    const dur = tx.durationMs !== undefined ? `  (${tx.durationMs}ms)` : "";
    output.appendLine("");
    output.appendLine(`← ${statusLabel(tx.statusCode)}${dur}`);

    const headers = Object.entries(tx.responseHeaders ?? {});
    if (headers.length > 0) {
      for (const [k, v] of headers) {
        output.appendLine(`  ${k}: ${v}`);
      }
    }

    if (tx.responseBody) {
      output.appendLine("");
      // Indent each body line for readability
      for (const line of tx.responseBody.split("\n")) {
        output.appendLine(`  ${line}`);
      }
    }
  }

  output.appendLine(DIVIDER);
  output.appendLine("");
}

// ─────────────────────────────────────────────────────────────
// TreeView provider for the Activity Bar "Network" panel
// ─────────────────────────────────────────────────────────────

export class NetworkLogTreeProvider
  implements vscode.TreeDataProvider<HttpTransaction>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    HttpTransaction | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private transactions: HttpTransaction[] = [];

  addTransaction(tx: HttpTransaction): void {
    this.transactions.unshift(tx); // newest first
    if (this.transactions.length > MAX_TRANSACTIONS) {
      this.transactions.length = MAX_TRANSACTIONS;
    }
    this._onDidChangeTreeData.fire(null);
  }

  clear(): void {
    this.transactions = [];
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(tx: HttpTransaction): vscode.TreeItem {
    const { path } = formatUrl(tx.url);
    const item = new vscode.TreeItem(
      `${this.statusIcon(tx)} ${tx.method}  ${path}`,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = this.descriptionFor(tx);
    item.tooltip = tx.url;
    item.iconPath = new vscode.ThemeIcon(this.themeIcon(tx));
    item.command = {
      command: "androidRunner.showNetworkTransaction",
      title: "Show transaction",
      arguments: [tx],
    };
    return item;
  }

  getChildren(): HttpTransaction[] {
    return this.transactions;
  }

  private statusIcon(tx: HttpTransaction): string {
    if (tx.error) {return "✗";}
    const code = tx.statusCode ?? 0;
    if (code >= 400) {return `[${code}]`;}
    if (code >= 200) {return `[${code}]`;}
    return "[...]";
  }

  private descriptionFor(tx: HttpTransaction): string {
    if (tx.error) {return tx.error.split(":").pop()?.trim() ?? "FAILED";}
    if (tx.durationMs !== undefined) {return `${tx.durationMs}ms`;}
    return "";
  }

  private themeIcon(tx: HttpTransaction): string {
    if (tx.error) {return "error";}
    const code = tx.statusCode ?? 0;
    if (code >= 500) {return "error";}
    if (code >= 400) {return "warning";}
    if (code >= 200) {return "check";}
    return "loading~spin";
  }
}

export function registerNetworkView(
  context: vscode.ExtensionContext,
  networkOutput: vscode.OutputChannel
): { provider: NetworkLogTreeProvider; parser: OkHttpParser } {
  const provider = new NetworkLogTreeProvider();

  const parser = new OkHttpParser((tx) => {
    printTransaction(tx, networkOutput);
    provider.addTransaction(tx);
  });

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("androidNetworkView", provider),

    vscode.commands.registerCommand("androidRunner.clearNetworkLog", () => {
      provider.clear();
      parser.reset();
      networkOutput.clear();
    }),

    vscode.commands.registerCommand(
      "androidRunner.showNetworkTransaction",
      (tx: HttpTransaction) => {
        networkOutput.show(true);
        printTransaction(tx, networkOutput);
      }
    )
  );

  return { provider, parser };
}
