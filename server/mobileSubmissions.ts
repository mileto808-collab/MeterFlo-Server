import type { RequestHandler } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { auditContext } from "./auditContext";
import { pool } from "./db";
import { storage } from "./storage";
import { getProjectWorkOrderStorage } from "./projectDb";
import { canStart, canonicalStatus, ChangeoutError, schemaName, submissionReplay } from "./changeoutService";
import { mobileSubmissionContext } from "./mobileSubmissionContext";
import { mobileSubmissionFingerprint, mobileSubmissionIdentity, submissionBody, validateSubmissionMedia, type MobileSubmission } from "../shared/mobile-submission-contract";

// A guarded handler also uses the ordinary pool. Never let waiting advisory
// locks occupy every connection and starve the handler that must release them.
let activeGuards = 0;
const waitingGuards: (() => void)[] = [];
async function submissionSlot() {
  const max = (pool as unknown as { options?: { max?: number } }).options?.max ?? 10;
  const limit = Math.max(1, Math.floor(max / 3));
  if (activeGuards >= limit) await new Promise<void>(resolve => waitingGuards.push(resolve));
  else activeGuards++;
  return () => {
    const next = waitingGuards.shift();
    if (next) next(); else activeGuards--;
  };
}

/** Serialize new mobile submissions before mutable preflight, photos or report notes.
 * Legacy callers without an identity retain their existing route/envelope.
 */
