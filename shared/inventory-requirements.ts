import type { Allocation, InventoryState, WorkRequirements } from "./inventory";
import { kitSerialContents } from "./inventory-kits";

/** A recipe is a requirement, not a claim on stock or on a physical serial. */
export function recipeContains(state: InventoryState, parent: string, child: string, seen = new Set<string>()): boolean {
  if (parent === child) return true;
  if (seen.has(parent)) return false;
  seen.add(parent);
  return !!state.items.find(i => i.id === parent)?.components.some(c => recipeContains(state, c.itemId, child, seen));
}

export function deduplicateRequirements(state: InventoryState, ids: string[]) {
  const unique = [...new Set(ids)];
  return unique.filter(id => !unique.some(other => other !== id && recipeContains(state, other, id)))
    .map(itemId => ({ itemId, quantity: 1 }));
}

/** Expand planned kits to leaves; never deduct this expansion as finished-kit usage. */
export function requirementLeaves(state: Pick<InventoryState, "items">, lines: { itemId: string; quantity: number }[], seen: string[] = []): { itemId: string; quantity: number }[] {
  return lines.flatMap(line => {
    if (seen.includes(line.itemId)) throw new Error("Kit recipe contains a cycle.");
    const item = state.items.find(i => i.id === line.itemId);
    // Labor is a configured non-stock allowance, never a physical stock claim.
    if (item?.kind === "labor") return [];
    const components = item?.components ?? [];
    return components.length
      ? requirementLeaves(state, components.map(c => ({ itemId: c.itemId, quantity: c.quantity * line.quantity })), [...seen, line.itemId])
      : [line];
  });
}

/** Validate coverage using finished kits OR loose components, without counting both. */
export function requirementsSatisfied(state: InventoryState, requirements: WorkRequirements, used: Allocation[], allowMixedExtras = false) {
  if (requirements.missing.length) return false;
  if (!allowMixedExtras && used.some(l => used.some(other => l.itemId !== other.itemId && recipeContains(state, l.itemId, other.itemId))))
    return false;
  const required = requirementLeaves(state, requirements.lines);
  const actual = requirementLeaves(state, used);
  const totals = (lines: { itemId: string; quantity: number }[]) => {
    const result = new Map<string, number>();
    for (const l of lines) result.set(l.itemId, (result.get(l.itemId) ?? 0) + l.quantity);
    return result;
  };
  const expected = totals(required), supplied = totals(actual);
  // Extra actual items are allowed (unplanned hardware), but never count a kit
  // and the same loose components towards one requirement twice.
  return [...expected].every(([id, qty]) => (supplied.get(id) ?? 0) >= qty);
}

/** Installed serialized equipment in a preassembled kit comes from its original contents. */
export function actualEquipmentLines(state: InventoryState, lines: Allocation[], seen: string[] = []): Allocation[] {
  return lines.flatMap(line => {
    if (seen.includes(line.itemId)) return [];
    let contents = line.serials.flatMap(serial => kitSerialContents(state, line.itemId, serial))
      .map(c => ({ ...c, warehouseId: line.warehouseId }));
    const kit = state.items.find(i => i.id === line.itemId);
    if (!contents.length && kit?.components.length) {
      // Quantity-only vendor/assembled kits can describe quantity-only equipment;
      // a recipe cannot establish the identity of a serialized component.
      contents = kit.components.filter(c => state.items.find(i => i.id === c.itemId)?.tracking === "regular")
        .map(c => ({ itemId: c.itemId, quantity: c.quantity * line.quantity, serials: [], warehouseId: line.warehouseId }));
    }
    return [line, ...actualEquipmentLines(state, contents, [...seen, line.itemId])];
  });
}
