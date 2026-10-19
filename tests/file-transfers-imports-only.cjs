// Reuse signed-in coverage without repeating already-passed export delivery tests.
process.argv.push("--imports-only");
require("./file-transfers-workspace.cjs");
