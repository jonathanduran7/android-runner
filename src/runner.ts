import * as vscode from "vscode";
import {
  getRunningEmulator,
  getAppPid,
  launchApp,
  killEmulator,
  streamLogcat,
} from "./adb";
import { startEmulator, waitForEmulator } from "./emulator";
import { runGradleInstall } from "./gradle";

export interface RunOptions {
  projectRoot: string;
  avdName: string | null;
  gradleTask: string;
  appId: string;
  keepEmulator: boolean;
  output: vscode.OutputChannel;
  /** Called for user-visible notifications (info/warn). Respects androidRunner.notifications setting when used from extension. */
  notify?: (message: string, type?: "info" | "warn") => void;
  /** Optional callback invoked for each raw OkHttp logcat line for network parsing. */
  onHttpLine?: (line: string) => void;
}

export interface RunResult {
  deviceId: string;
  startedEmulator: boolean;
  /** Stop logcat stream only, does NOT kill the emulator. */
  stopLogcat: () => void;
  /** Full cleanup: stop logcat + kill emulator if applicable. */
  logcatDispose: () => void;
}

interface InstallAndLogsOptions {
  projectRoot: string;
  deviceId: string;
  gradleTask: string;
  appId: string;
  output: vscode.OutputChannel;
  notify?: (message: string, type?: "info" | "warn") => void;
  onHttpLine?: (line: string) => void;
}

async function installOnDeviceAndStreamLogs(
  options: InstallAndLogsOptions
): Promise<RunResult> {
  const { projectRoot, deviceId, gradleTask, appId, output, notify, onHttpLine } = options;

  // 1. Run Gradle install
  await runGradleInstall(projectRoot, gradleTask, output);
  notify?.("Install complete", "info");

  // 2. Wait for install to settle (broadcasts, etc.) then launch launcher activity
  await new Promise((r) => setTimeout(r, 1500));
  output.appendLine(`[INFO] Launching app ${appId}...`);
  await launchApp(deviceId, appId);
  await new Promise((r) => setTimeout(r, 3000));

  // 3. Get app PID (retry launch if not running yet)
  let pid: string | null = null;
  const maxAttempts = 5;

  for (let i = 1; i <= maxAttempts; i++) {
    pid = await getAppPid(deviceId, appId);
    if (pid) {
      output.appendLine(`[INFO] App PID: ${pid}`);
      notify?.("App launched", "info");
      break;
    }
    output.appendLine(
      `[INFO] App not running yet (attempt ${i}/${maxAttempts}), retrying launch...`
    );
    await launchApp(deviceId, appId);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Bring app to foreground if we have a PID
  if (pid) {
    await launchApp(deviceId, appId);
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!pid) {
    output.appendLine(
      "[WARN] Could not get app PID. Streaming full logcat (unfiltered)."
    );
    notify?.("App PID not found. Streaming full logcat.", "warn");
  }

  // 4. Stream logcat
  const { dispose: logcatDisposeInner } = streamLogcat(deviceId, output, pid, onHttpLine);

  output.appendLine(
    pid
      ? `[INFO] Streaming logs (filtered by PID ${pid}). Press Stop or close to exit.`
      : "[INFO] Streaming full logcat. Press Stop or close to exit."
  );
  output.appendLine("");
  notify?.("Streaming logs. Use Android: Stop Logs to stop.", "info");

  const stopLogcat = () => {
    logcatDisposeInner();
  };

  return {
    deviceId,
    startedEmulator: false,
    stopLogcat,
    logcatDispose: stopLogcat,
  };
}

/**
 * Full flow: start emulator if needed, wait, install, get PID, stream logs.
 * Returns dispose function to stop logcat and optionally kill emulator.
 */
export async function runAndStreamLogs(
  options: RunOptions
): Promise<RunResult> {
  const {
    projectRoot,
    avdName,
    gradleTask,
    appId,
    keepEmulator,
    output,
    notify,
    onHttpLine,
  } = options;

  output.show(true);
  output.appendLine("[INFO] Android Runner - Run & Stream Logs");
  output.appendLine("");

  let deviceId: string;
  let startedEmulator = false;

  // 1. Get or start emulator
  let existing = await getRunningEmulator();
  if (existing) {
    deviceId = existing;
    output.appendLine(`[INFO] Using existing emulator: ${deviceId}`);
    notify?.("Using existing emulator", "info");
  } else if (avdName) {
    startEmulator(avdName, output);
    startedEmulator = true;
    output.appendLine("[INFO] Waiting for emulator to be ready...");
    deviceId = await waitForEmulator();
    output.appendLine(`[INFO] Emulator ready: ${deviceId}`);
    notify?.("Emulator ready", "info");
  } else {
    throw new Error(
      "No emulator running and no AVD selected. Start an emulator or select an AVD."
    );
  }

  // 2. Install APK on selected device and stream logs
  const innerResult = await installOnDeviceAndStreamLogs({
    projectRoot,
    deviceId,
    gradleTask,
    appId,
    output,
    notify,
    onHttpLine,
  });

  // 3. Register cleanup
  const { stopLogcat } = innerResult;

  const fullCleanup = () => {
    stopLogcat();
    if (startedEmulator && !keepEmulator && deviceId.startsWith("emulator-")) {
      output.appendLine(`[INFO] Killing emulator ${deviceId}`);
      killEmulator(deviceId).catch(() => {});
      notify?.("Emulator stopped", "info");
    }
  };

  return {
    deviceId,
    startedEmulator,
    stopLogcat,
    logcatDispose: fullCleanup,
  };
}

/**
 * Reinstall on an already running emulator.
 * Does not start or stop the emulator; only reinstalls, launches, and streams logs.
 */
export async function reinstallOnExistingEmulator(
  options: Omit<RunOptions, "avdName" | "keepEmulator"> & { deviceId: string }
): Promise<RunResult> {
  const { projectRoot, gradleTask, appId, output, notify, deviceId, onHttpLine } = options;

  output.show(true);
  output.appendLine("[INFO] Android Runner - Reinstall on Existing Emulator");
  output.appendLine("");
  output.appendLine(`[INFO] Using existing emulator: ${deviceId}`);
  notify?.("Using existing emulator", "info");

  return installOnDeviceAndStreamLogs({
    projectRoot,
    deviceId,
    gradleTask,
    appId,
    output,
    notify,
    onHttpLine,
  });
}
