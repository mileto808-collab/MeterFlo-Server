import type { InventoryReceipt, InventoryState, StockLine } from "../shared/inventory";
import { inventoryReceiptLabel } from "../shared/inventory-display-labels";
import { orderLabel } from "../shared/inventory-order-labels";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

export type ReceiptSerialEvidenceCategory =
  | "confirmed"
  | "damaged"
  | "dispatch-reference"
  | "verified-release"
  | "disposition-movement"
  | "disposition-known"
  | "transit-loss"
  | "assembled-kit" | "disassembled-kit" | "assembly-consumed" | "vendor-kit" | "vendor-component" | "recovered" | "kit-missing" | "kit-inspection";

export type ReceiptSerialEvidence = {
  itemId: string;
  product: string;
  sku: string;
  category: ReceiptSerialEvidenceCategory;
  serials: string[];
  unidentifiedQuantity: number;
  quantity?: number;
};

/**
 * Extract only serial evidence physically recorded on this receipt. The same
 * text in distinct evidence categories intentionally remains distinct.
 */
export function extractReceiptSerialEvidence(receipt: InventoryReceipt, state?: InventoryState): ReceiptSerialEvidence[] {
  const groups: ReceiptSerialEvidence[] = [];
  const addLine = (line: StockLine, category: ReceiptSerialEvidenceCategory, extra?: {
    unidentifiedQuantity?: number;
    quantity?: number;
  }) => {
    const serials = Array.isArray(line.serials) ? line.serials : [];
    const unidentifiedQuantity = extra?.unidentifiedQuantity ?? 0;
    if (!serials.length && !unidentifiedQuantity) return;
    groups.push({
      itemId: line.itemId,
      product: "",
      sku: "",
      category,
      serials: [...serials],
      unidentifiedQuantity,
      ...(extra?.quantity !== undefined ? { quantity: extra.quantity } : {}),
    });
  };

  const lineCategory = receipt.action === "verifyVendorKit" ? "vendor-kit" : receipt.action === "assemble" ? "assembled-kit" : receipt.action === "disassemble" ? "disassembled-kit" :
    receipt.action === "resolveTransit" ? "transit-loss" :
    receipt.action === "resolveHold" ? "disposition-movement" : "confirmed";
  for (const line of receipt.lines ?? []) addLine(line, lineCategory);
  for (const line of receipt.components ?? []) addLine(line, receipt.action === "verifyVendorKit" ? "vendor-component" :
    receipt.action === "assemble" ? "assembly-consumed" : receipt.kitConversion ? "recovered" : "confirmed");
  for (const recovery of receipt.kitConversion?.recovered ?? []) {
    addLine({ itemId: recovery.itemId, quantity: recovery.damagedQuantity, serials: recovery.damagedSerials }, "damaged");
    addLine({ itemId: recovery.itemId, quantity: recovery.missingQuantity, serials: recovery.missingSerials }, "kit-missing");
  }
  if (receipt.kitInspection) addLine(receipt.kitInspection, "kit-inspection");
  for (const line of receipt.damaged ?? []) {
    addLine(line, "damaged", { unidentifiedQuantity: line.unidentifiedQuantity });
    addLine({ itemId: line.itemId, quantity: line.quantity, serials: line.expectedSerials ?? [] }, "dispatch-reference");
  }
  if (receipt.holdDisposition) {
    const disposition = receipt.holdDisposition;
    // A disposition is a later receipt, not the original receipt that created
    // the hold. Resolve product metadata only; never copy that hold's serials.
    const itemId = state?.shipmentHolds?.find(hold => hold.id === receipt.holdId && hold.orderId === receipt.reference)?.itemId ??
      (receipt.lines.length === 1 ? receipt.lines[0].itemId : "");
    const addDisposition = (category: ReceiptSerialEvidenceCategory, serials: string[], unidentified = 0) => {
      if (!serials.length && !unidentified) return;
      groups.push({ itemId, product: "", sku: "", category, serials: [...(serials ?? [])], unidentifiedQuantity: unidentified });
    };
    addDisposition("disposition-known", disposition.serials ?? [], disposition.unidentifiedQuantity ?? 0);
    addDisposition("dispatch-reference", disposition.expectedSerials ?? []);
    addDisposition("verified-release", disposition.verifiedSerials ?? []);
  }
  return groups;
}

