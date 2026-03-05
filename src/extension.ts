import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getRunningEmulator } from "./adb.js";
import { killEmulator, streamLogcat } from "./adb.js";
import { listAvds } from "./emulator.js";
import { listInstallTasks } from "./gradle.js";
import { runAndStreamLogs } from "./runner.js";
import { getSdkPath } from "./sdk.js";

const USE_EXISTING_EMULATOR = "__use_existing__";

function getConfig() {
  return vscode.workspace.getConfiguration("androidRunner");
}

function getAppIdForTask(task: string): string | undefined {
  const config = getConfig();
  const mapping = config.get<Record<string, string>>("taskAppIds") ?? {};
  // task is :app:installStaging -> extract installStaging
  const match = task.match(/:app:install([A-Za-z][A-Za-z0-9]*)/);
  const key = match ? `install${match[1]}` : undefined;
  return key ? mapping[key] : undefined;
}

function ensureWorkspace(): string {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    throw new Error("Open a folder/workspace first.");
  }
  return workspace.uri.fsPath;
}

function checkGradlew(projectRoot: string): void {
  const gradlew =
    process.platform === "win32"
      ? path.join(projectRoot, "gradlew.bat")
      : path.join(projectRoot, "gradlew");
  if (!fs.existsSync(gradlew)) {
    throw new Error(`gradlew not found at ${projectRoot}`);
  }
}

function checkSdk(): void {
  const sdk = getSdkPath();
  if (!sdk) {
    throw new Error(
      "Android SDK not found. Set 'androidRunner.sdkPath' in settings (e.g. /Users/you/Library/Android/sdk on macOS), or ensure ANDROID_HOME/ANDROID_SDK_ROOT are set in your environment."
    );
  }
}

