import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { getRunningEmulator, waitForDevice } from "./adb.js";
import { getEmulatorPath, getEnvWithSdk } from "./sdk.js";

const execAsync = promisify(exec);

/**
 * List available AVDs from emulator -list-avds
 */
export async function listAvds(): Promise<string[]> {
  const emulator = getEmulatorPath();
  const { stdout } = await execAsync(`"${emulator}" -list-avds`, {
    env: getEnvWithSdk(),
    maxBuffer: 1024 * 1024,
  });

  const avds = stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return avds;
}

/**
 * Start emulator in background. Streams stdout/stderr to output in real-time.
 * Caller must wait for device to appear via adb.
 */
export function startEmulator(
  avdName: string,
  output: vscode.OutputChannel
): { child: ReturnType<typeof spawn> } {
  const emulator = getEmulatorPath();
  output.appendLine(`[INFO] Starting emulator: ${avdName}`);
  const child = spawn(emulator, ["-avd", avdName], {
    env: getEnvWithSdk(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (d) => output.append(d.toString()));
  child.stderr?.on("data", (d) => output.append(d.toString()));
  child.on("error", (err) => output.appendLine(`[emulator error] ${err.message}`));

  child.unref();
  return { child };
}

/**
 * Wait for emulator to appear in adb devices (with timeout)
 */
export async function waitForEmulator(timeoutMs = 300000): Promise<string> {
  await waitForDevice();

  const intervalMs = 5000;
  let elapsed = 0;

  while (elapsed < timeoutMs) {
    const deviceId = await getRunningEmulator();
    if (deviceId) {
      return deviceId;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    elapsed += intervalMs;
  }

  throw new Error(`Timeout (${timeoutMs / 1000}s) waiting for emulator to be available`);
}
