import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { planAttachmentMigration, applyAttachmentMigration, readAttachmentJournal, type AttachmentProject } from "../server/attachmentMigration";
import { getProjectDirectoryName, workOrderFolderName, attachmentChild } from "../server/attachmentPaths";

const projects: AttachmentProject[] = [{ id: 7, name: "Migration fixture", workOrders: [
  { id: 101, customerWoId: "CUSTOM-101" }, { id: 102, customerWoId: "CUSTOM-102" },
  { id: 103, customerWoId: null },
] }];
const project = getProjectDirectoryName(projects[0].name, 7);
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-attachment-"));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function file(root: string, relative: string, contents = "Original evidence") {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
}
async function missing(target: string) { await assert.rejects(fs.lstat(target), { code: "ENOENT" }); }

test("read-only inventory and verified migration cover both root formats, migrated numeric folders and project documents", async () => fixture(async root => {
  await file(root, `${project}/101/nested/photo.txt`);
  await file(root, `${project}/CUSTOM-102/second.txt`, "Second");
  await file(root, `${project}/Work Orders/101/third.txt`, "Third");
  await file(root, `${project}/Work Orders/103/canonical.txt`, "Canonical numeric fallback");
  await file(root, `${project}/_project_documents/sub/document.txt`, "Document");
  await fs.mkdir(path.join(root, project, "_project_documents", "empty"), { recursive: true });
  await file(root, `${project}/Project FTP Files/import.csv`, "Unchanged import");
  const plan = await planAttachmentMigration(root, projects);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.moves.length, 4);
  await missing(path.join(root, ".meterflo-attachment-migration"));
  assert.equal(await fs.readFile(path.join(root, project, "101/nested/photo.txt"), "utf8"), "Original evidence");
  await assert.rejects(applyAttachmentMigration(plan), /offline/);
  await applyAttachmentMigration(plan, { offline: true });
  for (const [relative, contents] of [
    ["Work Orders/CUSTOM-101/nested/photo.txt", "Original evidence"],
    ["Work Orders/CUSTOM-101/third.txt", "Third"],
    ["Work Orders/CUSTOM-102/second.txt", "Second"],
    ["Work Orders/103/canonical.txt", "Canonical numeric fallback"],
    ["Project Documents/sub/document.txt", "Document"],
    ["Project FTP Files/import.csv", "Unchanged import"],
  ]) assert.equal(await fs.readFile(path.join(root, project, relative), "utf8"), contents);
  assert.ok((await fs.stat(path.join(root, project, "Project Documents/empty"))).isDirectory());
  const ready = await planAttachmentMigration(root, projects);
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.moves.length + ready.directories.length, 0);
  assert.equal((await readAttachmentJournal(root)).complete, true);
}));

test("same-name destinations block even identical copies; no source is deleted", async () => fixture(async root => {
  const source = await file(root, `${project}/101/evidence.txt`);
  const target = await file(root, `${project}/Work Orders/CUSTOM-101/evidence.txt`);
  const plan = await planAttachmentMigration(root, projects);
  assert.ok(plan.blockers.some(b => /collision/.test(b)));
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /blocker/);
  assert.equal(await fs.readFile(source, "utf8"), await fs.readFile(target, "utf8"));
}));

test("ambiguous numeric ownership, sanitization collisions and orphan folders require review", async () => fixture(async root => {
  await file(root, `${project}/Work Orders/101/a.txt`);
  const ambiguous = [{ ...projects[0], workOrders: [...projects[0].workOrders, { id: 104, customerWoId: "101" }] }];
  assert.ok((await planAttachmentMigration(root, ambiguous)).blockers.some(b => /ambiguous/.test(b)));
  await file(root, `${project}/Work Orders/A_B/b.txt`);
  const collision = [{ ...projects[0], workOrders: [{ id: 1, customerWoId: "A/B" }, { id: 2, customerWoId: "A?B" }] }];
  assert.ok((await planAttachmentMigration(root, collision)).blockers.length);
  await file(root, `${project}/unmapped-orphan/old.txt`);
  assert.ok((await planAttachmentMigration(root, projects)).blockers.some(b => /unmapped-orphan/.test(b)));
}));

test("nested symlinks never get followed", { skip: process.platform === "win32" }, async () => fixture(async root => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-outside-"));
  try {
    await file(outside, "protected.txt", "Do not touch");
    await fs.mkdir(path.join(root, project, "101"), { recursive: true });
    await fs.symlink(outside, path.join(root, project, "101", "linked"));
    const plan = await planAttachmentMigration(root, projects);
    assert.ok(plan.blockers.some(b => /Linked/.test(b)));
    await assert.rejects(applyAttachmentMigration(plan, { offline: true }));
    assert.equal(await fs.readFile(path.join(outside, "protected.txt"), "utf8"), "Do not touch");
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
}));

