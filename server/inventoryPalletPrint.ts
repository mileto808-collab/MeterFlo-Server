import type { InventoryReceipt, InventoryState } from "../shared/inventory";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function inventoryPalletPrint(receipt: InventoryReceipt, state: InventoryState) {
  if (!receipt.pallets?.length) return "";
  return `<h2>Receiving pallet scan history</h2><p>As received; not current stock containers. Quantities below are counts of identified serials, including good and known-damaged units.</p>
    ${receipt.pallets.map(pallet => {
      const item = state.items.find(item => item.id === pallet.itemId);
      return `<h3>${escape(pallet.label)} · ${escape(item ? `${item.sku} · ${item.name}` : "Item unavailable")}</h3>
        <p>Expected: ${pallet.expectedQuantity} · Scanned: ${pallet.serials.length}${pallet.serials.length !== pallet.expectedQuantity ? ` · Difference: ${pallet.serials.length - pallet.expectedQuantity}` : " · Complete"}</p>
        ${pallet.exceptionReason ? `<p>Count discrepancy: ${escape(pallet.exceptionReason)}</p>` : ""}
        <table><thead><tr><th>#</th><th>Serial</th><th>As-received category</th></tr></thead><tbody>
        ${pallet.serials.map((serial, index) => `<tr><td>${index + 1}</td><td>${escape(serial)}</td><td>${receipt.damaged?.some(line => line.itemId === pallet.itemId && line.serials.includes(serial)) ? "Known damaged" : "Good"}</td></tr>`).join("")}
        </tbody></table>`;
    }).join("")}`;
}