function createNotifier(): (message: string, type?: "info" | "warn") => void {
  return (message: string, type?: "info" | "warn") => {
    if (getConfig().get<boolean>("notifications") !== false) {
      if (type === "warn") {
        vscode.window.showWarningMessage(message);
      } else {
        vscode.window.showInformationMessage(message);
      }
    }
  };
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Android Runner");

  let currentLogcatDispose: (() => void) | null = null;

  // Status bar: Run | Logs | Stop | Kill (higher priority = more to the left)
  const statusRun = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    400
  );
  statusRun.text = "$(play) Run";
  statusRun.tooltip = "Android: Run & Stream Logs";
  statusRun.command = "androidRunner.runAndLogs";

  const statusLogs = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    300
  );
  statusLogs.text = "$(output) Logs";
  statusLogs.tooltip = "Android: Logs";
  statusLogs.command = "androidRunner.logs";

  const statusStop = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    200
  );
  statusStop.text = "$(debug-stop) Stop";
  statusStop.tooltip = "Android: Stop Logs";
  statusStop.command = "androidRunner.stopLogs";

  const statusKill = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusKill.text = "$(trash) Kill";
  statusKill.tooltip = "Android: Kill Emulator";
  statusKill.command = "androidRunner.killEmulator";

  const updateStatusBar = () => {
    const visible = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (visible) {
      statusRun.show();
      statusLogs.show();
      statusStop.show();
      statusKill.show();
    } else {
      statusRun.hide();
      statusLogs.hide();
      statusStop.hide();
      statusKill.hide();
    }
  };
  updateStatusBar();
  context.subscriptions.push(
    statusRun,
    statusLogs,
    statusStop,
    statusKill,
    vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar)
  );

  const disposeLogcat = () => {
    if (currentLogcatDispose) {
      currentLogcatDispose();
      currentLogcatDispose = null;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("androidRunner.runAndLogs", async () => {
      try {
        const projectRoot = ensureWorkspace();
        checkGradlew(projectRoot);
        checkSdk();

        const config = getConfig();
        const defaultAvd = config.get<string>("defaultAvd") ?? "";
        const keepEmulator = config.get<boolean>("keepEmulator") ?? false;

        // QuickPick 1: AVD
        const avds = await listAvds();
        const avdItems: vscode.QuickPickItem[] = [
          {
            label: "$(device-mobile) Use running emulator",
            description: "Skip starting a new emulator",
            detail: USE_EXISTING_EMULATOR,
          },
          ...avds.map((name) => ({
            label: name,
            description: name === defaultAvd ? "Default" : undefined,
          })),
        ];

        const avdPick = await vscode.window.showQuickPick(avdItems, {
          title: "Select AVD",
          placeHolder: "Choose an emulator",
        });

        if (!avdPick) {
          return;
        }

        let avdName: string | null =
          avdPick.detail === USE_EXISTING_EMULATOR ? null : avdPick.label;

        // If "Use running emulator" but none is running, prompt for AVD to start
        if (avdName === null) {
          const existing = await getRunningEmulator();
          if (!existing) {
            if (avds.length === 0) {
              vscode.window.showErrorMessage(
                "No emulator running and no AVDs found. Run 'emulator -list-avds' in terminal to verify your Android SDK setup."
              );
              return;
            }
            const avdToStart = await vscode.window.showQuickPick(avds.map((n) => ({ label: n })), {
              title: "No emulator running. Select AVD to start",
              placeHolder: "Choose an emulator to launch",
            });
            if (!avdToStart) {
              return;
            }
            avdName = avdToStart.label;
          }
        }

        // QuickPick 2: Install task
        const tasks = await listInstallTasks(projectRoot);
        if (tasks.length === 0) {
          vscode.window.showErrorMessage(
            "No install tasks found. Run ./gradlew :app:tasks --all to verify."
          );
          return;
        }

        const taskPick = await vscode.window.showQuickPick(
          tasks.map((t) => ({
            label: t,
            description: getAppIdForTask(t) ?? "(configure appId in settings)",
          })),
          {
            title: "Select install task",
            placeHolder: "Choose a Gradle install task",
          }
        );

        if (!taskPick) {
          return;
        }

        const gradleTask = taskPick.label;
        const appId = getAppIdForTask(gradleTask);

        if (!appId) {
          vscode.window.showErrorMessage(
            `No applicationId configured for ${gradleTask}. Add "androidRunner.taskAppIds" in settings, e.g. {"installStaging": "com.example.app.staging"}.`
          );
          return;
        }

        disposeLogcat();

        const result = await runAndStreamLogs({
          projectRoot,
          avdName,
          gradleTask,
          appId,
          keepEmulator,
          output,
          notify: createNotifier(),
        });

        currentLogcatDispose = result.logcatDispose;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
        output.appendLine(`[ERROR] ${msg}`);
      }
    }),

    vscode.commands.registerCommand("androidRunner.runStaging", async () => {
      try {
        const projectRoot = ensureWorkspace();
        checkGradlew(projectRoot);
        checkSdk();

        const config = getConfig();
        const defaultAvd = config.get<string>("defaultAvd") ?? "Pixel_9_API34";
        const keepEmulator = config.get<boolean>("keepEmulator") ?? false;
        const appId =
          config.get<Record<string, string>>("taskAppIds")?.installStaging ??
          "com.altwo.wallet.staging";

        disposeLogcat();

        const result = await runAndStreamLogs({
          projectRoot,
          avdName: defaultAvd,
          gradleTask: ":app:installStaging",
          appId,
          keepEmulator,
          output,
          notify: createNotifier(),
        });
        currentLogcatDispose = result.logcatDispose;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
        output.appendLine(`[ERROR] ${msg}`);
      }
    }),

    vscode.commands.registerCommand("androidRunner.logs", async () => {
      try {
        checkSdk();
        const deviceId = await getRunningEmulator();
        if (!deviceId) {
          vscode.window.showErrorMessage(
            "No emulator running. Start one first."
          );
          return;
        }

        const config = getConfig();
        const mapping = config.get<Record<string, string>>("taskAppIds") ?? {};
        const appIds = [...new Set(Object.values(mapping))];

        if (appIds.length === 0) {
          vscode.window.showErrorMessage(
            "Configure androidRunner.taskAppIds in settings to show app logs."
          );
          return;
        }

        const appPick = await vscode.window.showQuickPick(
          appIds.map((id) => ({ label: id })),
          { title: "Select app to show logs" }
        );

        if (!appPick) {
          return;
        }

        const appId = appPick.label;
        const { getAppPid, launchApp } = await import("./adb.js");

        let pid: string | null = await getAppPid(deviceId, appId);
        for (let i = 0; i < 5 && !pid; i++) {
          await launchApp(deviceId, appId);
          await new Promise((r) => setTimeout(r, 2000));
          pid = await getAppPid(deviceId, appId);
        }

        disposeLogcat();

        const { dispose } = streamLogcat(deviceId, output, pid);
        currentLogcatDispose = dispose;
        output.show(true);
        output.appendLine(
          pid
            ? `[INFO] Streaming logs for ${appId} (PID ${pid})`
            : `[INFO] Streaming full logcat`
        );
        if (getConfig().get<boolean>("notifications") !== false) {
          vscode.window.showInformationMessage(
            `Streaming logs for ${appId}. Use Android: Stop Logs to stop.`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("androidRunner.killEmulator", async () => {
      try {
        checkSdk();
        const deviceId = await getRunningEmulator();
        if (!deviceId) {
          vscode.window.showInformationMessage(
            "No emulator running."
          );
          return;
        }

        disposeLogcat();
        await killEmulator(deviceId);
        vscode.window.showInformationMessage(
          `Emulator ${deviceId} killed.`
        );
        output.appendLine(`[INFO] Killed emulator ${deviceId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("androidRunner.stopLogs", () => {
      disposeLogcat();
      vscode.window.showInformationMessage("Logcat stopped.");
    })
  );

  context.subscriptions.push({
    dispose: disposeLogcat,
  });
}

export function deactivate() {}
