import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { clearTimezoneCache, formatDateTimeInTimezone } from "@/lib/timezone";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Moon, Sun, User as UserIcon, Shield, FolderOpen, Save, FileUp, Users, Plus, Pencil, Trash2, UsersRound, Clock, Copy, Gauge, Download, History, Send, ChevronDown, ChevronRight, Filter, CheckCircle2, XCircle, RefreshCw, Eye, Smartphone, Globe, GitBranch, ArrowUpCircle, FileCode, Clipboard } from "lucide-react";
import type { Subrole, Permission, WorkOrderStatus, UserGroup, UserGroupWithProjects, User, TroubleCode, ServiceTypeRecord, SystemType, ModuleType, Project, FileImportHistory, ImportHistory, CustomerApiLog } from "@shared/schema";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database } from "lucide-react";
import { Wrench } from "lucide-react";
import { AlertTriangle } from "lucide-react";

interface FileSettings {
  maxFileSizeMB: number;
  allowedExtensions: string;
}

const statusColors = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "yellow", label: "Yellow" },
  { value: "purple", label: "Purple" },
  { value: "gray", label: "Gray" },
];

// Core statuses that cannot be deleted or renamed (code cannot be changed)
// Users can still change the Label and Color of these statuses
const CORE_STATUS_CODES = ["Open", "Closed", "Completed", "Scheduled", "Trouble"];

// Case-insensitive check for core status codes
function isCoreStatus(code: string): boolean {
  return CORE_STATUS_CODES.some(c => c.toLowerCase() === code.toLowerCase());
}

