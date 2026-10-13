import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import multer from "multer";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { APK_CHUNK_SIZE } from "../shared/mobile-releases";
import { MobileReleaseService, releaseKey } from "./mobileReleaseService";
import { ReleaseError, publicRelease } from "./mobileReleaseRepository";
import { apkStorageStatus } from "./mobileReleaseStorage";

export interface ReleaseAuth {
  authenticated: RequestHandler;
  userId(req: Request): Promise<string | null>;
  canManage(userId: string): Promise<boolean>;
}
export function registerMobileReleaseRoutes(app: Express, service: MobileReleaseService, auth: ReleaseAuth,
  storageStatus = apkStorageStatus) {
  const chunkUpload = multer({ storage: multer.memoryStorage(),
    // Busboy raises LIMIT_FILE_SIZE at the limit, including an exact 5 MB chunk.
    // Allow one parser byte of headroom; the service enforces the exact expected size.
    limits: { fileSize: APK_CHUNK_SIZE + 1, files: 1, fields: 2, fieldSize: 128 } }).single("chunk");
  const endpoint = (work: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res, next) => { work(req,res).catch(next); };
  const userId = async (req: Request) => {
    const id = await auth.userId(req);
    if (!id) throw new ReleaseError("Unauthorized.", 401);
    return id;
  };
  const manage = async (req: Request) => {
    const id = await userId(req);
    if (!await auth.canManage(id)) throw new ReleaseError("Mobile App Configuration permission is required.", 403);
    return id;
  };
  const gate: RequestHandler = (req,_res,next) => { manage(req).then(() => next(), next); };
  const validId = (id: string) => {
    if (!z.string().uuid().safeParse(id).success) throw new ReleaseError("Invalid release or upload ID.");
    return id;
  };
  app.use("/api/mobile-releases", auth.authenticated, (_req,res,next) => {
    res.set("Cache-Control", "no-store"); next();
  });
  app.get("/api/mobile-releases", gate, endpoint(async (_req,res) => {
    const list = await service.repo.list();
    res.json({ ...list, releases: list.releases.map(publicRelease), storage: await storageStatus() });
  }));
  app.get("/api/mobile-releases/latest", endpoint(async (req,res) => {
    await userId(req);
    const release = await service.repo.latest();
    if (release) await service.downloadable(release.id, false);
    res.json({ release: release ? publicRelease(release) : null });
  }));
  app.post("/api/mobile-releases/uploads/init", gate, endpoint(async (req,res) => {
    res.status(201).json(await service.init(await manage(req), req.body));
  }));
  app.post("/api/mobile-releases/uploads/chunk", gate, (req,res,next) => chunkUpload(req,res,error => {
    if (error) return next(new ReleaseError(error.code === "LIMIT_FILE_SIZE" ? "APK chunks must not exceed 5 MB." : "Invalid chunk upload."));
    if (!req.file || !/^\d+$/.test(String(req.body.chunkIndex))) return next(new ReleaseError("Chunk and index are required."));
    // Ownership is resolved below rather than trusting any form-supplied user ID.
    manage(req).then(id => service.chunk(validId(req.body.uploadId), id, Number(req.body.chunkIndex), req.file!.buffer))
      .then(result => res.json(result), next);
  }));
  app.post("/api/mobile-releases/uploads/finalize", gate, endpoint(async (req,res) => {
    const result = await service.finalize(validId(req.body.uploadId), await manage(req), async () => { await manage(req); });
    res.status(201).json(publicRelease(result));
  }));
  app.delete("/api/mobile-releases/uploads/:id", gate, endpoint(async (req,res) => {
    await service.cancel(validId(req.params.id), await manage(req)); res.sendStatus(204);
  }));
  app.post("/api/mobile-releases/cleanup", gate, endpoint(async (_req,res) => {
    res.json({ pendingCleanup: await service.cleanup() });
  }));
  app.post("/api/mobile-releases/:id/publish", gate, endpoint(async (req,res) => {
    res.json(publicRelease(await service.publish(validId(req.params.id), async () => { await manage(req); })));
  }));
  app.delete("/api/mobile-releases/:id", gate, endpoint(async (req,res) => {
    res.json(await service.remove(validId(req.params.id), req.body?.withdrawLatest === true));
  }));
  app.get("/api/mobile-releases/:id/download", endpoint(async (req,res) => {
    const id = await userId(req);
    const release = await service.downloadable(validId(req.params.id), await auth.canManage(id));
    res.set("Content-Type", "application/vnd.android.package-archive");
    res.set("Content-Disposition", `attachment; filename="${release.fileName}"`);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Length", String(release.size));
    if (req.method === "HEAD") { res.end(); return; }
    try { await pipeline(await service.files.open(release.ref, releaseKey(release.id)), res); }
    catch {
      if (res.headersSent || res.destroyed) res.destroy();
      else { res.removeHeader("Content-Length"); res.removeHeader("Content-Disposition"); throw new ReleaseError("APK download failed. Retry or contact an administrator.", 503); }
    }
  }));
  app.use("/api/mobile-releases", (error: any,_req: Request,res: Response,_next: NextFunction) => {
    const expected = error instanceof ReleaseError || error.status === 503;
    if (!expected) console.error("[MobileReleases] Request failed:", error?.name || "Error");
    res.status(expected ? error.status : 503).json({ message: expected ? error.message
      : "Mobile release storage is unavailable. Check database/filesystem or bucket access and retry." });
  });
}
