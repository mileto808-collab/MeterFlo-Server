export type PickTicketScan =
  | { kind: "ticket"; projectId: number; batchId: string }
  | { kind: "wrong_project"; projectId: number }
  | { kind: "invalid" };

/** Read only the ticket identity. Never follow a scanned host or accept a bare serial/UUID. */
export function parsePickTicketQr(value: string, currentProjectId: number): PickTicketScan {
  if (typeof value !== "string" || value.length > 4096) return { kind: "invalid" };
  const text = value.trim();
  try {
    if (!text.startsWith("/") && !/^https?:\/\//i.test(text)) return { kind: "invalid" };
    if (text.startsWith("//")) return { kind: "invalid" };
    const url = new URL(text, "https://pick-ticket.invalid");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
      return { kind: "invalid" };
    // Keyboard-wedge scanners can uppercase the whole QR payload. Normalize
    // only our known route and parameter name, never arbitrary URL contents.
    const project = /^\/projects\/([1-9]\d*)\/(?:work-orders|inventory)\/?$/i.exec(url.pathname);
    const tokens = [...url.searchParams.entries()]
      .filter(([key]) => key.toLowerCase() === "pickup").map(([, value]) => value);
    const batchId = tokens[0];
    if (!project || tokens.length !== 1 || !batchId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId))
      return { kind: "invalid" };
    const projectId = Number(project[1]);
    if (!Number.isSafeInteger(projectId)) return { kind: "invalid" };
    if (projectId !== currentProjectId) return { kind: "wrong_project", projectId };
    return { kind: "ticket", projectId, batchId: batchId.toLowerCase() };
  } catch { return { kind: "invalid" }; }
}
