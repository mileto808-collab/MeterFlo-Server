export type PermissionCategory = 
  | "Navigation"
  | "Project Menu"
  | "Settings"
  | "Project Actions"
  | "Work Order Actions"
  | "File Actions"
  | "User Actions";

export interface PermissionDefinition {
  key: string;
  label: string;
  category: PermissionCategory;
  description: string;
  defaultAccess: {
    administrator: boolean;
    projectManager: boolean;
    fieldTechnician: boolean;
    viewer: boolean;
    customer: boolean;
  };
}

export const permissionRegistry: PermissionDefinition[] = [
  // Navigation permissions - main sidebar items
  {
    key: "nav.dashboard",
    label: "Dashboard",
    category: "Navigation",
    description: "Access to the main dashboard",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: true, customer: true },
  },
  {
    key: "nav.projects",
    label: "Projects Management",
    category: "Navigation",
    description: "Access to create and manage projects",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "nav.users",
    label: "Users Management",
    category: "Navigation",
    description: "Access to manage user accounts",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "nav.maintenance",
    label: "Maintenance",
    category: "Navigation",
    description: "Access to database backup and restore",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "nav.settings",
    label: "Settings",
    category: "Navigation",
    description: "Access to system settings",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "nav.searchReports",
    label: "Search & Reports",
    category: "Navigation",
    description: "Access to cross-project search and reporting",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: true, customer: false },
  },

  // Project Menu permissions - items under each project
  {
    key: "project.workOrders",
    label: "Work Orders",
    category: "Project Menu",
    description: "Access to view and manage work orders",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: true, customer: true },
  },
  {
    key: "project.documents",
    label: "Project Documents",
    category: "Project Menu",
    description: "Access to project-level document storage",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: true, customer: true },
  },
  {
    key: "project.import",
    label: "File Import",
    category: "Project Menu",
    description: "Access to import work orders from files",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "project.ftpFiles",
    label: "FTP Files",
    category: "Project Menu",
    description: "Access to FTP file management",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: true },
  },
  {
    key: "project.dbImport",
    label: "Database Import/Export",
    category: "Project Menu",
    description: "Access to database import and export tools",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },

  // Settings card permissions - individual cards in the settings page
  {
    key: "settings.projectFiles",
    label: "Project Files Directory",
    category: "Settings",
    description: "Configure root directory for project files",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.fileUpload",
    label: "File Upload Settings",
    category: "Settings",
    description: "Configure file upload limits and allowed types",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.timezone",
    label: "Timezone Settings",
    category: "Settings",
    description: "Configure system timezone display",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.importHistory",
    label: "File Import History",
    category: "Settings",
    description: "View and manage scheduled file imports",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.dbImportHistory",
    label: "External Database Import History",
    category: "Settings",
    description: "View and manage external database imports",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.accessLevels",
    label: "Access Levels",
    category: "Settings",
    description: "Manage access level permissions",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.statuses",
    label: "Work Order Statuses",
    category: "Settings",
    description: "Configure work order status codes",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.troubleCodes",
    label: "Trouble Codes",
    category: "Settings",
    description: "Configure trouble code definitions",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.userGroups",
    label: "User Groups",
    category: "Settings",
    description: "Manage user groups for assignment",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.serviceTypes",
    label: "Service Types",
    category: "Settings",
    description: "Configure service type definitions",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "settings.meterTypes",
    label: "Meter Types",
    category: "Settings",
    description: "Configure meter type definitions",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },

  // Project Action permissions - what users can do with projects
  {
    key: "projects.create",
    label: "Create Projects",
    category: "Project Actions",
    description: "Create new projects",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "projects.edit",
    label: "Edit Projects",
    category: "Project Actions",
    description: "Edit existing projects",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "projects.delete",
    label: "Delete Projects",
    category: "Project Actions",
    description: "Delete projects",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },

  // Work Order Action permissions - what users can do with work orders
  {
    key: "workOrders.create",
    label: "Create Work Orders",
    category: "Work Order Actions",
    description: "Create new work orders",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: false, customer: false },
  },
  {
    key: "workOrders.edit",
    label: "Edit Work Orders",
    category: "Work Order Actions",
    description: "Edit existing work orders",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: false, customer: false },
  },
  {
    key: "workOrders.delete",
    label: "Delete Work Orders",
    category: "Work Order Actions",
    description: "Delete work orders",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },

  // File Action permissions - what users can do with files
  {
    key: "files.upload",
    label: "Upload Files",
    category: "File Actions",
    description: "Upload files to work orders and projects",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: true, viewer: false, customer: false },
  },
  {
    key: "files.delete",
    label: "Delete Files",
    category: "File Actions",
    description: "Delete uploaded files",
    defaultAccess: { administrator: true, projectManager: true, fieldTechnician: false, viewer: false, customer: false },
  },

  // User Action permissions - what users can do with user accounts
  {
    key: "users.create",
    label: "Create Users",
    category: "User Actions",
    description: "Create new user accounts",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "users.edit",
    label: "Edit Users",
    category: "User Actions",
    description: "Edit existing user accounts",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "users.delete",
    label: "Delete Users",
    category: "User Actions",
    description: "Delete user accounts",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "users.lock",
    label: "Lock/Unlock Users",
    category: "User Actions",
    description: "Lock or unlock user accounts",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
  {
    key: "users.resetPassword",
    label: "Reset Passwords",
    category: "User Actions",
    description: "Reset user passwords",
    defaultAccess: { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false },
  },
];

export const getPermissionsByCategory = (category: PermissionCategory): PermissionDefinition[] => {
  return permissionRegistry.filter(p => p.category === category);
};

export const getPermissionByKey = (key: string): PermissionDefinition | undefined => {
  return permissionRegistry.find(p => p.key === key);
};

export const getAllPermissionKeys = (): string[] => {
  return permissionRegistry.map(p => p.key);
};

export const getCategories = (): PermissionCategory[] => {
  const categories: PermissionCategory[] = [];
  for (const p of permissionRegistry) {
    if (!categories.includes(p.category)) {
      categories.push(p.category);
    }
  }
  return categories;
};
