import type { RoutingResult } from "@shared/workOrderRouting";

type PrintableStop = RoutingResult["stops"][number] & {
  serviceDurationMinutes?: number;
  durationSource?: string;
  waitingMinutes?: number;
  appointmentSource?: string;
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatTime = (value: string | null | undefined, timezone: string) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : new Intl.DateTimeFormat(undefined, {
    timeZone: timezone, dateStyle: "medium", timeStyle: "short",
  }).format(date);
};

const originLabel = (route: RoutingResult) => route.originAddress?.trim() ||
  `${route.origin.lat}, ${route.origin.lng}`;

const stopMarkup = (stop: PrintableStop, index: number, timezone: string) => `
  <li class="stop">
    <div class="stop-number">${index + 1}</div>
    <div class="stop-content">
      <h2>${escapeHtml(stop.label)}</h2>
      <p class="address">${escapeHtml(stop.address || "No address provided")}</p>
      <dl>
        <div><dt>Scheduled</dt><dd>${escapeHtml(formatTime(stop.scheduledAt, timezone))}</dd></div>
        <div><dt>Estimated arrival</dt><dd>${escapeHtml(formatTime(stop.arrivalAt, timezone))}</dd></div>
        <div><dt>Estimated service start</dt><dd>${escapeHtml(formatTime(stop.serviceAt, timezone))}</dd></div>
        <div><dt>Service time</dt><dd>${escapeHtml(stop.serviceDurationMinutes ?? "Not available")} min</dd></div>
        <div><dt>Priority</dt><dd>${escapeHtml(stop.priority === null ? "Not set" : stop.priority)}</dd></div>
        ${stop.subStatus ? `<div><dt>Sub-status</dt><dd>${escapeHtml(stop.subStatus)}</dd></div>` : ""}
        ${stop.appointmentWindowStart || stop.appointmentWindowEnd ? `<div class="wide"><dt>Appointment window</dt><dd>${escapeHtml(formatTime(stop.appointmentWindowStart, timezone))} – ${escapeHtml(formatTime(stop.appointmentWindowEnd, timezone))} (${escapeHtml(timezone)})</dd></div>` : ""}
        ${typeof stop.waitingMinutes === "number" ? `<div><dt>Estimated wait</dt><dd>${escapeHtml(stop.waitingMinutes)} min</dd></div>` : ""}
        <div><dt>Arrival estimate</dt><dd>${stop.lateMinutes > 0 ? `${escapeHtml(stop.lateMinutes)} min late` : "On time"}</dd></div>
      </dl>
    </div>
  </li>`;

function routePage(route: RoutingResult, allWarnings: string[], _exclusions: RoutingResult["excluded"], timezone: string, projectName: string) {
  const warnings = [...new Set(route.warnings.length ? route.warnings : allWarnings)];
  const exclusions = route.excluded;
  return `<article class="route-page">
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(projectName)} · Daily route</p>
      <h1>${escapeHtml(route.assigneeName || "Technician route")}</h1>
      <p class="subhead">Departure ${escapeHtml(formatTime(route.departureAt, timezone))} · ${route.stops.length} ordered stops</p>
      <div class="route-meta"><div><span>Starting point</span><strong>${escapeHtml(originLabel(route))}</strong></div><div><span>Road travel estimate</span><strong>${escapeHtml((route.totalTravelMeters / 1609.34).toFixed(1))} mi · about ${escapeHtml(Math.round(route.totalTravelSeconds / 60))} min</strong></div></div>
      <p class="estimate-note">Travel figures are provider estimates; they do not include live traffic.</p>
    </header>
    ${warnings.length ? `<section class="notice"><h2>Route notes</h2><ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>` : ""}
    <ol class="stops">${route.stops.length ? route.stops.map((stop, index) => stopMarkup(stop, index, timezone)).join("") : "<li class='empty'>No stops were placed on this route.</li>"}</ol>
    ${exclusions.length ? `<section class="exclusions"><h2>Not routed · ${exclusions.length}</h2><p>Review these scheduled orders before dispatch.</p><ul>${exclusions.map(item => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.reason)}</span></li>`).join("")}</ul></section>` : ""}
    <footer>Printed from MeterFlo · ${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date()))} · All times in ${escapeHtml(timezone)}</footer>
  </article>`;
}

export function writeRoutePrintDocument(
  popup: Window,
  routes: RoutingResult[],
  warnings: string[],
  exclusions: RoutingResult["excluded"],
  timezone: string,
  projectName: string,
) {
  const pages = routes.map(route => routePage(route, warnings, exclusions, timezone, projectName)).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(projectName)} route print</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#e8e6df;color:#26353b;font:14px/1.45 system-ui,sans-serif}
      .route-page{max-width:850px;margin:24px auto;padding:34px 42px;background:#fff}
      .page-header{border-bottom:2px solid #26353b;padding-bottom:20px}.eyebrow{margin:0 0 8px;color:#93604a;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
      h1{margin:0;font-size:30px;line-height:1.1}.subhead{margin:9px 0 18px;color:#59676b}
      .route-meta{display:grid;grid-template-columns:1fr 1fr;gap:18px}.route-meta span,dt{display:block;color:#687579;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .route-meta strong{display:block;margin-top:4px;overflow-wrap:anywhere}.estimate-note{margin:10px 0 0;color:#687579;font-size:11px}
      .stops{list-style:none;margin:0;padding:0;counter-reset:none}.stop{display:flex;gap:14px;padding:17px 0;border-bottom:1px solid #d9dedb;break-inside:avoid}
      .stop-number{flex:0 0 30px;height:30px;border-radius:50%;background:#27665e;color:#fff;text-align:center;font-weight:700;line-height:30px}
      .stop-content{min-width:0;flex:1}.stop h2{margin:2px 0 3px;font-size:16px}.address{margin:0 0 11px;color:#506064;overflow-wrap:anywhere}
      dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px 16px;margin:0}.wide{grid-column:1/-1}dd{margin:2px 0 0;overflow-wrap:anywhere}
      .notice,.exclusions{margin:18px 0;padding:12px 15px;border:1px solid #d8b880;background:#fbf5e9;break-inside:avoid}.notice h2,.exclusions h2{margin:0 0 6px;font-size:13px}.notice ul,.exclusions ul{margin:0;padding-left:18px}.exclusions{border-color:#c8d5d0;background:#f2f6f3}.exclusions p{margin:0 0 8px;color:#58676b}.exclusions li{padding:3px 0}.exclusions li span{display:block;color:#58676b}
      .empty{padding:24px 0;color:#687579}footer{margin-top:20px;padding-top:10px;border-top:1px solid #d9dedb;color:#687579;font-size:10px}
      @page{size:auto;margin:12mm}
      @media print{body{background:#fff}.route-page{max-width:none;margin:0;padding:0}.route-page+.route-page{break-before:page;page-break-before:always}.stop{break-inside:avoid}.notice,.exclusions{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
      @media(max-width:620px){.route-page{margin:0;padding:22px 18px}.route-meta,dl{grid-template-columns:1fr 1fr}.wide{grid-column:1/-1}}
    </style></head><body>${pages}</body></html>`);
  popup.document.close();
}
