import fs from "node:fs";
import path from "node:path";
import type { LogCategory, LogInventory } from "../shared/log-maintenance";

export interface FileCandidate {
  category: LogCategory;
  name: string;
  bytes: number;
  mtime: number;
  ino: number;
  dev: number;
}
const archiveName = /^error-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-[a-f0-9]+)?\.log$/;

/** This service owns only MeterFlo's synchronous append-per-write error log. */
export class LogFiles {
  readonly root: string;
  constructor(root = process.env.LOG_DIR || "./logs") { this.root = path.resolve(root); }
  private validateRoot() {
    // Reject symlinks in every ancestor, not just the final directory.
    let current = this.root;
    for (;;) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error("Log directory contains a symbolic link");
      if (current === path.dirname(current)) break;
      current = path.dirname(current);
    }
    if (!fs.statSync(this.root).isDirectory()) throw new Error("Log directory is not a directory");
  }
  list(): FileCandidate[] {
    if (!fs.existsSync(this.root)) return [];
    this.validateRoot();
    const result: FileCandidate[] = [];
    // A bound avoids unbounded work on a misconfigured directory.
    const dir = fs.opendirSync(this.root);
    try {
      let scanned = 0;
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        if (++scanned > 10000) throw new Error("Log directory exceeds the 10,000-entry inspection limit");
        const category = entry.name === "error.log" ? "activeError" : archiveName.test(entry.name) ? "errorArchives" : null;
        if (!category) continue;
        const stat = fs.lstatSync(path.join(this.root, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) continue;
        result.push({ category, name: entry.name, bytes: stat.size, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
      }
    } finally { dir.closeSync(); }
    return result;
  }
  inventory(files: FileCandidate[]): LogInventory[] {
    return (["errorArchives", "activeError"] as const).map(category => {
      const rows = files.filter(f => f.category === category);
      const dates = rows.map(f => f.mtime).sort((a,b) => a-b);
      return { category, count: rows.length, bytes: rows.reduce((n,f) => n+f.bytes,0), protectedCount: category === "activeError" ? rows.length : 0,
        oldest: dates.length ? new Date(dates[0]).toISOString() : null, newest: dates.length ? new Date(dates[dates.length-1]).toISOString() : null };
    });
  }
  remove(candidate: FileCandidate): boolean {
    this.validateRoot();
    if (candidate.name !== "error.log" && !archiveName.test(candidate.name)) throw new Error("Unmanaged log filename");
    const target = path.join(this.root, candidate.name);
    let fd: number | undefined;
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.ino !== candidate.ino ||
          stat.dev !== candidate.dev || stat.size !== candidate.bytes || stat.mtimeMs !== candidate.mtime) return false;
      fd = fs.openSync(target, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) return false;
      // No await occurs between inode validation and mutation. The app writer also
      // uses synchronous per-write descriptors, so no stale file handle is abandoned.
      if (candidate.category === "activeError") fs.ftruncateSync(fd, 0);
      else fs.unlinkSync(target);
      return true;
    } catch (error: any) {
      if (error.code === "ENOENT") return false;
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