test("a destination arriving after dry-run is never overwritten", async () => fixture(async root => {
  const source = await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  const destination = await file(root, `${project}/Work Orders/CUSTOM-101/a.txt`, "Unrelated destination");
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /collision/);
  assert.equal(await fs.readFile(source, "utf8"), "Original evidence");
  assert.equal(await fs.readFile(destination, "utf8"), "Unrelated destination");
}));

test("changed source fails explicitly and preserves both copies", async () => fixture(async root => {
  const source = await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  await fs.writeFile(source, "New capture");
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /Source changed/);
  assert.equal(await fs.readFile(source, "utf8"), "New capture");
}));

test("a crash after verification resumes without losing sources or duplicating work", async () => fixture(async root => {
  const source = await file(root, `${project}/101/a.txt`);
  await file(root, `${project}/101/b.txt`, "Other file");
  const plan = await planAttachmentMigration(root, projects);
  await assert.rejects(applyAttachmentMigration(plan, { offline: true, afterVerified: async () => { throw new Error("simulated crash"); } }), /simulated crash/);
  assert.equal(await fs.readFile(source, "utf8"), "Original evidence");
  const saved = await readAttachmentJournal(root);
  assert.equal(saved.moves[0].state, "verified");
  await applyAttachmentMigration(saved, { offline: true });
  await missing(source);
  const complete = await readAttachmentJournal(root);
  await applyAttachmentMigration(complete, { offline: true });
  assert.equal((await planAttachmentMigration(root, projects)).moves.length, 0);
}));

test("an interrupted staging copy is retried from the verified original", async () => fixture(async root => {
  await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  plan.moves[0].state = "copying";
  await file(root, ".meterflo-attachment-migration/journal.json", JSON.stringify(plan));
  const stage = path.join(path.dirname(plan.moves[0].destination), `.meterflo-migrate-${plan.id}-0.tmp`);
  await file(root, stage, "Partial");
  await applyAttachmentMigration(await readAttachmentJournal(root), { offline: true });
  assert.equal(await fs.readFile(path.join(root, plan.moves[0].destination), "utf8"), "Original evidence");
  await missing(path.join(root, stage));
}));

test("a later migration archives completed evidence and does not replay the previous run", async () => fixture(async root => {
  await file(root, `${project}/101/a.txt`);
  const first = await planAttachmentMigration(root, projects);
  await applyAttachmentMigration(first, { offline: true });
  await file(root, `${project}/CUSTOM-102/b.txt`);
  await applyAttachmentMigration(await planAttachmentMigration(root, projects), { offline: true });
  assert.ok((await fs.stat(path.join(root, ".meterflo-attachment-migration", `journal-${first.id}.json`))).isFile());
}));

test("an existing lock is never removed by a second migration", async () => fixture(async root => {
  await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  const lock = path.join(root, ".meterflo-attachment-migration", "lock");
  await fs.mkdir(lock, { recursive: true });
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /locked/);
  assert.ok((await fs.stat(lock)).isDirectory());
}));

test("tampered journals cannot escape the root or rename unrelated files", async () => fixture(async root => {
  await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  plan.moves[0].source = "../outside.txt";
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /escapes/);
  await missing(path.join(root, ".meterflo-attachment-migration"));
}));

test("portable canonical names reject directory traversal and reserved Windows names", () => {
  for (const value of ["", ".", "..", "CON", "aux.txt", "COM1", "trailing."]) {
    assert.throws(() => workOrderFolderName(value));
  }
  assert.equal(workOrderFolderName("WO/42"), "WO_42");
  assert.throws(() => attachmentChild("root", "../secret"));
  assert.throws(() => attachmentChild("root", "..\\secret"));
});

test("missing journals are explicit, while unclaimed project roots are never assigned by ID suffix", async () => fixture(async root => {
  await assert.rejects(readAttachmentJournal(root), { code: "ENOENT" });
  await file(root, "An_old_project_7/original.txt", "Unclaimed evidence");
  const plan = await planAttachmentMigration(root, projects);
  assert.deepEqual(plan.unclaimedRoots, ["An_old_project_7"]);
  assert.equal(plan.moves.length, 0);
  await assert.rejects(applyAttachmentMigration(plan, { offline: true }), /Unclaimed/);
  assert.equal(await fs.readFile(path.join(root, "An_old_project_7/original.txt"), "utf8"), "Unclaimed evidence");
}));

test("completed journals can be retained as evidence on another OS but unfinished journals cannot execute there", async () => fixture(async root => {
  await file(root, `${project}/101/a.txt`);
  const plan = await planAttachmentMigration(root, projects);
  await applyAttachmentMigration(plan, { offline: true });
  const original = await readAttachmentJournal(root);
  original.root = "C:\\MeterFloData\\Project Files";
  const journal = path.join(root, ".meterflo-attachment-migration/journal.json");
  await fs.writeFile(journal, JSON.stringify(original));
  assert.equal((await readAttachmentJournal(root, true)).complete, true);
  await assert.rejects(readAttachmentJournal(root), /root|format/);
  original.complete = false;
  await fs.writeFile(journal, JSON.stringify(original));
  await assert.rejects(readAttachmentJournal(root, true), /root|format/);
}));
