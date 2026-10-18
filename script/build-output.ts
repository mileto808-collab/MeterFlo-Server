import fs from "node:fs/promises";
import path from "node:path";

/** Compile separately; a failed compiler must never remove the installed build. */
export async function prepareBuildOutput(
  root: string,
  compile: (directory: string) => Promise<void>,
  move: typeof fs.rename = fs.rename,
) {
  const destination = path.join(root, "dist");
  await fs.mkdir(path.join(root, "generated-artifacts"), { recursive: true });
  const run = await fs.mkdtemp(path.join(root, "generated-artifacts/build-"));
  const next = path.join(run, "next-dist");
  const previous = path.join(run, "previous-dist");
  await compile(next);
  for (const file of ["index.cjs", "public/index.html", "customer-release.json"]) {
    if (!(await fs.stat(path.join(next, file))).isFile())
      throw new Error(`Incomplete build: ${file}. Installed output has not been changed.`);
  }
  const prior = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (prior && (!prior.isDirectory() || prior.isSymbolicLink()))
    throw new Error("dist must be a real directory; installed output has not been changed.");
  if (prior) await move(destination, previous);
  try {
    await move(next, destination);
  } catch (error) {
    if (prior) {
      try { await move(previous, destination); }
      catch { throw new Error(`Build promotion and recovery failed. Prior output is retained at ${previous}. Do not restart.`); }
    }
    throw error;
  }
  if (prior) console.log(`Previous compiled build retained at ${previous}`);
}
