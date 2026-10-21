export const SERIAL_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const SERIAL_FILE_MAX_ROWS = 10000;
export type SerialFileRead = {
  serials: { serial: string; row: number }[];
  errors: { row: number; reason: string }[];
};
export type SerialFileSheet = {
  name: string;
  columns: { index: number; label: string }[];
  suggestedColumn: number | null;
  hasHeader: boolean;
  readColumn: (column: number, hasHeader: boolean) => SerialFileRead;
};

/** Read locally. Numeric identities must be exact; never guess lost digits. */
export async function readSerialFile(bytes: ArrayBuffer): Promise<SerialFileSheet[]> {
  if (bytes.byteLength > SERIAL_FILE_MAX_BYTES) throw new Error("Serial files are limited to 5 MiB.");
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "array", raw: true, cellNF: true, cellDates: false,
    cellHTML: false, sheetRows: SERIAL_FILE_MAX_ROWS + 2 });
  if (book.SheetNames.length > 20) throw new Error("Use a file with no more than 20 worksheets.");
  const headers = new Set(["serial", "serials", "serialid", "serialnumber", "serialnumbers", "serialno",
    "meterserial", "meterserialnumber", "systemserial", "systemserialnumber", "moduleserial", "moduleserialnumber"]);
  const text = (cell: import("xlsx").CellObject | undefined): string => {
    if (!cell || cell.v === undefined || cell.v === null || cell.t === "z") return "";
    if (cell.f) throw new Error("Formula cells are not supported; convert serials to text values.");
    if (cell.t === "n") {
      const number = Number(cell.v);
      if (!Number.isSafeInteger(number) || Math.abs(number) >= 1e15)
        throw new Error("Numeric serial is not safely exact. Supply the original serial as text.");
      const format = typeof cell.z === "string" ? cell.z : "";
      if (format && XLSX.SSF.is_date(format)) throw new Error("Date cells cannot be imported as serials.");
      return /^0+$/.test(format) ? String(number).padStart(format.length, "0") : String(number);
    }
    if (cell.t !== "s") throw new Error("Use a text serial, not a boolean or spreadsheet error.");
    return String(cell.v).trim();
  };
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    const fullRange = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
    const tooLong = fullRange.e.r - fullRange.s.r + 1 > SERIAL_FILE_MAX_ROWS + 1;
    const tooWide = range.e.c - range.s.c + 1 > 256;
    if (tooWide) throw new Error(`Worksheet "${name}" has more than 256 columns. Export the serial column separately.`);
    const first = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
      try { return text(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + index })]); }
      catch { return ""; }
    });
    const matches = first.map((value, index) => headers.has(value.toLowerCase().replace(/[^a-z0-9]/g, "")) ? range.s.c + index : -1).filter(index => index >= 0);
    return {
      name,
      columns: first.map((value, index) => ({ index: range.s.c + index,
        label: `${XLSX.utils.encode_col(range.s.c + index)}${value ? ` · ${value.slice(0, 80)}` : ""}` })),
      suggestedColumn: matches.length === 1 ? matches[0] : first.length === 1 ? range.s.c : null,
      hasHeader: matches.length > 0 || first.length > 1,
      readColumn(column, hasHeader) {
        const result: SerialFileRead = { serials: [], errors: [] };
        if (tooLong || range.e.r - range.s.r + 1 - Number(hasHeader) > SERIAL_FILE_MAX_ROWS)
          return { serials: [], errors: [{ row: 0, reason: "Worksheet exceeds 10,000 data rows. Split the file; no rows were imported." }] };
        for (let row = range.s.r + Number(hasHeader); row <= range.e.r; row++) {
          try {
            const serial = text(sheet[XLSX.utils.encode_cell({ r: row, c: column })]);
            if (!serial) continue;
            if (serial.length > 100) throw new Error("Serial exceeds 100 characters.");
            if (/[\u0000-\u001f\u007f]/.test(serial)) throw new Error("Serial contains a control character or line break.");
            result.serials.push({ serial, row: row + 1 });
          } catch (error) { result.errors.push({ row: row + 1, reason: (error as Error).message }); }
        }
        return result;
      },
    };
  });
}