const timezoneOptions = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona Time (AZ)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AK)" },
  { value: "America/Honolulu", label: "Hawaii Time (HI)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];

function getStatusColorHex(color: string): string {
  const colorMap: Record<string, string> = {
    blue: "#3b82f6",
    green: "#22c55e",
    orange: "#f97316",
    red: "#ef4444",
    yellow: "#eab308",
    purple: "#a855f7",
    gray: "#6b7280",
  };
  return colorMap[color] || colorMap.gray;
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDateTime } = useTimezone();
  const [projectFilesPath, setProjectFilesPath] = useState("");
  const [maxFileSizeMB, setMaxFileSizeMB] = useState("100");
  const [allowedExtensions, setAllowedExtensions] = useState("");
  const [selectedTimezone, setSelectedTimezone] = useState("America/Denver");
  const [timezoneEnabled, setTimezoneEnabled] = useState(true);

  // User permissions query for granular settings access
  const { data: userPermissions = [] } = useQuery<string[]>({
    queryKey: ["/api/users", user?.id, "permissions"],
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch(`/api/users/${user.id}/permissions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const hasPermission = (permission: string) => {
    if (user?.role === "admin") return true;
    return userPermissions.includes(permission);
  };
  
  const [subroleDialogOpen, setSubroleDialogOpen] = useState(false);
  const [deleteSubroleDialogOpen, setDeleteSubroleDialogOpen] = useState(false);
  const [copySubroleDialogOpen, setCopySubroleDialogOpen] = useState(false);
  const [copySubroleName, setCopySubroleName] = useState("");
  const [selectedSubrole, setSelectedSubrole] = useState<Subrole | null>(null);
  const [subroleForm, setSubroleForm] = useState({
    label: "",
    key: "",
    baseRole: "user" as "admin" | "user" | "customer",
    description: "",
    permissions: [] as string[],
  });

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [deleteStatusDialogOpen, setDeleteStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<WorkOrderStatus | null>(null);
  const [statusForm, setStatusForm] = useState({
    code: "",
    label: "",
    color: "blue",
    isDefault: false,
  });

  // Trouble Codes state
  const [troubleCodeDialogOpen, setTroubleCodeDialogOpen] = useState(false);
  const [deleteTroubleCodeDialogOpen, setDeleteTroubleCodeDialogOpen] = useState(false);
  const [selectedTroubleCode, setSelectedTroubleCode] = useState<TroubleCode | null>(null);
  const [troubleCodeForm, setTroubleCodeForm] = useState({
    code: "",
    label: "",
    description: "",
  });

  // User Groups state
  const [userGroupDialogOpen, setUserGroupDialogOpen] = useState(false);
  const [deleteUserGroupDialogOpen, setDeleteUserGroupDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<UserGroupWithProjects | null>(null);
  const [userGroupForm, setUserGroupForm] = useState({
    name: "",
    description: "",
    projectIds: [] as number[],
  });

  // Service Types state
  const [serviceTypeDialogOpen, setServiceTypeDialogOpen] = useState(false);
  const [deleteServiceTypeDialogOpen, setDeleteServiceTypeDialogOpen] = useState(false);
  const [selectedServiceType, setSelectedServiceType] = useState<ServiceTypeRecord | null>(null);
  const [serviceTypeForm, setServiceTypeForm] = useState({
    code: "",
    label: "",
    color: "blue",
    isDefault: false,
  });

  // System Types state
  const [systemTypeDialogOpen, setSystemTypeDialogOpen] = useState(false);
  const [deleteSystemTypeDialogOpen, setDeleteSystemTypeDialogOpen] = useState(false);
  const [copySystemTypeDialogOpen, setCopySystemTypeDialogOpen] = useState(false);
  const [copySystemTypeProjectIds, setCopySystemTypeProjectIds] = useState<number[]>([]);
  const [selectedSystemType, setSelectedSystemType] = useState<SystemType | null>(null);
  const [systemTypeProjectFilter, setSystemTypeProjectFilter] = useState<string>("all");
  const [systemTypeForm, setSystemTypeForm] = useState({
    productId: "",
    productLabel: "",
    productDescription: "",
    projectIds: [] as number[],
  });

  // Module Types state
  const [moduleTypeDialogOpen, setModuleTypeDialogOpen] = useState(false);
  const [deleteModuleTypeDialogOpen, setDeleteModuleTypeDialogOpen] = useState(false);
  const [copyModuleTypeDialogOpen, setCopyModuleTypeDialogOpen] = useState(false);
  const [copyModuleTypeProjectIds, setCopyModuleTypeProjectIds] = useState<number[]>([]);
  const [selectedModuleType, setSelectedModuleType] = useState<ModuleType | null>(null);
  const [moduleTypeProjectFilter, setModuleTypeProjectFilter] = useState<string>("all");
  const [moduleTypeForm, setModuleTypeForm] = useState({
    productId: "",
    productLabel: "",
    productDescription: "",
    projectIds: [] as number[],
  });

  // Profile Edit state
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });

  const isAdmin = user?.role === "admin";

  const { data: subroles, isLoading: loadingSubroles } = useQuery<Subrole[]>({
    queryKey: ["/api/subroles"],
    enabled: isAdmin || hasPermission("settings.accessLevels"),
  });

  const { data: allPermissions } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
    enabled: isAdmin || hasPermission("settings.accessLevels"),
  });

  const { data: selectedSubrolePermissions } = useQuery<string[]>({
    queryKey: ["/api/subroles", selectedSubrole?.id, "permissions"],
    queryFn: async () => {
      if (!selectedSubrole) return [];
      const res = await fetch(`/api/subroles/${selectedSubrole.id}/permissions`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedSubrole && subroleDialogOpen && (isAdmin || hasPermission("settings.accessLevels")),
  });

  const { data: pathData } = useQuery<{ path: string }>({
    queryKey: ["/api/settings/project-files-path"],
    enabled: isAdmin || hasPermission("settings.projectFiles"),
  });

  const { data: fileSettingsData } = useQuery<FileSettings>({
    queryKey: ["/api/settings/file-settings"],
    enabled: isAdmin || hasPermission("settings.fileUpload"),
  });

  const { data: timezoneData } = useQuery<{ timezone: string; isEnabled: boolean }>({
    queryKey: ["/api/settings/timezone"],
    enabled: isAdmin || hasPermission("settings.timezone"),
  });

  const { data: workOrderStatusList, isLoading: loadingStatuses } = useQuery<WorkOrderStatus[]>({
    queryKey: ["/api/work-order-statuses"],
    enabled: isAdmin || hasPermission("settings.statuses"),
  });

  // Trouble Codes query
  const { data: troubleCodesList, isLoading: loadingTroubleCodes } = useQuery<TroubleCode[]>({
    queryKey: ["/api/trouble-codes"],
    enabled: isAdmin || hasPermission("settings.troubleCodes"),
  });

  // User Groups queries
  const { data: userGroups, isLoading: loadingUserGroups } = useQuery<UserGroupWithProjects[]>({
    queryKey: ["/api/user-groups"],
    enabled: isAdmin || hasPermission("settings.userGroups"),
  });

  const { data: groupMembers, isLoading: loadingGroupMembers } = useQuery<User[]>({
    queryKey: ["/api/user-groups", selectedUserGroup?.id, "members"],
    queryFn: async () => {
      if (!selectedUserGroup) return [];
      const res = await fetch(`/api/user-groups/${selectedUserGroup.id}/members`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedUserGroup && membersDialogOpen && (isAdmin || hasPermission("settings.userGroups")),
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: (isAdmin || hasPermission("settings.userGroups")) && membersDialogOpen,
  });

  // Service Types query
  const { data: serviceTypesList, isLoading: loadingServiceTypes } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
    enabled: isAdmin || hasPermission("settings.serviceTypes"),
  });

  // System Types queries
  const { data: systemTypesList, isLoading: loadingSystemTypes } = useQuery<SystemType[]>({
    queryKey: ["/api/system-types", systemTypeProjectFilter],
    queryFn: async () => {
      const url = systemTypeProjectFilter !== "all" 
        ? `/api/system-types?projectId=${systemTypeProjectFilter}` 
        : "/api/system-types";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    enabled: isAdmin || hasPermission("settings.systemTypes"),
  });

  // Module Types queries
  const { data: moduleTypesList, isLoading: loadingModuleTypes } = useQuery<ModuleType[]>({
    queryKey: ["/api/module-types", moduleTypeProjectFilter],
    queryFn: async () => {
      const url = moduleTypeProjectFilter !== "all" 
        ? `/api/module-types?projectId=${moduleTypeProjectFilter}` 
        : "/api/module-types";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    enabled: isAdmin || hasPermission("settings.moduleTypes"),
  });

  const { data: projectsList } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: isAdmin || hasPermission("settings.systemTypes") || hasPermission("settings.moduleTypes") || hasPermission("settings.userGroups") || hasPermission("settings.customerApiLogs"),
  });

  // File Import History query
  const { data: fileImportHistoryList, isLoading: loadingImportHistory } = useQuery<(FileImportHistory & { projectName?: string; projectTimezone?: string | null })[]>({
    queryKey: ["/api/file-import-history"],
    enabled: isAdmin || hasPermission("settings.importHistory"),
  });

  // External Database Import History query
  const { data: externalDbImportHistoryList, isLoading: loadingExternalDbImportHistory } = useQuery<(ImportHistory & { configName?: string; databaseName?: string; projectName?: string })[]>({
    queryKey: ["/api/import-history"],
    enabled: isAdmin || hasPermission("settings.dbImportHistory"),
  });

  // Customer API Logs state and query
  const [apiLogStatusFilter, setApiLogStatusFilter] = useState<string>("all");
  const [apiLogProjectFilter, setApiLogProjectFilter] = useState<string>("all");
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  
  const { data: customerApiLogsList, isLoading: loadingApiLogs, refetch: refetchApiLogs } = useQuery<(CustomerApiLog & { projectName?: string | null })[]>({
    queryKey: ["/api/customer-api-logs", apiLogStatusFilter, apiLogProjectFilter],
    queryFn: async () => {
      let url = "/api/customer-api-logs?limit=100";
      if (apiLogStatusFilter !== "all") {
        url += `&success=${apiLogStatusFilter === "success"}`;
      }
      if (apiLogProjectFilter !== "all") {
        url += `&projectId=${apiLogProjectFilter}`;
      }
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    enabled: isAdmin || hasPermission("settings.customerApiLogs"),
  });

  // Mobile App Configuration state and query
  const [mobileUpdateUrl, setMobileUpdateUrl] = useState("");
  
  const { data: mobileConfigData } = useQuery<{ mobileUpdateUrl: string | null }>({
    queryKey: ["/api/settings/mobile-config"],
    enabled: isAdmin || hasPermission("settings.mobileConfig"),
  });

  useEffect(() => {
    if (mobileConfigData?.mobileUpdateUrl) {
      setMobileUpdateUrl(mobileConfigData.mobileUpdateUrl);
    }
  }, [mobileConfigData]);

  const saveMobileConfigMutation = useMutation({
    mutationFn: async (url: string) => {
      return apiRequest("PUT", "/api/settings/mobile-config", { mobileUpdateUrl: url });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/mobile-config"] });
      toast({ title: "Mobile app configuration saved" });
    },
    onError: () => {
      toast({ title: "Failed to save mobile configuration", variant: "destructive" });
    },
  });

  // Web Application Update state and queries
  const [webUpdateUrl, setWebUpdateUrl] = useState("");
  const [showUpdatePreview, setShowUpdatePreview] = useState(false);
  
  interface WebUpdateConfig {
    webUpdateUrl: string | null;
    lastCheck: string | null;
    cachedRelease: {
      latestVersion?: string;
      currentVersion?: string;
      updateAvailable: boolean;
      releaseName?: string;
      releaseNotes?: string;
      releaseUrl?: string;
      publishedAt?: string;
      // Git-based update info
      isGitRepo?: boolean;
      commitsBehind?: number;
      remoteBranch?: string;
      localCommit?: string;
      remoteCommit?: string;
      hasGitUpdates?: boolean;
    } | null;
  }

  interface UpdatePreview {
    isGitRepo: boolean;
    currentBranch: string;
    remoteBranch?: string;
    commitsBehind: number;
    filesChanged: string[];
    diff: string;
    updateCommand: string;
    fallbackCommand?: string;
    message?: string;
  }

  const { data: webUpdateConfigData } = useQuery<WebUpdateConfig>({
    queryKey: ["/api/settings/web-update-config"],
    enabled: isAdmin || hasPermission("settings.webUpdate"),
  });

  const { data: versionData } = useQuery<{ version: string }>({
    queryKey: ["/api/system/version"],
    enabled: isAdmin || hasPermission("settings.webUpdate"),
  });

  useEffect(() => {
    if (webUpdateConfigData?.webUpdateUrl) {
      setWebUpdateUrl(webUpdateConfigData.webUpdateUrl);
    }
  }, [webUpdateConfigData]);

  const saveWebUpdateConfigMutation = useMutation({
    mutationFn: async (url: string) => {
      return apiRequest("PUT", "/api/settings/web-update-config", { webUpdateUrl: url });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/web-update-config"] });
      toast({ title: "Web update configuration saved" });
    },
    onError: () => {
      toast({ title: "Failed to save web update configuration", variant: "destructive" });
    },
  });

  const checkForUpdatesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/system/update-check", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/web-update-config"] });
      if (data.hasGitUpdates) {
        toast({ title: `${data.commitsBehind} commit${data.commitsBehind === 1 ? '' : 's'} behind origin/${data.remoteBranch}` });
      } else if (data.updateAvailable && data.latestVersion) {
        toast({ title: `Update available: v${data.latestVersion}` });
      } else {
        toast({ title: "You're running the latest version" });
      }
    },
    onError: (error: any) => {
      toast({ title: error.message || "Failed to check for updates", variant: "destructive" });
    },
  });

  const [updatePreviewData, setUpdatePreviewData] = useState<UpdatePreview | null>(null);
  
  const previewUpdateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/system/update-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to preview update");
      }
      return response.json();
    },
    onSuccess: (data: UpdatePreview) => {
      setUpdatePreviewData(data);
      setShowUpdatePreview(true);
    },
    onError: (error: any) => {
      toast({ title: error.message || "Failed to preview update", variant: "destructive" });
    },
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Command copied to clipboard" });
  };

  const validateGitHubApiUrl = (url: string): boolean => {
    if (!url || url.trim() === "") return true; // Empty is valid (disables update checks)
    const pattern = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/releases\/(latest|\d+)$/;
    return pattern.test(url.trim());
  };

  useEffect(() => {
    if (pathData?.path) {
      setProjectFilesPath(pathData.path);
    }
  }, [pathData]);

  useEffect(() => {
    if (fileSettingsData) {
      setMaxFileSizeMB(String(fileSettingsData.maxFileSizeMB || 100));
      setAllowedExtensions(fileSettingsData.allowedExtensions || "");
    }
  }, [fileSettingsData]);

  useEffect(() => {
    if (timezoneData?.timezone) {
      setSelectedTimezone(timezoneData.timezone);
    }
    if (timezoneData !== undefined) {
      setTimezoneEnabled(timezoneData.isEnabled ?? true);
    }
  }, [timezoneData]);

  useEffect(() => {
    if (selectedSubrolePermissions && subroleDialogOpen) {
      setSubroleForm(prev => ({
        ...prev,
        permissions: selectedSubrolePermissions,
      }));
    }
  }, [selectedSubrolePermissions, subroleDialogOpen]);

  const createSubroleMutation = useMutation({
    mutationFn: async (data: { key: string; label: string; baseRole: string; description?: string; permissions: string[] }) => {
      return apiRequest("POST", "/api/subroles", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subroles"] });
      toast({ title: "Access level created successfully" });
      setSubroleDialogOpen(false);
      resetSubroleForm();
    },
    onError: () => {
      toast({ title: "Failed to create access level", variant: "destructive" });
    },
  });

  const updateSubroleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { key?: string; label?: string; baseRole?: string; description?: string; permissions: string[] } }) => {
      return apiRequest("PUT", `/api/subroles/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subroles"] });
      toast({ title: "Access level updated successfully" });
      setSubroleDialogOpen(false);
      setSelectedSubrole(null);
      resetSubroleForm();
    },
    onError: () => {
      toast({ title: "Failed to update access level", variant: "destructive" });
    },
  });

  const deleteSubroleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/subroles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subroles"] });
      toast({ title: "Access level deleted successfully" });
      setDeleteSubroleDialogOpen(false);
      setSelectedSubrole(null);
    },
    onError: () => {
      toast({ title: "Failed to delete access level", variant: "destructive" });
    },
  });

  const copySubroleMutation = useMutation({
    mutationFn: async ({ id, label }: { id: number; label: string }) => {
      return apiRequest("POST", `/api/subroles/${id}/copy`, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subroles"] });
      toast({ title: "Access level copied successfully" });
      setCopySubroleDialogOpen(false);
      setCopySubroleName("");
      setSelectedSubrole(null);
    },
    onError: () => {
      toast({ title: "Failed to copy access level", variant: "destructive" });
    },
  });

  const createStatusMutation = useMutation({
    mutationFn: async (data: { code: string; label: string; color: string; isDefault?: boolean }) => {
      return apiRequest("POST", "/api/work-order-statuses", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-order-statuses"] });
      toast({ title: "Status created successfully" });
      setStatusDialogOpen(false);
      resetStatusForm();
    },
    onError: () => {
      toast({ title: "Failed to create status", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { code?: string; label?: string; color?: string; isDefault?: boolean } }) => {
      return apiRequest("PATCH", `/api/work-order-statuses/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-order-statuses"] });
      toast({ title: "Status updated successfully" });
      setStatusDialogOpen(false);
      setSelectedStatus(null);
      resetStatusForm();
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const deleteStatusMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/work-order-statuses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-order-statuses"] });
      toast({ title: "Status deleted successfully" });
      setDeleteStatusDialogOpen(false);
      setSelectedStatus(null);
    },
    onError: () => {
      toast({ title: "Failed to delete status", variant: "destructive" });
    },
  });

  // Trouble Codes mutations
  const createTroubleCodeMutation = useMutation({
    mutationFn: async (data: { code: string; label: string; description?: string }) => {
      return apiRequest("POST", "/api/trouble-codes", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trouble-codes"] });
      toast({ title: "Trouble code created successfully" });
      setTroubleCodeDialogOpen(false);
      resetTroubleCodeForm();
    },
    onError: () => {
      toast({ title: "Failed to create trouble code", variant: "destructive" });
    },
  });

  const updateTroubleCodeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { code?: string; label?: string; description?: string } }) => {
      return apiRequest("PATCH", `/api/trouble-codes/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trouble-codes"] });
      toast({ title: "Trouble code updated successfully" });
      setTroubleCodeDialogOpen(false);
      setSelectedTroubleCode(null);
      resetTroubleCodeForm();
    },
    onError: () => {
      toast({ title: "Failed to update trouble code", variant: "destructive" });
    },
  });

  const deleteTroubleCodeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/trouble-codes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trouble-codes"] });
      toast({ title: "Trouble code deleted successfully" });
      setDeleteTroubleCodeDialogOpen(false);
      setSelectedTroubleCode(null);
    },
    onError: () => {
      toast({ title: "Failed to delete trouble code", variant: "destructive" });
    },
  });

  // User Groups mutations
  const createUserGroupMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; projectIds: number[] }) => {
      return apiRequest("POST", "/api/user-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-groups"] });
      toast({ title: "User group created successfully" });
      setUserGroupDialogOpen(false);
      resetUserGroupForm();
    },
    onError: () => {
      toast({ title: "Failed to create user group", variant: "destructive" });
    },
  });

  const updateUserGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; description?: string; projectIds?: number[] } }) => {
      return apiRequest("PATCH", `/api/user-groups/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-groups"] });
      toast({ title: "User group updated successfully" });
      setUserGroupDialogOpen(false);
      setSelectedUserGroup(null);
      resetUserGroupForm();
    },
    onError: () => {
      toast({ title: "Failed to update user group", variant: "destructive" });
    },
  });

  const deleteUserGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/user-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-groups"] });
      toast({ title: "User group deleted successfully" });
      setDeleteUserGroupDialogOpen(false);
      setSelectedUserGroup(null);
    },
    onError: () => {
      toast({ title: "Failed to delete user group", variant: "destructive" });
    },
  });

  const addUserToGroupMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: number; userId: string }) => {
      return apiRequest("POST", `/api/user-groups/${groupId}/members`, { userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-groups", selectedUserGroup?.id, "members"] });
      toast({ title: "User added to group" });
    },
    onError: () => {
      toast({ title: "Failed to add user to group", variant: "destructive" });
    },
  });

  const removeUserFromGroupMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: number; userId: string }) => {
      return apiRequest("DELETE", `/api/user-groups/${groupId}/members/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-groups", selectedUserGroup?.id, "members"] });
      toast({ title: "User removed from group" });
    },
    onError: () => {
      toast({ title: "Failed to remove user from group", variant: "destructive" });
    },
  });

  // Service Types mutations
  const createServiceTypeMutation = useMutation({
    mutationFn: async (data: { code: string; label: string; isDefault?: boolean }) => {
      return apiRequest("POST", "/api/service-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type created successfully" });
      setServiceTypeDialogOpen(false);
      resetServiceTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to create service type", variant: "destructive" });
    },
  });

  const updateServiceTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { code?: string; label?: string; isDefault?: boolean } }) => {
      return apiRequest("PATCH", `/api/service-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type updated successfully" });
      setServiceTypeDialogOpen(false);
      setSelectedServiceType(null);
      resetServiceTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to update service type", variant: "destructive" });
    },
  });

  const deleteServiceTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/service-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type deleted successfully" });
      setDeleteServiceTypeDialogOpen(false);
      setSelectedServiceType(null);
    },
    onError: () => {
      toast({ title: "Failed to delete service type", variant: "destructive" });
    },
  });

  // System Types mutations
  const createSystemTypeMutation = useMutation({
    mutationFn: async (data: { productId: string; productLabel: string; productDescription?: string; projectIds: number[] }) => {
      return apiRequest("POST", "/api/system-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-types"] });
      toast({ title: "System type created successfully" });
      setSystemTypeDialogOpen(false);
      resetSystemTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to create system type", variant: "destructive" });
    },
  });

  const updateSystemTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { productId?: string; productLabel?: string; productDescription?: string; projectIds?: number[] } }) => {
      return apiRequest("PATCH", `/api/system-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-types"] });
      toast({ title: "System type updated successfully" });
      setSystemTypeDialogOpen(false);
      setSelectedSystemType(null);
      resetSystemTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to update system type", variant: "destructive" });
    },
  });

  const deleteSystemTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/system-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-types"] });
      toast({ title: "System type deleted successfully" });
      setDeleteSystemTypeDialogOpen(false);
      setSelectedSystemType(null);
    },
    onError: () => {
      toast({ title: "Failed to delete system type", variant: "destructive" });
    },
  });

  const copySystemTypeMutation = useMutation({
    mutationFn: async ({ id, projectIds }: { id: number; projectIds?: number[] }) => {
      return apiRequest("POST", `/api/system-types/${id}/copy`, projectIds && projectIds.length > 0 ? { projectIds } : {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-types"] });
      toast({ title: "System type copied successfully" });
      setCopySystemTypeDialogOpen(false);
      setCopySystemTypeProjectIds([]);
      setSelectedSystemType(null);
    },
    onError: () => {
      toast({ title: "Failed to copy system type", variant: "destructive" });
    },
  });

  // Module Types mutations
  const createModuleTypeMutation = useMutation({
    mutationFn: async (data: { productId: string; productLabel: string; productDescription?: string; projectIds: number[] }) => {
      return apiRequest("POST", "/api/module-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-types"] });
      toast({ title: "Module type created successfully" });
      setModuleTypeDialogOpen(false);
      resetModuleTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to create module type", variant: "destructive" });
    },
  });

  const updateModuleTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { productId?: string; productLabel?: string; productDescription?: string; projectIds?: number[] } }) => {
      return apiRequest("PATCH", `/api/module-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-types"] });
      toast({ title: "Module type updated successfully" });
      setModuleTypeDialogOpen(false);
      setSelectedModuleType(null);
      resetModuleTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to update module type", variant: "destructive" });
    },
  });

  const deleteModuleTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/module-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-types"] });
      toast({ title: "Module type deleted successfully" });
      setDeleteModuleTypeDialogOpen(false);
      setSelectedModuleType(null);
    },
    onError: () => {
      toast({ title: "Failed to delete module type", variant: "destructive" });
    },
  });

  const copyModuleTypeMutation = useMutation({
    mutationFn: async ({ id, projectIds }: { id: number; projectIds?: number[] }) => {
      return apiRequest("POST", `/api/module-types/${id}/copy`, projectIds && projectIds.length > 0 ? { projectIds } : {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-types"] });
      toast({ title: "Module type copied successfully" });
      setCopyModuleTypeDialogOpen(false);
      setCopyModuleTypeProjectIds([]);
      setSelectedModuleType(null);
    },
    onError: () => {
      toast({ title: "Failed to copy module type", variant: "destructive" });
    },
  });

  const resetStatusForm = () => {
    setStatusForm({
      code: "",
      label: "",
      color: "blue",
      isDefault: false,
    });
  };

  const openCreateStatusDialog = () => {
    setSelectedStatus(null);
    resetStatusForm();
    setStatusDialogOpen(true);
  };

  const openEditStatusDialog = (status: WorkOrderStatus) => {
    setSelectedStatus(status);
    setStatusForm({
      code: status.code,
      label: status.label,
      color: status.color || "blue",
      isDefault: status.isDefault || false,
    });
    setStatusDialogOpen(true);
  };

  const handleStatusSubmit = () => {
    if (selectedStatus) {
      updateStatusMutation.mutate({
        id: selectedStatus.id,
        data: {
          code: statusForm.code,
          label: statusForm.label,
          color: statusForm.color,
          isDefault: statusForm.isDefault,
        },
      });
    } else {
      createStatusMutation.mutate({
        code: statusForm.code,
        label: statusForm.label,
        color: statusForm.color,
        isDefault: statusForm.isDefault,
      });
    }
  };

  const resetSubroleForm = () => {
    setSubroleForm({
      label: "",
      key: "",
      baseRole: "user",
      description: "",
      permissions: [],
    });
  };

  const openCreateSubroleDialog = () => {
    setSelectedSubrole(null);
    resetSubroleForm();
    setSubroleDialogOpen(true);
  };

  const openEditSubroleDialog = (subrole: Subrole) => {
    setSelectedSubrole(subrole);
    setSubroleForm({
      label: subrole.label,
      key: subrole.key,
      baseRole: subrole.baseRole as "admin" | "user" | "customer",
      description: subrole.description || "",
      permissions: [],
    });
    setSubroleDialogOpen(true);
  };

  const handleSubroleSubmit = () => {
    const key = subroleForm.key || subroleForm.label.toLowerCase().replace(/\s+/g, "_");
    const permissionList = subroleForm.baseRole === "admin" 
      ? allPermissions?.map(p => p.key) || []
      : subroleForm.permissions;
    
    if (selectedSubrole) {
      updateSubroleMutation.mutate({
        id: selectedSubrole.id,
        data: {
          key,
          label: subroleForm.label,
          baseRole: subroleForm.baseRole,
          description: subroleForm.description || undefined,
          permissions: permissionList,
        },
      });
    } else {
      createSubroleMutation.mutate({
        key,
        label: subroleForm.label,
        baseRole: subroleForm.baseRole,
        description: subroleForm.description || undefined,
        permissions: permissionList,
      });
    }
  };

  const togglePermission = (permKey: string) => {
    setSubroleForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permKey)
        ? prev.permissions.filter(p => p !== permKey)
        : [...prev.permissions, permKey],
    }));
  };

  // Trouble Code helper functions
  const resetTroubleCodeForm = () => {
    setTroubleCodeForm({
      code: "",
      label: "",
      description: "",
    });
  };

  const openCreateTroubleCodeDialog = () => {
    setSelectedTroubleCode(null);
    resetTroubleCodeForm();
    setTroubleCodeDialogOpen(true);
  };

  const openEditTroubleCodeDialog = (troubleCode: TroubleCode) => {
    setSelectedTroubleCode(troubleCode);
    setTroubleCodeForm({
      code: troubleCode.code,
      label: troubleCode.label,
      description: troubleCode.description || "",
    });
    setTroubleCodeDialogOpen(true);
  };

  const handleTroubleCodeSubmit = () => {
    if (selectedTroubleCode) {
      updateTroubleCodeMutation.mutate({
        id: selectedTroubleCode.id,
        data: {
          code: troubleCodeForm.code,
          label: troubleCodeForm.label,
          description: troubleCodeForm.description || undefined,
        },
      });
    } else {
      createTroubleCodeMutation.mutate({
        code: troubleCodeForm.code,
        label: troubleCodeForm.label,
        description: troubleCodeForm.description || undefined,
      });
    }
  };

  // User Group helper functions
  const resetUserGroupForm = () => {
    setUserGroupForm({
      name: "",
      description: "",
      projectIds: [],
    });
  };

  const openCreateUserGroupDialog = () => {
    setSelectedUserGroup(null);
    resetUserGroupForm();
    setUserGroupDialogOpen(true);
  };

  const openEditUserGroupDialog = (group: UserGroupWithProjects) => {
    setSelectedUserGroup(group);
    setUserGroupForm({
      name: group.name,
      description: group.description || "",
      projectIds: group.projectIds || [],
    });
    setUserGroupDialogOpen(true);
  };

  const openMembersDialog = (group: UserGroupWithProjects) => {
    setSelectedUserGroup(group);
    setMembersDialogOpen(true);
  };

  const handleUserGroupSubmit = () => {
    if (selectedUserGroup) {
      updateUserGroupMutation.mutate({
        id: selectedUserGroup.id,
        data: {
          name: userGroupForm.name,
          description: userGroupForm.description || undefined,
          projectIds: userGroupForm.projectIds,
        },
      });
    } else {
      createUserGroupMutation.mutate({
        name: userGroupForm.name,
        description: userGroupForm.description || undefined,
        projectIds: userGroupForm.projectIds,
      });
    }
  };

  // Service Type helper functions
  const resetServiceTypeForm = () => {
    setServiceTypeForm({
      code: "",
      label: "",
      color: "blue",
      isDefault: false,
    });
  };

  const openCreateServiceTypeDialog = () => {
    setSelectedServiceType(null);
    resetServiceTypeForm();
    setServiceTypeDialogOpen(true);
  };

  const openEditServiceTypeDialog = (serviceType: ServiceTypeRecord) => {
    setSelectedServiceType(serviceType);
    setServiceTypeForm({
      code: serviceType.code,
      label: serviceType.label,
      color: serviceType.color || "blue",
      isDefault: serviceType.isDefault || false,
    });
    setServiceTypeDialogOpen(true);
  };

  const handleServiceTypeSubmit = () => {
    if (selectedServiceType) {
      updateServiceTypeMutation.mutate({
        id: selectedServiceType.id,
        data: {
          code: serviceTypeForm.code,
          label: serviceTypeForm.label,
          color: serviceTypeForm.color,
          isDefault: serviceTypeForm.isDefault,
        },
      });
    } else {
      createServiceTypeMutation.mutate({
        code: serviceTypeForm.code,
        label: serviceTypeForm.label,
        color: serviceTypeForm.color,
        isDefault: serviceTypeForm.isDefault,
      });
    }
  };

  // System Type helper functions
  const resetSystemTypeForm = () => {
    setSystemTypeForm({
      productId: "",
      productLabel: "",
      productDescription: "",
      projectIds: [],
    });
  };

  const openCreateSystemTypeDialog = () => {
    setSelectedSystemType(null);
    resetSystemTypeForm();
    setSystemTypeDialogOpen(true);
  };

  const openEditSystemTypeDialog = (systemType: SystemType & { projectIds?: number[] }) => {
    setSelectedSystemType(systemType);
    setSystemTypeForm({
      productId: systemType.productId,
      productLabel: systemType.productLabel,
      productDescription: systemType.productDescription || "",
      projectIds: systemType.projectIds || [],
    });
    setSystemTypeDialogOpen(true);
  };

  const handleSystemTypeSubmit = () => {
    if (selectedSystemType) {
      updateSystemTypeMutation.mutate({
        id: selectedSystemType.id,
        data: {
          productId: systemTypeForm.productId,
          productLabel: systemTypeForm.productLabel,
          productDescription: systemTypeForm.productDescription || undefined,
          projectIds: systemTypeForm.projectIds,
        },
      });
    } else {
      createSystemTypeMutation.mutate({
        productId: systemTypeForm.productId,
        productLabel: systemTypeForm.productLabel,
        productDescription: systemTypeForm.productDescription || undefined,
        projectIds: systemTypeForm.projectIds,
      });
    }
  };

  const getProjectName = (projectId: number) => {
    const project = projectsList?.find(p => p.id === projectId);
    return project?.name || `Project ${projectId}`;
  };

  const getProjectNames = (projectIds: number[]) => {
    if (!projectIds || projectIds.length === 0) return "No projects";
    return projectIds.map(id => getProjectName(id)).join(", ");
  };

  const toggleSystemTypeProject = (projectId: number) => {
    setSystemTypeForm(prev => ({
      ...prev,
      projectIds: prev.projectIds.includes(projectId)
        ? prev.projectIds.filter(id => id !== projectId)
        : [...prev.projectIds, projectId],
    }));
  };

  const toggleCopySystemTypeProject = (projectId: number) => {
    setCopySystemTypeProjectIds(prev => 
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  // Module Type helper functions
  const resetModuleTypeForm = () => {
    setModuleTypeForm({
      productId: "",
      productLabel: "",
      productDescription: "",
      projectIds: [],
    });
  };

  const openCreateModuleTypeDialog = () => {
    setSelectedModuleType(null);
    resetModuleTypeForm();
    setModuleTypeDialogOpen(true);
  };

  const openEditModuleTypeDialog = (moduleType: ModuleType & { projectIds?: number[] }) => {
    setSelectedModuleType(moduleType);
    setModuleTypeForm({
      productId: moduleType.productId,
      productLabel: moduleType.productLabel,
      productDescription: moduleType.productDescription || "",
      projectIds: moduleType.projectIds || [],
    });
    setModuleTypeDialogOpen(true);
  };

  const handleModuleTypeSubmit = () => {
    if (selectedModuleType) {
      updateModuleTypeMutation.mutate({
        id: selectedModuleType.id,
        data: {
          productId: moduleTypeForm.productId,
          productLabel: moduleTypeForm.productLabel,
          productDescription: moduleTypeForm.productDescription || undefined,
          projectIds: moduleTypeForm.projectIds,
        },
      });
    } else {
      createModuleTypeMutation.mutate({
        productId: moduleTypeForm.productId,
        productLabel: moduleTypeForm.productLabel,
        productDescription: moduleTypeForm.productDescription || undefined,
        projectIds: moduleTypeForm.projectIds,
      });
    }
  };

  const toggleModuleTypeProject = (projectId: number) => {
    setModuleTypeForm(prev => ({
      ...prev,
      projectIds: prev.projectIds.includes(projectId)
        ? prev.projectIds.filter(id => id !== projectId)
        : [...prev.projectIds, projectId],
    }));
  };

  const toggleCopyModuleTypeProject = (projectId: number) => {
    setCopyModuleTypeProjectIds(prev => 
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  const getUserDisplayName = (u: User) => {
    if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
    return u.username || u.email || u.id;
  };

  const availableUsersForGroup = allUsers?.filter(
    u => !groupMembers?.some(m => m.id === u.id)
  ) || [];

  const groupedPermissions = allPermissions?.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>) || {};

  const updatePathMutation = useMutation({
    mutationFn: async (path: string) => {
      return apiRequest("PUT", "/api/settings/project-files-path", { path });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/project-files-path"] });
      toast({ title: "Project files path updated" });
    },
    onError: () => {
      toast({ title: "Failed to update path", variant: "destructive" });
    },
  });

  const updateFileSettingsMutation = useMutation({
    mutationFn: async (data: { maxFileSizeMB: number; allowedExtensions: string }) => {
      return apiRequest("PUT", "/api/settings/file-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/file-settings"] });
      toast({ title: "File settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update file settings", variant: "destructive" });
    },
  });

  const updateTimezoneMutation = useMutation({
    mutationFn: async (data: { timezone: string; isEnabled: boolean }) => {
      return apiRequest("PUT", "/api/settings/timezone", data);
    },
    onSuccess: () => {
      clearTimezoneCache();
      queryClient.invalidateQueries({ queryKey: ["/api/settings/timezone"] });
      toast({ title: "Timezone settings updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update timezone settings", variant: "destructive" });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof profileForm) => {
      // Normalize empty strings to null for optional fields
      const normalizedData = {
        firstName: data.firstName.trim() || null,
        lastName: data.lastName.trim() || null,
        email: data.email.trim() || null,
        phone: data.phone.trim() || null,
        address: data.address.trim() || null,
        city: data.city.trim() || null,
        state: data.state.trim() || null,
        zip: data.zip.trim() || null,
      };
      return apiRequest("PATCH", "/api/users/profile", normalizedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setProfileDialogOpen(false);
      toast({ title: "Profile updated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to update profile", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  const openProfileDialog = () => {
    setProfileForm({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: user?.email || "",
      phone: user?.phone || "",
      address: user?.address || "",
      city: user?.city || "",
      state: user?.state || "",
      zip: user?.zip || "",
    });
    setProfileDialogOpen(true);
  };

  const getInitials = () => {
    if (user?.firstName && user?.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    if (user?.username) return user.username[0].toUpperCase();
    if (user?.email) return user.email[0].toUpperCase();
    return "U";
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserIcon className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Profile</CardTitle>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={openProfileDialog}
                data-testid="button-edit-profile"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.profileImageUrl || undefined} className="object-cover" />
                <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium text-lg" data-testid="text-user-name">
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}` 
                    : user?.username || "User"}
                </p>
                <p className="text-muted-foreground" data-testid="text-user-email">{user?.email || "No email"}</p>
                <Badge variant="secondary" className="mt-2 capitalize" data-testid="badge-role">{user?.role || "user"}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sun className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Appearance</CardTitle>
            </div>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => setTheme("light")}
                className="flex-1"
                data-testid="button-theme-light"
              >
                <Sun className="h-4 w-4 mr-2" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => setTheme("dark")}
                className="flex-1"
                data-testid="button-theme-dark"
              >
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </Button>
            </div>
          </CardContent>
        </Card>

        {hasPermission("settings.projectFiles") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Project Files Directory</CardTitle>
                </div>
                <CardDescription>Configure the root directory where project files are stored</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="project-files-path">Current Path</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      id="project-files-path"
                      value={projectFilesPath}
                      onChange={(e) => setProjectFilesPath(e.target.value)}
                      placeholder="Project Files"
                      className="flex-1"
                      data-testid="input-project-files-path"
                    />
                    <Button
                      onClick={() => updatePathMutation.mutate(projectFilesPath)}
                      disabled={!projectFilesPath.trim() || updatePathMutation.isPending || projectFilesPath === pathData?.path}
                      data-testid="button-save-path"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Files will be stored in: <code className="bg-muted px-1 rounded">{projectFilesPath || "Project Files"}/[project_name]_[id]/[work_order_id]/</code>
                  </p>
                </div>
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.fileUpload") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileUp className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>File Upload Settings</CardTitle>
                </div>
                <CardDescription>Configure file upload limits and allowed file types</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="max-file-size">Maximum File Size</Label>
                  <div className="flex gap-2 mt-2 items-center">
                    <Select
                      value={maxFileSizeMB}
                      onValueChange={setMaxFileSizeMB}
                    >
                      <SelectTrigger className="w-48" data-testid="select-max-file-size">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 MB</SelectItem>
                        <SelectItem value="25">25 MB</SelectItem>
                        <SelectItem value="50">50 MB</SelectItem>
                        <SelectItem value="100">100 MB</SelectItem>
                        <SelectItem value="250">250 MB</SelectItem>
                        <SelectItem value="500">500 MB</SelectItem>
                        <SelectItem value="1024">1 GB</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">per file</span>
                  </div>
                </div>

                <div>
                  <Label htmlFor="allowed-extensions">Allowed File Extensions</Label>
                  <Textarea
                    id="allowed-extensions"
                    value={allowedExtensions}
                    onChange={(e) => setAllowedExtensions(e.target.value)}
                    placeholder=".pdf, .doc, .docx, .xls, .xlsx, .jpg, .jpeg, .png, .gif, .txt, .csv"
                    className="mt-2"
                    rows={3}
                    data-testid="input-allowed-extensions"
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    Enter file extensions separated by commas. Leave empty to allow all file types.
                  </p>
                </div>

                <Button
                  onClick={() => updateFileSettingsMutation.mutate({
                    maxFileSizeMB: parseInt(maxFileSizeMB),
                    allowedExtensions: allowedExtensions.trim(),
                  })}
                  disabled={updateFileSettingsMutation.isPending}
                  data-testid="button-save-file-settings"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save File Settings
                </Button>
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.timezone") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Timezone</CardTitle>
                </div>
                <CardDescription>Set the timezone used for how timestamps to be displayed in the user interface.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="timezone-enabled">Enable Timezone Conversion</Label>
                    <p className="text-sm text-muted-foreground">
                      This will display the selected local timezone in the UI. If disabled, the application will display all timestamps in UTC time.
                    </p>
                  </div>
                  <Switch
                    id="timezone-enabled"
                    checked={timezoneEnabled}
                    onCheckedChange={setTimezoneEnabled}
                    data-testid="switch-timezone-enabled"
                  />
                </div>
                
                <div className={timezoneEnabled ? "" : "opacity-50 pointer-events-none"}>
                  <Label htmlFor="timezone">System Timezone</Label>
                  <div className="flex gap-2 mt-2 items-center">
                    <Select
                      value={selectedTimezone}
                      onValueChange={setSelectedTimezone}
                      disabled={!timezoneEnabled}
                    >
                      <SelectTrigger className="w-72" data-testid="select-timezone">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneOptions.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <Button
                  onClick={() => updateTimezoneMutation.mutate({ 
                    timezone: selectedTimezone || timezoneData?.timezone || "America/Denver", 
                    isEnabled: timezoneEnabled 
                  })}
                  disabled={updateTimezoneMutation.isPending || (selectedTimezone === timezoneData?.timezone && timezoneEnabled === timezoneData?.isEnabled)}
                  data-testid="button-save-timezone"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Timezone Settings
                </Button>
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.customerApiLogs") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Customer API Logs</CardTitle>
                      <CardDescription className="mt-1">View API calls made to customer backend systems when work orders are completed</CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => refetchApiLogs()}
                    disabled={loadingApiLogs}
                    data-testid="button-refresh-api-logs"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingApiLogs ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3 flex-wrap items-center">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select
                      value={apiLogStatusFilter}
                      onValueChange={setApiLogStatusFilter}
                    >
                      <SelectTrigger className="w-32" data-testid="select-api-log-status-filter">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Select
                    value={apiLogProjectFilter}
                    onValueChange={setApiLogProjectFilter}
                  >
                    <SelectTrigger className="w-48" data-testid="select-api-log-project-filter">
                      <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Projects</SelectItem>
                      {projectsList?.map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {loadingApiLogs ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : customerApiLogsList && customerApiLogsList.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {customerApiLogsList.map((log) => (
                        <Collapsible 
                          key={log.id}
                          open={expandedLogId === log.id}
                          onOpenChange={(open) => setExpandedLogId(open ? log.id : null)}
                        >
                          <div className="border rounded-md">
                            <CollapsibleTrigger asChild>
                              <div 
                                className="flex items-center gap-3 p-3 cursor-pointer hover-elevate"
                                data-testid={`row-api-log-${log.id}`}
                              >
                                {expandedLogId === log.id ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )}
                                {log.success ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium truncate">
                                      WO #{log.workOrderId}
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                      {log.projectName || `Project ${log.projectId}`}
                                    </Badge>
                                    {log.responseStatus && (
                                      <Badge 
                                        variant={log.responseStatus >= 200 && log.responseStatus < 300 ? "default" : "destructive"}
                                        className="text-xs"
                                      >
                                        HTTP {log.responseStatus}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {log.createdAt ? formatDateTime(log.createdAt) : "—"}
                                  </p>
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="border-t p-3 space-y-3 bg-muted/30">
                                {log.errorMessage && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Error Message</Label>
                                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{log.errorMessage}</p>
                                  </div>
                                )}
                                <div>
                                  <Label className="text-xs text-muted-foreground">Request URL</Label>
                                  <p className="text-sm font-mono break-all mt-1">{log.requestUrl || "Not configured"}</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Eye className="h-3 w-3" /> Request Payload
                                    </Label>
                                    <pre className="text-xs font-mono bg-muted p-2 rounded mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                                      {log.requestPayload ? (() => { try { return JSON.stringify(JSON.parse(log.requestPayload), null, 2); } catch { return log.requestPayload; } })() : "No request payload"}
                                    </pre>
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Eye className="h-3 w-3" /> Response Body
                                    </Label>
                                    <pre className="text-xs font-mono bg-muted p-2 rounded mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                                      {log.responseBody ? (() => { try { return JSON.stringify(JSON.parse(log.responseBody), null, 2); } catch { return log.responseBody; } })() : "No response body"}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-muted-foreground">No API logs found. API calls are logged when work orders are completed and customer API integration is configured for the project.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.mobileConfig") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>Mobile App Configuration</CardTitle>
                    <CardDescription className="mt-1">Configure mobile app update settings for the MeterFlo mobile application</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mobileUpdateUrl">GitHub Releases API URL</Label>
                  <Input
                    id="mobileUpdateUrl"
                    placeholder="https://api.github.com/repos/yourorg/meterflo-mobile/releases/latest"
                    value={mobileUpdateUrl}
                    onChange={(e) => setMobileUpdateUrl(e.target.value)}
                    data-testid="input-mobile-update-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the GitHub releases API URL to enable mobile app update checks. Leave empty to disable update checks.
                    <br />
                    Format: https://api.github.com/repos/ORG/REPO/releases/latest
                  </p>
                  {mobileUpdateUrl && !validateGitHubApiUrl(mobileUpdateUrl) && (
                    <p className="text-xs text-destructive">
                      Invalid GitHub releases API URL format. Must be: https://api.github.com/repos/ORG/REPO/releases/latest
                    </p>
                  )}
                </div>
                <Button 
                  onClick={() => {
                    if (!validateGitHubApiUrl(mobileUpdateUrl)) {
                      toast({ title: "Invalid GitHub URL format", variant: "destructive" });
                      return;
                    }
                    saveMobileConfigMutation.mutate(mobileUpdateUrl.trim());
                  }}
                  disabled={saveMobileConfigMutation.isPending || (!validateGitHubApiUrl(mobileUpdateUrl))}
                  data-testid="button-save-mobile-config"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMobileConfigMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.webUpdate") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ArrowUpCircle className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>Web Application Updates</CardTitle>
                    <CardDescription className="mt-1">Check for updates and preview changes before updating</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4 flex-wrap p-3 bg-muted/50 rounded-md">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Current Version</div>
                    <div className="text-lg font-semibold">v{versionData?.version || "1.0.0"}</div>
                    {webUpdateConfigData?.cachedRelease?.localCommit && (
                      <div className="text-xs text-muted-foreground font-mono">
                        Commit: {webUpdateConfigData.cachedRelease.localCommit}
                      </div>
                    )}
                  </div>
                  {webUpdateConfigData?.cachedRelease?.hasGitUpdates && (
                    <div className="space-y-1 text-center">
                      <div className="text-sm text-muted-foreground">Git Status</div>
                      <Badge variant="default" className="text-sm">
                        {webUpdateConfigData.cachedRelease.commitsBehind} commit{webUpdateConfigData.cachedRelease.commitsBehind === 1 ? '' : 's'} behind
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        origin/{webUpdateConfigData.cachedRelease.remoteBranch}
                      </div>
                    </div>
                  )}
                  {webUpdateConfigData?.cachedRelease?.latestVersion && webUpdateConfigData?.cachedRelease?.updateAvailable && (
                    <div className="space-y-1 text-right">
                      <div className="text-sm text-muted-foreground">Latest Release</div>
                      <Badge variant="secondary" className="text-sm">
                        v{webUpdateConfigData.cachedRelease.latestVersion}
                      </Badge>
                    </div>
                  )}
                  {webUpdateConfigData?.lastCheck && (
                    <div className="space-y-1 text-right">
                      <div className="text-sm text-muted-foreground">Last Checked</div>
                      <div className="text-sm">{formatDateTime(new Date(webUpdateConfigData.lastCheck))}</div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webUpdateUrl">GitHub Releases API URL</Label>
                  <Input
                    id="webUpdateUrl"
                    placeholder="https://api.github.com/repos/yourorg/meterflo/releases/latest"
                    value={webUpdateUrl}
                    onChange={(e) => setWebUpdateUrl(e.target.value)}
                    data-testid="input-web-update-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the GitHub releases API URL to enable web app update checks.
                    <br />
                    Format: https://api.github.com/repos/ORG/REPO/releases/latest
                  </p>
                  {webUpdateUrl && !validateGitHubApiUrl(webUpdateUrl) && (
                    <p className="text-xs text-destructive">
                      Invalid GitHub releases API URL format
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button 
                    onClick={() => {
                      if (!validateGitHubApiUrl(webUpdateUrl)) {
                        toast({ title: "Invalid GitHub URL format", variant: "destructive" });
                        return;
                      }
                      saveWebUpdateConfigMutation.mutate(webUpdateUrl.trim());
                    }}
                    disabled={saveWebUpdateConfigMutation.isPending || (!validateGitHubApiUrl(webUpdateUrl))}
                    data-testid="button-save-web-update-config"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saveWebUpdateConfigMutation.isPending ? "Saving..." : "Save Configuration"}
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={() => checkForUpdatesMutation.mutate()}
                    disabled={checkForUpdatesMutation.isPending}
                    data-testid="button-check-updates"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${checkForUpdatesMutation.isPending ? "animate-spin" : ""}`} />
                    {checkForUpdatesMutation.isPending ? "Checking..." : "Check for Updates"}
                  </Button>

                  <Button 
                    variant="outline"
                    onClick={() => previewUpdateMutation.mutate()}
                    disabled={previewUpdateMutation.isPending}
                    data-testid="button-preview-update"
                  >
                    <GitBranch className={`h-4 w-4 mr-2 ${previewUpdateMutation.isPending ? "animate-spin" : ""}`} />
                    {previewUpdateMutation.isPending ? "Fetching..." : "Preview Changes"}
                  </Button>
                </div>

                {webUpdateConfigData?.cachedRelease?.updateAvailable && (
                  <div className="border rounded-md p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="font-medium">{webUpdateConfigData.cachedRelease.releaseName}</h4>
                      <a 
                        href={webUpdateConfigData.cachedRelease.releaseUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        View on GitHub
                      </a>
                    </div>
                    {webUpdateConfigData.cachedRelease.releaseNotes && (
                      <div className="text-sm text-muted-foreground max-h-40 overflow-y-auto">
                        <pre className="whitespace-pre-wrap font-sans">
                          {webUpdateConfigData.cachedRelease.releaseNotes}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
        )}

        <Dialog open={showUpdatePreview} onOpenChange={setShowUpdatePreview}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Update Preview
              </DialogTitle>
              <DialogDescription>
                Review the changes before updating. This shows what would change if you run the update command.
              </DialogDescription>
            </DialogHeader>
            
            {updatePreviewData && (
              <div className="space-y-4">
                {!updatePreviewData.isGitRepo ? (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                    <p className="text-destructive font-medium">Not a Git Repository</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      This installation is not a git repository. You'll need to update manually by downloading the latest release.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-muted/50 rounded-md">
                        <div className="text-sm text-muted-foreground">Current Branch</div>
                        <div className="font-medium">{updatePreviewData.currentBranch}</div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-md">
                        <div className="text-sm text-muted-foreground">Commits Behind</div>
                        <div className="font-medium">{updatePreviewData.commitsBehind}</div>
                      </div>
                    </div>

                    {updatePreviewData.message && (
                      <div className="p-3 bg-muted rounded-md">
                        <p className="text-sm">{updatePreviewData.message}</p>
                      </div>
                    )}

                    {updatePreviewData.filesChanged.length > 0 && (
                      <div className="space-y-2">
                        <Label>Files Changed ({updatePreviewData.filesChanged.length})</Label>
                        <ScrollArea className="h-40 border rounded-md">
                          <div className="p-3 space-y-1">
                            {updatePreviewData.filesChanged.map((file, i) => {
                              const [status, ...pathParts] = file.split("\t");
                              const filePath = pathParts.join("\t");
                              const statusColor = status === "M" ? "text-yellow-600" : 
                                                  status === "A" ? "text-green-600" : 
                                                  status === "D" ? "text-red-600" : "text-muted-foreground";
                              return (
                                <div key={i} className="flex items-center gap-2 text-sm font-mono">
                                  <span className={`w-4 ${statusColor}`}>{status}</span>
                                  <span>{filePath}</span>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                    {updatePreviewData.diff && (
                      <div className="space-y-2">
                        <Label>Change Summary</Label>
                        <pre className="p-3 bg-muted rounded-md text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto">
                          {updatePreviewData.diff}
                        </pre>
                      </div>
                    )}

                    <div className="space-y-3">
                      <Label>Update Command</Label>
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
                        <p className="text-xs text-amber-800 dark:text-amber-200 font-medium mb-1">
                          Important: First navigate to your application directory
                        </p>
                        <code className="text-xs font-mono text-amber-700 dark:text-amber-300">
                          cd /path/to/your/meterflo
                        </code>
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                          Example: cd c:/xampp/htdocs/meterflo
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Then copy and run this command to update:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-3 bg-muted rounded-md text-xs font-mono break-all">
                          {updatePreviewData.updateCommand}
                        </code>
                        <Button 
                          size="icon" 
                          variant="outline"
                          onClick={() => copyToClipboard(updatePreviewData.updateCommand)}
                          data-testid="button-copy-update-command"
                        >
                          <Clipboard className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      {updatePreviewData.fallbackCommand && (
                        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
                          <p className="text-xs text-blue-800 dark:text-blue-200 font-medium mb-2">
                            If the above command fails, try this alternative:
                          </p>
                          <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                            This command does a hard reset to match the remote exactly (local changes will be lost):
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 p-2 bg-blue-100 dark:bg-blue-900/50 rounded text-xs font-mono break-all text-blue-800 dark:text-blue-200">
                              {updatePreviewData.fallbackCommand}
                            </code>
                            <Button 
                              size="icon" 
                              variant="outline"
                              onClick={() => copyToClipboard(updatePreviewData.fallbackCommand!)}
                              data-testid="button-copy-fallback-command"
                            >
                              <Clipboard className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowUpdatePreview(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {hasPermission("settings.importHistory") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>File Import History</CardTitle>
                      <CardDescription className="mt-1">View all file import attempts and their results</CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => window.location.href = "/api/file-import-history/download"}
                    data-testid="button-download-import-history"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingImportHistory ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : fileImportHistoryList && fileImportHistoryList.length > 0 ? (
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>File Name</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Imported</TableHead>
                          <TableHead className="text-right">Failed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fileImportHistoryList.slice(0, 50).map((entry) => (
                          <TableRow key={entry.id} data-testid={`row-import-history-${entry.id}`}>
                            <TableCell className="text-sm">
                              {entry.startedAt ? (
                                entry.projectTimezone 
                                  ? formatDateTimeInTimezone(entry.startedAt, entry.projectTimezone)
                                  : formatDateTime(entry.startedAt)
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {entry.importSource?.replace("_", " ") || "scheduled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-32 truncate" title={entry.fileName}>
                              {entry.fileName}
                            </TableCell>
                            <TableCell>{entry.projectName || "—"}</TableCell>
                            <TableCell>{entry.userName || "—"}</TableCell>
                            <TableCell>
                              <Badge 
                                variant={entry.status === "success" ? "default" : entry.status === "failed" ? "destructive" : "secondary"}
                                className="capitalize"
                              >
                                {entry.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{entry.recordsImported || 0}</TableCell>
                            <TableCell className="text-right">{entry.recordsFailed || 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No import history found.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.dbImportHistory") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>External Database Import History</CardTitle>
                      <CardDescription className="mt-1">View all external database import attempts and their results</CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => window.location.href = "/api/import-history/download"}
                    data-testid="button-download-external-db-import-history"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingExternalDbImportHistory ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : externalDbImportHistoryList && externalDbImportHistoryList.length > 0 ? (
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Database</TableHead>
                          <TableHead>Config</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Imported</TableHead>
                          <TableHead className="text-right">Failed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {externalDbImportHistoryList.slice(0, 50).map((entry) => (
                          <TableRow key={entry.id} data-testid={`row-external-db-import-history-${entry.id}`}>
                            <TableCell className="text-sm">
                              {entry.startedAt ? formatDateTime(entry.startedAt) : "—"}
                            </TableCell>
                            <TableCell>{entry.projectName || "—"}</TableCell>
                            <TableCell>{entry.databaseName || "—"}</TableCell>
                            <TableCell className="max-w-32 truncate" title={entry.configName || ""}>
                              {entry.configName || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={entry.status === "success" ? "default" : entry.status === "failed" ? "destructive" : "secondary"}
                                className="capitalize"
                              >
                                {entry.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{entry.recordsImported || 0}</TableCell>
                            <TableCell className="text-right">{entry.recordsFailed || 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No external database import history found.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.accessLevels") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Access Levels</CardTitle>
                      <CardDescription className="mt-1">Define what each access level can do in the system</CardDescription>
                    </div>
                  </div>
                  <Button onClick={openCreateSubroleDialog} data-testid="button-add-subrole">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Access Level
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingSubroles ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : subroles && subroles.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Main Role</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subroles.map((subrole) => (
                        <TableRow key={subrole.id} data-testid={`row-subrole-${subrole.id}`}>
                          <TableCell className="font-medium">{subrole.label}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {subrole.baseRole}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{subrole.description || "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditSubroleDialog(subrole)}
                                data-testid={`button-edit-subrole-${subrole.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedSubrole(subrole);
                                  setCopySubroleName(`Copy of ${subrole.label}`);
                                  setCopySubroleDialogOpen(true);
                                }}
                                data-testid={`button-copy-subrole-${subrole.id}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedSubrole(subrole);
                                  setDeleteSubroleDialogOpen(true);
                                }}
                                data-testid={`button-delete-subrole-${subrole.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No access levels defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.statuses") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Work Order Statuses</CardTitle>
                      <CardDescription className="mt-1">Customize the status options available for work orders</CardDescription>
                    </div>
                  </div>
                  <Button onClick={openCreateStatusDialog} data-testid="button-add-status">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Status
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingStatuses ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : workOrderStatusList && workOrderStatusList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Color</TableHead>
                        <TableHead>Default</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workOrderStatusList.map((status) => (
                        <TableRow key={status.id} data-testid={`row-status-${status.id}`}>
                          <TableCell className="font-medium">{status.code}</TableCell>
                          <TableCell>{status.label}</TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline" 
                              style={{ 
                                backgroundColor: getStatusColorHex(status.color || "gray"),
                                color: ['yellow', 'orange'].includes(status.color || "") ? '#000' : '#fff',
                                borderColor: getStatusColorHex(status.color || "gray")
                              }}
                            >
                              {status.color || "gray"}
                            </Badge>
                          </TableCell>
                          <TableCell>{status.isDefault ? "Yes" : "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditStatusDialog(status)}
                                data-testid={`button-edit-status-${status.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {!isCoreStatus(status.code) && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => {
                                    setSelectedStatus(status);
                                    setDeleteStatusDialogOpen(true);
                                  }}
                                  data-testid={`button-delete-status-${status.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No statuses defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.troubleCodes") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Trouble Codes</CardTitle>
                      <CardDescription className="mt-1">Define trouble/issue codes that can be assigned to work orders</CardDescription>
                    </div>
                  </div>
                  <Button onClick={openCreateTroubleCodeDialog} data-testid="button-add-trouble-code">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Trouble Code
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingTroubleCodes ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : troubleCodesList && troubleCodesList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {troubleCodesList.map((troubleCode) => (
                        <TableRow key={troubleCode.id} data-testid={`row-trouble-code-${troubleCode.id}`}>
                          <TableCell className="font-medium">{troubleCode.code}</TableCell>
                          <TableCell>{troubleCode.label}</TableCell>
                          <TableCell className="text-muted-foreground">{troubleCode.description || "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditTroubleCodeDialog(troubleCode)}
                                data-testid={`button-edit-trouble-code-${troubleCode.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedTroubleCode(troubleCode);
                                  setDeleteTroubleCodeDialogOpen(true);
                                }}
                                data-testid={`button-delete-trouble-code-${troubleCode.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No trouble codes defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.userGroups") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <UsersRound className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>User Groups</CardTitle>
                      <CardDescription className="mt-1">Organize users into groups for work order assignment</CardDescription>
                    </div>
                  </div>
                  <Button onClick={openCreateUserGroupDialog} data-testid="button-add-user-group">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Group
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingUserGroups ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : userGroups && userGroups.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Projects</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userGroups.map((group) => (
                        <TableRow key={group.id} data-testid={`row-user-group-${group.id}`}>
                          <TableCell className="font-medium">{group.name}</TableCell>
                          <TableCell className="text-muted-foreground">{group.description || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {group.projectIds && group.projectIds.length > 0 ? (
                                group.projectIds.map((projectId) => {
                                  const project = projectsList?.find(p => p.id === projectId);
                                  return project ? (
                                    <Badge key={projectId} variant="secondary" className="text-xs">
                                      {project.name}
                                    </Badge>
                                  ) : null;
                                })
                              ) : (
                                <span className="text-muted-foreground text-sm">No projects</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => openMembersDialog(group)}
                                data-testid={`button-members-group-${group.id}`}
                              >
                                <Users className="h-4 w-4 mr-1" />
                                Members
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditUserGroupDialog(group)}
                                data-testid={`button-edit-group-${group.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedUserGroup(group);
                                  setDeleteUserGroupDialogOpen(true);
                                }}
                                data-testid={`button-delete-group-${group.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No user groups defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.serviceTypes") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Service Types</CardTitle>
                      <CardDescription className="mt-1">Define service types for work orders (e.g., Water, Electric, Gas)</CardDescription>
                    </div>
                  </div>
                  <Button onClick={openCreateServiceTypeDialog} data-testid="button-add-service-type">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Service Type
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingServiceTypes ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : serviceTypesList && serviceTypesList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Color</TableHead>
                        <TableHead>Default</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {serviceTypesList.map((serviceType) => (
                        <TableRow key={serviceType.id} data-testid={`row-service-type-${serviceType.id}`}>
                          <TableCell className="font-medium">{serviceType.code}</TableCell>
                          <TableCell>{serviceType.label}</TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline" 
                              style={{ 
                                backgroundColor: getStatusColorHex(serviceType.color || "gray"),
                                color: ['yellow', 'orange'].includes(serviceType.color || "") ? '#000' : '#fff',
                                borderColor: getStatusColorHex(serviceType.color || "gray")
                              }}
                            >
                              {serviceType.color || "gray"}
                            </Badge>
                          </TableCell>
                          <TableCell>{serviceType.isDefault ? "Yes" : "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditServiceTypeDialog(serviceType)}
                                data-testid={`button-edit-service-type-${serviceType.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedServiceType(serviceType);
                                  setDeleteServiceTypeDialogOpen(true);
                                }}
                                data-testid={`button-delete-service-type-${serviceType.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No service types defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.systemTypes") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>System Types</CardTitle>
                      <CardDescription className="mt-1">Define system types for work orders by project</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={systemTypeProjectFilter} onValueChange={setSystemTypeProjectFilter}>
                      <SelectTrigger className="w-48" data-testid="select-system-type-filter">
                        <SelectValue placeholder="Filter by project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Projects</SelectItem>
                        {projectsList?.map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={openCreateSystemTypeDialog} data-testid="button-add-system-type">
                      <Plus className="h-4 w-4 mr-2" />
                      Add System Type
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingSystemTypes ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : systemTypesList && systemTypesList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product ID</TableHead>
                        <TableHead>Product Label</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Projects</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {systemTypesList.map((systemType: SystemType & { projectIds?: number[] }) => (
                        <TableRow key={systemType.id} data-testid={`row-system-type-${systemType.id}`}>
                          <TableCell className="font-medium">{systemType.productId}</TableCell>
                          <TableCell>{systemType.productLabel}</TableCell>
                          <TableCell className="text-muted-foreground">{systemType.productDescription || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(systemType.projectIds && systemType.projectIds.length > 0) ? (
                                systemType.projectIds.map((pId: number) => (
                                  <Badge key={pId} variant="outline">{getProjectName(pId)}</Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">No projects</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditSystemTypeDialog(systemType)}
                                data-testid={`button-edit-system-type-${systemType.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedSystemType(systemType);
                                  setCopySystemTypeProjectIds([]);
                                  setCopySystemTypeDialogOpen(true);
                                }}
                                data-testid={`button-copy-system-type-${systemType.id}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedSystemType(systemType);
                                  setDeleteSystemTypeDialogOpen(true);
                                }}
                                data-testid={`button-delete-system-type-${systemType.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No system types defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        {hasPermission("settings.moduleTypes") && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Module Types</CardTitle>
                      <CardDescription className="mt-1">Define module types for work orders by project</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={moduleTypeProjectFilter} onValueChange={setModuleTypeProjectFilter}>
                      <SelectTrigger className="w-48" data-testid="select-module-type-filter">
                        <SelectValue placeholder="Filter by project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Projects</SelectItem>
                        {projectsList?.map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={openCreateModuleTypeDialog} data-testid="button-add-module-type">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Module Type
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingModuleTypes ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : moduleTypesList && moduleTypesList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product ID</TableHead>
                        <TableHead>Product Label</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Projects</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {moduleTypesList.map((moduleType: ModuleType & { projectIds?: number[] }) => (
                        <TableRow key={moduleType.id} data-testid={`row-module-type-${moduleType.id}`}>
                          <TableCell className="font-medium">{moduleType.productId}</TableCell>
                          <TableCell>{moduleType.productLabel}</TableCell>
                          <TableCell className="text-muted-foreground">{moduleType.productDescription || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(moduleType.projectIds && moduleType.projectIds.length > 0) ? (
                                moduleType.projectIds.map((pId: number) => (
                                  <Badge key={pId} variant="outline">{getProjectName(pId)}</Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">No projects</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => openEditModuleTypeDialog(moduleType)}
                                data-testid={`button-edit-module-type-${moduleType.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedModuleType(moduleType);
                                  setCopyModuleTypeProjectIds([]);
                                  setCopyModuleTypeDialogOpen(true);
                                }}
                                data-testid={`button-copy-module-type-${moduleType.id}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedModuleType(moduleType);
                                  setDeleteModuleTypeDialogOpen(true);
                                }}
                                data-testid={`button-delete-module-type-${moduleType.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No module types defined yet.</p>
                )}
              </CardContent>
            </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium">Session</p>
                <p className="text-sm text-muted-foreground">You are currently logged in</p>
              </div>
              <a href="/api/logout">
                <Button variant="destructive" data-testid="button-logout-settings">Log Out</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={subroleDialogOpen} onOpenChange={setSubroleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedSubrole ? "Edit Access Level" : "Create Access Level"}</DialogTitle>
            <DialogDescription>
              {selectedSubrole ? "Update the access level settings and permissions" : "Define a new access level with specific permissions"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="subrole-label">Name</Label>
                <Input
                  id="subrole-label"
                  value={subroleForm.label}
                  onChange={(e) => setSubroleForm({ ...subroleForm, label: e.target.value })}
                  placeholder="e.g., Project Manager"
                  className="mt-2"
                  data-testid="input-subrole-label"
                />
              </div>
              <div>
                <Label htmlFor="subrole-base-role">Main Role</Label>
                <Select
                  value={subroleForm.baseRole}
                  onValueChange={(value: "admin" | "user" | "customer") => setSubroleForm({ ...subroleForm, baseRole: value })}
                >
                  <SelectTrigger className="mt-2" data-testid="select-subrole-base-role">
                    <SelectValue placeholder="Select main role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="subrole-description">Description (optional)</Label>
              <Input
                id="subrole-description"
                value={subroleForm.description}
                onChange={(e) => setSubroleForm({ ...subroleForm, description: e.target.value })}
                placeholder="Brief description of this access level"
                className="mt-2"
                data-testid="input-subrole-description"
              />
            </div>

            <div className="border-t pt-4">
              <Label className="text-base font-semibold">Page Access Permissions</Label>
              {subroleForm.baseRole === "admin" ? (
                <p className="text-sm text-muted-foreground mt-2">
                  Admin access levels automatically have access to all pages and features.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {Object.entries(groupedPermissions).map(([category, perms]) => (
                    <div key={category}>
                      <p className="text-sm font-medium capitalize text-muted-foreground mb-2">{category}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {perms.map((perm) => (
                          <div key={perm.key} className="flex items-center space-x-2">
                            <Checkbox
                              id={`perm-${perm.key}`}
                              checked={subroleForm.permissions.includes(perm.key)}
                              onCheckedChange={() => togglePermission(perm.key)}
                              data-testid={`checkbox-perm-${perm.key}`}
                            />
                            <Label htmlFor={`perm-${perm.key}`} className="text-sm cursor-pointer">
                              {perm.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubroleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubroleSubmit}
              disabled={!subroleForm.label || createSubroleMutation.isPending || updateSubroleMutation.isPending}
              data-testid="button-save-subrole"
            >
              {createSubroleMutation.isPending || updateSubroleMutation.isPending ? "Saving..." : selectedSubrole ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteSubroleDialogOpen} onOpenChange={setDeleteSubroleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Access Level</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedSubrole?.label}"? This action cannot be undone.
              Users with this access level will lose their permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSubrole && deleteSubroleMutation.mutate(selectedSubrole.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-subrole"
            >
              {deleteSubroleMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={copySubroleDialogOpen} onOpenChange={setCopySubroleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy Access Level</DialogTitle>
            <DialogDescription>
              Enter a name for the copied access level. All permissions will be copied.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="copy-name">Name</Label>
            <Input
              id="copy-name"
              value={copySubroleName}
              onChange={(e) => setCopySubroleName(e.target.value)}
              placeholder="Enter name for copy"
              className="mt-2"
              data-testid="input-copy-subrole-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopySubroleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedSubrole && copySubroleMutation.mutate({ id: selectedSubrole.id, label: copySubroleName })}
              disabled={!copySubroleName.trim() || copySubroleMutation.isPending}
              data-testid="button-confirm-copy-subrole"
            >
              {copySubroleMutation.isPending ? "Copying..." : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedStatus ? "Edit Status" : "Create Status"}</DialogTitle>
            <DialogDescription>
              {selectedStatus ? "Update the status settings" : "Define a new status for work orders"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="status-code">Code</Label>
              <Input
                id="status-code"
                value={statusForm.code}
                onChange={(e) => setStatusForm(prev => ({ ...prev, code: e.target.value }))}
                placeholder="e.g. OPEN, COMPLETED"
                className="mt-2"
                data-testid="input-status-code"
                disabled={!!(selectedStatus && isCoreStatus(selectedStatus.code))}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {selectedStatus && isCoreStatus(selectedStatus.code)
                  ? "Core status codes cannot be changed"
                  : "A unique identifier for the status"}
              </p>
            </div>

            <div>
              <Label htmlFor="status-label">Label</Label>
              <Input
                id="status-label"
                value={statusForm.label}
                onChange={(e) => setStatusForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g. Open, Completed"
                className="mt-2"
                data-testid="input-status-label"
              />
              <p className="text-sm text-muted-foreground mt-1">Display name for the status</p>
            </div>

            <div>
              <Label htmlFor="status-color">Color</Label>
              <Select
                value={statusForm.color}
                onValueChange={(value) => setStatusForm(prev => ({ ...prev, color: value }))}
              >
                <SelectTrigger className="mt-2" data-testid="select-status-color">
                  <SelectValue placeholder="Select a color" />
                </SelectTrigger>
                <SelectContent>
                  {statusColors.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: getStatusColorHex(color.value) }} 
                        />
                        {color.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="status-default"
                checked={statusForm.isDefault}
                onCheckedChange={(checked) => setStatusForm(prev => ({ ...prev, isDefault: !!checked }))}
                data-testid="checkbox-status-default"
              />
              <Label htmlFor="status-default" className="cursor-pointer">
                Default status for new work orders
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStatusSubmit}
              disabled={!statusForm.code || !statusForm.label || createStatusMutation.isPending || updateStatusMutation.isPending}
              data-testid="button-save-status"
            >
              {createStatusMutation.isPending || updateStatusMutation.isPending ? "Saving..." : selectedStatus ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteStatusDialogOpen} onOpenChange={setDeleteStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Status</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedStatus?.label}"? This action cannot be undone.
              Work orders with this status may need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedStatus && deleteStatusMutation.mutate(selectedStatus.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-status"
            >
              {deleteStatusMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Trouble Code Create/Edit Dialog */}
      <Dialog open={troubleCodeDialogOpen} onOpenChange={setTroubleCodeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedTroubleCode ? "Edit Trouble Code" : "Create Trouble Code"}</DialogTitle>
            <DialogDescription>
              {selectedTroubleCode ? "Update the trouble code settings" : "Define a new trouble code for work orders"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="trouble-code-code">Code</Label>
              <Input
                id="trouble-code-code"
                value={troubleCodeForm.code}
                onChange={(e) => setTroubleCodeForm(prev => ({ ...prev, code: e.target.value }))}
                placeholder="e.g. DAMAGED, NO_ACCESS"
                className="mt-2"
                data-testid="input-trouble-code-code"
              />
              <p className="text-sm text-muted-foreground mt-1">A unique identifier for the trouble code</p>
            </div>

            <div>
              <Label htmlFor="trouble-code-label">Label</Label>
              <Input
                id="trouble-code-label"
                value={troubleCodeForm.label}
                onChange={(e) => setTroubleCodeForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g. Damaged System, No Access"
                className="mt-2"
                data-testid="input-trouble-code-label"
              />
              <p className="text-sm text-muted-foreground mt-1">Display name for the trouble code</p>
            </div>

            <div>
              <Label htmlFor="trouble-code-description">Description (optional)</Label>
              <Textarea
                id="trouble-code-description"
                value={troubleCodeForm.description}
                onChange={(e) => setTroubleCodeForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe when this trouble code should be used"
                className="mt-2"
                rows={3}
                data-testid="input-trouble-code-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTroubleCodeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleTroubleCodeSubmit}
              disabled={!troubleCodeForm.code || !troubleCodeForm.label || createTroubleCodeMutation.isPending || updateTroubleCodeMutation.isPending}
              data-testid="button-save-trouble-code"
            >
              {createTroubleCodeMutation.isPending || updateTroubleCodeMutation.isPending ? "Saving..." : selectedTroubleCode ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTroubleCodeDialogOpen} onOpenChange={setDeleteTroubleCodeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Trouble Code</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedTroubleCode?.label}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedTroubleCode && deleteTroubleCodeMutation.mutate(selectedTroubleCode.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-trouble-code"
            >
              {deleteTroubleCodeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Group Create/Edit Dialog */}
      <Dialog open={userGroupDialogOpen} onOpenChange={setUserGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedUserGroup ? "Edit User Group" : "Create User Group"}</DialogTitle>
            <DialogDescription>
              {selectedUserGroup ? "Update the group settings" : "Create a new group to organize users for work order assignment"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={userGroupForm.name}
                onChange={(e) => setUserGroupForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Field Technicians, Inspectors"
                className="mt-2"
                data-testid="input-group-name"
              />
            </div>

            <div>
              <Label htmlFor="group-description">Description (optional)</Label>
              <Input
                id="group-description"
                value={userGroupForm.description}
                onChange={(e) => setUserGroupForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of this group"
                className="mt-2"
                data-testid="input-group-description"
              />
            </div>

            <div>
              <Label>Projects <span className="text-destructive">*</span></Label>
              <p className="text-sm text-muted-foreground mt-1 mb-2">
                Select which projects this group can access
              </p>
              <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projectsList && projectsList.length > 0 ? (
                  projectsList.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`group-project-${project.id}`}
                        checked={userGroupForm.projectIds.includes(project.id)}
                        onCheckedChange={(checked) => {
                          setUserGroupForm(prev => ({
                            ...prev,
                            projectIds: checked
                              ? [...prev.projectIds, project.id]
                              : prev.projectIds.filter(id => id !== project.id)
                          }));
                        }}
                        data-testid={`checkbox-group-project-${project.id}`}
                      />
                      <label
                        htmlFor={`group-project-${project.id}`}
                        className="text-sm cursor-pointer"
                      >
                        {project.name}
                      </label>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No projects available</p>
                )}
              </div>
              {userGroupForm.projectIds.length === 0 && (
                <p className="text-sm text-destructive mt-1">At least one project is required</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUserGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUserGroupSubmit}
              disabled={!userGroupForm.name || userGroupForm.projectIds.length === 0 || createUserGroupMutation.isPending || updateUserGroupMutation.isPending}
              data-testid="button-save-user-group"
            >
              {createUserGroupMutation.isPending || updateUserGroupMutation.isPending ? "Saving..." : selectedUserGroup ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Group Delete Dialog */}
      <AlertDialog open={deleteUserGroupDialogOpen} onOpenChange={setDeleteUserGroupDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedUserGroup?.name}"? This action cannot be undone.
              Work orders assigned to this group will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUserGroup && deleteUserGroupMutation.mutate(selectedUserGroup.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-group"
            >
              {deleteUserGroupMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Group Members Dialog */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Group Members</DialogTitle>
            <DialogDescription>
              Add or remove users from "{selectedUserGroup?.name}"
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Add User Section */}
            <div>
              <Label>Add User to Group</Label>
              <div className="flex gap-2 mt-2">
                <Select
                  onValueChange={(userId) => {
                    if (selectedUserGroup) {
                      addUserToGroupMutation.mutate({ groupId: selectedUserGroup.id, userId });
                    }
                  }}
                  disabled={addUserToGroupMutation.isPending}
                >
                  <SelectTrigger className="flex-1" data-testid="select-add-user-to-group">
                    <SelectValue placeholder="Select a user to add" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsersForGroup.length > 0 ? (
                      availableUsersForGroup.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {getUserDisplayName(u)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="_none" disabled>No users available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Current Members Section */}
            <div>
              <Label>Current Members</Label>
              {loadingGroupMembers ? (
                <p className="text-muted-foreground mt-2">Loading...</p>
              ) : groupMembers && groupMembers.length > 0 ? (
                <div className="mt-2 border rounded-md">
                  <Table>
                    <TableBody>
                      {groupMembers.map((member) => (
                        <TableRow key={member.id} data-testid={`row-group-member-${member.id}`}>
                          <TableCell>{getUserDisplayName(member)}</TableCell>
                          <TableCell className="text-muted-foreground">{member.email || "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (selectedUserGroup) {
                                  removeUserFromGroupMutation.mutate({ 
                                    groupId: selectedUserGroup.id, 
                                    userId: member.id 
                                  });
                                }
                              }}
                              disabled={removeUserFromGroupMutation.isPending}
                              data-testid={`button-remove-member-${member.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-muted-foreground mt-2 text-center py-4">No members in this group yet.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service Type Create/Edit Dialog */}
      <Dialog open={serviceTypeDialogOpen} onOpenChange={setServiceTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedServiceType ? "Edit Service Type" : "Create Service Type"}</DialogTitle>
            <DialogDescription>
              {selectedServiceType ? "Update the service type settings" : "Define a new service type for work orders"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="service-type-code">Code</Label>
              <Input
                id="service-type-code"
                value={serviceTypeForm.code}
                onChange={(e) => setServiceTypeForm(prev => ({ ...prev, code: e.target.value }))}
                placeholder="e.g. WATER, ELECTRIC"
                className="mt-2"
                data-testid="input-service-type-code"
              />
              <p className="text-sm text-muted-foreground mt-1">A unique identifier for the service type</p>
            </div>

            <div>
              <Label htmlFor="service-type-label">Label</Label>
              <Input
                id="service-type-label"
                value={serviceTypeForm.label}
                onChange={(e) => setServiceTypeForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g. Water, Electric"
                className="mt-2"
                data-testid="input-service-type-label"
              />
              <p className="text-sm text-muted-foreground mt-1">Display name for the service type</p>
            </div>

            <div>
              <Label htmlFor="service-type-color">Color</Label>
              <Select
                value={serviceTypeForm.color}
                onValueChange={(value) => setServiceTypeForm(prev => ({ ...prev, color: value }))}
              >
                <SelectTrigger className="mt-2" data-testid="select-service-type-color">
                  <SelectValue placeholder="Select a color" />
                </SelectTrigger>
                <SelectContent>
                  {statusColors.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: getStatusColorHex(color.value) }} 
                        />
                        {color.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="service-type-default"
                checked={serviceTypeForm.isDefault}
                onCheckedChange={(checked) => setServiceTypeForm(prev => ({ ...prev, isDefault: !!checked }))}
                data-testid="checkbox-service-type-default"
              />
              <Label htmlFor="service-type-default" className="cursor-pointer">
                Default service type for new work orders
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleServiceTypeSubmit}
              disabled={!serviceTypeForm.code || !serviceTypeForm.label || createServiceTypeMutation.isPending || updateServiceTypeMutation.isPending}
              data-testid="button-save-service-type"
            >
              {createServiceTypeMutation.isPending || updateServiceTypeMutation.isPending ? "Saving..." : selectedServiceType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteServiceTypeDialogOpen} onOpenChange={setDeleteServiceTypeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedServiceType?.label}"? This action cannot be undone.
              Work orders with this service type may need to be updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedServiceType && deleteServiceTypeMutation.mutate(selectedServiceType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-service-type"
            >
              {deleteServiceTypeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* System Type Create/Edit Dialog */}
      <Dialog open={systemTypeDialogOpen} onOpenChange={setSystemTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedSystemType ? "Edit System Type" : "Create System Type"}</DialogTitle>
            <DialogDescription>
              {selectedSystemType ? "Update the system type settings" : "Define a new system type for work orders"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="system-type-product-id">Product ID</Label>
              <Input
                id="system-type-product-id"
                value={systemTypeForm.productId}
                onChange={(e) => setSystemTypeForm(prev => ({ ...prev, productId: e.target.value }))}
                placeholder="e.g. MTR-001"
                className="mt-2"
                data-testid="input-system-type-product-id"
              />
            </div>

            <div>
              <Label htmlFor="system-type-product-label">Product Label</Label>
              <Input
                id="system-type-product-label"
                value={systemTypeForm.productLabel}
                onChange={(e) => setSystemTypeForm(prev => ({ ...prev, productLabel: e.target.value }))}
                placeholder="e.g. Standard Water System"
                className="mt-2"
                data-testid="input-system-type-product-label"
              />
            </div>

            <div>
              <Label htmlFor="system-type-description">Description (optional)</Label>
              <Textarea
                id="system-type-description"
                value={systemTypeForm.productDescription}
                onChange={(e) => setSystemTypeForm(prev => ({ ...prev, productDescription: e.target.value }))}
                placeholder="Brief description of this system type"
                className="mt-2"
                rows={2}
                data-testid="input-system-type-description"
              />
            </div>

            <div>
              <Label>Projects</Label>
              <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projectsList && projectsList.length > 0 ? (
                  projectsList.map((project) => (
                    <div key={project.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`system-type-project-${project.id}`}
                        checked={systemTypeForm.projectIds.includes(project.id)}
                        onCheckedChange={() => toggleSystemTypeProject(project.id)}
                        data-testid={`checkbox-system-type-project-${project.id}`}
                      />
                      <Label htmlFor={`system-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                        {project.name}
                      </Label>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">No projects available</p>
                )}
              </div>
              {systemTypeForm.projectIds.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {systemTypeForm.projectIds.length} project(s)
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSystemTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSystemTypeSubmit}
              disabled={!systemTypeForm.productId || !systemTypeForm.productLabel || createSystemTypeMutation.isPending || updateSystemTypeMutation.isPending}
              data-testid="button-save-system-type"
            >
              {createSystemTypeMutation.isPending || updateSystemTypeMutation.isPending ? "Saving..." : selectedSystemType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteSystemTypeDialogOpen} onOpenChange={setDeleteSystemTypeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete System Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedSystemType?.productLabel}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSystemType && deleteSystemTypeMutation.mutate(selectedSystemType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-system-type"
            >
              {deleteSystemTypeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={copySystemTypeDialogOpen} onOpenChange={setCopySystemTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy System Type</DialogTitle>
            <DialogDescription>
              Copy this system type to additional projects (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Target Projects (optional)</Label>
            <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
              {projectsList && projectsList.length > 0 ? (
                projectsList.map((project) => (
                  <div key={project.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`copy-system-type-project-${project.id}`}
                      checked={copySystemTypeProjectIds.includes(project.id)}
                      onCheckedChange={() => toggleCopySystemTypeProject(project.id)}
                      data-testid={`checkbox-copy-system-type-project-${project.id}`}
                    />
                    <Label htmlFor={`copy-system-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                      {project.name}
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">No projects available</p>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {copySystemTypeProjectIds.length > 0 
                ? `Selected: ${copySystemTypeProjectIds.length} project(s)` 
                : "Leave empty to copy with same project assignments."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopySystemTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedSystemType && copySystemTypeMutation.mutate({ 
                id: selectedSystemType.id, 
                projectIds: copySystemTypeProjectIds.length > 0 ? copySystemTypeProjectIds : undefined 
              })}
              disabled={copySystemTypeMutation.isPending}
              data-testid="button-confirm-copy-system-type"
            >
              {copySystemTypeMutation.isPending ? "Copying..." : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moduleTypeDialogOpen} onOpenChange={setModuleTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedModuleType ? "Edit Module Type" : "Create Module Type"}</DialogTitle>
            <DialogDescription>
              {selectedModuleType ? "Update the module type details." : "Add a new module type to your system."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="module-type-product-id">Product ID</Label>
              <Input
                id="module-type-product-id"
                value={moduleTypeForm.productId}
                onChange={(e) => setModuleTypeForm({ ...moduleTypeForm, productId: e.target.value })}
                placeholder="e.g., MOD-001"
                className="mt-2"
                data-testid="input-module-type-product-id"
              />
            </div>
            <div>
              <Label htmlFor="module-type-product-label">Product Label</Label>
              <Input
                id="module-type-product-label"
                value={moduleTypeForm.productLabel}
                onChange={(e) => setModuleTypeForm({ ...moduleTypeForm, productLabel: e.target.value })}
                placeholder="e.g., Residential Module"
                className="mt-2"
                data-testid="input-module-type-product-label"
              />
            </div>
            <div>
              <Label htmlFor="module-type-description">Description (optional)</Label>
              <Textarea
                id="module-type-description"
                value={moduleTypeForm.productDescription}
                onChange={(e) => setModuleTypeForm({ ...moduleTypeForm, productDescription: e.target.value })}
                placeholder="Optional description..."
                className="mt-2"
                data-testid="input-module-type-description"
              />
            </div>

            <div>
              <Label>Projects</Label>
              <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projectsList && projectsList.length > 0 ? (
                  projectsList.map((project) => (
                    <div key={project.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`module-type-project-${project.id}`}
                        checked={moduleTypeForm.projectIds.includes(project.id)}
                        onCheckedChange={() => toggleModuleTypeProject(project.id)}
                        data-testid={`checkbox-module-type-project-${project.id}`}
                      />
                      <Label htmlFor={`module-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                        {project.name}
                      </Label>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">No projects available</p>
                )}
              </div>
              {moduleTypeForm.projectIds.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {moduleTypeForm.projectIds.length} project(s)
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModuleTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleModuleTypeSubmit}
              disabled={!moduleTypeForm.productId || !moduleTypeForm.productLabel || createModuleTypeMutation.isPending || updateModuleTypeMutation.isPending}
              data-testid="button-save-module-type"
            >
              {createModuleTypeMutation.isPending || updateModuleTypeMutation.isPending ? "Saving..." : selectedModuleType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteModuleTypeDialogOpen} onOpenChange={setDeleteModuleTypeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Module Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedModuleType?.productLabel}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedModuleType && deleteModuleTypeMutation.mutate(selectedModuleType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-module-type"
            >
              {deleteModuleTypeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={copyModuleTypeDialogOpen} onOpenChange={setCopyModuleTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy Module Type</DialogTitle>
            <DialogDescription>
              Copy this module type to additional projects (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Target Projects (optional)</Label>
            <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
              {projectsList && projectsList.length > 0 ? (
                projectsList.map((project) => (
                  <div key={project.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`copy-module-type-project-${project.id}`}
                      checked={copyModuleTypeProjectIds.includes(project.id)}
                      onCheckedChange={() => toggleCopyModuleTypeProject(project.id)}
                      data-testid={`checkbox-copy-module-type-project-${project.id}`}
                    />
                    <Label htmlFor={`copy-module-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                      {project.name}
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">No projects available</p>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {copyModuleTypeProjectIds.length > 0 
                ? `Selected: ${copyModuleTypeProjectIds.length} project(s)` 
                : "Leave empty to copy with same project assignments."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyModuleTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedModuleType && copyModuleTypeMutation.mutate({ 
                id: selectedModuleType.id, 
                projectIds: copyModuleTypeProjectIds.length > 0 ? copyModuleTypeProjectIds : undefined 
              })}
              disabled={copyModuleTypeMutation.isPending}
              data-testid="button-confirm-copy-module-type"
            >
              {copyModuleTypeMutation.isPending ? "Copying..." : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your personal information.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-first-name">First Name</Label>
                <Input
                  id="profile-first-name"
                  value={profileForm.firstName}
                  onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                  placeholder="John"
                  data-testid="input-profile-first-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-last-name">Last Name</Label>
                <Input
                  id="profile-last-name"
                  value={profileForm.lastName}
                  onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                  placeholder="Doe"
                  data-testid="input-profile-last-name"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                placeholder="john.doe@example.com"
                data-testid="input-profile-email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                placeholder="(555) 123-4567"
                data-testid="input-profile-phone"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-address">Address</Label>
              <Input
                id="profile-address"
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                placeholder="123 Main St"
                data-testid="input-profile-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-city">City</Label>
                <Input
                  id="profile-city"
                  value={profileForm.city}
                  onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                  placeholder="Denver"
                  data-testid="input-profile-city"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-state">State</Label>
                <Input
                  id="profile-state"
                  value={profileForm.state}
                  onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })}
                  placeholder="CO"
                  data-testid="input-profile-state"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-zip">Zip</Label>
                <Input
                  id="profile-zip"
                  value={profileForm.zip}
                  onChange={(e) => setProfileForm({ ...profileForm, zip: e.target.value })}
                  placeholder="80202"
                  data-testid="input-profile-zip"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateProfileMutation.mutate(profileForm)}
              disabled={updateProfileMutation.isPending}
              data-testid="button-save-profile"
            >
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
