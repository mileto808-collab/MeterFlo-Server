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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Moon, Sun, User as UserIcon, Shield, FolderOpen, Save, FileUp, Users, Plus, Pencil, Trash2, UsersRound, Clock, Copy, Gauge } from "lucide-react";
import type { Subrole, Permission, WorkOrderStatus, UserGroup, User, TroubleCode, ServiceTypeRecord, MeterType, Project } from "@shared/schema";
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
  const [projectFilesPath, setProjectFilesPath] = useState("");
  const [maxFileSizeMB, setMaxFileSizeMB] = useState("100");
  const [allowedExtensions, setAllowedExtensions] = useState("");
  const [selectedTimezone, setSelectedTimezone] = useState("America/Denver");
  
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
  const [selectedUserGroup, setSelectedUserGroup] = useState<UserGroup | null>(null);
  const [userGroupForm, setUserGroupForm] = useState({
    name: "",
    description: "",
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

  // Meter Types state
  const [meterTypeDialogOpen, setMeterTypeDialogOpen] = useState(false);
  const [deleteMeterTypeDialogOpen, setDeleteMeterTypeDialogOpen] = useState(false);
  const [copyMeterTypeDialogOpen, setCopyMeterTypeDialogOpen] = useState(false);
  const [copyMeterTypeProjectIds, setCopyMeterTypeProjectIds] = useState<number[]>([]);
  const [selectedMeterType, setSelectedMeterType] = useState<MeterType | null>(null);
  const [meterTypeProjectFilter, setMeterTypeProjectFilter] = useState<string>("all");
  const [meterTypeForm, setMeterTypeForm] = useState({
    productId: "",
    productLabel: "",
    productDescription: "",
    projectIds: [] as number[],
  });

  const { data: subroles, isLoading: loadingSubroles } = useQuery<Subrole[]>({
    queryKey: ["/api/subroles"],
    enabled: user?.role === "admin",
  });

  const { data: allPermissions } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
    enabled: user?.role === "admin",
  });

  const { data: selectedSubrolePermissions } = useQuery<string[]>({
    queryKey: ["/api/subroles", selectedSubrole?.id, "permissions"],
    queryFn: async () => {
      if (!selectedSubrole) return [];
      const res = await fetch(`/api/subroles/${selectedSubrole.id}/permissions`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedSubrole && subroleDialogOpen,
  });

  const { data: pathData } = useQuery<{ path: string }>({
    queryKey: ["/api/settings/project-files-path"],
    enabled: user?.role === "admin",
  });

  const { data: fileSettingsData } = useQuery<FileSettings>({
    queryKey: ["/api/settings/file-settings"],
    enabled: user?.role === "admin",
  });

  const { data: timezoneData } = useQuery<{ timezone: string }>({
    queryKey: ["/api/settings/timezone"],
    enabled: user?.role === "admin",
  });

  const { data: workOrderStatusList, isLoading: loadingStatuses } = useQuery<WorkOrderStatus[]>({
    queryKey: ["/api/work-order-statuses"],
    enabled: user?.role === "admin",
  });

  // Trouble Codes query
  const { data: troubleCodesList, isLoading: loadingTroubleCodes } = useQuery<TroubleCode[]>({
    queryKey: ["/api/trouble-codes"],
    enabled: user?.role === "admin",
  });

  // User Groups queries
  const { data: userGroups, isLoading: loadingUserGroups } = useQuery<UserGroup[]>({
    queryKey: ["/api/user-groups"],
    enabled: user?.role === "admin",
  });

  const { data: groupMembers, isLoading: loadingGroupMembers } = useQuery<User[]>({
    queryKey: ["/api/user-groups", selectedUserGroup?.id, "members"],
    queryFn: async () => {
      if (!selectedUserGroup) return [];
      const res = await fetch(`/api/user-groups/${selectedUserGroup.id}/members`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedUserGroup && membersDialogOpen,
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: user?.role === "admin" && membersDialogOpen,
  });

  // Service Types query
  const { data: serviceTypesList, isLoading: loadingServiceTypes } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
    enabled: user?.role === "admin",
  });

  // Meter Types queries
  const { data: meterTypesList, isLoading: loadingMeterTypes } = useQuery<MeterType[]>({
    queryKey: ["/api/meter-types", meterTypeProjectFilter],
    queryFn: async () => {
      const url = meterTypeProjectFilter !== "all" 
        ? `/api/meter-types?projectId=${meterTypeProjectFilter}` 
        : "/api/meter-types";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    enabled: user?.role === "admin",
  });

  const { data: projectsList } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: user?.role === "admin",
  });

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
    mutationFn: async (data: { name: string; description?: string }) => {
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
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; description?: string } }) => {
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

  // Meter Types mutations
  const createMeterTypeMutation = useMutation({
    mutationFn: async (data: { productId: string; productLabel: string; productDescription?: string; projectIds: number[] }) => {
      return apiRequest("POST", "/api/meter-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-types"] });
      toast({ title: "Meter type created successfully" });
      setMeterTypeDialogOpen(false);
      resetMeterTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to create meter type", variant: "destructive" });
    },
  });

  const updateMeterTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { productId?: string; productLabel?: string; productDescription?: string; projectIds?: number[] } }) => {
      return apiRequest("PATCH", `/api/meter-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-types"] });
      toast({ title: "Meter type updated successfully" });
      setMeterTypeDialogOpen(false);
      setSelectedMeterType(null);
      resetMeterTypeForm();
    },
    onError: () => {
      toast({ title: "Failed to update meter type", variant: "destructive" });
    },
  });

  const deleteMeterTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/meter-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-types"] });
      toast({ title: "Meter type deleted successfully" });
      setDeleteMeterTypeDialogOpen(false);
      setSelectedMeterType(null);
    },
    onError: () => {
      toast({ title: "Failed to delete meter type", variant: "destructive" });
    },
  });

  const copyMeterTypeMutation = useMutation({
    mutationFn: async ({ id, projectIds }: { id: number; projectIds?: number[] }) => {
      return apiRequest("POST", `/api/meter-types/${id}/copy`, projectIds && projectIds.length > 0 ? { projectIds } : {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-types"] });
      toast({ title: "Meter type copied successfully" });
      setCopyMeterTypeDialogOpen(false);
      setCopyMeterTypeProjectIds([]);
      setSelectedMeterType(null);
    },
    onError: () => {
      toast({ title: "Failed to copy meter type", variant: "destructive" });
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
    });
  };

  const openCreateUserGroupDialog = () => {
    setSelectedUserGroup(null);
    resetUserGroupForm();
    setUserGroupDialogOpen(true);
  };

  const openEditUserGroupDialog = (group: UserGroup) => {
    setSelectedUserGroup(group);
    setUserGroupForm({
      name: group.name,
      description: group.description || "",
    });
    setUserGroupDialogOpen(true);
  };

  const openMembersDialog = (group: UserGroup) => {
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
        },
      });
    } else {
      createUserGroupMutation.mutate({
        name: userGroupForm.name,
        description: userGroupForm.description || undefined,
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

  // Meter Type helper functions
  const resetMeterTypeForm = () => {
    setMeterTypeForm({
      productId: "",
      productLabel: "",
      productDescription: "",
      projectIds: [],
    });
  };

  const openCreateMeterTypeDialog = () => {
    setSelectedMeterType(null);
    resetMeterTypeForm();
    setMeterTypeDialogOpen(true);
  };

  const openEditMeterTypeDialog = (meterType: MeterType & { projectIds?: number[] }) => {
    setSelectedMeterType(meterType);
    setMeterTypeForm({
      productId: meterType.productId,
      productLabel: meterType.productLabel,
      productDescription: meterType.productDescription || "",
      projectIds: meterType.projectIds || [],
    });
    setMeterTypeDialogOpen(true);
  };

  const handleMeterTypeSubmit = () => {
    if (selectedMeterType) {
      updateMeterTypeMutation.mutate({
        id: selectedMeterType.id,
        data: {
          productId: meterTypeForm.productId,
          productLabel: meterTypeForm.productLabel,
          productDescription: meterTypeForm.productDescription || undefined,
          projectIds: meterTypeForm.projectIds,
        },
      });
    } else {
      createMeterTypeMutation.mutate({
        productId: meterTypeForm.productId,
        productLabel: meterTypeForm.productLabel,
        productDescription: meterTypeForm.productDescription || undefined,
        projectIds: meterTypeForm.projectIds,
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

  const toggleMeterTypeProject = (projectId: number) => {
    setMeterTypeForm(prev => ({
      ...prev,
      projectIds: prev.projectIds.includes(projectId)
        ? prev.projectIds.filter(id => id !== projectId)
        : [...prev.projectIds, projectId],
    }));
  };

  const toggleCopyMeterTypeProject = (projectId: number) => {
    setCopyMeterTypeProjectIds(prev => 
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
    mutationFn: async (timezone: string) => {
      return apiRequest("PUT", "/api/settings/timezone", { timezone });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/timezone"] });
      toast({ title: "Timezone updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update timezone", variant: "destructive" });
    },
  });

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
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.profileImageUrl || undefined} className="object-cover" />
                <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
              </Avatar>
              <div>
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

        {user?.role === "admin" && (
          <>
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

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Timezone</CardTitle>
                </div>
                <CardDescription>Set the timezone used for timestamps in trouble code notes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="timezone">System Timezone</Label>
                  <div className="flex gap-2 mt-2 items-center">
                    <Select
                      value={selectedTimezone}
                      onValueChange={setSelectedTimezone}
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
                    <Button
                      onClick={() => updateTimezoneMutation.mutate(selectedTimezone)}
                      disabled={updateTimezoneMutation.isPending || selectedTimezone === timezoneData?.timezone}
                      data-testid="button-save-timezone"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    This timezone will be used when recording timestamps for trouble codes on work orders.
                  </p>
                </div>
              </CardContent>
            </Card>

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
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userGroups.map((group) => (
                        <TableRow key={group.id} data-testid={`row-user-group-${group.id}`}>
                          <TableCell className="font-medium">{group.name}</TableCell>
                          <TableCell className="text-muted-foreground">{group.description || "—"}</TableCell>
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

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle>Meter Types</CardTitle>
                      <CardDescription className="mt-1">Define meter types for work orders by project</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={meterTypeProjectFilter} onValueChange={setMeterTypeProjectFilter}>
                      <SelectTrigger className="w-48" data-testid="select-meter-type-filter">
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
                    <Button onClick={openCreateMeterTypeDialog} data-testid="button-add-meter-type">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Meter Type
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingMeterTypes ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : meterTypesList && meterTypesList.length > 0 ? (
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
                      {meterTypesList.map((meterType: MeterType & { projectIds?: number[] }) => (
                        <TableRow key={meterType.id} data-testid={`row-meter-type-${meterType.id}`}>
                          <TableCell className="font-medium">{meterType.productId}</TableCell>
                          <TableCell>{meterType.productLabel}</TableCell>
                          <TableCell className="text-muted-foreground">{meterType.productDescription || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(meterType.projectIds && meterType.projectIds.length > 0) ? (
                                meterType.projectIds.map(pId => (
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
                                onClick={() => openEditMeterTypeDialog(meterType)}
                                data-testid={`button-edit-meter-type-${meterType.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedMeterType(meterType);
                                  setCopyMeterTypeProjectIds([]);
                                  setCopyMeterTypeDialogOpen(true);
                                }}
                                data-testid={`button-copy-meter-type-${meterType.id}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => {
                                  setSelectedMeterType(meterType);
                                  setDeleteMeterTypeDialogOpen(true);
                                }}
                                data-testid={`button-delete-meter-type-${meterType.id}`}
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
                  <p className="text-muted-foreground text-center py-4">No meter types defined yet.</p>
                )}
              </CardContent>
            </Card>
          </>
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
              />
              <p className="text-sm text-muted-foreground mt-1">A unique identifier for the status</p>
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
                placeholder="e.g. Damaged Meter, No Access"
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUserGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUserGroupSubmit}
              disabled={!userGroupForm.name || createUserGroupMutation.isPending || updateUserGroupMutation.isPending}
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

      {/* Meter Type Create/Edit Dialog */}
      <Dialog open={meterTypeDialogOpen} onOpenChange={setMeterTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedMeterType ? "Edit Meter Type" : "Create Meter Type"}</DialogTitle>
            <DialogDescription>
              {selectedMeterType ? "Update the meter type settings" : "Define a new meter type for work orders"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="meter-type-product-id">Product ID</Label>
              <Input
                id="meter-type-product-id"
                value={meterTypeForm.productId}
                onChange={(e) => setMeterTypeForm(prev => ({ ...prev, productId: e.target.value }))}
                placeholder="e.g. MTR-001"
                className="mt-2"
                data-testid="input-meter-type-product-id"
              />
            </div>

            <div>
              <Label htmlFor="meter-type-product-label">Product Label</Label>
              <Input
                id="meter-type-product-label"
                value={meterTypeForm.productLabel}
                onChange={(e) => setMeterTypeForm(prev => ({ ...prev, productLabel: e.target.value }))}
                placeholder="e.g. Standard Water Meter"
                className="mt-2"
                data-testid="input-meter-type-product-label"
              />
            </div>

            <div>
              <Label htmlFor="meter-type-description">Description (optional)</Label>
              <Textarea
                id="meter-type-description"
                value={meterTypeForm.productDescription}
                onChange={(e) => setMeterTypeForm(prev => ({ ...prev, productDescription: e.target.value }))}
                placeholder="Brief description of this meter type"
                className="mt-2"
                rows={2}
                data-testid="input-meter-type-description"
              />
            </div>

            <div>
              <Label>Projects</Label>
              <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projectsList && projectsList.length > 0 ? (
                  projectsList.map((project) => (
                    <div key={project.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`meter-type-project-${project.id}`}
                        checked={meterTypeForm.projectIds.includes(project.id)}
                        onCheckedChange={() => toggleMeterTypeProject(project.id)}
                        data-testid={`checkbox-meter-type-project-${project.id}`}
                      />
                      <Label htmlFor={`meter-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                        {project.name}
                      </Label>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">No projects available</p>
                )}
              </div>
              {meterTypeForm.projectIds.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {meterTypeForm.projectIds.length} project(s)
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMeterTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMeterTypeSubmit}
              disabled={!meterTypeForm.productId || !meterTypeForm.productLabel || createMeterTypeMutation.isPending || updateMeterTypeMutation.isPending}
              data-testid="button-save-meter-type"
            >
              {createMeterTypeMutation.isPending || updateMeterTypeMutation.isPending ? "Saving..." : selectedMeterType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteMeterTypeDialogOpen} onOpenChange={setDeleteMeterTypeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Meter Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedMeterType?.productLabel}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedMeterType && deleteMeterTypeMutation.mutate(selectedMeterType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-meter-type"
            >
              {deleteMeterTypeMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={copyMeterTypeDialogOpen} onOpenChange={setCopyMeterTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy Meter Type</DialogTitle>
            <DialogDescription>
              Copy this meter type to additional projects (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Target Projects (optional)</Label>
            <div className="mt-2 border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
              {projectsList && projectsList.length > 0 ? (
                projectsList.map((project) => (
                  <div key={project.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`copy-meter-type-project-${project.id}`}
                      checked={copyMeterTypeProjectIds.includes(project.id)}
                      onCheckedChange={() => toggleCopyMeterTypeProject(project.id)}
                      data-testid={`checkbox-copy-meter-type-project-${project.id}`}
                    />
                    <Label htmlFor={`copy-meter-type-project-${project.id}`} className="text-sm font-normal cursor-pointer">
                      {project.name}
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">No projects available</p>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {copyMeterTypeProjectIds.length > 0 
                ? `Selected: ${copyMeterTypeProjectIds.length} project(s)` 
                : "Leave empty to copy with same project assignments."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyMeterTypeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedMeterType && copyMeterTypeMutation.mutate({ 
                id: selectedMeterType.id, 
                projectIds: copyMeterTypeProjectIds.length > 0 ? copyMeterTypeProjectIds : undefined 
              })}
              disabled={copyMeterTypeMutation.isPending}
              data-testid="button-confirm-copy-meter-type"
            >
              {copyMeterTypeMutation.isPending ? "Copying..." : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
