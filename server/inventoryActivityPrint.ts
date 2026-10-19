import type { InventoryState } from "../shared/inventory";
import type { InventoryActivityGroup } from "../shared/inventory-activity-groups";
import { inventoryActivityActionLabel } from "../shared/inventory-activity-groups";
import { inventoryDateTime } from "../shared/inventory-date-time";
import { inventoryActorLabel, inventoryReceiptLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";
import { inventoryPrint } from "./inventoryPrint";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function inventoryActivityPrint(group: InventoryActivityGroup, state: InventoryState, project: string,
  actors: readonly InventoryActorLabel[], timezone: string, labels: InventoryWorkOrderLabels): string {
  // Reuse complete receipt/manifest rendering so damage, corrections, kit evidence,
  // pricing snapshots and separate scanned/visually verified serial pages stay intact.
  const styles = new Set<string>();
  const documents = group.receipts.map(receipt => {
    const html = inventoryPrint("receipt", receipt, state, project, actors, timezone, labels);
    const body = /<body>([\s\S]*)<\/body>/.exec(html);
    if (!body) throw new Error("Transaction document could not be included in the activity history.");
    for (const style of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) styles.add(style[1]);
    return `<section class="transaction-document" data-receipt-id="${escape(receipt.id)}">
      <h2>${escape(inventoryReceiptLabel(state.receipts, receipt.id))} · ${escape(inventoryActivityActionLabel(receipt.action))}</h2>
      ${body[1].replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, "")}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Activity history</title>
    <style>${[...styles].join("\n")}
      body{font:14px Arial,sans-serif;color:#111;margin:24px}
      th,td,p,h1,h2{overflow-wrap:anywhere}table{table-layout:fixed}
      thead{display:table-header-group}tr{break-inside:avoid}
      .transaction-document{border-top:1px solid #bbb;margin-top:32px;padding-top:16px}
      @media print{button{display:none}.transaction-document{break-before:page;page-break-before:always;border:0;margin:0;padding:0}}
    </style></head><body><button onclick="window.print()">Print / Save PDF</button>
    <h1>Activity history</h1><h2>${escape(group.title)}</h2><p>${escape(project)} · Timezone: ${escape(timezone)}</p>
    <p>${group.receipts.length} transactions. Complete related history, including transactions outside the current filters.
      Quantities are recorded per transaction; they are not added together across custody changes.</p>
    <table><thead><tr><th>Receipt</th><th>Recorded at</th><th>Action</th><th>User</th><th>Location</th></tr></thead><tbody>
      ${group.receipts.map(receipt => `<tr><td>${escape(inventoryReceiptLabel(state.receipts, receipt.id))}</td>
        <td>${escape(inventoryDateTime(receipt.occurredAt, timezone))}</td><td>${escape(inventoryActivityActionLabel(receipt.action))}</td>
        <td>${escape(inventoryActorLabel(receipt.actor, actors))}</td>
        <td>${escape(state.warehouses.find(warehouse => warehouse.id === receipt.warehouseId)?.name ?? "Not recorded")}</td></tr>`).join("")}
    </tbody></table>${documents.join("")}</body></html>`;
}