const categoryLabels: Record<ReceiptSerialEvidenceCategory, string> = {
  confirmed: "Confirmed identities",
  damaged: "Damaged / quarantined identities",
  "dispatch-reference": "Unverified dispatch references",
  "verified-release": "Verified release identities",
  "disposition-movement": "Disposition movement identities (may include unverified references)",
  "disposition-known": "Disposition-selected known identities",
  "transit-loss": "Confirmed transit loss references (not physically received)",
  "assembled-kit": "Finished kits added to stock",
  "vendor-kit": "Purchased finished kits inspected (no stock movement)",
  "vendor-component": "Actual contents received inside vendor kits (not loose stock)",
  "disassembled-kit": "Finished kits removed for disassembly",
  "assembly-consumed": "Components consumed by assembly",
  recovered: "Usable components returned to stock",
  "kit-missing": "Missing component references (not recovered stock)",
  "kit-inspection": "Components selected for inspection disposition",
};

function receiptContext(receipt: InventoryReceipt, state: InventoryState) {
  const linkedOrder = state.orders.find(order => order.id === receipt.reference);
  return {
    order: linkedOrder ? orderLabel(linkedOrder) : "",
    receipt: inventoryReceiptLabel(state.receipts, receipt.id),
  };
}

/** Compact, linked serial-count summaries for a receipt's summary table. */
export function receiptSerialSummary(line: Pick<StockLine, "serials">): string {
  const count = line.serials?.length ?? 0;
  if (!count) return "—";
  return `${count} serial${count === 1 ? "" : "s"} · <a href="#serial-details">Serial Details</a>`;
}

/** Compact count-and-link presentation for exception and disposition paragraphs. */
export function receiptDispositionSerialSummary(disposition: NonNullable<InventoryReceipt["holdDisposition"]>): string {
  const known = disposition.serials?.length ?? 0;
  const unidentified = disposition.unidentifiedQuantity ?? 0;
  const references = disposition.expectedSerials?.length ?? 0;
  const verified = disposition.verifiedSerials?.length ?? 0;
  const bits = [`${known} known identit${known === 1 ? "y" : "ies"}`];
  if (unidentified) bits.push(`${unidentified} unidentified`);
  if (references) bits.push(`${references} dispatch reference${references === 1 ? "" : "s"}`);
  if (verified) bits.push(`${verified} verified release identit${verified === 1 ? "y" : "ies"}`);
  const hasEvidence = known + references + verified > 0;
  return `${bits.map(escape).join("; ")}${hasEvidence ? ` · <a href="#serial-details">Serial Details</a>` : ""}`;
}

/** Appendix HTML is empty for receipts with no serial or unidentified evidence. */
export function receiptSerialAppendix(receipt: InventoryReceipt, state: InventoryState, project: string): string {
  const sourceGroups = extractReceiptSerialEvidence(receipt, state);
  if (!sourceGroups.some(group => group.serials.length)) return "";
  const context = receiptContext(receipt, state);
  const groups = sourceGroups.map(group => {
    const item = state.items.find(candidate => candidate.id === group.itemId);
    return { ...group, product: item?.name || group.itemId || "Unknown product", sku: item?.sku || group.itemId || "—" };
  });
  const groupMarkup = groups.map(group => {
    const title = `${group.sku} — ${group.product} / ${categoryLabels[group.category]}`;
    const serialRows = group.serials.map((serial, serialIndex) =>
      `<tr class="serial-evidence-row"><td>${serialIndex + 1}</td><td class="serial-text">${escape(serial)}</td></tr>`
    ).join("");
    const unknownRows = group.unidentifiedQuantity > 0
      ? `<tr class="serial-evidence-row unidentified"><td>—</td><td>${group.unidentifiedQuantity} unidentified / unreadable unit${group.unidentifiedQuantity === 1 ? "" : "s"}; no serial recorded</td></tr>`
      : "";
    return `<table class="serial-evidence-group" data-serial-product="${escape(group.sku)}" data-serial-category="${escape(group.category)}" aria-label="${escape(title)}">
      <colgroup><col class="serial-number-column"><col></colgroup>
      <thead><tr class="serial-identification"><th colspan="2">Project: ${escape(project)} · ${context.order ? `Order: ${escape(context.order)} · ` : ""}Receipt: ${escape(context.receipt)}</th></tr>
      <tr class="serial-identification"><th colspan="2">${escape(title)}</th></tr>
      <tr><th scope="col">No.</th><th scope="col">Serial / evidence</th></tr></thead>
      <tbody>${serialRows}${unknownRows}</tbody></table>`;
  }).join("");
  return `<section id="serial-details" class="serial-details" aria-label="Serial Details">
    <h2>Serial Details</h2><p>Receipt evidence only. Separate evidence categories are retained as recorded.</p>
    ${groupMarkup}</section>`;
}

