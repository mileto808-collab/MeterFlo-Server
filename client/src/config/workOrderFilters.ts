export type FilterFieldType = "text" | "select" | "date-range" | "user-select" | "group-select";

export interface FilterFieldConfig {
  key: string;
  label: string;
  type: FilterFieldType;
  defaultValue: string;
  showInGlobal?: boolean;
  showInProject?: boolean;
  requiresData?: "systemTypes" | "moduleTypes" | "troubleCodes" | "serviceTypes" | "statuses" | "users" | "groups";
}

export const workOrderFilterFields: FilterFieldConfig[] = [
  { key: "systemWoId", label: "System WO ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "searchQuery", label: "Search", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "status", label: "Status", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "statuses" },
  { key: "serviceType", label: "Service Type", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "serviceTypes" },
  { key: "assignedTo", label: "Assigned To (User)", type: "user-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "users" },
  { key: "assignedGroup", label: "Assigned To (Group)", type: "group-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "groups" },
  { key: "trouble", label: "Trouble Code", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "troubleCodes" },
  { key: "oldSystemType", label: "Old System Type", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "systemTypes" },
  { key: "newSystemType", label: "New System Type", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "systemTypes" },
  { key: "customerId", label: "Customer ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "customerName", label: "Customer Name", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "address", label: "Address", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "city", label: "City", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "state", label: "State", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "zip", label: "ZIP", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "phone", label: "Phone", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "email", label: "Email", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "route", label: "Route", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "zone", label: "Zone", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "oldSystemId", label: "Old System ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "newSystemId", label: "New System ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "oldModuleId", label: "Old Module ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "newModuleId", label: "New Module ID", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "oldModuleType", label: "Old Module Type", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "moduleTypes" },
  { key: "newModuleType", label: "New Module Type", type: "select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "moduleTypes" },
  { key: "scheduledAt", label: "Scheduled At", type: "date-range", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "createdBy", label: "Created By", type: "user-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "users" },
  { key: "updatedBy", label: "Updated By", type: "user-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "users" },
  { key: "scheduledBy", label: "Scheduled By", type: "user-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "users" },
  { key: "completedBy", label: "Completed By", type: "user-select", defaultValue: "all", showInGlobal: true, showInProject: true, requiresData: "users" },
  { key: "completedAt", label: "Completed At", type: "date-range", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "notes", label: "Notes", type: "text", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "createdAt", label: "Created At", type: "date-range", defaultValue: "", showInGlobal: true, showInProject: true },
  { key: "updatedAt", label: "Updated At", type: "date-range", defaultValue: "", showInGlobal: true, showInProject: true },
];

export function getInitialFilterValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of workOrderFilterFields) {
    if (field.type === "date-range") {
      values[`${field.key}From`] = "";
      values[`${field.key}To`] = "";
    } else {
      values[field.key] = field.defaultValue;
    }
  }
  return values;
}

export function getFilterConfigForPage(isGlobal: boolean): FilterFieldConfig[] {
  return workOrderFilterFields.filter(f => isGlobal ? f.showInGlobal : f.showInProject);
}
