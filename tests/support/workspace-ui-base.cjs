// A URL override is allowed only through the config created by our owned sandbox.
const fs = require("node:fs");
module.exports = function workspaceBaseURL() {
  const configFile = process.env.WORKSPACE_UI_SANDBOX_CONFIG;
  if (!configFile) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const url = new URL(config.baseURL);
  if (!config.ownedWorkspaceSandbox || !config.runId ||
      url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("Workspace acceptance requires its owned loopback sandbox.");
  return config.baseURL;
};
