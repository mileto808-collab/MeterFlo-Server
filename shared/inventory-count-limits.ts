// Counts are complete atomic submissions, not purchase/transfer stock batches.
export const COUNT_MAX_LINES = 2000;
export const COUNT_MAX_SERIALS = 50000;
export const COUNT_MAX_BYTES = 8 * 1024 * 1024;
export const COUNT_PAGE_SIZE = 50;
export function countPayloadFits(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= COUNT_MAX_BYTES;
}
