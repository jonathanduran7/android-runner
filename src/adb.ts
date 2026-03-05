import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { getAdbPath } from "./sdk.js";

const execAsync = promisify(exec);

export interface AdbDevice {
  id: string;
  isEmulator: boolean;
}

/**
 * Get list of connected devices from adb
 */
export async function getDevices(): Promise<AdbDevice[]> {
  const adb = getAdbPath();
  const { stdout } = await execAsync(`"${adb}" devices -l`, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  });

  const lines = stdout.split("\n").slice(1);
  const devices: AdbDevice[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("*")) {
      continue;
    }

    const id = trimmed.split(/\s+/)[0];
    if (id && id !== "List") {
      devices.push({
        id,
        isEmulator: id.startsWith("emulator-"),
      });
    }
  }

  return devices;
}

/**
 * Get the first running emulator device ID, or null if none
 */
export async function getRunningEmulator(): Promise<string | null> {
  const devices = await getDevices();
  const emu = devices.find((d) => d.isEmulator);
  return emu ? emu.id : null;
}

/**
 * Wait for a device to be available (with optional device filter)
 */
export async function waitForDevice(deviceId?: string): Promise<void> {
  const adb = getAdbPath();
  const args = deviceId ? ["-s", deviceId, "wait-for-device"] : ["wait-for-device"];
  await execAsync(`"${adb}" ${args.join(" ")}`, {
    env: process.env,
    timeout: 5000,
  }).catch(() => {
    // wait-for-device can timeout; we retry in caller
  });
}

/**
 * Get PID of an app by package name on a device
 */
export async function getAppPid(
  deviceId: string,
  appId: string
): Promise<string | null> {
  const adb = getAdbPath();
  const { stdout } = await execAsync(
    `"${adb}" -s "${deviceId}" shell pidof "${appId}"`,
    { env: process.env, maxBuffer: 1024 }
  ).catch(() => ({ stdout: "" }));

  const pid = (stdout || "").trim().replace(/\r/g, "");
  return pid || null;
}

/**
 * Resolve the launcher activity component for a package (e.g. "com.example/.MainActivity").
 * Returns null if not resolvable.
 */
async function resolveLauncherComponent(
  adb: string,
  deviceId: string,
  appId: string
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `"${adb}" -s "${deviceId}" shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${appId}`,
      { env: process.env, maxBuffer: 4096 }
    );
    // Output has a "priority" line first, then the component on the last non-empty line
    const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const component = lines[lines.length - 1];
    if (component && component.includes("/")) {
      return component;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Launch app and bring to foreground.
 * Strategy:
 *   1. Resolve the exact launcher activity component via `cmd package resolve-activity`
 *      and start it with `am start -n <component>` (most reliable).
 *   2. Fall back to `monkey` if resolution fails.
 */
export async function launchApp(
  deviceId: string,
  appId: string
): Promise<void> {
  const adb = getAdbPath();

  const component = await resolveLauncherComponent(adb, deviceId, appId);

  if (component) {
    // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TOP to bring launcher to front
    await execAsync(
      `"${adb}" -s "${deviceId}" shell am start -n "${component}" -f 0x10c00000`,
      { env: process.env, maxBuffer: 1024 }
    ).catch(() => {});
    return;
  }

  // Fallback: monkey is reliable for opening the default launcher activity
  await execAsync(
    `"${adb}" -s "${deviceId}" shell monkey -p "${appId}" -c android.intent.category.LAUNCHER 1`,
    { env: process.env, maxBuffer: 1024 }
  ).catch(() => {});
}

/**
 * Kill emulator
 */
export async function killEmulator(deviceId: string): Promise<void> {
  const adb = getAdbPath();
  await execAsync(`"${adb}" -s "${deviceId}" emu kill`, {
    env: process.env,
    timeout: 5000,
  }).catch(() => {});
}

/**
 * Stream logcat to OutputChannel, optionally filtered by PID (cross-platform).
 * @param onHttpLine - optional callback invoked for every raw logcat line that
 *   contains "okhttp.OkHttpClient:", allowing callers to feed an OkHttpParser.
 */
export function streamLogcat(
  deviceId: string,
  output: vscode.OutputChannel,
  pid?: string | null,
  onHttpLine?: (line: string) => void
): { child: ReturnType<typeof spawn>; dispose: () => void } {
  const adb = getAdbPath();
  const args = ["-s", deviceId, "logcat"];
  const child = spawn(adb, args, {
    env: process.env,
  });

  const onData = (data: Buffer | string) => {
    const text = data.toString();
    const lines = text.split("\n");

    for (const line of lines) {
      // Feed OkHttp lines to the network parser regardless of PID filter
      if (onHttpLine && line.includes("okhttp.OkHttpClient:")) {
        onHttpLine(line);
      }

      if (pid) {
        if (line.includes(pid)) {
          output.append(line + "\n");
        }
      } else {
        if (line) {
          output.append(line + "\n");
        }
      }
    }
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", (d) => output.append(d.toString()));

  child.on("error", (err) => {
    output.appendLine(`[adb logcat error] ${err.message}`);
  });

  const dispose = () => {
    child.kill("SIGTERM");
  };

  return { child, dispose };
}
