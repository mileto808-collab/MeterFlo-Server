import type { ReplacementEligibility } from "../shared/defective-replacement";
const esc = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function replacementReceipt(project: string, context: ReplacementEligibility, readingOnly = false) {
  const title = readingOnly ? "Read history" : "Replacement installation history";
  const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { timeZone: context.timezone }) : "Not completed";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title><style>
  body{font:14px system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}
  h1{font-size:24px}article{border:1px solid #bbb;padding:16px;margin:16px 0;break-inside:avoid}
  dl{display:grid;grid-template-columns:150px 1fr;gap:6px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
  @media print{button{display:none}body{margin:0;max-width:none}}
  </style></head><body><button onclick="window.print()">Print history</button>
  <h1>${title}</h1><p>${esc(project)} · Times in ${esc(context.timezone)}</p>
  <p>${readingOnly ? "This project records readings only; equipment is not replaced. Existing and captured identifiers describe the recorded equipment, not a physical removal or installation." :
    "Each visit is a separate installation record. Accepted completion and stock reconciliation are separate; defective returned equipment is not automatically usable stock. This document does not move inventory."}</p>
  ${context.history.map(row => `<article><h2>${esc(row.label)}</h2><dl>
  <dt>${readingOnly ? "Record" : "Visit"}</dt><dd>${esc(row.equipment || (readingOnly ? "Reading capture" : "Original installation"))} · ${esc(row.status)}</dd>
  <dt>Reason</dt><dd>${esc(row.reason)}</dd><dt>Completed</dt><dd>${esc(date(row.completedAt))}</dd>
  <dt>System</dt><dd>${readingOnly ? "Existing: " : ""}${esc(row.oldSystemId)} → ${readingOnly ? "Captured: " : ""}${esc(row.newSystemId)}</dd>
  <dt>Module</dt><dd>${readingOnly ? "Existing: " : ""}${esc(row.oldModuleId)} → ${readingOnly ? "Captured: " : ""}${esc(row.newModuleId)}</dd>
  ${readingOnly ? "" : `<dt>Accounting</dt><dd>${esc(row.accountingStatus || "No acceptance record available")}</dd>`}</dl></article>`).join("")}
  </body></html>`;
}
