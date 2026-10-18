import { pool } from "../db";
import type { DispatchEntry } from "./dispatchCache";
import type { RoutingResult } from "../../shared/workOrderRouting";

export type DispatchMetadata = Pick<RoutingResult, "projectId" | "assigneeId" | "originAddress" |
  "departureAt" | "expiresAt" | "configurationRevision" | "fingerprint" |
  "addressReviewVersion" | "assignmentRoutingVersion" | "serviceMinutes" | "toleranceMinutes"> & { scopeIds: number[] };
export interface StoredDispatch {
  id: string;
  plannerId: string;
  activatedAt?: number;
  route: DispatchMetadata;
}

// Only customer-entered business inputs and identities belong here. Never store
// provider responses, resolved coordinates, geometry or address-review tokens.
export async function initializeDispatch() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.route_dispatches (
    id uuid PRIMARY KEY,
    project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    planner_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    assignee_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    origin_address text NOT NULL,
    departure_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
    configuration_revision varchar(64) NOT NULL, fingerprint varchar(64) NOT NULL,
    service_minutes integer NOT NULL, tolerance_minutes integer NOT NULL,
    address_review_version integer NOT NULL, assignment_routing_version integer NOT NULL,
    activated_at timestamptz, dispatched_at timestamptz,
    CHECK (expires_at > departure_at - interval '7 days')
  );
  ALTER TABLE public.route_dispatches ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
  CREATE INDEX IF NOT EXISTS route_dispatches_inbox ON public.route_dispatches(project_id,assignee_id,expires_at);
  CREATE TABLE IF NOT EXISTS public.route_dispatch_orders (
    dispatch_id uuid NOT NULL REFERENCES public.route_dispatches(id) ON DELETE CASCADE,
    work_order_id integer NOT NULL, position integer NOT NULL,
    PRIMARY KEY(dispatch_id,work_order_id), UNIQUE(dispatch_id,position)
  );`);
}

export class DispatchStore {
  async save(entry: DispatchEntry) {
    if (!entry.shareableOrigin || !entry.route.originAddress) throw new Error("Dispatch requires an entered address");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = entry.route;
      const inserted = await client.query(`INSERT INTO public.route_dispatches
        (id,project_id,planner_id,assignee_id,origin_address,departure_at,expires_at,configuration_revision,
         fingerprint,service_minutes,tolerance_minutes,address_review_version,assignment_routing_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [entry.id,r.projectId,entry.plannerId,r.assigneeId,r.originAddress,r.departureAt,r.expiresAt,
        r.configurationRevision,r.fingerprint,r.serviceMinutes,r.toleranceMinutes,r.addressReviewVersion,r.assignmentRoutingVersion]);
      if (inserted.rowCount) {
        for (const [position, id] of r.scopeIds!.entries())
          await client.query(`INSERT INTO public.route_dispatch_orders(dispatch_id,work_order_id,position) VALUES($1,$2,$3)`,
            [entry.id,id,position]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private async read(projectId: number, userId: string, id?: string, draft = false): Promise<StoredDispatch[]> {
    const result = await pool.query(`SELECT d.*, array_agg(o.work_order_id ORDER BY o.position) AS scope_ids
      FROM public.route_dispatches d JOIN public.route_dispatch_orders o ON o.dispatch_id=d.id
      WHERE d.project_id=$1 AND ${draft ? "d.planner_id=$2" : "d.assignee_id=$2 AND d.dispatched_at IS NOT NULL"} AND d.expires_at>$3
      AND ($4::uuid IS NULL OR d.id=$4) GROUP BY d.id ORDER BY d.departure_at,d.id`,
    [projectId,userId,new Date(Date.now()),id??null]);
    return result.rows.map(r => ({
      id:r.id,plannerId:r.planner_id,activatedAt:r.activated_at?.getTime(),
      route:{projectId:r.project_id,assigneeId:r.assignee_id,originAddress:r.origin_address,
        departureAt:r.departure_at.toISOString(),expiresAt:r.expires_at.toISOString(),
        configurationRevision:r.configuration_revision,fingerprint:r.fingerprint,
        serviceMinutes:r.service_minutes,toleranceMinutes:r.tolerance_minutes,
        addressReviewVersion:r.address_review_version,assignmentRoutingVersion:r.assignment_routing_version,
        scopeIds:r.scope_ids},
    }));
  }
  async get(projectId: number, assigneeId: string, id: string) { return (await this.read(projectId,assigneeId,id))[0]; }
  async planned(projectId: number, plannerId: string, id: string) { return (await this.read(projectId,plannerId,id,true))[0]; }
  received(projectId: number, assigneeId: string) { return this.read(projectId,assigneeId); }
  async dispatch(id: string) {
    const result=await pool.query(`UPDATE public.route_dispatches SET dispatched_at=COALESCE(dispatched_at,$2)
      WHERE id=$1 AND expires_at>$2 RETURNING id`,[id,new Date(Date.now())]);
    return !!result.rowCount;
  }
  async activate(id: string) {
    // First activation wins across instances and is never moved forward by retries.
    const result = await pool.query(`UPDATE public.route_dispatches SET activated_at=COALESCE(activated_at,$2)
      WHERE id=$1 AND dispatched_at IS NOT NULL AND expires_at>$2 RETURNING activated_at`, [id,new Date(Date.now())]);
    return result.rows[0]?.activated_at?.getTime() as number | undefined;
  }
}
