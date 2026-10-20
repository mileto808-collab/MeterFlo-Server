import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

type PgProcessResult = { success: boolean; stdout: string; stderr: string };

/** Process exit is not proof that a piped backup file has finished writing. */
export async function runPgProcess(
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
  outputFile?: string,
): Promise<PgProcessResult> {
  let stdout = "", stderr = "", outputOpened = false;
  const proc = spawn(executable, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
  const completion = new Promise<{ code: number | null; error?: Error }>(resolve => {
    proc.once("close", code => resolve({ code }));
    proc.once("error", error => resolve({ code: null, error }));
  });
  proc.stderr.on("data", data => { stderr += data.toString(); });

  // Attach rejection handling immediately so a filesystem error cannot become
  // an unhandled rejection while we are still waiting for the child to close.
  let outputCompletion: Promise<Error | undefined> = Promise.resolve(undefined);
  if (outputFile) {
    try {
      const destination = fs.createWriteStream(outputFile, { mode: 0o600 });
      destination.once("open", () => { outputOpened = true; });
      outputCompletion = pipeline(proc.stdout, destination).then(() => undefined, error => {
        if (proc.exitCode === null) proc.kill();
        return error as Error;
      });
    } catch (error) {
      proc.stdout.resume();
      proc.kill();
      outputCompletion = Promise.resolve(error as Error);
    }
  } else {
    proc.stdout.on("data", data => { stdout += data.toString(); });
  }

  const processResult = await completion;
  const outputError = await outputCompletion;
  if (processResult.error || outputError || processResult.code !== 0) {
    // Only remove a destination this invocation actually opened. An open
    // permission error must not delete a pre-existing file we could not open.
    if (outputFile && outputOpened) {
      try { await fs.promises.unlink(outputFile); }
      catch (error: any) {
        if (error.code !== "ENOENT") stderr += "\nThe incomplete backup file could not be removed.";
      }
    }
    if (processResult.error) stderr += `\nPostgreSQL tool could not run: ${processResult.error.message}`;
    if (outputError) stderr += `\nBackup output could not be completed: ${outputError.message}`;
    return { success: false, stdout, stderr };
  }
  return { success: true, stdout, stderr };
}
