export type SettingsSectionKey =
  | "profile" | "appearance" | "session"
  | "user-groups" | "access-levels"
  | "statuses" | "trouble-codes" | "service-types" | "routing"
  | "system-types" | "module-types"
  | "project-files" | "upload-settings" | "file-import-history" | "external-import-history"
  | "contact-support" | "customer-api-logs"
  | "security-settings"
  | "mobile-updates" | "web-updates"
  | "timezone" | "log-maintenance";

export type SettingsSection = {
  key: SettingsSectionKey;
  label: string;
  permission?: string;
  adminOnly?: boolean;
};

export type SettingsGroup = {
  key: string;
  label: string;
  sections: SettingsSection[];
};

export const settingsGroups: SettingsGroup[] = [
  { key: "account", label: "Account", sections: [
    { key: "profile", label: "Profile" },
    { key: "appearance", label: "Appearance" },
    { key: "session", label: "Session security" },
  ] },
  { key: "access", label: "People & Access", sections: [
    { key: "user-groups", label: "User Groups", permission: "settings.userGroups" },
    { key: "access-levels", label: "Access Levels", permission: "settings.accessLevels" },
  ] },
  { key: "work-orders", label: "Work Orders", sections: [
    { key: "statuses", label: "Statuses", permission: "settings.statuses" },
    { key: "trouble-codes", label: "Trouble Codes", permission: "settings.troubleCodes" },
    { key: "service-types", label: "Service Types", permission: "settings.serviceTypes" },
    { key: "routing", label: "Maps & Routing", adminOnly: true },
  ] },
  { key: "equipment", label: "Equipment", sections: [
    { key: "system-types", label: "System Types", permission: "settings.systemTypes" },
    { key: "module-types", label: "Module Types", permission: "settings.moduleTypes" },
  ] },
  { key: "files", label: "Files & Imports", sections: [
    { key: "project-files", label: "Project Files Directory", permission: "settings.projectFiles" },
    { key: "upload-settings", label: "Upload Settings", permission: "settings.fileUpload" },
    { key: "file-import-history", label: "File Import History", permission: "settings.importHistory" },
    { key: "external-import-history", label: "External DB Import History", permission: "settings.dbImportHistory" },
  ] },
  { key: "api", label: "API & Messaging", sections: [
    { key: "contact-support", label: "Contact & Support Forms", permission: "settings.contactSupport" },
    { key: "customer-api-logs", label: "Customer API Logs", permission: "settings.customerApiLogs" },
  ] },
  { key: "security", label: "Security", sections: [
    { key: "security-settings", label: "Security Settings", permission: "settings.security" },
  ] },
  { key: "updates", label: "Updates", sections: [
    { key: "mobile-updates", label: "Mobile Updates", permission: "settings.mobileConfig" },
    { key: "web-updates", label: "Web Updates", permission: "settings.webUpdate" },
  ] },
  { key: "system", label: "System", sections: [
    { key: "timezone", label: "Timezone", permission: "settings.timezone" },
    { key: "log-maintenance", label: "Log Maintenance", permission: "maintenance.logManagement" },
  ] },
];
