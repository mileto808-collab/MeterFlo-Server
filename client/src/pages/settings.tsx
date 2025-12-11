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
import { Moon, Sun, User, Shield, FolderOpen, Save, FileUp, Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { Subrole, Permission, WorkOrderStatus } from "@shared/schema";

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
  
  const [subroleDialogOpen, setSubroleDialogOpen] = useState(false);
  const [deleteSubroleDialogOpen, setDeleteSubroleDialogOpen] = useState(false);
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

  const { data: workOrderStatusList, isLoading: loadingStatuses } = useQuery<WorkOrderStatus[]>({
    queryKey: ["/api/work-order-statuses"],
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
              <User className="h-5 w-5 text-muted-foreground" />
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
    </div>
  );
}
