import { exec, spawn } from "child_process";
import { promisify } from "util";
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

  // Match installXxx (Xxx = flavor: Debug, Staging, Release, etc.)
  const regex = /:app:install([A-Za-z][A-Za-z0-9]*)|\binstall([A-Z][A-Za-z0-9]*)/g;

  for (const line of stdout.split("\n")) {
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(line)) !== null) {
      const flavor = m[1] || m[2];
      if (flavor) {
        const task = `:app:install${flavor}`;
        if (!seen.has(task)) {
          seen.add(task);
          tasks.push(task);
        }
      }
    }
  }

  return tasks.sort();
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
