import { useState } from "react";
import type { EquipmentReturn } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CustodyAction = "returnCustomerHandoff" | "returnCorrectDecision";
export function RemovedEquipmentCustodyActions({ record, busy, run, onHandoff }: {
  record: EquipmentReturn; busy: boolean;
  onHandoff: () => void;
  run: (action: CustodyAction, data: Record<string, unknown>) => Promise<boolean>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [present, setPresent] = useState(false);
  const expectedOperationId = record.history?.at(-1)?.operationId;
  if (!expectedOperationId || record.disposition !== "returned") return null;
  const canCorrect = ["released", "scrapped", "customer_pending"].includes(record.status);
  return <div className="space-y-3">
    {record.status === "customer_pending" && !correcting && <div className="space-y-2">
      <p className="text-sm">Held for customer return. This equipment is not available stock. Confirm only after actual collection or dispatch.</p>
      <Button type="button" size="sm" disabled={busy} onClick={onHandoff}>Verify and hand off to customer</Button>
    </div>}
    {canCorrect && !correcting && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setCorrecting(true)}>Correct warehouse decision</Button>}
    {canCorrect && correcting && <fieldset disabled={busy} className="space-y-2 rounded-md border p-3">
      <p className="text-sm">Return this entry to quarantine for a new decision. History is retained. If it was released to stock, one available unit must be removed from this same location; reserved, moved or consumed serials cannot be reversed here.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={present} onChange={event => setPresent(event.target.checked)} />I verified this equipment is still physically present and has not been destroyed or handed to the customer.</label>
      <div><Label htmlFor={`correction-reason-${record.id}`}>Correction reason</Label><Input id={`correction-reason-${record.id}`} value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={!present || !reason.trim()} onClick={async () => {
        if (window.confirm("Record an audited correction and return this equipment to quarantine?")) {
          if (await run("returnCorrectDecision", { id: record.id, expectedOperationId, physicallyPresent: true, reason })) {
            setCorrecting(false); setReason(""); setPresent(false);
          }
        }
      }}>Record correction</Button><Button type="button" size="sm" variant="outline" onClick={() => setCorrecting(false)}>Cancel correction</Button></div>
    </fieldset>}
  </div>;
}
