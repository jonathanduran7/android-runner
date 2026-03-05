import * as vscode from "vscode";
import { getRunningEmulator } from "./adb.js";
import { listAvds } from "./emulator.js";
import { listInstallTasks } from "./gradle.js";
import * as path from "path";
import * as fs from "fs";

const VIEW_ID = "androidRunnerView";

export type TreeNode =
  | { kind: "action"; id: string; label: string; icon: string; command: string }
  | { kind: "folder"; id: string; label: string; icon: string }
  | { kind: "emulator"; name: string; running: boolean }
  | { kind: "flavor"; task: string };

function getProjectRoot(): string | null {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  return workspace ? workspace.uri.fsPath : null;
}

function hasGradlew(projectRoot: string): boolean {
  const gradlew =
    process.platform === "win32"
      ? path.join(projectRoot, "gradlew.bat")
      : path.join(projectRoot, "gradlew");
  return fs.existsSync(gradlew);
}

export class AndroidTreeDataProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "action") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = {
        command: element.command,
        title: element.label,
      };
      item.tooltip = element.label;
      return item;
    }

    if (element.kind === "folder") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.contextValue = "folder";
      return item;
    }

    if (element.kind === "emulator") {
      const item = new vscode.TreeItem(
        element.running ? `${element.name} $(pass-filled)` : element.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon(
        element.running ? "device-mobile" : "vm"
      );
      item.description = element.running ? "running" : undefined;
      item.tooltip = element.running ? `${element.name} (running)` : element.name;
      return item;
    }

    if (element.kind === "flavor") {
      const item = new vscode.TreeItem(
        element.task.replace(/^:app:/, ""),
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon("package");
      item.tooltip = element.task;
      return item;
    }

    return new vscode.TreeItem("?", vscode.TreeItemCollapsibleState.None);
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.getRootChildren();
    }

    if (element.kind === "folder") {
      if (element.id === "emulators") {
        return this.getEmulatorChildren();
      }
      if (element.id === "flavors") {
        return this.getFlavorChildren();
      }
    }

    return [];
  }

  private getRootChildren(): TreeNode[] {
    const actions: TreeNode[] = [
      {
        kind: "action",
        id: "run",
        label: "Run & Stream Logs",
        icon: "play",
        command: "androidRunner.runAndLogs",
      },
      {
        kind: "action",
        id: "logs",
        label: "Logs",
        icon: "output",
        command: "androidRunner.logs",
      },
      {
        kind: "action",
        id: "stop",
        label: "Stop Logs",
        icon: "debug-stop",
        command: "androidRunner.stopLogs",
      },
      {
        kind: "action",
        id: "kill",
        label: "Kill Emulator",
        icon: "trash",
        command: "androidRunner.killEmulator",
      },
      {
        kind: "action",
        id: "focusLogs",
        label: "Focus Logs",
        icon: "output-view-icon",
        command: "androidRunner.focusLogs",
      },
      {
        kind: "folder",
        id: "emulators",
        label: "Emulators",
        icon: "device-mobile",
      },
      {
        kind: "folder",
        id: "flavors",
        label: "Flavors",
        icon: "layers",
      },
    ];
    return actions;
  }

  private async getEmulatorChildren(): Promise<TreeNode[]> {
    try {
      const [avds, runningId] = await Promise.all([
        listAvds(),
        getRunningEmulator(),
      ]);

      const runningAvd = runningId ?? null;
      const items: TreeNode[] = [];

      if (runningId) {
        items.push({
          kind: "emulator",
          name: runningId,
          running: true,
        });
      }

      for (const name of avds) {
        items.push({
          kind: "emulator",
          name,
          running: false,
        });
      }

      if (items.length === 0) {
        return [
          {
            kind: "emulator",
            name: "No AVDs found",
            running: false,
          },
        ];
      }

      return items;
    } catch {
      return [
        {
          kind: "emulator",
          name: "Check SDK / emulator -list-avds",
          running: false,
        },
      ];
    }
  }

  private async getFlavorChildren(): Promise<TreeNode[]> {
    const projectRoot = getProjectRoot();
    if (!projectRoot || !hasGradlew(projectRoot)) {
      return [
        {
          kind: "flavor",
          task: "Open an Android project (gradlew)",
        },
      ];
    }

    try {
      const tasks = await listInstallTasks(projectRoot);
      if (tasks.length === 0) {
        return [
          {
            kind: "flavor",
            task: "No install tasks found",
          },
        ];
      }
      return tasks.map((task) => ({ kind: "flavor" as const, task }));
    } catch {
      return [
        {
          kind: "flavor",
          task: "Run :app:tasks --all to see tasks",
        },
      ];
    }
  }
}

export function registerAndroidView(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): AndroidTreeDataProvider {
  const provider = new AndroidTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("androidRunner.refreshView", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand("androidRunner.focusLogs", () => {
      outputChannel.show(true);
    })
  );

  return provider;
}
