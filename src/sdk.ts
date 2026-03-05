import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";

const isWindows = process.platform === "win32";
const adbName = isWindows ? "adb.exe" : "adb";
const emulatorName = isWindows ? "emulator.exe" : "emulator";

function getDefaultSdkPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];

  if (process.env.ANDROID_HOME) {
    paths.push(process.env.ANDROID_HOME);
  }
  if (process.env.ANDROID_SDK_ROOT) {
    paths.push(process.env.ANDROID_SDK_ROOT);
  }

  // Common SDK locations
  if (process.platform === "darwin") {
    paths.push(path.join(home, "Library", "Android", "sdk"));
  } else if (process.platform === "win32") {
    paths.push(path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk"));
    paths.push(path.join(process.env.USERPROFILE || "", "AppData", "Local", "Android", "Sdk"));
  }
  paths.push(path.join(home, "Android", "Sdk"));
  paths.push(path.join(home, "android-sdk"));

  return [...new Set(paths)];
}

/**
 * Resolve Android SDK root path.
 * Priority: setting > ANDROID_HOME > ANDROID_SDK_ROOT > common paths
 */
export function getSdkPath(): string | null {
  const config = vscode.workspace.getConfiguration("androidRunner");
  const settingPath = config.get<string>("sdkPath")?.trim();

  if (settingPath && fs.existsSync(settingPath)) {
    return path.resolve(settingPath);
  }

  for (const p of getDefaultSdkPaths()) {
    if (p && fs.existsSync(p)) {
      return path.resolve(p);
    }
  }

  return null;
}

/**
 * Get full path to adb executable
 */
export function getAdbPath(): string {
  const sdk = getSdkPath();
  if (sdk) {
    const p = path.join(sdk, "platform-tools", adbName);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return "adb";
}

/**
 * Get process.env with ANDROID_SDK_ROOT and ANDROID_HOME set.
 * Use when spawning emulator/adb so they resolve SDK paths correctly.
 */
export function getEnvWithSdk(): NodeJS.ProcessEnv {
  const sdk = getSdkPath();
  const env = { ...process.env };
  if (sdk) {
    env.ANDROID_SDK_ROOT = sdk;
    env.ANDROID_HOME = sdk;
  }
  return env;
}

/**
 * Get full path to emulator executable
 */
export function getEmulatorPath(): string {
  const sdk = getSdkPath();
  if (sdk) {
    const p = path.join(sdk, "emulator", emulatorName);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return "emulator";
}
