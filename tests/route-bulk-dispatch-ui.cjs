// Run the feature's real browser flow without depending on the legacy
// simulated external-Maps navigation checks later in the broader route suite.
// The owned sandbox creates and destroys the app, database and accounts.
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) {
  throw new Error("Run through tests/support/project-workspace-sandbox.mjs");
}
process.env.METERFLO_BULK_DISPATCH_ONLY = "1";
require("./work-order-routing-ui.cjs");
