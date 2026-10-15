import { canonicalInventoryJson } from "@shared/inventory-engine";

export type OrderSaveAttempt = {
  scope: string;
  reference: string;
  id: string;
  fingerprint: string;
  operationId: string;
};

// Keep an unnamed order's identity through an unknown outcome. An edited
// payload updates that same draft with a new command, not a second order.
export function orderSaveAttempt(
  previous: OrderSaveAttempt | null, scope: string, reference: string,
  payload: Record<string, unknown>, createId: () => string,
): OrderSaveAttempt {
  const normalizedReference = reference.trim();
  const sameEditor = previous?.scope === scope && previous.reference === normalizedReference;
  const id = normalizedReference || (sameEditor ? previous!.id : createId());
  const fingerprint = canonicalInventoryJson({ ...payload, id });
  if (sameEditor && previous!.fingerprint === fingerprint) return previous!;
  return { scope, reference: normalizedReference, id, fingerprint, operationId: createId() };
}
