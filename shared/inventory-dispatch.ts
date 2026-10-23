/** Dispatch is a view of existing custody, not another work-order core status. */
export type InventoryDispatch = {
  /** Absent means legacy fulfillment custody; never use an onboard operation as a pick-ticket ID. */
  source?: "fulfillment" | "replacement_onboard";
  batchId: string;
  batchName: string;
  receiptNumber: string;
  vehicleId: string;
  vehicleName: string;
  stage: "awaiting_pickup" | "ready_for_field" | "needs_review";
  canStart: boolean;
  reason?: string;
};

export type DispatchEvidence = {
  batchId: string; batchName: string; receiptNumber: string;
  vehicleId: string; vehicleName: string; member: boolean;
  mode: string; status: string; assignmentVersion: number; currentVersion: number;
  installerId: string | null; currentInstallerId: string | null;
  currentInstallerMember?: boolean; currentStatus?: string;
  staged: number; delivered: number; required: number;
  ready: boolean; issue: boolean; activeVehicle: boolean;
};

export function dispatchFromEvidence(e: DispatchEvidence): InventoryDispatch | null {
  if (!e.member || !e.activeVehicle || e.status === "cancelled" || e.staged <= 0 && e.delivered <= 0) return null;
  // Claiming shared crew work after handoff legitimately changes assignment_version.
  // Scheduled work always retains its explicit installer constraint.
  const handedOff = e.delivered >= e.required && e.required > 0;
  const changed = e.mode === "scheduled"
    ? e.assignmentVersion !== e.currentVersion || e.installerId !== e.currentInstallerId
    : e.assignmentVersion !== e.currentVersion &&
      !(handedOff && e.currentInstallerId && e.currentInstallerMember && e.currentStatus === "open");
  const inactiveWork = !!e.currentStatus && !["open", "scheduled"].includes(e.currentStatus);
  const reviewed = e.issue || changed || inactiveWork || e.mode === "crew" && e.currentStatus === "scheduled";
  if (!reviewed && !handedOff && !e.ready) return null;
  const stage = reviewed ? "needs_review" : handedOff ? "ready_for_field" : "awaiting_pickup";
  return {
    batchId: e.batchId, batchName: e.batchName, receiptNumber: e.receiptNumber,
    vehicleId: e.vehicleId, vehicleName: e.vehicleName, stage,
    canStart: stage === "ready_for_field",
    ...(stage === "needs_review" ? { reason: "The warehouse must resolve this batch's pickup issue or reassignment before field work can start." }
      : stage === "awaiting_pickup" ? { reason: "Stock is ready at staging. Have the warehouse verify and record the vehicle handoff before starting field work." } : {}),
  };
}
