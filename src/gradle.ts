import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as vscode from "vscode";
import * as path from "path";

const execAsync = promisify(exec);

/**
 * Parse install task names from gradlew :app:tasks --all output
 * Looks for lines containing "install" and extracts task path (e.g. :app:installStaging)
 */
export async function listInstallTasks(projectRoot: string): Promise<string[]> {
  const gradlew =
    process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const fullPath = path.join(projectRoot, gradlew);

  const { stdout } = await execAsync(
    `"${fullPath}" :app:tasks --all`,
    { cwd: projectRoot, env: process.env, maxBuffer: 1024 * 1024 }
  ).catch(() => ({ stdout: "" }));

  const tasks: string[] = [];
  const seen = new Set<string>();

  // Match lines where the task name starts at the beginning (with optional :app: prefix).
  // Excludes instrumented test tasks (AndroidTest) and unit test tasks (UnitTest).
  const lineRegex = /^(?::app:)?(install([A-Z][A-Za-z0-9]*))(?:\s+-\s+|\s*$)/;
  const testSuffixes = ["AndroidTest", "UnitTest"];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trimStart();
    const m = lineRegex.exec(trimmed);
    if (!m) {
      continue;
    }
    const suffix = m[2];
    if (testSuffixes.some((s) => suffix.endsWith(s))) {
      continue;
    }
    const task = `:app:install${suffix}`;
    if (!seen.has(task)) {
      seen.add(task);
      tasks.push(task);
    }
  }

  return tasks.sort();
}

/**
 * Extract the content between matching braces for a named block (e.g. "defaultConfig {…}").
 * Handles nested braces correctly.
 */
function extractGradleBlock(content: string, blockName: string): string {
  const pattern = new RegExp(`\\b${blockName}\\s*\\{`);
  const match = pattern.exec(content);
  if (!match) {
    return "";
  }
  const braceStart = content.indexOf("{", match.index);
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === "{") {
      depth++;
    } else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(braceStart + 1, i);
      }
    }
  }
  return "";
}

/**
 * Extract applicationId info (full override or suffix) from a named sub-block.
 */
function getIdInfoFromBlock(
  parentBlock: string,
  name: string
): { fullId?: string; suffix?: string } | null {
  const block = extractGradleBlock(parentBlock, name);
  if (!block) {
    return null;
  }
  // A build type can only have applicationIdSuffix; a flavor can override applicationId entirely.
  // Match applicationId but NOT applicationIdSuffix (negative lookahead on "Suffix").
  const fullId = block.match(/\bapplicationId(?!Suffix)\s*[=]?\s*["']([^"']+)["']/)?.[1];
  const suffix = block.match(/\bapplicationIdSuffix\s*[=]?\s*["']([^"']+)["']/)?.[1];
  return { fullId, suffix };
}

/**
 * Auto-detect the applicationId for a given install task suffix (e.g. "Debug", "Staging",
 * "StagingDebug") by parsing app/build.gradle or app/build.gradle.kts.
 *
 * Handles:
 *  - Simple build types:          installDebug    → buildTypes { debug { applicationIdSuffix } }
 *  - Product flavors:             installStaging  → productFlavors { staging { applicationId } }
 *  - Flavor + build type combos:  installStagingDebug → flavor "staging" + buildType "debug"
 *  - Full applicationId overrides inside flavors (not just suffixes)
 *
 * Returns null if the file cannot be found or the base applicationId cannot be parsed.
 */
export function detectAppIdSync(projectRoot: string, taskSuffix: string): string | null {
  const candidates = [
    path.join(projectRoot, "app", "build.gradle"),
    path.join(projectRoot, "app", "build.gradle.kts"),
  ];

  let content = "";
  for (const f of candidates) {
    try {
      content = fs.readFileSync(f, "utf8");
      break;
    } catch {
      continue;
    }
  }

  if (!content) {
    return null;
  }

  // Base applicationId from defaultConfig
  const defaultConfigBlock = extractGradleBlock(content, "defaultConfig");
  const baseIdMatch = defaultConfigBlock.match(/\bapplicationId(?!Suffix)\s*[=]?\s*["']([^"']+)["']/);
  if (!baseIdMatch) {
    return null;
  }
  const baseId = baseIdMatch[1];

  const buildTypesBlock = extractGradleBlock(content, "buildTypes");
  const flavorsBlock = extractGradleBlock(content, "productFlavors");

  // Lowercase-first camelCase name e.g. "StagingDebug" → "stagingDebug"
  const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const suffixLower = lcFirst(taskSuffix);

  // ── 1. Exact match in productFlavors ──────────────────────────────────────
  const flavorExact = getIdInfoFromBlock(flavorsBlock, suffixLower);
  if (flavorExact) {
    if (flavorExact.fullId) { return flavorExact.fullId; }
    if (flavorExact.suffix) { return baseId + flavorExact.suffix; }
    return baseId;
  }

  // ── 2. Exact match in buildTypes ──────────────────────────────────────────
  const btExact = getIdInfoFromBlock(buildTypesBlock, suffixLower);
  if (btExact) {
    if (btExact.fullId) { return btExact.fullId; }
    if (btExact.suffix) { return baseId + btExact.suffix; }
    return baseId;
  }

  // ── 3. Compound name: split camelCase into flavor + buildType parts ────────
  // e.g. "StagingDebug" → ["Staging", "Debug"], try flavor="staging" + bt="debug"
  const parts = taskSuffix.match(/[A-Z][a-z0-9]*/g) ?? [];
  for (let split = 1; split < parts.length; split++) {
    const flavorName = lcFirst(parts.slice(0, split).join(""));
    const btName = lcFirst(parts.slice(split).join(""));

    const flavorInfo = getIdInfoFromBlock(flavorsBlock, flavorName);
    const btInfo = getIdInfoFromBlock(buildTypesBlock, btName);

    if (!flavorInfo && !btInfo) {
      continue;
    }

    // Start from defaultConfig base; let flavor override it, then build type appends suffix.
    let appId = baseId;
    if (flavorInfo?.fullId) {
      appId = flavorInfo.fullId;
    } else if (flavorInfo?.suffix) {
      appId = baseId + flavorInfo.suffix;
    }
    if (btInfo?.suffix) {
      appId = appId + btInfo.suffix;
    }
    return appId;
  }

  return baseId;
}

/**
 * Run Gradle install task
 */
export async function runGradleInstall(
  projectRoot: string,
  task: string,
  output: vscode.OutputChannel
): Promise<void> {
  return new Promise((resolve, reject) => {
    const gradlew =
      process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    output.appendLine(`[INFO] Running: ${gradlew} ${task}`);

    const child = spawn(gradlew, [task], {
      cwd: projectRoot,
      shell: true,
      env: process.env,
    });

    child.stdout.on("data", (d) => output.append(d.toString()));
    child.stderr.on("data", (d) => output.append(d.toString()));

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Gradle install failed with exit code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
