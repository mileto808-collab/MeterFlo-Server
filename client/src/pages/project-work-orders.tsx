import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
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
import { Plus, ClipboardList, Trash2, ShieldAlert, Folder, Pencil, Upload } from "lucide-react";
import type { Project } from "@shared/schema";
import { insertProjectWorkOrderSchema, serviceTypeEnum, workOrderStatusEnum, workOrderPriorityEnum } from "@shared/schema";
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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<ProjectWorkOrder | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

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
      priority: "medium",
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
      priority: "medium",
      notes: "",
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

  const { data: stats, error: statsError } = useQuery<{ pending: number; inProgress: number; completed: number; total: number }>({
    queryKey: [`/api/projects/${projectId}/work-orders/stats`],
    enabled: !!projectId && !accessDenied,
    retry: false,
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
        priority: (editingWorkOrder.priority as any) || "medium",
        notes: editingWorkOrder.notes || "",
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
      return apiRequest("POST", `/api/projects/${projectId}/work-orders`, {
        ...normalizeOptionalFields(data),
        status: "pending",
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
      setIsEditOpen(false);
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
    setIsEditOpen(true);
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
        name="priority"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Priority</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {workOrderPriorityEnum.map((p) => (
                  <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-pending">{stats.pending}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>In Progress</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-in-progress">{stats.inProgress}</CardTitle>
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
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-total">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

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
                    <TableHead>WO ID</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Old Meter</TableHead>
                    <TableHead>Status</TableHead>
                    {user?.role !== "customer" && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.map((workOrder) => (
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

      <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if (!open) setEditingWorkOrder(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Edit Work Order</DialogTitle>
            <DialogDescription>Update work order details</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <WorkOrderFormFields formInstance={editForm} />
                {editingWorkOrder && (
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
                            {workOrderStatusEnum.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <DialogFooter className="pt-4">
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-update-work-order">
                    {updateMutation.isPending ? "Updating..." : "Update"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
