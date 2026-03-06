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
 * Auto-detect the applicationId for a given install task suffix (e.g. "Debug", "Staging")
 * by parsing app/build.gradle or app/build.gradle.kts in the project root.
 *
 * Returns null if the file cannot be found or parsed.
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

  // Extract base applicationId from defaultConfig block
  const defaultConfigBlock = extractGradleBlock(content, "defaultConfig");
  const baseIdMatch = defaultConfigBlock.match(/applicationId\s*[=]?\s*["']([^"']+)["']/);
  if (!baseIdMatch) {
    return null;
  }
  const baseId = baseIdMatch[1];

  // Look for applicationIdSuffix in the matching build type block
  // e.g. taskSuffix "Staging" -> block name "staging"
  const buildTypeName = taskSuffix.charAt(0).toLowerCase() + taskSuffix.slice(1);
  const buildTypesBlock = extractGradleBlock(content, "buildTypes");
  const buildTypeBlock = extractGradleBlock(buildTypesBlock, buildTypeName);
  const suffixMatch = buildTypeBlock.match(/applicationIdSuffix\s*[=]?\s*["']([^"']+)["']/);

  return suffixMatch ? baseId + suffixMatch[1] : baseId;
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
