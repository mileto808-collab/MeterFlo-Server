/**
 * Generic project writers must never select credentials or change routing
 * billing. A null redacted DTO value may round-trip, but cannot clear config.
 */
export function sanitizeGenericProjectSettings<T extends object>(input: T): T {
  const copy = { ...input } as T & Record<string, unknown>;
  for (const key of ["routingConfiguration", "routing_configuration"]) {
    if (Object.hasOwn(copy, key) && copy[key] != null)
      throw new Error("Routing configuration must be changed through the dedicated Maps & Routing settings.");
    delete copy[key];
  }
  return copy;
}
