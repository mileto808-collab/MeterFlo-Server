/** Commit scanner-delimited entries without treating a partly typed serial as a scan. */
export function acceptFulfillmentScans(text: string, blocked: string[] = [], commitLast = false) {
  const parts = text.split(/[\r\n,;\t]/);
  const trailing = commitLast ? "" : parts.pop() ?? "";
  const seen = new Set(blocked);
  const accepted: string[] = [];
  const rejected = new Set<string>();
  for (const part of parts) {
    const serial = part.trim();
    if (!serial) continue;
    if (seen.has(serial)) rejected.add(serial);
    else {
      seen.add(serial);
      accepted.push(serial);
    }
  }
  return {
    text: accepted.join("\n") + (accepted.length ? "\n" : "") + trailing,
    rejected: [...rejected],
  };
}
