/** Commit scanner-delimited entries without treating a partly typed serial as a scan. */
export function acceptFulfillmentScans(text: string, blocked: string[] = [], commitLast = false, limit = Infinity) {
  const parts = text.split(/[\r\n,;\t]/);
  let trailing = commitLast ? "" : parts.pop() ?? "";
  const seen = new Set(blocked);
  const accepted: string[] = [];
  const rejected = new Set<string>();
  const capacity = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
  let excess = 0;
  for (const part of parts) {
    const serial = part.trim();
    if (!serial) continue;
    if (seen.has(serial)) rejected.add(serial);
    else if (accepted.length >= capacity) excess++;
    else {
      seen.add(serial);
      accepted.push(serial);
    }
  }
  if (trailing.trim() && accepted.length >= capacity) {
    trailing = "";
    excess++;
  }
  return {
    text: accepted.join("\n") + (accepted.length ? "\n" : "") + trailing,
    rejected: [...rejected],
    excess,
  };
}
