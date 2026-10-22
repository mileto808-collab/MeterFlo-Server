import QRCode from "qrcode";
import type { InventoryState } from "../shared/inventory";
import type { FulfillmentBatch } from "../shared/inventory-fulfillment";
import { fulfillmentTicketNumber } from "../shared/inventory-pickups";
import { inventoryDateTime } from "../shared/inventory-date-time";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export async function inventoryPickTicket(batch: FulfillmentBatch, state: InventoryState,
  project: { id: number; name: string; timezone: string | null }, users: { id: string; username: string | null }[],
  origin: string, workOrderLabels: InventoryWorkOrderLabels) {
  const vehicle = state.warehouses.find(location => location.id === batch.vehicleId);
  const staging = state.warehouses.find(location => location.id === batch.stagingId);
  const source = state.warehouses.find(location => location.id === batch.sourceId);
  const assigned = new Set([...(vehicle?.userIds ?? []), ...(vehicle?.assignedUserId ? [vehicle.assignedUserId] : [])]);
  const crew = users.filter(user => assigned.has(user.id)).map(user => user.username || "Assigned technician");
  const ticket = fulfillmentTicketNumber(batch.createdAt, (state.fulfillmentBatches ?? []).findIndex(row => row.id === batch.id));
  const link = `${origin}/projects/${project.id}/work-orders?pickup=${encodeURIComponent(batch.id)}`;
  const qr = await QRCode.toDataURL(link, { width: 160, margin: 1 });
  const items = new Map<string, { planned: number; staged: number; loaded: number; serials: string[] }>();
  for (const line of batch.lines) {
    const item = items.get(line.itemId) ?? { planned: 0, staged: 0, loaded: 0, serials: [] };
    item.planned += line.quantity; item.staged += line.stagedQuantity; item.loaded += line.deliveredQuantity;
    item.serials.push(...line.stagedSerials.filter(serial => !line.deliveredSerials.includes(serial)));
    items.set(line.itemId, item);
  }
  const waiting = [...items.values()].some(item => item.staged > item.loaded);
  const full = batch.lines.every(line => line.stagedQuantity === line.quantity);
  const status = batch.status !== "active" ? batch.status : batch.issues?.some(issue => issue.status === "open") ? "Pickup needs review — do not load" : !waiting ? "Picking / not yet staged" :
    full ? "Ready for pickup" : batch.pickupReady ? "Ready for partial pickup" : "Partially staged — not yet ready";
  const timezone = project.timezone ?? "UTC";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(ticket)} — Pick ticket</title><style>
    body{font:14px Arial,sans-serif;color:#111;margin:24px;overflow-wrap:anywhere}h1{margin-bottom:8px}
    header{display:flex;justify-content:space-between;gap:16px}header img{width:120px;height:120px}
    table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #aaa;padding:9px;text-align:left;vertical-align:top}
    .table-scroll{overflow-x:auto}.check{min-width:65px;min-height:24px}small{color:#444}button{padding:10px}
    @media print{button{display:none}body{font-size:11px;margin:0}thead{display:table-header-group}.table-scroll{overflow:visible}tr{break-inside:avoid}}
    @page{margin:12mm}</style></head><body><button onclick="window.print()">Print / Save PDF</button>
    <header><div><h1>Pick ticket · ${escape(ticket)}</h1><strong>${escape(project.name)} · ${escape(batch.name)}</strong>
    <p>${escape(status)} · Revision ${batch.revision}</p><p>Created: ${escape(inventoryDateTime(batch.createdAt, timezone))}<br>
    Printed: ${escape(inventoryDateTime(new Date().toISOString(), timezone))} · ${escape(timezone)}</p></div>
    <div><img src="${qr}" alt="Open this pickup in MeterFlo"><br><small>Scan to review pickup. Sign-in required.</small></div></header>
    <p><strong>Pick from:</strong> ${escape(source?.name ?? "Unavailable warehouse")}<br>
    <strong>Stage at:</strong> ${escape(staging?.name ?? "Unavailable staging location")} · ${escape(staging?.code)} · ${escape(staging?.location)}<br>
    <strong>Vehicle:</strong> ${escape(vehicle?.name ?? "Unavailable vehicle")}<br>
    <strong>Assigned crew:</strong> ${escape(crew.join(", ") || "No vehicle users assigned — assign users before expecting a pickup notice.")}</p>
    <p>Work orders: ${batch.workOrders.map(work => escape(workOrderLabels[String(work.workOrderId)] || work.label)).join(", ")}</p>
    <p>Place this ticket with the physical stock in Staging. Printing/checking this sheet does not reserve stock, record a movement, or acknowledge pickup.
    Record the actual warehouse pull and vehicle handoff in MeterFlo. Captured serials are custody identities, not installed work-order assignments.</p>
    <div class="table-scroll"><table><thead><tr><th>Item / SKU</th><th>Unit</th><th>Required</th><th>Recorded staged</th><th>Waiting at staging</th><th>Still to pick</th><th>Picked ✓</th><th>Loaded ✓</th></tr></thead><tbody>
    ${[...items].map(([id, quantities]) => {
      const item = state.items.find(item => item.id === id);
      return `<tr><td>${escape(item?.name ?? "Unavailable item")}<br><small>${escape(item?.sku)}</small></td>
      <td>${escape(item?.unit ?? "each")}</td><td>${quantities.planned}</td><td>${quantities.staged}</td>
      <td>${quantities.staged - quantities.loaded}</td><td>${quantities.planned - quantities.staged}</td><td class="check">☐</td><td class="check">☐</td></tr>`;
    }).join("")}</tbody></table></div>
    <p>Picked by: ____________________ &nbsp; Verified / loaded by: ____________________ &nbsp; Date/time: ____________________</p>
    ${[...items].some(([, item]) => item.serials.length) ? "<h2>Recorded serials waiting at staging</h2>" : ""}
    ${[...items].filter(([, item]) => item.serials.length).map(([id, quantities]) =>
      `<p><strong>${escape(state.items.find(item => item.id === id)?.name ?? "Item")}</strong><br>${[...new Set(quantities.serials)].map(escape).join(", ")}</p>`).join("")}
    </body></html>`;
}
