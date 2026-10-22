import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/textarea";
import { acceptSerialScans } from "@/lib/serial-scans";

export const serialTokens = (value: string) => value.split(/[\r\n,;\t]/).map(token => token.trim()).filter(Boolean);
function targetCount(value: string | number | null | undefined) {
  if (value == null || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function SerialScanProgress({ scanned, expected, verification }: {
  scanned: number; expected: string | number | null | undefined;
  verification?: { status: "checking" | "invalid" | "verified" | "error"; message: string };
}) {
  const target = targetCount(expected);
  const complete = target !== null && target > 0 && scanned === target && (!verification || verification.status === "verified");
  const extra = target !== null && scanned > target;
  const invalid = verification?.status === "invalid" || verification?.status === "error";
  return <div className={`rounded-md border p-2 text-xs ${extra || invalid ? "border-destructive text-destructive" : complete ? "border-green-600/50 bg-green-500/10" : "bg-muted/30"}`}
    data-testid="serial-scan-progress" role="status" aria-live="polite" aria-atomic="true">
    <div className="flex flex-wrap justify-between gap-2 font-medium tabular-nums">
      <span>Scanned {scanned} / {target ?? "—"}</span>
      <span>{target === null ? "Expected count not set" : extra ? `${scanned - target} extra` : `${Math.max(0, target - scanned)} left to scan`}</span>
    </div>
    {target !== null && target > 0 && <div role="progressbar" aria-label="Serial scans" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(target, scanned)} className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
      <div className={`h-full ${complete ? "bg-green-600" : "bg-primary"}`} style={{ width: `${Math.min(100, scanned / target * 100)}%` }} />
    </div>}
    <p className="mt-1">{verification && verification.status !== "verified" ? verification.message
      : extra ? "Quantity was reduced. Keep these captures until you explicitly remove the extra serials or correct the quantity."
      : complete ? verification ? "Scanning complete — serials verified against current stock." : "Scanning complete — all required serials captured."
        : target === null ? "Enter a whole quantity to set the expected scan count."
          : target === 0 ? "No serials required for this quantity." : "Scan one unique serial per unit."}</p>
  </div>;
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onPaste" | "onKeyDown"> & {
  value: string; onChange: (value: string) => void; expected: string | number | null | undefined;
  blockedSerials?: string[]; requireTarget?: boolean;
  verifyCommittedScans?: (serials: string[]) => Promise<{
    status: "verified" | "invalid" | "error"; message: string; rejectedSerials?: string[];
  }>;
  verificationState?: { status: "checking" | "invalid" | "verified" | "error"; message: string };
  /** Raw handover drafts preserve the next unfinished barcode, unlike normalized array-backed fields. */
  preserveUncommittedTail?: boolean;
};

/** Text and array-backed consumers share scanner commits while retaining unfinished text locally. */
export function SerialScanField({ value, onChange, expected, blockedSerials = [], requireTarget = true,
  verifyCommittedScans, verificationState, preserveUncommittedTail = false, ...props }: Props) {
  const [text, setText] = useState(value);
  const rawPending = (input: string) => preserveUncommittedTail && !!input.trim() && !/[\r\n,;\t]\s*$/.test(input);
  const [pending, setPending] = useState(rawPending(value));
  const [notice, setNotice] = useState("");
  const [verification, setVerification] = useState<{ status: "checking" | "invalid" | "verified" | "error"; message: string }>();
  const emitted = useRef(value);
  const fieldId = useRef(props.id);
  const latestInput = useRef({ text, pending });
  latestInput.current = { text, pending };
  const validationSequence = useRef(0);
  const validatorRef = useRef(verifyCommittedScans);
  validatorRef.current = verifyCommittedScans;
  const runVerificationRef = useRef<(serials: string[]) => void>(() => undefined);
  runVerificationRef.current = serials => {
    const validator = validatorRef.current;
    const sequence = ++validationSequence.current;
    if (!validator || !serials.length) {
      setVerification(undefined);
      return;
    }
    setVerification({ status: "checking", message: "Checking committed serials against current source stock…" });
    void validator(serials).then(result => {
      if (sequence !== validationSequence.current) return;
      const rejected = new Set(result.rejectedSerials ?? []);
      if (rejected.size) {
        const latest = latestInput.current;
        const latestTokens = serialTokens(latest.text);
        const trailing = latest.pending ? latestTokens.pop() ?? "" : "";
        const retained = latestTokens.filter(token => !rejected.has(token));
        const nextText = `${retained.join("\n")}${retained.length ? "\n" : ""}${trailing}`;
        latestInput.current = { text: nextText, pending: latest.pending };
        setText(nextText);
        setPending(latest.pending);
        emitted.current = nextText;
        onChange(nextText);
        setNotice(result.message || `Unavailable serials rejected: ${[...rejected].join(", ")}.`);
      }
      setVerification({ status: result.status, message: result.message });
    }).catch(() => {
      if (sequence === validationSequence.current) setVerification({ status: "error", message: "Current source stock could not be verified. Keep the scans and retry." });
    });
  };
  useEffect(() => {
    // Array-backed parents may normalize delimiters. Do not replace a partly typed token on their echo.
    if (fieldId.current !== props.id || (value !== emitted.current &&
      (preserveUncommittedTail || serialTokens(value).join("\n") !== serialTokens(emitted.current).join("\n")))) {
      setText(value); setPending(rawPending(value)); setNotice(""); setVerification(undefined);
      validationSequence.current += 1;
      latestInput.current = { text: value, pending: rawPending(value) };
      emitted.current = value;
    }
    fieldId.current = props.id;
  }, [value, props.id, preserveUncommittedTail]);
  const target = targetCount(expected);
  const tokens = serialTokens(text);
  const committed = pending ? tokens.slice(0, -1) : tokens;
  const scanned = new Set(committed).size;
  const accept = (input: string, commitLast: boolean) => {
    if (props.disabled || props.readOnly) return;
    const previousCount = new Set(tokens).size;
    const limit = target === null ? (requireTarget ? 0 : Infinity) : Math.max(target, previousCount);
    const parts = input.split(/[\r\n,;\t]/);
    if (!commitLast) parts.pop();
    const tooLong = parts.map(part => part.trim()).filter(part => part.length > 100);
    const result = acceptSerialScans(input, [...blockedSerials, ...tooLong], commitLast, limit);
    const nextPending = !commitLast && !!result.text.trim() && !/[\r\n,;\t]$/.test(result.text);
    const nextTokens = serialTokens(result.text);
    const nextCommitted = nextPending ? nextTokens.slice(0, -1) : nextTokens;
    const previousCommitted = pending ? tokens.slice(0, -1) : tokens;
    const shouldVerify = nextCommitted.join("\n") !== previousCommitted.join("\n");
    latestInput.current = { text: result.text, pending: nextPending };
    setText(result.text); setPending(nextPending);
    emitted.current = result.text; onChange(result.text);
    if (shouldVerify) runVerificationRef.current(nextCommitted);
    const nextNotice = [
      result.rejected.length ? `Rejected duplicate, unavailable, or invalid serials: ${result.rejected.join(", ")}.` : "",
      result.excess ? target === null || target === 0 ? "Enter the quantity before scanning." : `Scan target reached. ${result.excess} extra scan(s) rejected.` : "",
    ].filter(Boolean).join(" ");
    if (nextNotice || target === null || scanned < target || serialTokens(result.text).join("\n") !== tokens.join("\n")) setNotice(nextNotice);
  };
  return <div className="space-y-2">
    <SerialScanProgress scanned={scanned} expected={expected} verification={verificationState ?? verification} />
    <Textarea {...props} value={text} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      onChange={event => accept(event.target.value, false)}
      onKeyDown={event => {
        if (event.key === "Enter" || (event.key === "Tab" && text.trim())) {
          event.preventDefault(); accept(text, true);
        }
      }}
      onPaste={event => {
        event.preventDefault();
        const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd;
        accept(text.slice(0, start) + event.clipboardData.getData("text") + text.slice(end), true);
      }} />
    <p className="text-xs text-muted-foreground">Scan with Enter or Tab, or paste a list. Repeated serials and extra scans are rejected.</p>
    {notice && <p role="alert" className="text-xs text-destructive">{notice}</p>}
    {tokens.length !== new Set(tokens).size && <p role="alert" className="text-xs text-destructive">Saved entries contain duplicate serials. Remove duplicates before posting.</p>}
  </div>;
}
