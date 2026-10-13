/** Visibility for project-bound forms, not a destructive data-cleanup rule. */
export interface EquipmentVisibility {
  showSystem: boolean;
  showModule: boolean;
}

type ProjectEquipmentSettings = {
  wizardMode?: string | null;
  changeoutEquipmentType?: string | null;
  readingEquipmentType?: string | null;
};

export function getProjectEquipmentVisibility(project?: ProjectEquipmentSettings | null): EquipmentVisibility {
  const scopes = project?.wizardMode === "reading_only"
    ? [project.readingEquipmentType]
    : project?.wizardMode === "user_choice"
      ? [project.changeoutEquipmentType, project.readingEquipmentType]
      : [project?.changeoutEquipmentType];
  // Both/user-choice (and legacy missing settings) must keep both available.
  return {
    showSystem: scopes.some(scope => scope !== "module"),
    showModule: scopes.some(scope => scope !== "system"),
  };
}

const systemFields = [
  "oldSystemId", "newSystemId", "oldSystemType", "newSystemType",
  "oldSystemReading", "newSystemReading",
] as const;
const moduleFields = [
  "oldModuleId", "newModuleId", "oldModuleType", "newModuleType",
  "oldModuleRead", "newModuleRead", "oldModuleReading", "newModuleReading",
] as const;

/** Omit hidden equipment values on manual writes; retain stored historical data. */
export function omitInapplicableEquipmentFields<T extends object>(
  payload: T, visibility: EquipmentVisibility,
): T {
  const result = { ...payload } as Record<string, unknown>;
  if (!visibility.showSystem) for (const key of systemFields) delete result[key];
  if (!visibility.showModule) for (const key of moduleFields) delete result[key];
  // GPS is common to both equipment types, so it is deliberately not omitted.
  return result as T;
}
