// Customer-side reference only. MeterFlo does not import or run this module.
import express from "express";
import { randomUUID } from "node:crypto";

const categories = new Set(["before", "after", "trouble", "signature", "photo"]);
const problem = (status, message) => Object.assign(new Error(message), { status });

// Inspect bytes, not the filename. This identifies format, not complete image
// validity: a production decoder must also enforce dimensions and pixel limits.
export function imageFormat(bytes) {
  const hex = bytes.subarray(0, 8).toString("hex");
  if (hex === "89504e470d0a1a0a") return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (hex.startsWith("424d")) return "image/bmp";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "image/tiff";
  throw problem(422, "Unsupported image byte format");
}

export function decodeImage(data, maxBytes) {
  if (typeof data !== "string" || !data.length || data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw problem(422, "Invalid base64 image");
  }
  if (data.length > 4 * Math.ceil(maxBytes / 3)) throw problem(413, "Image exceeds decoded-size limit");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maxBytes) throw problem(413, "Image exceeds decoded-size limit");
  if (bytes.toString("base64") !== data) throw problem(422, "Noncanonical base64 image");
  return bytes;
}

export function collectImages(payload, { maxImageBytes, maxTotalBytes, maxImages }) {
  if (payload.photos !== undefined && !Array.isArray(payload.photos)) throw problem(422, "photos must be an array");
  const inputs = [...(payload.photos ?? [])];
  // These fields repeat the first matching photo; do not store them twice.
  for (const [key, type] of [["beforePhoto", "before"], ["afterPhoto", "after"], ["signature", "signature"]]) {
    if (payload[key] && !inputs.some(image => image?.type === type)) {
      inputs.push({ filename: `${type}-compatibility`, type, data: payload[key] });
    }
  }
  if (inputs.length > maxImages) throw problem(413, "Too many images");
  let total = 0;
  return inputs.map(image => {
    if (!image || !categories.has(image.type) || typeof image.filename !== "string" ||
        image.filename.length > 2000) throw problem(422, "Invalid image metadata");
    const bytes = decodeImage(image.data, maxImageBytes);
    total += bytes.length;
    if (total > maxTotalBytes) throw problem(413, "Images exceed total decoded-size limit");
    const contentType = imageFormat(bytes);
    if (image.contentType !== undefined && image.contentType !== contentType) {
      throw problem(422, "Image MIME type does not match bytes");
    }
    return { id: randomUUID(), filename: image.filename, type: image.type, contentType, bytes };
  });
}

/**
 * db: a dedicated better-sqlite3 Database on durable, private local storage.
 * authenticate(req): synchronous verified principal or null; never body-derived.
 * authorizeProject(principal, projectId): synchronous boolean.
 * This is a receiving customer service, NOT a route to install into MeterFlo.
 */
