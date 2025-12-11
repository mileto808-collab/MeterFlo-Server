import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardList, Trash2, ShieldAlert, Folder, Pencil, Upload, ArrowLeft, Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Project, WorkOrderStatus } from "@shared/schema";
import { insertProjectWorkOrderSchema, serviceTypeEnum } from "@shared/schema";
import type { ProjectWorkOrder } from "../../../server/projectDb";

const workOrderFormSchema = insertProjectWorkOrderSchema.extend({
  email: z.string().optional().nullable().or(z.literal("")),
});

type WorkOrderFormData = z.infer<typeof workOrderFormSchema>;

export default function ProjectWorkOrders() {
  const [, params] = useRoute("/projects/:projectId/work-orders");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<ProjectWorkOrder | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const form = useForm<WorkOrderFormData>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: {
      customerWoId: "",
      customerId: "",
      customerName: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      email: "",
      route: "",
      zone: "",
      serviceType: "Water",
      oldMeterId: "",
      oldMeterReading: undefined,
      newMeterId: "",
      newMeterReading: undefined,
      oldGps: "",
      newGps: "",
      notes: "",
    },
  });

  const editForm = useForm<WorkOrderFormData>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: {
      customerWoId: "",
      customerId: "",
      customerName: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      email: "",
      route: "",
      zone: "",
      serviceType: "Water",
      oldMeterId: "",
      oldMeterReading: undefined,
      newMeterId: "",
      newMeterReading: undefined,
      oldGps: "",
      newGps: "",
      notes: "",
      status: "Open",
    },
  });

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: workOrders = [], isLoading: workOrdersLoading, error: workOrdersError } = useQuery<ProjectWorkOrder[]>({
    queryKey: [`/api/projects/${projectId}/work-orders`],
    enabled: !!projectId && !accessDenied,
    retry: false,
  });

  const { data: stats, error: statsError } = useQuery<{ open: number; completed: number; scheduled: number; skipped: number; total: number }>({
    queryKey: [`/api/projects/${projectId}/work-orders/stats`],
    enabled: !!projectId && !accessDenied,
    retry: false,
  });

  const { data: workOrderStatuses = [] } = useQuery<WorkOrderStatus[]>({
    queryKey: ["/api/work-order-statuses"],
  });

  useEffect(() => {
    const error = projectError || workOrdersError || statsError;
    if (error) {
      const errorMsg = (error as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
      }
    }
  }, [projectError, workOrdersError, statsError]);

  useEffect(() => {
    if (editingWorkOrder) {
      editForm.reset({
        customerWoId: editingWorkOrder.customerWoId || "",
        customerId: editingWorkOrder.customerId || "",
        customerName: editingWorkOrder.customerName || "",
        address: editingWorkOrder.address || "",
        city: editingWorkOrder.city || "",
        state: editingWorkOrder.state || "",
        zip: editingWorkOrder.zip || "",
        phone: editingWorkOrder.phone || "",
        email: editingWorkOrder.email || "",
        route: editingWorkOrder.route || "",
        zone: editingWorkOrder.zone || "",
        serviceType: (editingWorkOrder.serviceType as any) || "Water",
        oldMeterId: editingWorkOrder.oldMeterId || "",
        oldMeterReading: editingWorkOrder.oldMeterReading ?? undefined,
        newMeterId: editingWorkOrder.newMeterId || "",
        newMeterReading: editingWorkOrder.newMeterReading ?? undefined,
        oldGps: editingWorkOrder.oldGps || "",
        newGps: editingWorkOrder.newGps || "",
        notes: editingWorkOrder.notes || "",
        status: editingWorkOrder.status || "Open",
      });
    }
  }, [editingWorkOrder, editForm]);

  const normalizeOptionalFields = (data: WorkOrderFormData) => ({
    ...data,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    phone: data.phone || null,
    email: data.email || null,
    route: data.route || null,
    zone: data.zone || null,
    oldMeterId: data.oldMeterId || null,
    oldMeterReading: data.oldMeterReading ?? null,
    newMeterId: data.newMeterId || null,
    newMeterReading: data.newMeterReading ?? null,
    oldGps: data.oldGps || null,
    newGps: data.newGps || null,
    notes: data.notes || null,
  });

  const createMutation = useMutation({
    mutationFn: async (data: WorkOrderFormData) => {
      if (accessDenied) throw new Error("403: Access denied");
      const defaultStatus = workOrderStatuses.find(s => s.isDefault)?.code || "Open";
      return apiRequest("POST", `/api/projects/${projectId}/work-orders`, {
        ...normalizeOptionalFields(data),
        status: defaultStatus,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setIsCreateOpen(false);
      form.reset();
      toast({ title: "Work order created" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
      } else {
        toast({ title: "Failed to create work order", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<WorkOrderFormData>) => {
      if (accessDenied) throw new Error("403: Access denied");
      return apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${id}`, 
        normalizeOptionalFields(data as WorkOrderFormData));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setEditingWorkOrder(null);
      toast({ title: "Work order updated" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", variant: "destructive" });
      } else {
        toast({ title: "Failed to update work order", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (accessDenied) throw new Error("403: Access denied");
      return apiRequest("DELETE", `/api/projects/${projectId}/work-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      toast({ title: "Work order deleted" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", variant: "destructive" });
      } else {
        toast({ title: "Failed to delete work order", variant: "destructive" });
      }
    },
  });

  const onSubmit = (data: WorkOrderFormData) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: WorkOrderFormData) => {
    if (editingWorkOrder) {
      updateMutation.mutate({ id: editingWorkOrder.id, ...data });
    }
  };

  const handleEdit = (workOrder: ProjectWorkOrder) => {
    setEditingWorkOrder(workOrder);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline">Pending</Badge>;
      case "in_progress":
        return <Badge variant="default">In Progress</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getServiceTypeBadge = (serviceType: string | null) => {
    switch (serviceType) {
      case "Water":
        return <Badge className="bg-blue-500 text-white">Water</Badge>;
      case "Electric":
        return <Badge className="bg-yellow-500 text-black">Electric</Badge>;
      case "Gas":
        return <Badge className="bg-orange-500 text-white">Gas</Badge>;
      default:
        return <Badge variant="outline">{serviceType || "Unknown"}</Badge>;
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-50" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="ml-1 h-3 w-3 inline" />
      : <ArrowDown className="ml-1 h-3 w-3 inline" />;
  };

  const filteredAndSortedWorkOrders = useMemo(() => {
    let result = [...workOrders];
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(wo => {
        const fields = [
          wo.customerWoId,
          wo.customerName,
          wo.address,
          wo.city,
          wo.route,
          wo.zone,
          wo.oldMeterId,
          wo.newMeterId,
          wo.status,
          wo.serviceType
        ];
        return fields.some(field => 
          field && String(field).toLowerCase().includes(query)
        );
      });
    }
    
    // Sort
    if (sortColumn) {
      result.sort((a, b) => {
        const aVal = (a as any)[sortColumn] || "";
        const bVal = (b as any)[sortColumn] || "";
        const comparison = String(aVal).localeCompare(String(bVal));
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }
    
    return result;
  }, [workOrders, searchQuery, sortColumn, sortDirection]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
        <p className="text-muted-foreground text-center mb-4">
          You are not assigned to this project. Please contact your administrator.
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>
          Return to Dashboard
        </Button>
      </div>
    );
  }

  if (projectLoading || workOrdersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (editingWorkOrder) {
    return (
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => setEditingWorkOrder(null)} 
            className="mb-4"
            data-testid="button-back-to-work-orders"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Work Orders
          </Button>
          <h1 className="text-2xl font-bold" data-testid="text-edit-work-order-title">Edit Work Order</h1>
          <p className="text-muted-foreground mt-1">
            Update work order {editingWorkOrder.customerWoId || `#${editingWorkOrder.id}`}
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="customerWoId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Order ID *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="WO-001" data-testid="input-edit-customer-wo-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="customerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer ID *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="CUST-001" data-testid="input-edit-customer-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="John Doe" data-testid="input-edit-customer-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="serviceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-service-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {serviceTypeEnum.map((type) => (
                              <SelectItem key={type} value={type}>{type}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Address *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="123 Main Street" data-testid="input-edit-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="City" data-testid="input-edit-city" />
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
                          <Input {...field} value={field.value || ""} placeholder="State" data-testid="input-edit-state" />
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
                        <FormLabel>ZIP Code</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="12345" data-testid="input-edit-zip" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="555-123-4567" data-testid="input-edit-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="email@example.com" data-testid="input-edit-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="route"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Route</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Route A" data-testid="input-edit-route" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="zone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Zone 1" data-testid="input-edit-zone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="oldMeterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old Meter ID</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="OLD-12345" data-testid="input-edit-old-meter-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="oldMeterReading"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old Meter Reading</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            {...field} 
                            value={field.value ?? ""} 
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            placeholder="12345" 
                            data-testid="input-edit-old-meter-reading" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="newMeterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Meter ID</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="NEW-67890" data-testid="input-edit-new-meter-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="newMeterReading"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Meter Reading</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            {...field} 
                            value={field.value ?? ""} 
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            placeholder="67890" 
                            data-testid="input-edit-new-meter-reading" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="oldGps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old GPS Coordinates</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-edit-old-gps" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="newGps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New GPS Coordinates</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-edit-new-gps" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select value={field.value || editingWorkOrder.status} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-status">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {workOrderStatuses.map((s) => (
                              <SelectItem key={s.id} value={s.code}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." data-testid="input-edit-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                {/* Audit Fields (Read-Only) */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">Audit Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Assigned To</label>
                      <Input 
                        value={editingWorkOrder.assignedTo || "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-assigned-to"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Created By</label>
                      <Input 
                        value={editingWorkOrder.createdBy || "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-created-by"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Created At</label>
                      <Input 
                        value={editingWorkOrder.createdAt ? new Date(editingWorkOrder.createdAt).toLocaleString() : "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-created-at"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Updated By</label>
                      <Input 
                        value={editingWorkOrder.updatedBy || "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-updated-by"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Updated At</label>
                      <Input 
                        value={editingWorkOrder.updatedAt ? new Date(editingWorkOrder.updatedAt).toLocaleString() : "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-updated-at"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Completed At</label>
                      <Input 
                        value={editingWorkOrder.completedAt ? new Date(editingWorkOrder.completedAt).toLocaleString() : "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-completed-at"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditingWorkOrder(null)}>Cancel</Button>
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-update-work-order">
                    {updateMutation.isPending ? "Updating..." : "Update Work Order"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const WorkOrderFormFields = ({ formInstance }: { formInstance: typeof form }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField
        control={formInstance.control}
        name="customerWoId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Work Order ID *</FormLabel>
            <FormControl>
              <Input {...field} placeholder="WO-001" data-testid="input-customer-wo-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="customerId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Customer ID *</FormLabel>
            <FormControl>
              <Input {...field} placeholder="CUST-001" data-testid="input-customer-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="customerName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Customer Name *</FormLabel>
            <FormControl>
              <Input {...field} placeholder="John Doe" data-testid="input-customer-name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="serviceType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Service Type *</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid="select-service-type">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {serviceTypeEnum.map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="address"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>Address *</FormLabel>
            <FormControl>
              <Input {...field} placeholder="123 Main Street" data-testid="input-address" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="city"
        render={({ field }) => (
          <FormItem>
            <FormLabel>City</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="City" data-testid="input-city" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="state"
        render={({ field }) => (
          <FormItem>
            <FormLabel>State</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="State" data-testid="input-state" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="zip"
        render={({ field }) => (
          <FormItem>
            <FormLabel>ZIP Code</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="12345" data-testid="input-zip" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="555-123-4567" data-testid="input-phone" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="email@example.com" data-testid="input-email" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="route"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Route</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="Route A" data-testid="input-route" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="zone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Zone</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="Zone 1" data-testid="input-zone" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="oldMeterId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Old Meter ID</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="OLD-12345" data-testid="input-old-meter-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="oldMeterReading"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Old Meter Reading</FormLabel>
            <FormControl>
              <Input 
                type="number" 
                {...field} 
                value={field.value ?? ""} 
                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="12345" 
                data-testid="input-old-meter-reading" 
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="newMeterId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>New Meter ID</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="NEW-67890" data-testid="input-new-meter-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="newMeterReading"
        render={({ field }) => (
          <FormItem>
            <FormLabel>New Meter Reading</FormLabel>
            <FormControl>
              <Input 
                type="number" 
                {...field} 
                value={field.value ?? ""} 
                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="67890" 
                data-testid="input-new-meter-reading" 
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="oldGps"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Old GPS Coordinates</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-old-gps" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="newGps"
        render={({ field }) => (
          <FormItem>
            <FormLabel>New GPS Coordinates</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-new-gps" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="notes"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." data-testid="input-notes" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-project-title">{project?.name}</h1>
          <p className="text-muted-foreground">Work Orders</p>
        </div>
        {user?.role !== "customer" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/projects/${projectId}/files`}>
              <Button variant="outline" data-testid="button-project-files">
                <Folder className="h-4 w-4 mr-2" />
                Project Files
              </Button>
            </Link>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-work-order">
                  <Plus className="h-4 w-4 mr-2" />
                  New Work Order
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh]">
                <DialogHeader>
                  <DialogTitle>Create Work Order</DialogTitle>
                  <DialogDescription>Add a new utility meter work order</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-4">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <WorkOrderFormFields formInstance={form} />
                      <DialogFooter className="pt-4">
                        <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-work-order">
                          {createMutation.isPending ? "Creating..." : "Create"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Open</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-open">{stats.open}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Scheduled</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-scheduled">{stats.scheduled}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-completed">{stats.completed}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Skipped</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-skipped">{stats.skipped}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-total">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Search Input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search work orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-work-orders"
          />
        </div>
        {searchQuery && (
          <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
            Clear
          </Button>
        )}
      </div>

      {workOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No work orders yet</p>
            {user?.role !== "customer" && (
              <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Work Order
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("customerWoId")}>
                      WO ID {getSortIcon("customerWoId")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("address")}>
                      Address {getSortIcon("address")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("serviceType")}>
                      Service {getSortIcon("serviceType")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("route")}>
                      Route {getSortIcon("route")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("zone")}>
                      Zone {getSortIcon("zone")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("oldMeterId")}>
                      Old Meter {getSortIcon("oldMeterId")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                      Status {getSortIcon("status")}
                    </TableHead>
                    {user?.role !== "customer" && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedWorkOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No work orders match your search
                      </TableCell>
                    </TableRow>
                  ) : filteredAndSortedWorkOrders.map((workOrder) => (
                    <TableRow key={workOrder.id} data-testid={`row-work-order-${workOrder.id}`}>
                      <TableCell className="font-medium" data-testid={`text-wo-id-${workOrder.id}`}>
                        {workOrder.customerWoId || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-address-${workOrder.id}`}>
                        {workOrder.address || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-service-${workOrder.id}`}>
                        {getServiceTypeBadge(workOrder.serviceType)}
                      </TableCell>
                      <TableCell data-testid={`text-route-${workOrder.id}`}>
                        {workOrder.route || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-zone-${workOrder.id}`}>
                        {workOrder.zone || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-old-meter-${workOrder.id}`}>
                        {workOrder.oldMeterId || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-status-${workOrder.id}`}>
                        {getStatusBadge(workOrder.status)}
                      </TableCell>
                      {user?.role !== "customer" && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(workOrder)}
                              data-testid={`button-edit-${workOrder.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Link href={`/projects/${projectId}/work-orders/${workOrder.id}/files`}>
                              <Button variant="ghost" size="icon" data-testid={`button-files-${workOrder.id}`}>
                                <Upload className="h-4 w-4" />
                              </Button>
                            </Link>
                            {user?.role === "admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteMutation.mutate(workOrder.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${workOrder.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
