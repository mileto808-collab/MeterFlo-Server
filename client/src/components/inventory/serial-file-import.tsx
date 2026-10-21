import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readSerialFile, SERIAL_FILE_MAX_BYTES, type SerialFileSheet } from "@/lib/inventory-serial-file";

export type SerialImportResult = { added: number; rejected: { index: number; reason: string }[] };

export function SerialFileImport({ category, currentCount, quantity, onAdd }: {
  category: string; currentCount: number; quantity: number;
  onAdd: (serials: string[], useCount: boolean) => SerialImportResult;
}) {
  const id = useId();
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<SerialFileSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState("0");
  const [column, setColumn] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [useCount, setUseCount] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ added: number; issues: { row: number; reason: string }[] } | null>(null);
  useEffect(() => () => { generation.current++; }, []);
  const sheet = sheets[Number(sheetIndex)];
  const parsed = useMemo(() => sheet && column !== "" ? sheet.readColumn(Number(column), hasHeader) : null, [sheet, column, hasHeader]);
  const chooseSheet = (index: string, available = sheets) => {
    setSheetIndex(index); setColumn(available[Number(index)]?.suggestedColumn?.toString() ?? "");
    setHasHeader(available[Number(index)]?.hasHeader ?? true); setReport(null);
  };
  const load = async (file?: File) => {
    const attempt = ++generation.current;
    setError(""); setReport(null); setSheets([]); setColumn("");
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { setError("Choose a CSV, XLSX or XLS file."); return; }
    if (file.size > SERIAL_FILE_MAX_BYTES) { setError("Serial files are limited to 5 MiB."); return; }
    setBusy(true);
    try {
      const available = await readSerialFile(await file.arrayBuffer());
      if (attempt !== generation.current) return;
      setSheets(available); chooseSheet("0", available);
      if (!available.length) setError("This file has no worksheets.");
    } catch (problem) {
      if (attempt === generation.current) setError(problem instanceof Error ? problem.message : "Could not read the serial file.");
    } finally { if (attempt === generation.current) setBusy(false); }
  };
  const issues = report?.issues ?? parsed?.errors ?? [];
  return <div className="space-y-2 border-t pt-2">
    <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}><Upload className="mr-1 h-4 w-4" />Import serials from file</Button>
    {open && <div id={id} className="space-y-2 rounded-md border bg-muted/20 p-2">
      <p className="text-xs text-muted-foreground">Add to <strong>{category}</strong> for this item only. CSV, XLSX or XLS · 5 MiB · 10,000 data rows maximum. Nothing is received until movement review and posting.</p>
      <p className="text-xs text-muted-foreground">Required: one serial column, one serial per row. A header such as Serial or Serial number is recommended; headers are optional for single-column files. Other columns are ignored. Store serials as text to preserve leading zeros and long IDs. Pallet IDs do not expand into individual serials.</p>
      <Label htmlFor={`${id}-file`} className="sr-only">Serials file</Label>
      <Input id={`${id}-file`} type="file" accept=".csv,.xlsx,.xls" disabled={busy} className="h-auto min-w-0 py-1.5 text-xs"
        onChange={event => { const file = event.target.files?.[0]; void load(file); event.target.value = ""; }} />
      {busy && <p role="status" className="text-xs">Reading serial file…</p>}
      {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
      {sheet && <>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-sheet`} className="text-xs">Worksheet</Label>
            <Select value={sheetIndex} onValueChange={index => chooseSheet(index)}>
              <SelectTrigger id={`${id}-sheet`}><SelectValue /></SelectTrigger>
              <SelectContent>{sheets.map((value, index) => <SelectItem key={index} value={String(index)}>{value.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-column`} className="text-xs">Serial column</Label>
            <Select value={column} onValueChange={value => { setColumn(value); setReport(null); }}>
              <SelectTrigger id={`${id}-column`}><SelectValue placeholder="Choose serial column" /></SelectTrigger>
              <SelectContent>{sheet.columns.map(value => <SelectItem key={value.index} value={String(value.index)}>{value.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={hasHeader}
          onChange={event => { setHasHeader(event.target.checked); setReport(null); }} />First row contains column headers</label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={useCount}
          onChange={event => { setUseCount(event.target.checked); setReport(null); }} />Set {category} quantity to the resulting serial count</label>
        <p className="text-xs text-muted-foreground">Existing scans stay. Duplicates, unavailable identities, invalid values and excess serials are skipped and reported. Quantities stay unchanged unless the option above is checked.</p>
        {parsed && <>
          <p className="text-xs">{parsed.serials.length} file serials ready to check · {currentCount} already captured · target {quantity}</p>
          <p className="break-all font-mono text-xs text-muted-foreground">{parsed.serials.slice(0, 3).map(value => value.serial).join(" · ")}</p>
          {!useCount && parsed.serials.length > Math.max(0, quantity - currentCount) &&
            <p className="text-xs text-amber-700 dark:text-amber-400">Only {Math.max(0, quantity - currentCount)} spaces remain in this target. Set the quantity in receiving, or select the serial-count option above.</p>}
          <Button type="button" size="sm" disabled={!parsed.serials.length || busy || (!useCount && quantity <= currentCount)}
            onClick={() => {
              const result = onAdd(parsed.serials.map(value => value.serial), useCount);
              setReport({ added: result.added, issues: [...parsed.errors, ...result.rejected.map(value => ({
                row: parsed.serials[value.index].row, reason: value.reason,
              }))] });
            }}>Add serials to {category}</Button>
        </>}
      </>}
      {report && <p role="status" className="text-xs font-medium">{report.added} added · {report.issues.length} skipped. Existing scans preserved.</p>}
      {issues.length > 0 && <div className="max-h-28 overflow-y-auto rounded border p-2 text-xs" aria-label="Serial import issues">
        {issues.slice(0, 20).map((issue, index) => <p key={index}>{issue.row ? `Row ${issue.row}: ` : ""}{issue.reason}</p>)}
        {issues.length > 20 && <p>{issues.length - 20} more issues. Fix the file and retry; existing serials will not be duplicated.</p>}
      </div>}
    </div>}
  </div>;
}
