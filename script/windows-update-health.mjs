import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function waitForUpdatedBuild({ url, expected, read = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "error" });
  if (!response.ok) throw new Error("Unhealthy HTTP response");
  return response.json();
}, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), attempts = 25 }) {
  if (!expected.buildId || !expected.version) throw new Error("Compiled release is missing its build identity.");
  let consecutive = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const actual = await read(url);
      consecutive = actual.ready === true && actual.version === expected.version && actual.buildId === expected.buildId
        ? consecutive + 1 : 0;
      if (consecutive >= 2) return;
    } catch { consecutive = 0; }
    await sleep(1500);
  }
  throw new Error("The restarted application did not serve the expected build twice. Check private .env HOST/PORT settings, cached PM2 overrides, and PM2 logs locally. An 'online' status alone is not success.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await import("dotenv/config");
    const port = Number(process.env.PORT ?? 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid configured PORT.");
    const host = process.env.HOST?.includes(":") ? "[::1]" : "127.0.0.1";
    const expected = JSON.parse(fs.readFileSync("dist/customer-release.json", "utf8"));
    await waitForUpdatedBuild({ url: `http://${host}:${port}/api/system/release-health`, expected });
    console.log("HTTP health verified: the new compiled build is running.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Build health verification failed.");
    process.exitCode = 1;
  }
}
