import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryState, StockLine } from "@shared/inventory";
import { inventoryReceiptLabel } from "@shared/inventory-display-labels";
import { orderLabel } from "@shared/inventory-order-labels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, PackageCheck, RefreshCw, ScanLine, Trash2 } from "lucide-react";

type Props = {
  state: InventoryState;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onOperationPending?: (pending: boolean) => void;
};
type Source = { id: string; reference: string; warehouseId: string; lines: StockLine[] };
type Attempt = { operationId: string; payload: Record<string, unknown>; fingerprint: string; uncertain: boolean };
const validCount = (value: string, min = 1) => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= 1_000_000;
const unique = (values: string[]) => new Set(values).size === values.length;
function sourceRemaining(state: InventoryState, receiptId: string, itemId: string, sourceLine: StockLine) {
  const vendorAssemblies = (state.kitAssemblies ?? []).filter(assembly =>
    assembly.source === "vendor" && assembly.sourceReceiptId === receiptId);
  const usedAsFinishedKit = vendorAssemblies.filter(assembly => assembly.itemId === itemId)
    .reduce((sum, assembly) => sum + assembly.quantity, 0);
  return Math.max(0, sourceLine.quantity - usedAsFinishedKit);
}

function relevantBasis(state: InventoryState, source: Source | undefined, itemId: string) {
  if (!source || !itemId) return "";
  const kit = state.items.find(item => item.id === itemId);
  const involved = new Set([itemId, ...(kit?.components.map(line => line.itemId) ?? [])]);
  return JSON.stringify({
    receipt: state.receipts.find(receipt => receipt.id === source.id),
    order: state.orders.find(order => order.type === "purchase" && order.id === source.reference),
    kit,
    stock: state.stock.filter(line => involved.has(line.itemId)),
    reserved: state.allocations.filter(allocation => allocation.status === "reserved").flatMap(allocation =>
      allocation.lines.filter(line => line.warehouseId === source.warehouseId && involved.has(line.itemId))),
    assemblies: (state.kitAssemblies ?? []).filter(assembly =>
      assembly.itemId === itemId || assembly.sourceReceiptId === source.id),
    occupancy: state.serialOccupancy?.filter(line => involved.has(line.itemId)),
    shipmentHolds: state.shipmentHolds?.filter(line => involved.has(line.itemId)),
    kitHolds: state.kitHolds?.filter(line => involved.has(line.itemId)),
    returns: state.returns,
    transfers: state.orders.filter(order => order.type === "transfer" && order.lines.some(line => involved.has(line.itemId))),
  });
}

