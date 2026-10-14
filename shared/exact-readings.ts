/** Numeric compatibility fields are retained; these additive text fields are authoritative for display. */
export const exactReadingFields = [
  {key:"oldSystemReading",column:"old_system_reading"},
  {key:"newSystemReading",column:"new_system_reading"},
  {key:"oldModuleRead",column:"old_module_read"},
  {key:"newModuleRead",column:"new_module_read"},
] as const;

export function readingParameter(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Reading must be a finite numeric value");
    return value;
  }
  const text = String(value).trim();
  if (text !== "" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw new Error("Reading must be a numeric value");
  }
  return text === "" ? null : text;
}

export function capturedReadingText(value: unknown): string | null {
  return typeof value === "string" ? readingParameter(value) as string | null : null;
}

export function exactReadingDto(row: Record<string, any>) {
  return Object.fromEntries(exactReadingFields.map(({key,column}) => [
    `${key}Text`, row[`${column}_text`] ?? (row[column] == null ? null : String(row[column])),
  ]));
}

/** JSON response adapter for web consumers and exact-string exports. Never parse reading text as a number. */
export function withExactReadings<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withExactReadings) as T;
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const row = Object.fromEntries(Object.entries(value).map(([key,item]) => [key,withExactReadings(item)]));
  for (const {key,column} of exactReadingFields) {
    const text = row[`${key}Text`] ?? row[`${column}_text`];
    if (text != null) {
      if (Object.hasOwn(row,key)) row[key] = text;
      if (Object.hasOwn(row,column)) row[column] = text;
      if (key.endsWith("Read") && Object.hasOwn(row,`${key}ing`)) row[`${key}ing`] = text;
    }
  }
  return row as T;
}
