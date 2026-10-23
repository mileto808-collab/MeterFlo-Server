/** A zero/empty line is optional; a proposed movement must be complete. */
export function movementCaptureComplete({
  quantityText, limit, serialized, serials,
}: {
  quantityText: string; limit: number; serialized: boolean; serials: string[];
}): boolean {
  const quantity = quantityText.trim() === "" ? 0 : Number(quantityText);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > limit) return false;
  if (quantity === 0) return serials.length === 0;
  return serialized
    ? serials.length === quantity && new Set(serials).size === serials.length
    : serials.length === 0;
}
