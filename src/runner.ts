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
}

export interface RunResult {
  deviceId: string;
  startedEmulator: boolean;
  logcatDispose: () => void;
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
  } else if (avdName) {
    startEmulator(avdName, output);
    startedEmulator = true;
    output.appendLine("[INFO] Waiting for emulator to be ready...");
    deviceId = await waitForEmulator();
    output.appendLine(`[INFO] Emulator ready: ${deviceId}`);
  } else {
    throw new Error(
      "No emulator running and no AVD selected. Start an emulator or select an AVD."
    );
  }

  // 2. Run Gradle install
  await runGradleInstall(projectRoot, gradleTask, output);

  // 3. Get app PID (launch with monkey if needed)
  let pid: string | null = null;
  const maxAttempts = 10;

  for (let i = 1; i <= maxAttempts; i++) {
    pid = await getAppPid(deviceId, appId);
    if (pid) {
      output.appendLine(`[INFO] App PID: ${pid}`);
      break;
    }
    output.appendLine(
      `[INFO] App not running (attempt ${i}/${maxAttempts}), launching...`
    );
    await launchApp(deviceId, appId);
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!pid) {
    output.appendLine(
      "[WARN] Could not get app PID. Streaming full logcat (unfiltered)."
    );
  }

  // 4. Stream logcat
  const { dispose: logcatDispose } = streamLogcat(deviceId, output, pid);

  output.appendLine(
    pid
      ? `[INFO] Streaming logs (filtered by PID ${pid}). Press Stop or close to exit.`
      : "[INFO] Streaming full logcat. Press Stop or close to exit."
  );
  output.appendLine("");

  // 5. Register cleanup
  const cleanup = () => {
    logcatDispose();
    if (startedEmulator && !keepEmulator && deviceId.startsWith("emulator-")) {
      output.appendLine(`[INFO] Killing emulator ${deviceId}`);
      killEmulator(deviceId).catch(() => {});
    }
  };

  return {
    deviceId,
    startedEmulator,
    logcatDispose: cleanup,
  };
}