export function mobileSubmissionRoute(kind: "complete" | "trouble" | "auto", handler: RequestHandler): RequestHandler {
  return async (req: any, res: any, next) => {
    let identity = req.body?.changeoutSubmissionId;
    if (identity === undefined && typeof req.body?.data === "string") {
      try { identity = JSON.parse(req.body.data)?.changeoutSubmissionId; }
      catch { return handler(req, res, next); }
    }
    // Do not impose new parsing/media rules on existing native clients.
    if (identity === undefined) return handler(req, res, next);
    let body: Record<string, any>;
    try { body = submissionBody(req); }
    catch { return res.status(400).json({ code: "MOBILE_SUBMISSION", message: "Invalid submission JSON." }); }
    let client: PoolClient | undefined;
    let releaseSlot: (() => void) | undefined;
    let locked = false;
    const originalJson = res.json.bind(res);
    try {
      const identity = mobileSubmissionIdentity.parse({
        changeoutSubmissionId: body.changeoutSubmissionId,
        changeoutAssignmentVersion: typeof body.changeoutAssignmentVersion === "string" &&
          /^\d+$/.test(body.changeoutAssignmentVersion) ? Number(body.changeoutAssignmentVersion) : body.changeoutAssignmentVersion,
      });
      if (kind === "auto" && typeof body.canChange !== "boolean")
        throw new ChangeoutError("canChange must be a boolean for this endpoint.", 400, "MOBILE_SUBMISSION");
      const readingOnly = body.isReadingOnly ?? body.is_reading_only;
      if (readingOnly !== undefined && typeof readingOnly !== "boolean")
        throw new ChangeoutError("isReadingOnly must be a boolean.", 400, "MOBILE_SUBMISSION");
      const actor = await storage.getUser(req.user?.claims?.sub);
      if (!actor) return res.status(401).json({ message: "Unauthorized" });
      if (!await canStart(actor)) throw new ChangeoutError("Changeout permission is required.", 403);
      const projectId = Number(req.params.projectId), workOrderId = Number(req.params.workOrderId);
      if (![projectId, workOrderId].every(id => Number.isSafeInteger(id) && id > 0))
        throw new ChangeoutError("Invalid project or work order.", 400);
      if (!await storage.isAdminUser(actor) && !await storage.isUserAssignedToProject(actor.id, projectId))
        throw new ChangeoutError("Project access required.", 403);
      const project = await storage.getProject(projectId);
      if (!project?.databaseName) throw new ChangeoutError("Project not found.", 404);
      const resolvedKind = kind === "auto" ? body.canChange === false ? "trouble" : "complete" : kind;
      let fingerprint: string;
      try {
        validateSubmissionMedia(body, kind);
        fingerprint = mobileSubmissionFingerprint(body, resolvedKind, identity.changeoutAssignmentVersion,
          Array.isArray(req.files) ? req.files : []);
      } catch { throw new ChangeoutError("Invalid or conflicting submission payload.", 400, "MOBILE_SUBMISSION"); }
      const context: MobileSubmission = {
        id: identity.changeoutSubmissionId, assignmentVersion: identity.changeoutAssignmentVersion,
        kind: resolvedKind,
        actorId: actor.id, projectId, workOrderId,
        fingerprint,
      };
      releaseSlot = await submissionSlot();
      client = await pool.connect();
      // Session lock, not a stock lock/transaction: completion still uses its
      // normal independent transaction and the worker stays asynchronous.
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`mobile-submission:${projectId}:${workOrderId}`]);
      locked = true;
      const readRecord = async () => {
        const record = await submissionReplay(client!, projectId, workOrderId, context.id, context.fingerprint, actor.id);
        if (!record) return null;
        const { rows: [current] } = await client!.query(`SELECT status,assignment_version FROM ${schemaName(project.databaseName!)}.work_orders WHERE id=$1`, [workOrderId]);
        const status = await canonicalStatus(client!, current?.status);
        const acceptedStatus = await canonicalStatus(client!, record.evidence.next.status);
        if (!current || current.assignment_version !== record.assignment_version ||
          (context.kind === "complete" ? !["completed", "closed"].includes(status) : status !== acceptedStatus))
          throw new ChangeoutError("This submission belongs to an earlier assignment or reopened attempt.", 409, "CHANGEOUT_ATTEMPT_CHANGED");
        return record;
      };
      const reply = async (record: any, replayed: boolean, payload?: any) => {
        const workOrder = await getProjectWorkOrderStorage(project.databaseName!).getWorkOrder(workOrderId);
        res.status(200);
        res.set("Cache-Control", "no-store");
        return originalJson({
          ...(payload && typeof payload === "object" ? payload : {}),
          success: true, workOrder,
          submission: {
            contractVersion: 1, submissionId: context.id, workOrderId, kind: context.kind,
            receiptId: record.id, assignmentVersion: record.assignment_version, acceptedAt: record.created_at,
            fieldStatus: "accepted", reconciliationStatus: record.status, replayed,
            attachmentsConfirmed: true, attachmentScope: "submission",
          },
        });
      };
      const prior = await readRecord();
      if (prior) return await reply(prior, true);
      const { rows: [current] } = await client.query(`SELECT assigned_user_id,assignment_version,status
        FROM ${schemaName(project.databaseName)}.work_orders WHERE id=$1`, [workOrderId]);
      if (!current || current.assignment_version !== context.assignmentVersion ||
          ["completed", "closed"].includes(await canonicalStatus(client, current?.status)))
        throw new ChangeoutError("This assignment or work attempt changed. Retain the captured inputs.", 409, "CHANGEOUT_ATTEMPT_CHANGED");
      if (!await storage.isAdminUser(actor) && current.assigned_user_id !== actor.id)
        throw new ChangeoutError("Claim this work order before submitting.", 403);
      let payload: any, responded = false;
      // Delay the JSON response until the durable record has been checked.
      // A late webhook failure must not report a committed submission as lost.
      res.json = (value: any) => { payload = value; responded = true; return res; };
      await auditContext.run({
        actorId: actor.id, actorLabel: actor.username ?? actor.id, actorKind: "user",
        source: "mobile", operationId: auditContext.getStore()?.operationId ?? randomUUID(),
      }, () => mobileSubmissionContext.run(context, () => handler(req, res, next)));
      res.json = originalJson;
      const accepted = await readRecord();
      if (accepted) return await reply(accepted, false, res.statusCode >= 400 ? undefined : payload);
      if (responded && res.statusCode >= 400) return originalJson(payload);
      throw new ChangeoutError("Submission outcome is not confirmed. Retain inputs and retry the same identity.", 503, "CHANGEOUT_UNCONFIRMED");
    } catch (error: any) {
      res.json = originalJson;
      const status = error instanceof ChangeoutError ? error.status : error?.name === "ZodError" ||
        error instanceof SyntaxError ? 400 : 503;
      return res.status(status).json({
        success: false, code: error instanceof ChangeoutError ? error.code : status === 400 ? "MOBILE_SUBMISSION" : "CHANGEOUT_UNCONFIRMED",
        message: error instanceof ChangeoutError ? error.message : status === 400 ?
          "Invalid submission identity or payload." : "Submission outcome is not confirmed. Retain inputs and retry the same identity.",
      });
    } finally {
      res.json = originalJson;
      if (client) {
        if (locked) {
          try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [`mobile-submission:${Number(req.params.projectId)}:${Number(req.params.workOrderId)}`]); }
          catch { client.release(true); client = undefined; }
        }
        client?.release();
      }
      releaseSlot?.();
    }
  };
}

/** Run the same guarded direct handler for one new-protocol batch item. */
export async function mobileSubmissionBatchItem(handler: RequestHandler, req: any, id: number, data: any) {
  let status = 200, payload: any;
  const child = Object.assign(Object.create(req), { body: data, params: { ...req.params, workOrderId: String(id) } });
  const response: any = {
    statusCode: 200,
    status(value: number) { status = value; this.statusCode = value; return this; },
    set() { return this; },
    json(value: any) { payload = value; return this; },
  };
  await handler(child, response, () => {});
  return { status, payload };
}
