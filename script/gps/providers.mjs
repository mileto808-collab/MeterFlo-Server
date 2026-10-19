import net from "node:net";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function coordinate(degreesMinutes, direction, latitude) {
  if (!/^\d+(?:\.\d+)?$/.test(degreesMinutes) || !(latitude ? ["N", "S"] : ["E", "W"]).includes(direction)) return null;
  const value = Number(degreesMinutes), degrees = Math.floor(value / 100), minutes = value - degrees * 100;
  const result = (degrees + minutes / 60) * (["S", "W"].includes(direction) ? -1 : 1);
  return minutes >= 0 && minutes < 60 && Math.abs(result) <= (latitude ? 90 : 180) ? result : null;
}

/** RMC includes an actual GNSS date/time. HDOP is NOT a metre accuracy value. */
export function parseRmc(line) {
  const match = /^\$([A-Z]{2}RMC,[^*\r\n]+)\*([0-9A-F]{2})$/i.exec(line.trim());
  if (!match) return null;
  const checksum = [...match[1]].reduce((sum, char) => sum ^ char.charCodeAt(0), 0);
  if (checksum !== parseInt(match[2], 16)) return null;
  const f = match[1].split(",");
  if (f[2] !== "A" || (f[12] && !["A", "D", "R", "F", "P"].includes(f[12])) ||
      !/^\d{6}(?:\.\d+)?$/.test(f[1]) || !/^\d{6}$/.test(f[9])) return null;
  const lat = coordinate(f[3], f[4], true), lng = coordinate(f[5], f[6], false);
  if (lat == null || lng == null) return null;
  const year = Number(f[9].slice(4)), month = Number(f[9].slice(2, 4)), day = Number(f[9].slice(0, 2));
  const hour = Number(f[1].slice(0, 2)), minute = Number(f[1].slice(2, 4)), seconds = Number(f[1].slice(4));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || seconds >= 60) return null;
  const time = new Date(Date.UTC(year >= 80 ? year + 1900 : year + 2000, month - 1, day, hour, minute, 0, Math.round(seconds * 1000)));
  if (time.getUTCDate() !== day || time.getUTCMonth() !== month - 1) return null;
  return { coordinates: `${lat}, ${lng}`, source: "native", receiver: "external", accuracy: null, capturedAt: time.toISOString() };
}

function fresh(fix) {
  if (!fix || !Number.isFinite(Date.parse(fix.capturedAt))) return false;
  const age = Date.now() - Date.parse(fix.capturedAt);
  return age >= -60000 && age <= 15000;
}

function lineCapture(stream, signal, parse) {
  return new Promise((resolve, reject) => {
    let buffer = "", finished = false;
    const finish = (error, fix) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      stream.destroy();
      error ? reject(error) : resolve(fix);
    };
    const abort = () => finish(new Error("Native capture cancelled or timed out."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    stream.on("error", () => finish(new Error("Cannot access the configured GPS provider.")));
    stream.on("end", () => finish(new Error("GPS provider closed before a fresh fix.")));
    stream.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 65536) return finish(new Error("Invalid GPS provider stream."));
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        try {
          const fix = parse(line);
          if (fresh(fix)) return finish(null, fix);
        } catch { /* Ignore malformed receiver sentences; never promote them to fixes. */ }
      }
    });
  });
}

export function gpsdCapture(signal, port = 2947) {
  const stream = net.createConnection({ host: "127.0.0.1", port });
  stream.on("connect", () => stream.write('?WATCH={"enable":true,"json":true};\n'));
  return lineCapture(stream, signal, line => {
    const value = JSON.parse(line);
    if (value.class !== "TPV" || value.mode < 2 || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) ||
        Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180 || typeof value.time !== "string") return null;
    return { coordinates: `${value.lat}, ${value.lon}`, source: "native", receiver: "unknown",
      accuracy: Number.isFinite(value.eph) && value.eph >= 0 ? value.eph : null, capturedAt: value.time };
  });
}

export function nmeaCapture(signal, device) {
  return lineCapture(fs.createReadStream(device), signal, parseRmc);
}

export function windowsCapture(signal, serialPort, baud = 9600) {
  if (process.platform !== "win32") throw new Error("The Windows location provider requires Windows.");
  if (serialPort && !/^COM[1-9]\d{0,2}$/i.test(serialPort)) throw new Error("Select a COM port such as COM3.");
  const script = fileURLToPath(new URL("./windows-location.ps1", import.meta.url));
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script,
    ...(serialPort ? ["-Port", serialPort, "-Baud", String(baud)] : [])], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  // Do not echo provider stdout/stderr: position data stays out of helper logs.
  child.on("error", () => child.stdout.destroy(new Error("Windows location provider could not start.")));
  child.stderr.resume();
  child.on("exit", () => { if (!child.stdout.destroyed) child.stdout.push(null); });
  return lineCapture(child.stdout, signal, line => serialPort ? parseRmc(line) : JSON.parse(line))
    .finally(() => child.kill());
}
