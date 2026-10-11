// LOCAL DEMONSTRATION ONLY. These public dummy keys provide no real security.
// Never deploy this launcher or configure a production MeterFlo project with it.
import Database from "better-sqlite3";
import { createImageReceiver } from "./customer-image-receiver.mjs";

const db = new Database(process.argv[2] || "/tmp/customer-image-receiver-demo.sqlite");
const app = createImageReceiver({
  db,
  authenticate: req => req.get("X-Demo-Key") === "local-demo-only" ? { id: "demo-customer" } : null,
  authorizeProject: (principal, projectId) => principal.id === "demo-customer" && projectId === 1,
});
const server = app.listen(5101, "127.0.0.1", () => {
  console.log("Local demo receiver on http://127.0.0.1:5101/work-orders; dummy projectId 1 only");
});
process.on("SIGINT", () => server.close(() => { db.close(); process.exit(0); }));
