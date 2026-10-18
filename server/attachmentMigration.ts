import * as fs from "node:fs/promises";
import * as path from "node:path";
import { constants, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { getProjectDirectoryName, workOrderFolderName } from "./attachmentPaths";

export type AttachmentProject = {
  id: number; name: string; workOrders: { id: number; customerWoId: string | null }[];
};
type Move = { source: string; destination: string; hash: string; state: "pending" | "copying" | "verified" | "done" };
export type AttachmentPlan = {
  version: 1; id: string; root: string; moves: Move[];
  directories: { source: string; destination: string }[];
  blockers: string[]; unclaimedRoots: string[]; complete: boolean;
};
const STATE = ".meterflo-attachment-migration";
const folded = (value: string) => value.toLowerCase();
const samePath = (left: string, right: string) =>
  process.platform === "win32" ? folded(left) === folded(right) : left === right;
async function stat(file: string) {
  try { return await fs.lstat(file); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}
async function digest(file: string): Promise<string> {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular attachment files may be migrated.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function beneath(root: string, relative: string): string {
  const result = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || path.relative(root, result).startsWith("..") ||
      result === root) throw new Error("Migration path escapes the configured attachment root.");
  return result;
}
async function safeParents(root: string, relative: string, create = false) {
  const directory = beneath(root, relative);
  const parts = path.relative(root, directory).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let info = await stat(current);
    if (!info && create) {
      await fs.mkdir(current).catch((error: any) => { if (error.code !== "EEXIST") throw error; });
      info = await fs.lstat(current);
    }
    if (!info || !info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Attachment migration encountered a missing, linked or non-directory parent.");
    }
  }
}

function validatePlan(plan: AttachmentPlan, completedMetadataOnly = false) {
  if (!plan || plan.version !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) ||
      typeof plan.root !== "string" || (!completedMetadataOnly && !path.isAbsolute(plan.root)) ||
      !Array.isArray(plan.moves) || !Array.isArray(plan.directories) ||
      !Array.isArray(plan.blockers) || !Array.isArray(plan.unclaimedRoots) || typeof plan.complete !== "boolean") {
    throw new Error("Invalid migration journal format.");
  }
  for (const move of plan.moves) {
    if (!/^[a-f0-9]{64}$/.test(move.hash) || !["pending", "copying", "verified", "done"].includes(move.state) ||
        (plan.complete && move.state !== "done")) {
      throw new Error("Invalid migration journal entry.");
    }
  }
  for (const item of [...plan.moves, ...plan.directories]) {
    if (completedMetadataOnly) continue; // Evidence only; never execute paths from another host.
    beneath(plan.root, item.source); beneath(plan.root, item.destination);
    if (folded(item.source) === folded(item.destination)) throw new Error("Migration source and destination must differ.");
  }
}

