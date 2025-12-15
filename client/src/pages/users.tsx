import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnSelector, type ColumnConfig } from "@/components/column-selector";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { FilterSelector, type FilterConfig } from "@/components/filter-selector";
import { useFilterPreferences } from "@/hooks/use-filter-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { User, Project, Subrole } from "@shared/schema";
import { Search, Users as UsersIcon, Plus, MoreHorizontal, Pencil, Lock, Unlock, Key, Trash2, FolderPlus, X, Folder, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { format } from "date-fns";

type UserWithProjects = User & { assignedProjects?: Project[] };

const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(100),
  password: z.string().min(8, "Password must be at least 8 characters").regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain uppercase, lowercase, and a number"
  ),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  role: z.enum(["admin", "user", "customer"]),
  subroleId: z.number().nullable().optional(),
  address: z.string().max(255).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  website: z.string().max(255).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

const editUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(100),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  role: z.enum(["admin", "user", "customer"]),
  subroleId: z.number().nullable().optional(),
  address: z.string().max(255).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  website: z.string().max(255).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters").regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain uppercase, lowercase, and a number"
  ),
  confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type CreateUserForm = z.infer<typeof createUserSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

type SortField = "name" | "email" | "role" | "status" | "createdAt";
type SortOrder = "asc" | "desc";

