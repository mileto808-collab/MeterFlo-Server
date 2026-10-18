import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const migrationHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function inspectMigrationBytes(bytes: Buffer, expected: string) {
  const actual = migrationHash(bytes);
  if (actual === expected) return { status: "match" as const, actual, expected, lfHash: null, corrected: null };
  // Never guess encodings, strip BOMs, alter whitespace, or rewrite SQL text.
  // Only CR bytes immediately before LF may be removed, and only if the result
  // exactly reproduces the already declared checksum.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes("\0") || text.startsWith("\uFEFF")) throw new Error("Unsupported encoding");
  } catch {
    return { status: "unsupported-encoding" as const, actual, expected, lfHash: null, corrected: null };
  }
  const candidate = Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
  const lfHash = migrationHash(candidate);
  const repairable = !candidate.equals(bytes) && lfHash === expected;
  return { status: repairable ? "crlf-only" as const : "mismatch" as const, actual, expected, lfHash,
    corrected: repairable ? candidate : null };
}