/** Read-only inventory. A collision is a blocker, even when bytes are identical. */
export async function planAttachmentMigration(rootPath: string, projects: AttachmentProject[], hashFiles = true): Promise<AttachmentPlan> {
  const root = path.resolve(rootPath);
  const plan: AttachmentPlan = { version: 1, id: randomUUID(), root, moves: [], directories: [], blockers: [], unclaimedRoots: [], complete: false };
  const rootInfo = await stat(root);
  if (!rootInfo) return plan;
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !samePath(await fs.realpath(root), root)) {
    throw new Error("Use a real, non-symlink attachment root.");
  }
  const destinations = new Set<string>();
  const walk = async (source: string, destination: string) => {
    const sourcePath = beneath(root, source);
    const info = await fs.lstat(sourcePath);
    if (info.isSymbolicLink()) { plan.blockers.push(`Linked entry: ${source}`); return; }
    if (info.isDirectory()) {
      const target = source === destination ? null : await stat(beneath(root, destination));
      if (target && (!target.isDirectory() || target.isSymbolicLink())) {
        plan.blockers.push(`Destination directory collision: ${destination}`); return;
      }
      if (source !== destination) plan.directories.push({ source, destination });
      const names = await fs.readdir(sourcePath);
      for (const name of names) await walk(path.join(source, name), path.join(destination, name));
    } else if (info.isFile()) {
      const key = folded(destination);
      if (destinations.has(key)) { plan.blockers.push(`Destination collision: ${destination}`); return; }
      destinations.add(key);
      if (source !== destination) {
        if (await stat(beneath(root, destination))) {
          plan.blockers.push(`Destination collision: ${destination}`); return;
        }
        plan.moves.push({ source, destination, hash: hashFiles ? await digest(sourcePath) : "", state: "pending" });
      }
    } else plan.blockers.push(`Unsupported file type: ${source}`);
  };
  const projectNames = new Map(projects.map(p => [p.id, getProjectDirectoryName(p.name, p.id)]));
  for (const name of await fs.readdir(root)) {
    const id = Number(name.match(/_(\d+)$/)?.[1]);
    if (id > 0 && (!projectNames.has(id) || !samePath(projectNames.get(id)!, name))) {
      plan.unclaimedRoots.push(name);
    }
  }
  for (const project of projects) {
    const projectDir = getProjectDirectoryName(project.name, project.id);
    const projectPath = path.join(root, projectDir);
    const info = await stat(projectPath);
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) { plan.blockers.push(`Invalid project directory: ${projectDir}`); continue; }
    const owners = new Map<string, Map<number, string>>();
    const add = (source: string, id: number, destination: string) => {
      const key = folded(source), set = owners.get(key) ?? new Map();
      set.set(id, destination); owners.set(key, set);
    };
    for (const order of project.workOrders) {
      let folder: string;
      try { folder = workOrderFolderName(order.customerWoId || String(order.id)); }
      catch { plan.blockers.push(`Invalid attachment identifier for project ${project.id}, work order ${order.id}`); continue; }
      const target = path.join(projectDir, "Work Orders", folder);
      for (const source of [
        path.join(projectDir, String(order.id)), path.join(projectDir, folder),
        path.join(projectDir, "Work Orders", String(order.id)), target,
      ]) add(source, order.id, target);
    }
    const inventory = async (relative: string) => {
      const info = await fs.lstat(beneath(root, relative));
      if (!info.isDirectory() || info.isSymbolicLink()) {
        plan.blockers.push(`Invalid work-order folder: ${relative}`); return;
      }
      const matching = owners.get(folded(relative));
      if (!matching || matching.size !== 1) {
        plan.blockers.push(`Unmapped or ambiguous work-order folder: ${relative}`); return;
      }
      await walk(relative, [...matching.values()][0]);
    };
    for (const name of await fs.readdir(projectPath)) {
      const relative = path.join(projectDir, name);
      if (name === "Project FTP Files") continue;
      if (name === "Work Orders") {
        const parent = await fs.lstat(beneath(root, relative));
        if (parent.isSymbolicLink() || !parent.isDirectory()) { plan.blockers.push(`Invalid work-order parent: ${relative}`); continue; }
        for (const child of await fs.readdir(beneath(root, relative))) await inventory(path.join(relative, child));
      } else if (name === "_project_documents" || name === "Project Documents") {
        const info = await fs.lstat(beneath(root, relative));
        if (!info.isDirectory() || info.isSymbolicLink()) plan.blockers.push(`Invalid document folder: ${relative}`);
        else await walk(relative, path.join(projectDir, "Project Documents"));
      } else await inventory(relative);
    }
  }
  return plan;
}

async function flushDirectory(directory: string) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error: any) {
    // Node cannot flush directory handles on some Windows filesystems. File
    // contents and journals are still explicitly flushed before source removal.
    if (process.platform !== "win32" || !["EPERM", "EACCES", "EINVAL", "EISDIR", "ENOTSUP"].includes(error.code)) throw error;
  } finally { await handle?.close(); }
}