export function createImageReceiver({
  db, authenticate, authorizeProject, jsonLimit = "30mb",
  maxImageBytes = 8 * 1024 * 1024, maxTotalBytes = 20 * 1024 * 1024, maxImages = 64,
}) {
  if (typeof authenticate !== "function" || typeof authorizeProject !== "function") {
    throw new Error("Authentication and project authorization adapters are required");
  }
  for (const limit of [maxImageBytes, maxTotalBytes, maxImages]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Limits must be positive integers");
  }
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      sender TEXT NOT NULL, id TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(sender,id));
    CREATE TABLE IF NOT EXISTS work_orders (
      sender TEXT NOT NULL, project INTEGER NOT NULL, wo INTEGER NOT NULL,
      updated INTEGER NOT NULL, created INTEGER NOT NULL, metadata TEXT NOT NULL, refs TEXT NOT NULL,
      PRIMARY KEY(sender,project,wo));
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY, sender TEXT NOT NULL, project INTEGER NOT NULL, wo INTEGER NOT NULL,
      delivery TEXT NOT NULL, filename TEXT NOT NULL, category TEXT NOT NULL,
      mime TEXT NOT NULL, bytes BLOB NOT NULL);
  `);
  const save = db.transaction((sender, payload) => {
    const prior = db.prepare("SELECT result FROM receipts WHERE sender=? AND id=?").get(sender, payload.deliveryId);
    if (prior) return JSON.parse(prior.result);
    const old = db.prepare("SELECT * FROM work_orders WHERE sender=? AND project=? AND wo=?")
      .get(sender, payload.projectId, payload.workOrderId);
    const updated = Date.parse(payload.updatedAt), created = Date.parse(payload.deliveryCreatedAt);
    if (old && (updated < old.updated || (updated === old.updated && created <= old.created))) {
      const result = { deliveryId: payload.deliveryId, state: "ignored-stale", images: [] };
      db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(sender, payload.deliveryId, JSON.stringify(result));
      return result;
    }
    const images = collectImages(payload, { maxImageBytes, maxTotalBytes, maxImages });
    const insert = db.prepare("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?)");
    for (const image of images) insert.run(image.id, sender, payload.projectId, payload.workOrderId,
      payload.deliveryId, image.filename, image.type, image.contentType, image.bytes);
    const refs = images.map(({ id, filename, type, contentType }) => ({
      id, filename, type, contentType, url: `/images/${id}`,
    }));
    // Absence/empty is not a deletion instruction. Retain earlier references.
    const currentRefs = refs.length ? refs : JSON.parse(old?.refs ?? "[]");
    const { photos, beforePhoto, afterPhoto, signature, ...metadata } = payload;
    db.prepare(`INSERT INTO work_orders VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(sender,project,wo) DO UPDATE SET updated=excluded.updated,
      created=excluded.created,metadata=excluded.metadata,refs=excluded.refs`)
      .run(sender, payload.projectId, payload.workOrderId, updated, created,
        JSON.stringify(metadata), JSON.stringify(currentRefs));
    const result = { deliveryId: payload.deliveryId, state: "accepted", images: refs };
    db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(sender, payload.deliveryId, JSON.stringify(result));
    return result;
  });
  const app = express();
  app.disable("x-powered-by");
  // Authenticate BEFORE allocating memory to parse a potentially large body.
  app.use((req, res, next) => {
    try {
      const principal = authenticate(req);
      if (!principal || typeof principal.id !== "string" || !principal.id) return res.sendStatus(401);
      req.principal = principal;
      next();
    } catch { res.sendStatus(401); }
  });
  app.post("/work-orders", express.json({ limit: jsonLimit, inflate: false }), (req, res, next) => {
    try {
      const p = req.body;
      if (!p || p.schemaVersion !== 2 || typeof p.deliveryId !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.deliveryId) ||
          !Number.isSafeInteger(p.projectId) || p.projectId < 1 ||
          !Number.isSafeInteger(p.workOrderId) || p.workOrderId < 1 ||
          typeof p.updatedAt !== "string" || !Number.isFinite(Date.parse(p.updatedAt)) ||
          typeof p.deliveryCreatedAt !== "string" || !Number.isFinite(Date.parse(p.deliveryCreatedAt))) {
        throw problem(422, "Invalid schema-v2 delivery identifiers or timestamps");
      }
      if (req.get("Idempotency-Key") !== p.deliveryId || req.get("X-MeterFlo-Delivery-Id") !== p.deliveryId) {
        throw problem(422, "Delivery headers and body must match");
      }
      if (authorizeProject(req.principal, p.projectId) !== true) throw problem(403, "Project not authorized");
      // BEGIN IMMEDIATE serializes competing SQLite writers; PK prevents duplicates.
      // Image BLOBs, references, work-order metadata and receipt commit together.
      res.status(200).json(save.immediate(req.principal.id, p));
    } catch (error) { next(error); }
  });
  app.get("/images/:id", (req, res, next) => {
    try {
      const image = db.prepare("SELECT * FROM images WHERE id=? AND sender=?")
        .get(req.params.id, req.principal.id);
      if (!image || authorizeProject(req.principal, image.project) !== true) return res.sendStatus(404);
      res.set({
        "Content-Type": image.mime, "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'",
        "Content-Disposition": `attachment; filename="${image.id}"`,
      }).send(image.bytes);
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    const status = error.status >= 400 && error.status < 500 ? error.status : 503;
    // Never log the payload, bytes, auth headers, DB paths or internal errors.
    res.status(status).json({ error: status === 503 ? "Storage unavailable; retry later" :
      error.type === "entity.too.large" ? "JSON body exceeds receiver limit" :
      error.type === "entity.parse.failed" ? "Invalid JSON" : error.message });
  });
  return app;
}
