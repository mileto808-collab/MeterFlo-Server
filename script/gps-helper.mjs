// Runs on the technician's computer, NEVER as a hosted app workflow.
import { createServer } from "node:https";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { gpsHelperHandler } from "./gps/helper-server.mjs";
import { gpsdCapture, nmeaCapture, windowsCapture } from "./gps/providers.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!/^--[a-z-]+$/.test(process.argv[i]) || !process.argv[i + 1]) throw new Error("Expected --option value.");
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
const origins = (args.origin ?? "").split(",");
if (!args.cert || !args.key || !args["token-file"] || !["gpsd", "windows", "nmea"].includes(args.provider) ||
    !origins.every(value => { try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; } catch { return false; } }))
  throw new Error("Required: --origin https://your-exact-site --cert file --key file --token-file private-file --provider gpsd|windows|nmea. See docs/GPS_CAPTURE.md.");
if (args.provider === "nmea" && !args.device) throw new Error("NMEA requires --device /dev/ttyUSB0 or COM3.");
const port = Number(args.port ?? 47764), baud = Number(args.baud ?? 9600);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(baud) || baud < 4800 || baud > 921600)
  throw new Error("Invalid port or baud rate.");
if (!fs.existsSync(args["token-file"])) fs.writeFileSync(args["token-file"], randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
const token = fs.readFileSync(args["token-file"], "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid private pairing file.");
const capture = args.provider === "windows" ? signal => windowsCapture(signal)
  : args.provider === "gpsd" ? signal => gpsdCapture(signal)
  : process.platform === "win32" ? signal => windowsCapture(signal, args.device, baud)
  : signal => nmeaCapture(signal, args.device);
const server = createServer({ cert: fs.readFileSync(args.cert), key: fs.readFileSync(args.key), minVersion: "TLSv1.2" },
  gpsHelperHandler({ origins, token, capture, provider: args.provider }));
server.requestTimeout = 12000;
server.headersTimeout = 10000;
server.listen(port, "127.0.0.1", () => console.log(`GPS helper listening on HTTPS loopback port ${port}. Pair through /gps-setup. Location data and pairing keys are not logged.`));