async function persist(journal: string, plan: AttachmentPlan) {
  const temporary = `${journal}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(plan, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, journal);
  await flushDirectory(path.dirname(journal));
}

/** Offline operation. Never overwrite a destination or delete an unverified source. */
export async function applyAttachmentMigration(
  plan: AttachmentPlan,
  options: { offline: boolean; afterVerified?: (index: number) => Promise<void> } = { offline: false },
) {
  if (!options.offline) throw new Error("Stop every MeterFlo process and use --offline before applying.");
  validatePlan(plan);
  if (plan.unclaimedRoots.length) throw new Error("Unclaimed project directories require ownership review before applying. No files moved.");
  if (plan.version !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) ||
      plan.blockers.length || plan.moves.some(m => !/^[a-f0-9]{64}$/.test(m.hash))) {
    throw new Error("Resolve the dry-run blockers before applying this migration.");
  }
  const root = path.resolve(plan.root);
  await fs.mkdir(root, { recursive: true });
  if (!samePath(await fs.realpath(root), root) || (await fs.lstat(root)).isSymbolicLink()) throw new Error("Unsafe attachment root.");
  await safeParents(root, STATE, true);
  const journal = path.join(root, STATE, "journal.json");
  const lockPath = path.join(root, STATE, "lock");
  // mkdir is exclusive on supported Windows and Linux filesystems.
  await fs.mkdir(lockPath).catch(() => { throw new Error("Migration is locked. Verify no migration is running before removing a stale lock."); });
  try {
    const previous = await stat(journal);
    if (previous) {
      if (previous.isSymbolicLink() || !previous.isFile()) throw new Error("Unsafe migration journal.");
      const saved: AttachmentPlan = JSON.parse(await fs.readFile(journal, "utf8"));
      validatePlan(saved, saved.complete && saved.id !== plan.id);
      if (saved.root !== root && !saved.complete) throw new Error("Journal root mismatch.");
      if (saved.id !== plan.id && saved.complete) {
        // Retain completed evidence before starting a later maintenance run.
        const archive = path.join(root, STATE, `journal-${saved.id}.json`);
        await fs.copyFile(journal, archive, constants.COPYFILE_EXCL);
        await persist(journal, plan);
      } else if (saved.id !== plan.id) {
        throw new Error("An existing journal belongs to a different plan. Resume it first.");
      } else plan = saved;
    } else await persist(journal, plan);
    if (plan.blockers.length || plan.moves.some(m =>
      !/^[a-f0-9]{64}$/.test(m.hash) || !["pending", "copying", "verified", "done"].includes(m.state))) {
      throw new Error("Invalid or blocked migration journal.");
    }
    // Validate every supplied/journal path before any file is copied.
    for (const item of [...plan.moves, ...plan.directories]) {
      beneath(root, item.source); beneath(root, item.destination);
    }
    for (const directory of plan.directories) await safeParents(root, directory.destination, true);
    for (let index = 0; index < plan.moves.length; index++) {
      const move = plan.moves[index];
      const source = beneath(root, move.source), destination = beneath(root, move.destination);
      const stageRelative = path.join(path.dirname(move.destination), `.meterflo-migrate-${plan.id}-${index}.tmp`);
      const stage = beneath(root, stageRelative);
      await safeParents(root, path.dirname(move.destination), true);
      if (move.state === "done") {
        if (await digest(destination) !== move.hash) throw new Error("A completed destination has changed; review the journal.");
        if (await stat(source)) throw new Error("A completed migration source has reappeared; review it.");
        const leftover = await stat(stage);
        if (leftover) {
          const target = await fs.lstat(destination);
          if (leftover.isSymbolicLink() || leftover.dev !== target.dev || leftover.ino !== target.ino) {
            throw new Error("Unrecognized staging file; review the journal.");
          }
          await fs.unlink(stage);
        }
        continue;
      }
      if (move.state === "pending") {
        if (await stat(destination) || await stat(stage)) throw new Error("Destination/staging collision; nothing was overwritten.");
        move.state = "copying"; await persist(journal, plan);
      }
      if (move.state === "copying") {
        await safeParents(root, path.dirname(move.source));
        if (await digest(source) !== move.hash) throw new Error("Source changed since dry run; no source was removed.");
        if (await stat(stage) && !await stat(destination) && await digest(stage) !== move.hash) {
          // This UUID-scoped temporary namespace was claimed by the persisted
          // copying phase. Only its interrupted copy is discarded, never source.
          await fs.unlink(stage);
        }
        if (!await stat(stage)) {
          await fs.copyFile(source, stage, constants.COPYFILE_EXCL);
          const handle = await fs.open(stage, "r+");
          try { await handle.sync(); } finally { await handle.close(); }
        }
        if (await digest(stage) !== move.hash) throw new Error("Partial or changed staging file; original source retained. Review before retry.");
        const target = await stat(destination);
        if (target) {
          const staged = await fs.lstat(stage);
          if (target.isSymbolicLink() || target.dev !== staged.dev || target.ino !== staged.ino) {
            throw new Error("Destination collision; original source retained.");
          }
        } else await fs.link(stage, destination); // Atomic, exclusive, no overwrite (NTFS/Linux).
        await flushDirectory(path.dirname(destination));
        if (await digest(destination) !== move.hash || await digest(source) !== move.hash) throw new Error("Copy verification failed; source retained.");
        move.state = "verified"; await persist(journal, plan);
      }
      if (move.state === "verified") {
        await options.afterVerified?.(index);
        if (await digest(destination) !== move.hash) throw new Error("Verified destination changed; source retained.");
        if (await stat(source)) {
          await safeParents(root, path.dirname(move.source));
          if (await digest(source) !== move.hash) throw new Error("Source changed; source retained.");
          await fs.unlink(source);
          await flushDirectory(path.dirname(source));
        }
        move.state = "done"; await persist(journal, plan);
      }
      if (await stat(stage)) await fs.unlink(stage);
    }
    for (const directory of [...plan.directories].sort((a, b) => b.source.length - a.source.length)) {
      const source = beneath(root, directory.source);
      const info = await stat(source);
      if (!info) continue;
      await safeParents(root, path.dirname(directory.source));
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Migration source directory changed.");
      await fs.rmdir(source); // A concurrent/new file makes this fail, never recursive-delete.
    }
    plan.complete = true; await persist(journal, plan);
    return { moved: plan.moves.length, journal };
  } finally { await fs.rmdir(lockPath); }
}

export async function readAttachmentJournal(root: string, allowCompletedRelocation = false): Promise<AttachmentPlan> {
  const directory = path.resolve(root);
  if (!await stat(path.join(directory, STATE))) {
    throw Object.assign(new Error("No attachment migration journal."), { code: "ENOENT" });
  }
  await safeParents(directory, STATE);
  const journal = path.join(directory, STATE, "journal.json");
  const info = await fs.lstat(journal);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Unsafe migration journal.");
  const plan: AttachmentPlan = JSON.parse(await fs.readFile(journal, "utf8"));
  validatePlan(plan, allowCompletedRelocation && plan.complete && plan.root !== directory);
  if (plan.root !== directory && !(allowCompletedRelocation && plan.complete)) throw new Error("Journal root does not match this instance.");
  return plan;
}