export function InventoryVendorKitDialog({ state, projectId, onClose, onSaved, onDirtyChange, onOperationPending }: Props) {
  const { toast } = useToast();
  const [receiptId, setReceiptId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [parentSerial, setParentSerial] = useState("");
  const [componentSerials, setComponentSerials] = useState<Record<string, string[]>>({});
  const [componentQuantities, setComponentQuantities] = useState<Record<string, string>>({});
  const [scanInputs, setScanInputs] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [externalChange, setExternalChange] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState<{ receiptId: string; itemId: string } | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [attemptConfirmed, setAttemptConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);
  const attemptConfirmedRef = useRef(false);
  const relevantSources = useMemo<Source[]>(() => state.receipts
    .filter(receipt => receipt.action === "receive" && !!receipt.warehouseId)
    .flatMap(receipt => {
      const order = state.orders.find(value => value.type === "purchase" &&
        value.id === receipt.reference);
      return order ? [{ id: receipt.id, reference: receipt.reference, warehouseId: receipt.warehouseId!, lines: receipt.lines }] : [];
    }), [state.receipts, state.orders]);
  const source = relevantSources.find(value => value.id === receiptId);
  const definedKit = state.items.find(item => item.id === itemId);
  const kit = definedKit ? { ...definedKit, components: definedKit.components.filter(component =>
    state.items.find(item => item.id === component.itemId)?.kind !== "labor") } : undefined;
  const sourceLineFor = (id: string) => source?.lines.find(line => line.itemId === id);
  const reserved = (id: string) => state.allocations.filter(allocation => allocation.status === "reserved")
    .flatMap(allocation => allocation.lines).filter(line => line.warehouseId === source?.warehouseId && line.itemId === id)
    .flatMap(line => line.serials);
  const stockLineFor = (id: string) => state.stock.find(line => line.warehouseId === source?.warehouseId && line.itemId === id);
  const availableSerials = (id: string) => {
    const original = sourceLineFor(id)?.serials ?? [];
    const current = stockLineFor(id)?.serials ?? [];
    const reservedSerials = reserved(id);
    const proven = (state.kitAssemblies ?? []).filter(assembly => assembly.itemId === id)
      .flatMap(assembly => assembly.positions.filter(position => position.kind === "stock" && position.id === source?.warehouseId))
      .flatMap(position => position.serials);
    return original.filter(serial => current.includes(serial) && !reservedSerials.includes(serial) && !proven.includes(serial));
  };
  const kitOptions = useMemo(() => state.items.filter(item => item.active && item.components.length > 0), [state.items]);
  const nestedItems = kit?.components.filter(component =>
    state.items.find(item => item.id === component.itemId)?.components.length) ?? [];
  const hasSerializedComponents = !!kit?.components.some(component =>
    state.items.find(item => item.id === component.itemId)?.tracking === "serialized");
  const basis = relevantBasis(state, source, itemId);
  const acceptedBasis = useRef(basis);
  useEffect(() => {
    if (basis && basis !== acceptedBasis.current && !attemptRef.current) setExternalChange(true);
  }, [basis]);

  const isDirty = !!(receiptId || itemId || reason || parentSerial || Object.values(componentSerials).some(value => value.length) ||
    Object.keys(componentQuantities).length ||
    Object.values(scanInputs).some(Boolean) || quantity !== "1" || attempt);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); onOperationPending?.(false); }, [onDirtyChange, onOperationPending]);
  const locked = busy || !!attempt;
  const quantityNumber = validCount(quantity) ? Number(quantity) : 0;
  const parentLine = itemId ? sourceLineFor(itemId) : undefined;
  const parentOptions = kit?.tracking === "serialized" ? availableSerials(itemId) : [];
  const chosenParentInStock = !!parentSerial && parentOptions.includes(parentSerial);
  const quantityRemaining = parentLine ? sourceRemaining(state, receiptId, itemId, parentLine) : 0;

  const resetDraft = (nextReceiptId: string, nextItemId: string) => {
    setReceiptId(nextReceiptId);
    setItemId(nextItemId);
    setQuantity("1");
    setParentSerial("");
    setComponentSerials({});
    setComponentQuantities({});
    setScanInputs({});
    setReason("");
    setReviewing(false);
    setError("");
    setNotice("");
    setExternalChange(false);
    acceptedBasis.current = relevantBasis(state, relevantSources.find(value => value.id === nextReceiptId), nextItemId);
  };
  const requestSource = (nextReceiptId: string, nextItemId: string) => {
    const captured = parentSerial || reason || Object.values(componentSerials).some(values => values.length) ||
      Object.values(componentQuantities).some(Boolean) || Object.values(scanInputs).some(Boolean);
    if (captured) {
      setPendingSource({ receiptId: nextReceiptId, itemId: nextItemId });
      setDiscardOpen(true);
    } else resetDraft(nextReceiptId, nextItemId);
  };
  const commitScan = (componentId: string) => {
    const serial = (scanInputs[componentId] ?? "").trim();
    if (!serial || !kit) return;
    const current = componentSerials[componentId] ?? [];
    const target = (kit.components.find(line => line.itemId === componentId)?.quantity ?? 0) * quantityNumber;
    if (current.includes(serial)) { setError(`${serial} is already scanned for this component.`); return; }
    if (current.length >= target) { setError("The required serial count is complete."); return; }
    // These identities arrived INSIDE the purchased kit, not as loose stock.
    // The server checks current stock, transit, installed, held and return custody.
    setComponentSerials(values => ({ ...values, [componentId]: [...(values[componentId] ?? []), serial] }));
    setScanInputs(values => ({ ...values, [componentId]: "" }));
    setReviewing(false);
    setError("");
  };
  const buildPayload = () => {
    if (!source || !kit) throw new Error("Choose a received purchase source and a defined kit.");
    if (externalChange) throw new Error("Saved inventory changed. Recheck the source and current custody before reviewing.");
    if (!reason.trim()) throw new Error("Enter the vendor-kit inspection reason or note.");
    if (nestedItems.length) throw new Error("Nested kit components are not supported. Choose a recipe with stock items only.");
    if (!validCount(quantity)) throw new Error("Quantity must be a whole number from 1 to 1,000,000.");
    if (hasSerializedComponents && (kit.tracking !== "serialized" || Number(quantity) !== 1)) {
      throw new Error("Kits with serialized components must have a serialized finished kit and be inspected one at a time.");
    }
    if (!parentLine) throw new Error("The selected purchase receipt has no source line for this kit.");
    const qty = Number(quantity);
    if (kit.tracking === "serialized") {
      if (qty !== 1) throw new Error("Serialized finished kits must be inspected one at a time.");
      if (!chosenParentInStock) throw new Error("Choose an exact finished-kit serial from this receipt that remains in warehouse stock and is not reserved.");
    } else if (parentSerial) throw new Error("This finished kit is quantity tracked and must not have a serial.");
    if (qty > quantityRemaining) throw new Error(`Only ${quantityRemaining} unverified finished kit(s) remain on this receipt.`);
    const components: StockLine[] = kit.components.map(recipe => {
      const part = state.items.find(item => item.id === recipe.itemId);
      if (!part?.active) throw new Error("A current recipe component is missing or inactive.");
      if (part.components.length) throw new Error(`${part.name} is a kit. Nested kit components are not supported.`);
      const required = recipe.quantity * qty;
      const capturedQuantity = part.tracking === "regular"
        ? Number(componentQuantities[part.id] ?? "") : required;
      if (!validCount(String(capturedQuantity))) {
        throw new Error(`${part.name}: enter the actual whole quantity counted inside this kit.`);
      }
      if (capturedQuantity !== required) {
        throw new Error(`${part.name}: captured quantity must match the current recipe (${required}). Review the recipe before verification.`);
      }
      if (part.tracking === "serialized") {
        const serials = componentSerials[part.id] ?? [];
        if (scanInputs[part.id]?.trim()) throw new Error(`${part.name}: commit or clear the unfinished serial scan.`);
        if (serials.length !== required || !unique(serials)) {
          throw new Error(`${part.name}: scan exactly ${required} distinct serialized components found inside this kit.`);
        }
        return { itemId: part.id, quantity: required, serials };
      }
      if ((componentSerials[part.id] ?? []).length) throw new Error(`${part.name} is quantity tracked and cannot have serial scans.`);
      return { itemId: part.id, quantity: capturedQuantity, serials: [] };
    });
    return { receiptId: source.id, itemId: kit.id, quantity: qty,
      serials: kit.tracking === "serialized" ? [parentSerial] : [], components, reason: reason.trim() };
  };
  const close = () => {
    if (busyRef.current || attemptRef.current) return;
    if (isDirty) setDiscardOpen(true);
    else onClose();
  };
  const confirmResult = async (result: any, operationId: string) =>
    result?.operationId === operationId || result?.receipt?.id === operationId ||
    result?.state?.receipts?.some((receipt: { id?: string }) => receipt.id === operationId);
  const complete = async (operationId: string) => {
    try {
      const refreshed = await onSaved() as { isError?: boolean; data?: { state?: InventoryState } };
      if (refreshed?.isError) throw new Error("Inventory refresh failed.");
      acceptedBasis.current = relevantBasis(refreshed.data?.state ?? state, source, itemId);
      attemptRef.current = null;
      setAttempt(null);
      attemptConfirmedRef.current = false;
      setAttemptConfirmed(false);
      onOperationPending?.(false);
      toast({ title: "Vendor kit verified", description: "The source receipt and component custody were recorded." });
      onDirtyChange?.(false);
      onClose();
    } catch {
      attemptConfirmedRef.current = true;
      setAttemptConfirmed(true);
      setNotice("The operation receipt is confirmed, but the inventory refresh failed. Refresh and verify the ledger before continuing.");
    }
  };
  const submit = async () => {
    if (busyRef.current) return;
    let selected = attemptRef.current;
    if (selected && attemptConfirmedRef.current) {
      await checkReceipt();
      return;
    }
    if (!selected) {
      try {
        const payload = buildPayload();
        selected = { payload, fingerprint: JSON.stringify(payload), operationId: crypto.randomUUID(), uncertain: false };
        attemptRef.current = selected;
        setAttempt(selected);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Check the source and captured quantities.");
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    onOperationPending?.(true);
    try {
      const response = await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: selected.operationId, action: "verifyVendorKit", data: selected.payload,
      });
      const result = await response.json();
      if (await confirmResult(result, selected.operationId)) {
        attemptConfirmedRef.current = true;
        setAttemptConfirmed(true);
        await complete(selected.operationId);
      } else {
        const uncertainAttempt = { ...selected, uncertain: true };
        attemptRef.current = uncertainAttempt;
        setAttempt(uncertainAttempt);
        setError("No receipt confirmed this operation. Retry the unchanged operation or check the ledger; the prepared payload and operation identity are retained.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Outcome unknown. Retry with the same operation identity.";
      // A first, explicit validation/permission rejection is definitive. Never
      // unlock a retry that follows an earlier uncertain response.
      const definitive = !selected.uncertain && !attemptConfirmedRef.current && /^(400|403|409):/.test(message);
      if (definitive) {
        attemptRef.current = null;
        setAttempt(null);
        onOperationPending?.(false);
        setError(message.replace(/^\d+:\s*/, ""));
      } else {
        const uncertainAttempt = { ...selected, uncertain: true };
        attemptRef.current = uncertainAttempt;
        setAttempt(uncertainAttempt);
        setError(`${message} Outcome may be unknown; retry will reuse the same operation identity.`);
      }
    } finally { busyRef.current = false; setBusy(false); }
  };
  const checkReceipt = async () => {
    if (!attempt || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("Checking the saved inventory ledger for the prepared operation…");
    try {
      const refreshed = await onSaved() as { isError?: boolean; data?: { state?: InventoryState } };
      if (refreshed?.isError) throw new Error("Inventory refresh failed.");
      const latest = refreshed.data?.state ?? state;
      if (attemptConfirmedRef.current || latest.receipts.some(receipt => receipt.id === attempt.operationId)) {
        attemptConfirmedRef.current = true;
        setAttemptConfirmed(true);
        await complete(attempt.operationId);
      }
      else setNotice("No confirming receipt was found. Captures remain frozen. Retry the unchanged operation or check again.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not check the inventory ledger."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent data-testid="vendor-kit-dialog" className="flex max-h-[min(94dvh,820px)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-3 overflow-hidden p-3 sm:p-6"
      onOpenAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader className="shrink-0 text-left">
        <DialogTitle>Inspect vendor-supplied kit</DialogTitle>
         <DialogDescription>Open the purchased finished kit and record its actual contents. Components are not loose stock; no stock quantities change during verification.</DialogDescription>
      </DialogHeader>
      {externalChange && !attempt && <Alert data-testid="vendor-kit-external-change">
        <AlertTriangle className="h-4 w-4" /><AlertTitle>Saved stock basis changed</AlertTitle>
        <AlertDescription className="space-y-2">
          Your local captures are retained. Recheck current receipt, stock, reservation and kit-assembly records before continuing.
          <div><Button type="button" size="sm" variant="outline" onClick={() => { acceptedBasis.current = basis; setExternalChange(false); setReviewing(false); setError(""); }}>Recheck current basis</Button></div>
        </AlertDescription>
      </Alert>}
      {attempt && <Alert data-testid="vendor-kit-unknown-attempt"><AlertTriangle className="h-4 w-4" /><AlertTitle>Operation needs confirmation</AlertTitle>
        <AlertDescription>The exact payload and operation identity are locked. Retry sends the same operation; checking refreshes the ledger without changing captures.</AlertDescription></Alert>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vendor-kit-source">Original purchase receive receipt</Label>
            <select id="vendor-kit-source" data-testid="vendor-kit-source" disabled={locked} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={receiptId} onChange={event => requestSource(event.target.value, "")}>
              <option value="">Choose purchase receipt</option>
              {relevantSources.map(value => {
                const warehouse = state.warehouses.find(location => location.id === value.warehouseId);
                const order = state.orders.find(order => order.id === value.reference);
                return <option key={value.id} value={value.id}>{inventoryReceiptLabel(state.receipts, value.id)} · {order ? orderLabel(order) : "Purchase"} · {warehouse?.name ?? "Unknown location"}</option>;
              })}
            </select>
            {!relevantSources.length && <p className="text-xs text-muted-foreground">No received purchase orders are available as a verified source.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-kit-item">Finished kit item</Label>
            <select id="vendor-kit-item" data-testid="vendor-kit-item" disabled={locked || !source} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={itemId} onChange={event => requestSource(receiptId, event.target.value)}>
              <option value="">Choose a kit recipe</option>
              {kitOptions.filter(value => source?.lines.some(line => line.itemId === value.id))
                .map(value => <option key={value.id} value={value.id}>{value.sku} · {value.name}</option>)}
            </select>
          </div>
        </div>
        {source && kit && <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <PackageCheck className="h-4 w-4 text-muted-foreground" />
            <span>{state.warehouses.find(value => value.id === source.warehouseId)?.name ?? "Source warehouse"}</span>
            <Badge variant="outline">{kit.tracking === "serialized" ? "Serialized kit" : "Quantity-tracked kit"}</Badge>
            <span className="ml-auto font-mono text-xs tabular-nums">{quantityRemaining} unverified in source</span>
          </div>
          {nestedItems.length > 0 && <Alert variant="destructive" data-testid="vendor-kit-nested-warning">
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Nested kit recipe is unsupported</AlertTitle>
            <AlertDescription>{nestedItems.map(line => state.items.find(value => value.id === line.itemId)?.name ?? line.itemId).join(", ")} is itself a kit. Vendor kit verification supports stock components only.</AlertDescription>
          </Alert>}
          {hasSerializedComponents && kit.tracking !== "serialized" && <Alert variant="destructive" data-testid="vendor-kit-serialized-parent-warning">
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Serialized finished kit required</AlertTitle>
            <AlertDescription>This recipe includes serialized components. Set the finished kit item to serial tracking before vendor-kit verification; serialized component kits are verified one at a time.</AlertDescription>
          </Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-kit-quantity">Finished quantity</Label>
              <Input id="vendor-kit-quantity" data-testid="vendor-kit-quantity" inputMode="numeric" type="number" min="1" max="1000000"
                disabled={locked || kit.tracking === "serialized" || hasSerializedComponents} value={quantity} onChange={event => { setQuantity(event.target.value); setComponentQuantities({}); setReviewing(false); }} />
              {kit.tracking === "serialized" && <p className="text-xs text-muted-foreground">Serialized finished kits are verified one at a time.</p>}
            </div>
            {kit.tracking === "serialized" && <div className="space-y-1.5">
              <Label htmlFor="vendor-kit-parent-serial">Finished-kit serial on source receipt</Label>
              <select id="vendor-kit-parent-serial" data-testid="vendor-kit-parent-serial" disabled={locked} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                value={parentSerial} onChange={event => { setParentSerial(event.target.value); setReviewing(false); }}>
                <option value="">Choose exact in-stock serial</option>
                {parentOptions.map(serial => <option key={serial} value={serial}>{serial}</option>)}
              </select>
            </div>}
          </div>
          <section aria-label="Current kit recipe components" className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Current recipe · component evidence</h3><span className="text-xs text-muted-foreground">Quantity capture or exact serial scans</span></div>
            {kit.components.map(recipe => {
              const part = state.items.find(value => value.id === recipe.itemId);
              const required = recipe.quantity * quantityNumber;
              const serials = componentSerials[recipe.itemId] ?? [];
              return <article key={recipe.itemId} data-testid={`vendor-kit-component-${recipe.itemId}`} className="space-y-2 rounded-md border p-2.5">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0"><h4 className="break-words text-sm font-medium">{part?.name ?? recipe.itemId}</h4><p className="font-mono text-xs text-muted-foreground">{part?.sku ?? "Missing item"} · recipe {recipe.quantity} / kit</p></div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">{required} required</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Count or scan actual contents inside the finished kit</span>
                  {part?.tracking === "serialized" && <span className="ml-auto font-mono tabular-nums">{serials.length}/{required} scanned</span>}
                </div>
                {part?.tracking === "serialized" ? <div className="space-y-2">
                  <div className="flex gap-2">
                    <Label className="sr-only" htmlFor={`vendor-kit-scan-${recipe.itemId}`}>Scan {part.name} component serial</Label>
                    <Input id={`vendor-kit-scan-${recipe.itemId}`} data-testid={`vendor-kit-scan-${recipe.itemId}`} autoComplete="off" maxLength={100}
                      className="h-10 min-w-0 flex-1 font-mono" placeholder="Scan actual component serial" disabled={locked}
                      value={scanInputs[recipe.itemId] ?? ""} onChange={event => setScanInputs(value => ({ ...value, [recipe.itemId]: event.target.value }))}
                      onKeyDown={event => { if (event.key === "Enter" && event.currentTarget.value.trim()) { event.preventDefault(); commitScan(recipe.itemId); } }} />
                    <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" disabled={locked || !scanInputs[recipe.itemId]?.trim() || serials.length >= required}
                      aria-label={`Commit ${part.name} serial scan`} onClick={() => commitScan(recipe.itemId)}><ScanLine className="mr-1.5 h-4 w-4" /><span className="hidden sm:inline">Commit</span></Button>
                  </div>
                  {!!serials.length && <ul aria-label={`${part.name} scanned serials`} className="max-h-24 space-y-1 overflow-y-auto rounded border bg-muted/20 p-2">
                    {serials.map((serial, index) => <li key={`${serial}-${index}`} className="flex items-center gap-2 font-mono text-xs"><span className="min-w-0 flex-1 break-all">{index + 1}. {serial}</span>
                      <button type="button" className="rounded p-1 hover:bg-muted" aria-label={`Remove ${part.name} serial ${serial}`} disabled={locked}
                        onClick={() => { setComponentSerials(value => ({ ...value, [part.id]: value[part.id].filter((_, position) => position !== index) })); setReviewing(false); }}><Trash2 className="h-3.5 w-3.5" /></button></li>)}
                  </ul>}
                </div> : <div className="flex items-center gap-2">
                  <Label htmlFor={`vendor-kit-count-${recipe.itemId}`} className="shrink-0 text-xs">Quantity captured</Label>
                  <Input id={`vendor-kit-count-${recipe.itemId}`} data-testid={`vendor-kit-count-${recipe.itemId}`} type="number" inputMode="numeric" min="0"
                    max={1000000} className="h-9 w-24 font-mono tabular-nums" disabled={locked}
                    value={componentQuantities[recipe.itemId] ?? ""}
                    onChange={event => { setComponentQuantities(value => ({ ...value, [recipe.itemId]: event.target.value })); setReviewing(false); }} />
                  <span className="text-xs text-muted-foreground">Current recipe requires {required}; no serials are inferred.</span>
                </div>}
              </article>;
            })}
          </section>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-kit-reason">Inspection note</Label>
            <Textarea id="vendor-kit-reason" data-testid="vendor-kit-reason" disabled={locked} maxLength={1000} rows={2}
              value={reason} placeholder="Record what was checked or any vendor discrepancy." onChange={event => { setReason(event.target.value); setReviewing(false); }} />
          </div>
        </>}
        {error && <p role="alert" data-testid="vendor-kit-error" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
        {notice && <p role="status" aria-live="polite" className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{notice}</p>}
        {reviewing && !attempt && <div data-testid="vendor-kit-review" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <h3 className="font-medium">Ready to verify</h3><p className="mt-1 text-muted-foreground">{inventoryReceiptLabel(state.receipts, receiptId)} · {quantityNumber} finished kit · {kit?.components.length ?? 0} recipe components. No loose stock will be deducted. The prepared payload will be immutable after submission.</p>
        </div>}
      </div>
      <DialogFooter className="shrink-0 flex-row flex-wrap justify-between gap-2 sm:justify-between">
        <Button type="button" variant="outline" onClick={close} disabled={busy || !!attempt}>Close</Button>
        {attempt ? <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void checkReceipt()}><RefreshCw className="mr-1.5 h-4 w-4" />Check ledger</Button>
          {!attemptConfirmed && <Button type="button" data-testid="vendor-kit-retry" disabled={busy} onClick={() => void submit()}>{busy ? "Retrying…" : "Retry unchanged operation"}</Button>}
        </> : reviewing ?
          <Button type="button" data-testid="vendor-kit-submit" disabled={busy || externalChange || nestedItems.length > 0} onClick={() => void submit()}><Check className="mr-1.5 h-4 w-4" />Verify vendor kit</Button> :
          <Button type="button" data-testid="vendor-kit-review-button" disabled={busy || !source || !kit || externalChange || nestedItems.length > 0}
            onClick={() => { setError(""); try { buildPayload(); setReviewing(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check captured component evidence."); } }}>Review verification</Button>}
      </DialogFooter>
    </DialogContent>
    <Dialog open={discardOpen} onOpenChange={open => { setDiscardOpen(open); if (!open) setPendingSource(null); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Discard vendor-kit captures?</DialogTitle><DialogDescription>Local receipt, serial and quantity captures will be cleared. Nothing has been posted.</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => { setDiscardOpen(false); setPendingSource(null); }}>Keep captures</Button><Button type="button" variant="destructive" onClick={() => {
          setDiscardOpen(false);
          if (pendingSource) { resetDraft(pendingSource.receiptId, pendingSource.itemId); setPendingSource(null); }
          else { onDirtyChange?.(false); onClose(); }
        }}>Discard captures</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Dialog>;
}
