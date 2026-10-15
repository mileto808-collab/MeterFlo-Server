import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// No POSIX environment assignment: npm can launch this unchanged from PowerShell/cmd.
// Use the same owned-cluster runner as the customer-verified Windows launcher.
const child = spawn(process.execPath, [
  fileURLToPath(new URL("./inventory-volume-standalone.mjs", import.meta.url)), "--confirm-disposable-checkout",
], { stdio: "inherit" });
child.on("error", () => { console.error("Could not launch inventory acceptance tests"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