export default function Users() {
  const { toast } = useToast();
  const { formatDateTime, formatCustom } = useTimezone();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subroleFilter, setSubroleFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [assignProjectDialogOpen, setAssignProjectDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [lockReason, setLockReason] = useState("");

  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: subroles } = useQuery<Subrole[]>({ queryKey: ["/api/subroles"] });

  // Column configuration for the users table
  const userColumns: ColumnConfig[] = useMemo(() => [
    { key: "user", label: "User", required: true },
    { key: "username", label: "Username" },
    { key: "email", label: "Email" },
    { key: "firstName", label: "First Name" },
    { key: "lastName", label: "Last Name" },
    { key: "role", label: "Role" },
    { key: "accessLevel", label: "Access Level" },
    { key: "projects", label: "Projects" },
    { key: "status", label: "Status" },
    { key: "isLocked", label: "Is Locked" },
    { key: "lockedReason", label: "Locked Reason" },
    { key: "lastLogin", label: "Last Login" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "ZIP" },
    { key: "phone", label: "Phone" },
    { key: "website", label: "Website" },
  ], []);

  const { visibleColumns, setVisibleColumns, isColumnVisible, isLoading: columnPrefsLoading } = useColumnPreferences("users", userColumns);

  // Filter configuration - only includes filters that have actual UI controls
  const userFilters: FilterConfig[] = useMemo(() => [
    { key: "searchQuery", label: "Search Text" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
    { key: "subrole", label: "Access Level" },
  ], []);

  const { visibleFilters, setVisibleFilters, isFilterVisible, isLoading: filterPrefsLoading } = useFilterPreferences("users", userFilters);
  
  // Fetch assigned projects for selected user
  const { data: selectedUserProjects, isLoading: loadingUserProjects } = useQuery<Project[]>({
    queryKey: ["/api/users", selectedUser?.id, "projects"],
    queryFn: async () => {
      if (!selectedUser) return [];
      const res = await fetch(`/api/users/${selectedUser.id}/projects`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user projects");
      return res.json();
    },
    enabled: !!selectedUser && assignProjectDialogOpen,
  });

  // Fetch all user project assignments for the table display
  const { data: allUsersProjects } = useQuery({
    queryKey: ["/api/users/all-projects"],
    queryFn: async () => {
      if (!users) return {};
      const map: Record<string, Project[]> = {};
      for (const user of users) {
        try {
          const res = await fetch(`/api/users/${user.id}/projects`, { credentials: "include" });
          if (res.ok) {
            map[user.id] = await res.json();
          }
        } catch {
          map[user.id] = [];
        }
      }
      return map;
    },
    enabled: !!users && users.length > 0,
  });

  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: "", password: "", firstName: "", lastName: "", email: "", role: "user", subroleId: null, address: "", city: "", state: "", zip: "", phone: "", website: "", notes: "" },
  });

  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { username: "", firstName: "", lastName: "", email: "", role: "user", subroleId: null, address: "", city: "", state: "", zip: "", phone: "", website: "", notes: "" },
  });

  const resetPasswordForm = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: CreateUserForm) => {
      const payload = { ...data, email: data.email || null };
      await apiRequest("POST", "/api/users", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User created successfully" });
      setIsCreatingUser(false);
      createForm.reset();
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Session expired. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message || "Failed to create user", variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: EditUserForm }) => {
      const payload = { ...data, email: data.email || null };
      await apiRequest("PATCH", `/api/users/${userId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      setEditingUser(null);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Session expired", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message || "Failed to update user", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      await apiRequest("POST", `/api/users/${userId}/reset-password`, { newPassword });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Password reset successfully" });
      setResetPasswordDialogOpen(false);
      setSelectedUser(null);
      resetPasswordForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to reset password", variant: "destructive" });
    },
  });

  const lockUserMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      await apiRequest("POST", `/api/users/${userId}/lock`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User locked successfully" });
      setLockDialogOpen(false);
      setSelectedUser(null);
      setLockReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to lock user", variant: "destructive" });
    },
  });

  const unlockUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/users/${userId}/unlock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User unlocked successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to unlock user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "User deleted successfully" });
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete user", variant: "destructive" });
    },
  });

  const assignProjectMutation = useMutation({
    mutationFn: async ({ userId, projectId }: { userId: string; projectId: number }) => {
      await apiRequest("POST", `/api/users/${userId}/projects`, { projectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/all-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", selectedUser?.id, "projects"] });
      toast({ title: "Success", description: "Project assigned successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to assign project", variant: "destructive" });
    },
  });

  const removeProjectMutation = useMutation({
    mutationFn: async ({ userId, projectId }: { userId: string; projectId: number }) => {
      await apiRequest("DELETE", `/api/users/${userId}/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/all-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", selectedUser?.id, "projects"] });
      toast({ title: "Success", description: "User removed from project" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove from project", variant: "destructive" });
    },
  });

  // Filter users based on search and filter criteria
  const filteredUsers = users?.filter((u) => {
    // Text search filter - includes new contact fields
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = searchQuery === "" || 
      (u.email || "").toLowerCase().includes(searchLower) ||
      (u.firstName || "").toLowerCase().includes(searchLower) ||
      (u.lastName || "").toLowerCase().includes(searchLower) ||
      (u.username || "").toLowerCase().includes(searchLower) ||
      (u.address || "").toLowerCase().includes(searchLower) ||
      (u.city || "").toLowerCase().includes(searchLower) ||
      (u.state || "").toLowerCase().includes(searchLower) ||
      (u.zip || "").toLowerCase().includes(searchLower) ||
      (u.phone || "").toLowerCase().includes(searchLower) ||
      (u.website || "").toLowerCase().includes(searchLower);
    
    // Role filter
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    
    // Status filter
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "active" && !u.isLocked) ||
      (statusFilter === "locked" && u.isLocked);
    
    // Subrole/Access level filter
    const matchesSubrole = subroleFilter === "all" || 
      (subroleFilter === "none" && !u.subroleId) ||
      (u.subroleId && String(u.subroleId) === subroleFilter);
    
    return matchesSearch && matchesRole && matchesStatus && matchesSubrole;
  }).sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case "name":
        const nameA = (a.firstName && a.lastName) ? `${a.firstName} ${a.lastName}` : (a.username || "");
        const nameB = (b.firstName && b.lastName) ? `${b.firstName} ${b.lastName}` : (b.username || "");
        comparison = nameA.localeCompare(nameB);
        break;
      case "email":
        comparison = (a.email || "").localeCompare(b.email || "");
        break;
      case "role":
        comparison = (a.role || "").localeCompare(b.role || "");
        break;
      case "status":
        comparison = (a.isLocked ? 1 : 0) - (b.isLocked ? 1 : 0);
        break;
      case "createdAt":
        comparison = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        break;
    }
    
    return sortOrder === "asc" ? comparison : -comparison;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1" />;
    }
    return sortOrder === "asc" ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
    setSubroleFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || roleFilter !== "all" || statusFilter !== "all" || subroleFilter !== "all";

  const getInitials = (user: User) => {
    if (user.firstName && user.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    if (user.username) return user.username[0].toUpperCase();
    if (user.email) return user.email[0].toUpperCase();
    return "U";
  };

  const getRoleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
    switch (role) {
      case "admin": return "default";
      case "customer": return "secondary";
      default: return "outline";
    }
  };

  const handleEditUser = (user: User) => {
    editForm.reset({
      username: user.username || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      role: (user.role as "admin" | "user" | "customer") || "user",
      subroleId: user.subroleId ?? null,
      address: user.address || "",
      city: user.city || "",
      state: user.state || "",
      zip: user.zip || "",
      phone: user.phone || "",
      website: user.website || "",
      notes: user.notes || "",
    });
    setEditingUser(user);
  };

  const handleResetPassword = (user: User) => {
    setSelectedUser(user);
    resetPasswordForm.reset();
    setResetPasswordDialogOpen(true);
  };

  const handleLockUser = (user: User) => {
    setSelectedUser(user);
    setLockReason("");
    setLockDialogOpen(true);
  };

  const handleDeleteUser = (user: User) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const handleAssignProject = (user: User) => {
    setSelectedUser(user);
    setAssignProjectDialogOpen(true);
  };

  if (isCreatingUser) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => {
              setIsCreatingUser(false);
              createForm.reset();
            }} 
            className="mb-4"
            data-testid="button-back-to-users"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
          <h1 className="text-3xl font-bold" data-testid="text-create-user-title">Add New User</h1>
          <p className="text-muted-foreground mt-1">Create a new user account</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((data) => createUserMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={createForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="johndoe" data-testid="input-create-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} placeholder="Min 8 characters" data-testid="input-create-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="John" data-testid="input-create-firstname" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Doe" data-testid="input-create-lastname" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={createForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email (optional)</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} placeholder="john@example.com" data-testid="input-create-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select 
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value === "admin") {
                            createForm.setValue("subroleId", null);
                          }
                        }} 
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-create-role">
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(createForm.watch("role") === "user" || createForm.watch("role") === "customer") && (
                  <FormField
                    control={createForm.control}
                    name="subroleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Access Level</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} 
                          value={field.value?.toString() || "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-create-subrole">
                              <SelectValue placeholder="Select access level" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No Access Level ({createForm.watch("role") === "customer" ? "Read Only" : "View Only"})</SelectItem>
                            {subroles?.filter(s => s.baseRole === createForm.watch("role")).map((subrole) => (
                              <SelectItem key={subrole.id} value={subrole.id.toString()}>
                                {subrole.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {field.value 
                            ? subroles?.find(s => s.id === field.value)?.description 
                            : createForm.watch("role") === "customer" 
                              ? "Read-only access to completed work orders in assigned projects"
                              : "Basic view-only access to assigned projects"}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium mb-3">Contact Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={createForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="(555) 123-4567" data-testid="input-create-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Website</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="https://example.com" data-testid="input-create-website" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="123 Main Street" data-testid="input-create-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={createForm.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Anytown" data-testid="input-create-city" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="CA" data-testid="input-create-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zip</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="12345" data-testid="input-create-zip" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={createForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea {...field} placeholder="Additional notes about this user..." rows={3} data-testid="input-create-notes" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => {
                    setIsCreatingUser(false);
                    createForm.reset();
                  }}>Cancel</Button>
                  <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit-create">
                    {createUserMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (editingUser) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => setEditingUser(null)} 
            className="mb-4"
            data-testid="button-back-to-users"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
          <h1 className="text-3xl font-bold" data-testid="text-edit-user-title">Edit User</h1>
          <p className="text-muted-foreground mt-1">
            Update information for {editingUser.firstName && editingUser.lastName 
              ? `${editingUser.firstName} ${editingUser.lastName}` 
              : editingUser.username || editingUser.email}
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit((data) => updateUserMutation.mutate({ userId: editingUser.id, data }))} className="space-y-4">
                <FormField
                  control={editForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} data-testid="input-edit-firstname" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} data-testid="input-edit-lastname" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={editForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} value={field.value || ""} data-testid="input-edit-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={(value) => {
                        field.onChange(value);
                        if (value === "admin") {
                          editForm.setValue("subroleId", null);
                        }
                      }} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-role">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(editForm.watch("role") === "user" || editForm.watch("role") === "customer") && (
                  <FormField
                    control={editForm.control}
                    name="subroleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Access Level</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} 
                          value={field.value?.toString() || "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-subrole">
                              <SelectValue placeholder="Select access level" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No Access Level ({editForm.watch("role") === "customer" ? "Read Only" : "View Only"})</SelectItem>
                            {subroles?.filter(s => s.baseRole === editForm.watch("role")).map((subrole) => (
                              <SelectItem key={subrole.id} value={subrole.id.toString()}>
                                {subrole.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {field.value 
                            ? subroles?.find(s => s.id === field.value)?.description 
                            : editForm.watch("role") === "customer" 
                              ? "Read-only access to completed work orders in assigned projects"
                              : "Basic view-only access to assigned projects"}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium mb-3">Contact Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={editForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="(555) 123-4567" data-testid="input-edit-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Website</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="https://example.com" data-testid="input-edit-website" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="123 Main Street" data-testid="input-edit-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={editForm.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="Anytown" data-testid="input-edit-city" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={editForm.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="CA" data-testid="input-edit-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={editForm.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zip</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="12345" data-testid="input-edit-zip" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={editForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea {...field} value={field.value || ""} placeholder="Additional notes about this user..." rows={3} data-testid="input-edit-notes" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                  <Button type="submit" disabled={updateUserMutation.isPending} data-testid="button-submit-edit">
                    {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-users-title">Users</h1>
          <p className="text-muted-foreground mt-1">Manage user accounts and permissions</p>
        </div>
        <Button onClick={() => setIsCreatingUser(true)} data-testid="button-create-user">
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {isFilterVisible("searchQuery") && (
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-users" />
              </div>
            )}
            {isFilterVisible("role") && (
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-filter-role">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                </SelectContent>
              </Select>
            )}
            {isFilterVisible("status") && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            )}
            {isFilterVisible("subrole") && (
              <Select value={subroleFilter} onValueChange={setSubroleFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-filter-subrole">
                  <SelectValue placeholder="All Access Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Access Levels</SelectItem>
                  <SelectItem value="none">No Access Level</SelectItem>
                  {subroles?.map((subrole) => (
                    <SelectItem key={subrole.id} value={String(subrole.id)}>
                      {subrole.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
            <div className="flex-1" />
            <FilterSelector
              allFilters={userFilters}
              visibleFilters={visibleFilters}
              onChange={setVisibleFilters}
              disabled={filterPrefsLoading}
            />
            <ColumnSelector
              allColumns={userColumns}
              visibleColumns={visibleColumns}
              onChange={setVisibleColumns}
              disabled={columnPrefsLoading}
            />
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span>Showing {filteredUsers?.length || 0} of {users?.length || 0} users</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border rounded-md">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredUsers && filteredUsers.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isColumnVisible("user") && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center p-0 h-auto hover:bg-transparent"
                          onClick={() => handleSort("name")}
                          data-testid="sort-name"
                        >
                          User
                          {getSortIcon("name")}
                        </Button>
                      </TableHead>
                    )}
                    {isColumnVisible("email") && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center p-0 h-auto hover:bg-transparent"
                          onClick={() => handleSort("email")}
                          data-testid="sort-email"
                        >
                          Email
                          {getSortIcon("email")}
                        </Button>
                      </TableHead>
                    )}
                    {isColumnVisible("username") && <TableHead>Username</TableHead>}
                    {isColumnVisible("firstName") && <TableHead>First Name</TableHead>}
                    {isColumnVisible("lastName") && <TableHead>Last Name</TableHead>}
                    {isColumnVisible("role") && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center p-0 h-auto hover:bg-transparent"
                          onClick={() => handleSort("role")}
                          data-testid="sort-role"
                        >
                          Role
                          {getSortIcon("role")}
                        </Button>
                      </TableHead>
                    )}
                    {isColumnVisible("accessLevel") && <TableHead>Access Level</TableHead>}
                    {isColumnVisible("projects") && <TableHead>Projects</TableHead>}
                    {isColumnVisible("status") && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center p-0 h-auto hover:bg-transparent"
                          onClick={() => handleSort("status")}
                          data-testid="sort-status"
                        >
                          Status
                          {getSortIcon("status")}
                        </Button>
                      </TableHead>
                    )}
                    {isColumnVisible("createdAt") && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center p-0 h-auto hover:bg-transparent"
                          onClick={() => handleSort("createdAt")}
                          data-testid="sort-joined"
                        >
                          Joined
                          {getSortIcon("createdAt")}
                        </Button>
                      </TableHead>
                    )}
                    {isColumnVisible("isLocked") && <TableHead>Is Locked</TableHead>}
                    {isColumnVisible("lockedReason") && <TableHead>Locked Reason</TableHead>}
                    {isColumnVisible("lastLogin") && <TableHead>Last Login</TableHead>}
                    {isColumnVisible("address") && <TableHead>Address</TableHead>}
                    {isColumnVisible("city") && <TableHead>City</TableHead>}
                    {isColumnVisible("state") && <TableHead>State</TableHead>}
                    {isColumnVisible("zip") && <TableHead>ZIP</TableHead>}
                    {isColumnVisible("phone") && <TableHead>Phone</TableHead>}
                    {isColumnVisible("website") && <TableHead>Website</TableHead>}
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      {isColumnVisible("user") && (
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={user.profileImageUrl || undefined} className="object-cover" />
                              <AvatarFallback>{getInitials(user)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <span className="font-medium block">
                                {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.username || "Unknown"}
                              </span>
                              {user.username && (
                                <span className="text-sm text-muted-foreground">@{user.username}</span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      )}
                      {isColumnVisible("email") && (
                        <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                      )}
                      {isColumnVisible("username") && (
                        <TableCell>{user.username || "—"}</TableCell>
                      )}
                      {isColumnVisible("firstName") && (
                        <TableCell>{user.firstName || "—"}</TableCell>
                      )}
                      {isColumnVisible("lastName") && (
                        <TableCell>{user.lastName || "—"}</TableCell>
                      )}
                      {isColumnVisible("role") && (
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(user.role)} data-testid={`badge-role-${user.id}`}>
                            {user.role}
                          </Badge>
                        </TableCell>
                      )}
                      {isColumnVisible("accessLevel") && (
                        <TableCell data-testid={`cell-access-level-${user.id}`}>
                          {(user.role === "user" || user.role === "customer") && user.subroleId ? (
                            <Badge variant="outline" className="capitalize">
                              {subroles?.find(s => s.id === user.subroleId)?.label || "—"}
                            </Badge>
                          ) : user.role === "admin" ? (
                            <span className="text-muted-foreground text-sm">Full Access</span>
                          ) : user.role === "customer" ? (
                            <span className="text-muted-foreground text-sm">Read Only</span>
                          ) : user.role === "user" ? (
                            <span className="text-muted-foreground text-sm">View Only</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      )}
                      {isColumnVisible("projects") && (
                        <TableCell data-testid={`cell-projects-${user.id}`}>
                          {allUsersProjects && allUsersProjects[user.id]?.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {allUsersProjects[user.id].slice(0, 3).map((project) => (
                                <Badge 
                                  key={project.id} 
                                  variant="secondary" 
                                  className="text-xs"
                                  data-testid={`badge-project-${user.id}-${project.id}`}
                                >
                                  {project.name}
                                </Badge>
                              ))}
                              {allUsersProjects[user.id].length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{allUsersProjects[user.id].length - 3} more
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                      )}
                      {isColumnVisible("status") && (
                        <TableCell>
                          {user.isLocked ? (
                            <Badge variant="destructive" data-testid={`badge-status-${user.id}`}>
                              <Lock className="h-3 w-3 mr-1" />
                              Locked
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-600" data-testid={`badge-status-${user.id}`}>
                              Active
                            </Badge>
                          )}
                        </TableCell>
                      )}
                      {isColumnVisible("createdAt") && (
                        <TableCell>{user.createdAt ? formatCustom(user.createdAt, "MMM d, yyyy") : "—"}</TableCell>
                      )}
                      {isColumnVisible("isLocked") && (
                        <TableCell>{user.isLocked ? "Yes" : "No"}</TableCell>
                      )}
                      {isColumnVisible("lockedReason") && (
                        <TableCell className="max-w-xs truncate">{user.lockedReason || "—"}</TableCell>
                      )}
                      {isColumnVisible("lastLogin") && (
                        <TableCell>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</TableCell>
                      )}
                      {isColumnVisible("address") && (
                        <TableCell className="max-w-xs truncate">{user.address || "—"}</TableCell>
                      )}
                      {isColumnVisible("city") && (
                        <TableCell>{user.city || "—"}</TableCell>
                      )}
                      {isColumnVisible("state") && (
                        <TableCell>{user.state || "—"}</TableCell>
                      )}
                      {isColumnVisible("zip") && (
                        <TableCell>{user.zip || "—"}</TableCell>
                      )}
                      {isColumnVisible("phone") && (
                        <TableCell>{user.phone || "—"}</TableCell>
                      )}
                      {isColumnVisible("website") && (
                        <TableCell>{user.website || "—"}</TableCell>
                      )}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-actions-${user.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditUser(user)} data-testid={`menu-edit-${user.id}`}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetPassword(user)} data-testid={`menu-reset-password-${user.id}`}>
                              <Key className="h-4 w-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAssignProject(user)} data-testid={`menu-assign-project-${user.id}`}>
                              <FolderPlus className="h-4 w-4 mr-2" />
                              Assign Projects
                            </DropdownMenuItem>
                            {user.isLocked ? (
                              <DropdownMenuItem onClick={() => unlockUserMutation.mutate(user.id)} data-testid={`menu-unlock-${user.id}`}>
                                <Unlock className="h-4 w-4 mr-2" />
                                Unlock User
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleLockUser(user)} data-testid={`menu-lock-${user.id}`}>
                                <Lock className="h-4 w-4 mr-2" />
                                Lock User
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleDeleteUser(user)} className="text-destructive" data-testid={`menu-delete-${user.id}`}>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <UsersIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-1">No users found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery ? "Try adjusting your search" : "Get started by adding your first user"}
              </p>
              {!searchQuery && (
                <Button onClick={() => setIsCreatingUser(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for {selectedUser?.username || selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <Form {...resetPasswordForm}>
            <form onSubmit={resetPasswordForm.handleSubmit((data) => selectedUser && resetPasswordMutation.mutate({ userId: selectedUser.id, newPassword: data.newPassword }))} className="space-y-4">
              <FormField
                control={resetPasswordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Min 6 characters" {...field} data-testid="input-new-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Confirm password" {...field} data-testid="input-confirm-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={resetPasswordMutation.isPending} data-testid="button-submit-reset-password">
                  {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Lock User Dialog */}
      <AlertDialog open={lockDialogOpen} onOpenChange={setLockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock User Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to lock {selectedUser?.username || selectedUser?.email}? They will not be able to log in until unlocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Input 
              value={lockReason} 
              onChange={(e) => setLockReason(e.target.value)} 
              placeholder="Enter reason for locking..."
              className="mt-2"
              data-testid="input-lock-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUser && lockUserMutation.mutate({ userId: selectedUser.id, reason: lockReason || undefined })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-lock"
            >
              Lock User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete User Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedUser?.username || selectedUser?.email}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUser && deleteUserMutation.mutate(selectedUser.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Projects Dialog */}
      <Dialog open={assignProjectDialogOpen} onOpenChange={setAssignProjectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Project Assignments</DialogTitle>
            <DialogDescription>Manage project access for {selectedUser?.username || selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Current Assignments */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Assigned Projects
              </h4>
              {loadingUserProjects ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : selectedUserProjects && selectedUserProjects.length > 0 ? (
                <div className="space-y-2">
                  {selectedUserProjects.map((project) => (
                    <div 
                      key={project.id} 
                      className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/50"
                      data-testid={`assigned-project-${project.id}`}
                    >
                      <span className="font-medium">{project.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive h-7"
                        onClick={() => selectedUser && removeProjectMutation.mutate({ userId: selectedUser.id, projectId: project.id })}
                        disabled={removeProjectMutation.isPending}
                        data-testid={`button-remove-project-${project.id}`}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-2">No projects assigned</p>
              )}
            </div>

            {/* Available Projects to Assign */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <FolderPlus className="h-4 w-4" />
                Available Projects
              </h4>
              {projects && projects.length > 0 ? (
                <div className="space-y-2">
                  {projects
                    .filter((p) => !selectedUserProjects?.some((up) => up.id === p.id))
                    .map((project) => (
                      <div 
                        key={project.id} 
                        className="flex items-center justify-between gap-3 p-2 rounded-md border"
                        data-testid={`available-project-${project.id}`}
                      >
                        <span className="font-medium">{project.name}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => selectedUser && assignProjectMutation.mutate({ userId: selectedUser.id, projectId: project.id })}
                          disabled={assignProjectMutation.isPending}
                          data-testid={`button-assign-project-${project.id}`}
                        >
                          <FolderPlus className="h-4 w-4 mr-1" />
                          Assign
                        </Button>
                      </div>
                    ))}
                  {projects.filter((p) => !selectedUserProjects?.some((up) => up.id === p.id)).length === 0 && (
                    <p className="text-muted-foreground text-sm py-2">All projects are assigned</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-2">No projects available</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignProjectDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
