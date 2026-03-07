import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getRunningEmulator, getPhysicalDevices } from "./adb.js";
import { killEmulator, streamLogcat } from "./adb.js";
import { listAvds } from "./emulator.js";
import { listInstallTasks, detectAppIdSync } from "./gradle.js";
import { runAndStreamLogs, reinstallOnExistingEmulator } from "./runner.js";
import { getSdkPath } from "./sdk.js";
import { registerAndroidView } from "./androidView.js";
import { registerNetworkView } from "./networkLog.js";

const USE_EXISTING_EMULATOR = "__use_existing__";
const PHYSICAL_DEVICE_PREFIX = "__physical__:";

/**
 * Registers a command safely, ignoring "already exists" errors that can occur
 * when the extension is both installed and running in development mode simultaneously.
 */
function safeRegisterCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: unknown[]) => unknown
): void {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  } catch {
    // Command already registered — extension was activated twice (e.g. installed + dev mode).
  }
}

interface LastRunOptions {
  projectRoot: string;
  gradleTask: string;
  appId: string;
}

function getConfig() {
  return vscode.workspace.getConfiguration("androidRunner");
}

function getAppIdForTask(task: string, projectRoot?: string): string | undefined {
  const config = getConfig();
  const mapping = config.get<Record<string, string>>("taskAppIds") ?? {};
  // task is :app:installStaging -> extract installStaging
  const match = task.match(/:app:install([A-Za-z][A-Za-z0-9]*)/);
  const key = match ? `install${match[1]}` : undefined;
  const configured = key ? mapping[key] : undefined;

  if (configured) {
    return configured;
  }

  // Fall back to auto-detection from app/build.gradle
  if (projectRoot && match) {
    return detectAppIdSync(projectRoot, match[1]) ?? undefined;
  }

  return undefined;
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
  const networkOutput = vscode.window.createOutputChannel("Android Network");

  let currentLogcatDispose: (() => void) | null = null;
  let currentStopLogcat: (() => void) | null = null;
  let lastRun: LastRunOptions | null = null;

  const { parser: networkParser, clearNetworkLog } = registerNetworkView(
    context,
    networkOutput
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => clearNetworkLog())
  );

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

  const statusReinstall = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    250
  );
  statusReinstall.text = "$(sync) Reinstall";
  statusReinstall.tooltip = "Android: Reinstall Last APK";
  statusReinstall.command = "androidRunner.reinstallLast";

  const updateStatusBar = () => {
    const visible = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (visible) {
      statusRun.show();
      statusLogs.show();
      statusStop.show();
      statusKill.show();
      statusReinstall.show();
    } else {
      statusRun.hide();
      statusLogs.hide();
      statusStop.hide();
      statusKill.hide();
      statusReinstall.hide();
    }
  };
  updateStatusBar();
  context.subscriptions.push(
    statusRun,
    statusLogs,
    statusStop,
    statusKill,
    statusReinstall,
    vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar)
  );

  // Activity Bar + Tree View
  registerAndroidView(context, output);

  const disposeLogcat = () => {
    if (currentLogcatDispose) {
      currentLogcatDispose();
      currentLogcatDispose = null;
    }
    currentStopLogcat = null;
  };

  const stopLogcatOnly = () => {
    if (currentStopLogcat) {
      currentStopLogcat();
      currentStopLogcat = null;
    }
    currentLogcatDispose = null;
  };

  safeRegisterCommand(context, "androidRunner.runAndLogs", async () => {
      try {
        const projectRoot = ensureWorkspace();
        checkGradlew(projectRoot);
        checkSdk();

        const config = getConfig();
        const defaultAvd = config.get<string>("defaultAvd") ?? "";
        const keepEmulator = config.get<boolean>("keepEmulator") ?? false;

        // QuickPick 1: AVD / physical device
        const [avds, physicalDevices] = await Promise.all([listAvds(), getPhysicalDevices()]);
        const avdItems: vscode.QuickPickItem[] = [
          {
            label: "$(device-mobile) Use running emulator",
            description: "Skip starting a new emulator",
            detail: USE_EXISTING_EMULATOR,
          },
          ...physicalDevices.map((d) => ({
            label: `$(plug) ${d.model ?? d.id}`,
            description: d.id,
            detail: PHYSICAL_DEVICE_PREFIX + d.id,
          })),
          ...avds.map((name) => ({
            label: name,
            description: name === defaultAvd ? "Default" : undefined,
          })),
        ];

        const avdPick = await vscode.window.showQuickPick(avdItems, {
          title: "Select device or AVD",
          placeHolder: "Choose a physical device or emulator",
        });

        if (!avdPick) {
          return;
        }

        // Physical device selected — run directly on it
        if (avdPick.detail?.startsWith(PHYSICAL_DEVICE_PREFIX)) {
          const physicalDeviceId = avdPick.detail.slice(PHYSICAL_DEVICE_PREFIX.length);

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
              description: getAppIdForTask(t, projectRoot) ?? "(auto-detect from build.gradle)",
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
          const appId = getAppIdForTask(gradleTask, projectRoot);

          if (!appId) {
            vscode.window.showErrorMessage(
              `Could not detect applicationId for ${gradleTask}. Add "androidRunner.taskAppIds" in settings, e.g. {"installDebug": "com.example.app.debug"}.`
            );
            return;
          }

          lastRun = { projectRoot, gradleTask, appId };
          disposeLogcat();
          clearNetworkLog();

          const result = await reinstallOnExistingEmulator({
            projectRoot,
            deviceId: physicalDeviceId,
            gradleTask,
            appId,
            output,
            notify: createNotifier(),
            onHttpLine: (line) => networkParser.processLine(line),
          });

          currentLogcatDispose = result.logcatDispose;
          currentStopLogcat = result.stopLogcat;
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
            description: getAppIdForTask(t, projectRoot) ?? "(auto-detect from build.gradle)",
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
        const appId = getAppIdForTask(gradleTask, projectRoot);

        if (!appId) {
          vscode.window.showErrorMessage(
            `Could not detect applicationId for ${gradleTask}. Add "androidRunner.taskAppIds" in settings, e.g. {"installDebug": "com.example.app.debug"}.`
          );
          return;
        }

        lastRun = {
          projectRoot,
          gradleTask,
          appId,
        };

        disposeLogcat();
        clearNetworkLog();

        const result = await runAndStreamLogs({
          projectRoot,
          avdName,
          gradleTask,
          appId,
          keepEmulator,
          output,
          notify: createNotifier(),
          onHttpLine: (line) => networkParser.processLine(line),
        });

        currentLogcatDispose = result.logcatDispose;
        currentStopLogcat = result.stopLogcat;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
        output.appendLine(`[ERROR] ${msg}`);
      }
  });

  safeRegisterCommand(context, "androidRunner.runStaging", async () => {
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

        lastRun = {
          projectRoot,
          gradleTask: ":app:installStaging",
          appId,
        };

        disposeLogcat();
        clearNetworkLog();

        const result = await runAndStreamLogs({
          projectRoot,
          avdName: defaultAvd,
          gradleTask: ":app:installStaging",
          appId,
          keepEmulator,
          output,
          notify: createNotifier(),
          onHttpLine: (line) => networkParser.processLine(line),
        });
        currentLogcatDispose = result.logcatDispose;
        currentStopLogcat = result.stopLogcat;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
        output.appendLine(`[ERROR] ${msg}`);
      }
  });

  safeRegisterCommand(context, "androidRunner.logs", async () => {
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
        clearNetworkLog();

        const { dispose } = streamLogcat(deviceId, output, pid, (line) => networkParser.processLine(line));
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
  });

  safeRegisterCommand(context, "androidRunner.killEmulator", async () => {
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
  });

  safeRegisterCommand(context, "androidRunner.stopLogs", () => {
    disposeLogcat();
    vscode.window.showInformationMessage("Logcat stopped.");
  });

  safeRegisterCommand(context, "androidRunner.reinstallLast", async () => {
      try {
        const run = lastRun;
        if (!run) {
          vscode.window.showErrorMessage(
            "No previous run found. Use Android: Run & Stream Logs or Android: Run Staging first."
          );
          return;
        }

        const projectRoot = run.projectRoot;
        checkGradlew(projectRoot);
        checkSdk();

        const deviceId = await getRunningEmulator();
        if (!deviceId) {
          vscode.window.showErrorMessage(
            "No emulator running. Start an emulator or use Android: Run & Stream Logs."
          );
          return;
        }

        // Solo parar el logcat, NO matar el emulador
        stopLogcatOnly();
        clearNetworkLog();

        const result = await reinstallOnExistingEmulator({
          projectRoot,
          deviceId,
          gradleTask: run.gradleTask,
          appId: run.appId,
          output,
          notify: createNotifier(),
          onHttpLine: (line) => networkParser.processLine(line),
        });

        currentLogcatDispose = result.logcatDispose;
        currentStopLogcat = result.stopLogcat;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Android Runner: ${msg}`);
        output.appendLine(`[ERROR] ${msg}`);
      }
  });

  context.subscriptions.push({
    dispose: disposeLogcat,
  });
}

export function deactivate() {}
