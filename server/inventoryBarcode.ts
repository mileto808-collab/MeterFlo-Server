import bwipjs from "bwip-js/node";

// Inline vector output works offline and remains sharp in printed/PDF receipts.
// The encoded value stays exactly the persisted identifier; no display text is encoded.
export function inventoryBarcode(id: string, label: string) {
  const svg = bwipjs.toSVG({
    bcid: "code128", text: id, scale: 2, height: 12,
    includetext: false, paddingwidth: 12, paddingheight: 4, backgroundcolor: "FFFFFF",
  });
  const safeLabel = label.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return `<figure class="internal-barcode" role="img" aria-label="${safeLabel} barcode"><figcaption>${safeLabel}</figcaption>${svg}</figure>`;
}
