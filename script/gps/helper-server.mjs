import { timingSafeEqual } from "node:crypto";

export function gpsHelperHandler({ origins, token, capture, provider }) {
  const seen = new Map();
  let busy = false;
  return async (req, res) => {
    const origin = req.headers.origin;
    const send = (status, value) => {
      if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
    };
    if (!origins.includes(origin)) return send(403, { message: "Website is not authorized." });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Access-Control-Max-Age", "600");
      res.writeHead(204); return res.end();
    }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return send(401, { message: "Pairing required." });
    if (req.url === "/status" && req.method === "GET") return send(200, { version: 1, provider });
    if (req.url !== "/capture" || req.method !== "POST") return send(404, { message: "Not found." });
    if (busy) return send(409, { message: "Receiver is busy." });
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2048) { send(413, { message: "Request too large." }); req.destroy(); }
    });
    req.on("end", async () => {
      let input;
      try { input = JSON.parse(body); } catch { return send(400, { message: "Invalid request." }); }
      const now = Date.now();
      for (const [id, time] of seen) if (time < now - 60000) seen.delete(id);
      if (input.version !== 1 || input.origin !== origin || typeof input.id !== "string" ||
          !/^[a-f0-9-]{36}$/i.test(input.id) || !Number.isFinite(input.startedAt) ||
          Math.abs(now - input.startedAt) > 15000 || seen.has(input.id) || seen.size >= 30 ||
          !Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 10000)
        return send(400, { message: "Invalid, expired or repeated capture request." });
      if (busy) return send(409, { message: "Receiver is busy." });
      seen.set(input.id, now); busy = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      res.on("close", () => controller.abort());
      try {
        const fix = await capture(controller.signal);
        if (!controller.signal.aborted) send(200, { version: 1, id: input.id, origin, fix });
        else send(504, { message: "Receiver did not provide a fresh fix in time." });
      } catch { send(503, { message: "Receiver unavailable. Browser fallback remains available." }); }
      finally { clearTimeout(timer); busy = false; }
    });
  };
}
