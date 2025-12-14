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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardList, Trash2, ShieldAlert, Folder, Pencil, Upload, ArrowLeft, Search, ArrowUpDown, ArrowUp, ArrowDown, Download, FileSpreadsheet, FileText, Filter, X } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project, WorkOrderStatus, TroubleCode, ServiceTypeRecord, MeterType } from "@shared/schema";
import { insertProjectWorkOrderSchema } from "@shared/schema";
import type { ProjectWorkOrder } from "../../../server/projectDb";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, ChevronDown } from "lucide-react";

type Assignee = {
  type: "user" | "group";
  id: string;
  label: string;
  username?: string;
  key?: string;
};

type AssigneesResponse = {
  users: Assignee[];
  groups: Assignee[];
};

const workOrderFormSchema = insertProjectWorkOrderSchema.extend({
  email: z.string().optional().nullable().or(z.literal("")),
  assignedTo: z.string().optional().nullable(),
});

type WorkOrderFormData = z.infer<typeof workOrderFormSchema>;

export default function ProjectWorkOrders() {
  const [, params] = useRoute("/projects/:projectId/work-orders");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isCreatingWorkOrder, setIsCreatingWorkOrder] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<ProjectWorkOrder | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedServiceType, setSelectedServiceType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [createMeterTypeOpen, setCreateMeterTypeOpen] = useState(false);
  const [meterTypeField, setMeterTypeField] = useState<"oldMeterType" | "newMeterType" | "editOldMeterType" | "editNewMeterType" | null>(null);
  const [newMeterTypeProductId, setNewMeterTypeProductId] = useState("");
  const [newMeterTypeLabel, setNewMeterTypeLabel] = useState("");
  const [newMeterTypeDescription, setNewMeterTypeDescription] = useState("");

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
      assignedTo: "",
      scheduledDate: "",
      trouble: "",
      oldMeterType: "",
      newMeterType: "",
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
      assignedTo: "",
      scheduledDate: "",
      trouble: "",
      oldMeterType: "",
      newMeterType: "",
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

  const { data: assigneesData } = useQuery<AssigneesResponse>({
    queryKey: [`/api/projects/${projectId}/assignees`],
    enabled: !!projectId && !accessDenied,
  });

  const { data: troubleCodes = [] } = useQuery<TroubleCode[]>({
    queryKey: ["/api/trouble-codes"],
  });

  const { data: serviceTypes = [] } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
  });

  const { data: meterTypes = [] } = useQuery<MeterType[]>({
    queryKey: ["/api/meter-types", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/meter-types?projectId=${projectId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!projectId && !accessDenied,
  });

  // Helper to get color hex from service type color name
  const getServiceTypeColorHex = (color: string): string => {
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
  };

  useEffect(() => {
    const error = projectError || workOrdersError || statsError;
    if (error) {
      const errorMsg = (error as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
      }
    }
  }, [projectError, workOrdersError, statsError]);

  // Reset filters when project changes
  useEffect(() => {
    setSearchQuery("");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setDateFrom("");
    setDateTo("");
    setShowFilters(false);
    setIsCreatingWorkOrder(false);
    setEditingWorkOrder(null);
  }, [projectId]);

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
        assignedTo: editingWorkOrder.assignedTo || "",
        scheduledDate: (editingWorkOrder as any).scheduledDate || "",
        trouble: (editingWorkOrder as any).trouble || "",
        oldMeterType: (editingWorkOrder as any).oldMeterType || "",
        newMeterType: (editingWorkOrder as any).newMeterType || "",
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
    trouble: (data as any).trouble || null,
    oldMeterType: (data as any).oldMeterType || null,
    newMeterType: (data as any).newMeterType || null,
  });

  const createMutation = useMutation({
    mutationFn: async (data: WorkOrderFormData) => {
      if (accessDenied) throw new Error("403: Access denied");
      const troubleStatus = workOrderStatuses.find(s => s.label === "Trouble")?.label || "Trouble";
      const defaultStatus = workOrderStatuses.find(s => s.isDefault)?.label || "Open";
      const status = (data as any).trouble ? troubleStatus : defaultStatus;
      return apiRequest("POST", `/api/projects/${projectId}/work-orders`, {
        ...normalizeOptionalFields(data),
        status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setIsCreatingWorkOrder(false);
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
      const normalizedData = normalizeOptionalFields(data as WorkOrderFormData);
      const troubleStatus = workOrderStatuses.find(s => s.label === "Trouble")?.label || "Trouble";
      const openStatus = workOrderStatuses.find(s => s.isDefault)?.label || "Open";
      if ((data as any).trouble) {
        (normalizedData as any).status = troubleStatus;
      } else if ((data as any).trouble === "" || (data as any).trouble === null) {
        (normalizedData as any).status = openStatus;
      }
      return apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${id}`, normalizedData);
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

  const createMeterTypeMutation = useMutation({
    mutationFn: async (data: { productId: string; productLabel: string; productDescription?: string }): Promise<MeterType> => {
      const res = await apiRequest("POST", "/api/meter-types", {
        ...data,
        projectIds: [projectId],
      });
      return res.json();
    },
    onSuccess: (newMeterType: MeterType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-types", projectId] });
      if (meterTypeField === "oldMeterType") {
        form.setValue("oldMeterType", newMeterType.productId);
      } else if (meterTypeField === "newMeterType") {
        form.setValue("newMeterType", newMeterType.productId);
      } else if (meterTypeField === "editOldMeterType") {
        editForm.setValue("oldMeterType", newMeterType.productId);
      } else if (meterTypeField === "editNewMeterType") {
        editForm.setValue("newMeterType", newMeterType.productId);
      }
      setCreateMeterTypeOpen(false);
      setNewMeterTypeProductId("");
      setNewMeterTypeLabel("");
      setNewMeterTypeDescription("");
      setMeterTypeField(null);
      toast({ title: "Meter type created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create meter type", description: error?.message, variant: "destructive" });
    },
  });

  const handleCreateMeterTypeSubmit = () => {
    if (!newMeterTypeProductId.trim() || !newMeterTypeLabel.trim()) {
      toast({ title: "Product ID and Label are required", variant: "destructive" });
      return;
    }
    createMeterTypeMutation.mutate({
      productId: newMeterTypeProductId.trim(),
      productLabel: newMeterTypeLabel.trim(),
      productDescription: newMeterTypeDescription.trim() || undefined,
    });
  };

  const openCreateMeterTypeDialog = (field: "oldMeterType" | "newMeterType" | "editOldMeterType" | "editNewMeterType") => {
    if (!projectId) {
      toast({ title: "Project not loaded", description: "Please wait for the project to load", variant: "destructive" });
      return;
    }
    setMeterTypeField(field);
    setNewMeterTypeProductId("");
    setNewMeterTypeLabel("");
    setNewMeterTypeDescription("");
    setCreateMeterTypeOpen(true);
  };

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

  const getStatusColorHex = (color: string): string => {
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
  };

  const getStatusBadge = (status: string) => {
    if (!status) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    const statusRecord = workOrderStatuses.find(
      s => s.code === status || s.label === status
    );
    if (statusRecord && statusRecord.color) {
      const bgColor = getStatusColorHex(statusRecord.color);
      const textColor = ['yellow', 'orange'].includes(statusRecord.color) ? '#000' : '#fff';
      return (
        <Badge 
          style={{ backgroundColor: bgColor, color: textColor, borderColor: bgColor }}
        >
          {statusRecord.label}
        </Badge>
      );
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  const getServiceTypeBadge = (serviceType: string | null) => {
    if (!serviceType) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    const serviceTypeRecord = serviceTypes.find(
      st => st.code === serviceType || st.label === serviceType
    );
    if (serviceTypeRecord && serviceTypeRecord.color) {
      const bgColor = getServiceTypeColorHex(serviceTypeRecord.color);
      const textColor = ['yellow', 'orange'].includes(serviceTypeRecord.color) ? '#000' : '#fff';
      return (
        <Badge 
          style={{ backgroundColor: bgColor, color: textColor, borderColor: bgColor }}
        >
          {serviceTypeRecord.label}
        </Badge>
      );
    }
    return <Badge variant="outline">{serviceType}</Badge>;
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
    
    // Filter by status
    if (selectedStatus !== "all") {
      result = result.filter(wo => wo.status === selectedStatus);
    }
    
    // Filter by service type
    if (selectedServiceType !== "all") {
      result = result.filter(wo => wo.serviceType === selectedServiceType);
    }
    
    // Filter by date range
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      result = result.filter(wo => wo.createdAt && new Date(wo.createdAt) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter(wo => wo.createdAt && new Date(wo.createdAt) <= toDate);
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
  }, [workOrders, searchQuery, sortColumn, sortDirection, selectedStatus, selectedServiceType, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setDateFrom("");
    setDateTo("");
  };

  const hasActiveFilters = selectedStatus !== "all" || selectedServiceType !== "all" || dateFrom !== "" || dateTo !== "";

  const exportToCSV = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const headers = ["WO ID", "Customer ID", "Customer Name", "Address", "City", "State", "ZIP", "Phone", "Email", "Route", "Zone", "Service Type", "Old Meter ID", "Old Meter Reading", "New Meter ID", "New Meter Reading", "Old GPS", "New GPS", "Status", "Assigned To", "Created At", "Completed At", "Notes"];
    const rows = filteredAndSortedWorkOrders.map(wo => [
      wo.customerWoId || "",
      wo.customerId || "",
      wo.customerName || "",
      wo.address || "",
      wo.city || "",
      wo.state || "",
      wo.zip || "",
      wo.phone || "",
      wo.email || "",
      wo.route || "",
      wo.zone || "",
      wo.serviceType || "",
      wo.oldMeterId || "",
      wo.oldMeterReading ?? "",
      wo.newMeterId || "",
      wo.newMeterReading ?? "",
      wo.oldGps || "",
      wo.newGps || "",
      wo.status,
      wo.assignedTo || "",
      wo.createdAt && wo.createdAt !== null ? format(new Date(wo.createdAt), "yyyy-MM-dd HH:mm") : "",
      wo.completedAt && wo.completedAt !== null ? format(new Date(wo.completedAt), "yyyy-MM-dd HH:mm") : "",
      wo.notes || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${project?.name || "work-orders"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({ title: "CSV exported successfully" });
  };

  const exportToExcel = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const data = filteredAndSortedWorkOrders.map(wo => ({
      "WO ID": wo.customerWoId || "",
      "Customer ID": wo.customerId || "",
      "Customer Name": wo.customerName || "",
      "Address": wo.address || "",
      "City": wo.city || "",
      "State": wo.state || "",
      "ZIP": wo.zip || "",
      "Phone": wo.phone || "",
      "Email": wo.email || "",
      "Route": wo.route || "",
      "Zone": wo.zone || "",
      "Service Type": wo.serviceType || "",
      "Old Meter ID": wo.oldMeterId || "",
      "Old Meter Reading": wo.oldMeterReading ?? "",
      "New Meter ID": wo.newMeterId || "",
      "New Meter Reading": wo.newMeterReading ?? "",
      "Old GPS": wo.oldGps || "",
      "New GPS": wo.newGps || "",
      "Status": wo.status,
      "Assigned To": wo.assignedTo || "",
      "Created At": wo.createdAt && wo.createdAt !== null ? format(new Date(wo.createdAt), "yyyy-MM-dd HH:mm") : "",
      "Completed At": wo.completedAt && wo.completedAt !== null ? format(new Date(wo.completedAt), "yyyy-MM-dd HH:mm") : "",
      "Notes": wo.notes || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Orders");
    XLSX.writeFile(workbook, `${project?.name || "work-orders"}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);

    toast({ title: "Excel file exported successfully" });
  };

  const exportToPDF = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${project?.name || "Work Orders"} Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .meta { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 11px; }
          th { background-color: #f4f4f4; font-weight: bold; }
          tr:nth-child(even) { background-color: #fafafa; }
          .service-water { color: #0066cc; }
          .service-electric { color: #cc9900; }
          .service-gas { color: #cc6600; }
        </style>
      </head>
      <body>
        <h1>${project?.name || "Work Orders"} Report</h1>
        <div class="meta">
          <p>Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}</p>
          <p>Total Results: ${filteredAndSortedWorkOrders.length}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>WO ID</th>
              <th>Customer</th>
              <th>Address</th>
              <th>Service</th>
              <th>Route</th>
              <th>Zone</th>
              <th>Old Meter</th>
              <th>Old Reading</th>
              <th>New Meter</th>
              <th>New Reading</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${filteredAndSortedWorkOrders.map(wo => `
              <tr>
                <td>${wo.customerWoId || "-"}</td>
                <td>${wo.customerName || "-"}</td>
                <td>${wo.address || "-"}</td>
                <td class="service-${(wo.serviceType || "").toLowerCase()}">${wo.serviceType || "-"}</td>
                <td>${wo.route || "-"}</td>
                <td>${wo.zone || "-"}</td>
                <td>${wo.oldMeterId || "-"}</td>
                <td>${wo.oldMeterReading ?? "-"}</td>
                <td>${wo.newMeterId || "-"}</td>
                <td>${wo.newMeterReading ?? "-"}</td>
                <td>${wo.status.replace("_", " ")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }

    toast({ title: "PDF print dialog opened" });
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
                          <Input {...field} value={field.value || ""} placeholder="WO-001" data-testid="input-edit-customer-wo-id" />
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
                          <Input {...field} value={field.value || ""} placeholder="CUST-001" data-testid="input-edit-customer-id" />
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
                          <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-edit-customer-name" />
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
                            {serviceTypes.map((type) => (
                              <SelectItem key={type.id} value={type.label}>{type.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="oldMeterType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old Meter Type</FormLabel>
                        <Select 
                          value={(field.value as string) || "__none__"} 
                          onValueChange={(val) => {
                            if (val === "__create_new__") {
                              openCreateMeterTypeDialog("editOldMeterType");
                            } else {
                              field.onChange(val === "__none__" ? "" : val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-old-meter-type">
                              <SelectValue placeholder="Select old meter type..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {meterTypes.map((mt) => (
                              <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                            ))}
                            <SelectItem value="__create_new__" className="text-primary font-medium">
                              <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Create New</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="newMeterType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Meter Type</FormLabel>
                        <Select 
                          value={(field.value as string) || "__none__"} 
                          onValueChange={(val) => {
                            if (val === "__create_new__") {
                              openCreateMeterTypeDialog("editNewMeterType");
                            } else {
                              field.onChange(val === "__none__" ? "" : val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-new-meter-type">
                              <SelectValue placeholder="Select new meter type..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {meterTypes.map((mt) => (
                              <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                            ))}
                            <SelectItem value="__create_new__" className="text-primary font-medium">
                              <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Create New</span>
                            </SelectItem>
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
                          <Input {...field} value={field.value || ""} placeholder="123 Main Street" data-testid="input-edit-address" />
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
                    name="assignedTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned To</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between font-normal"
                                data-testid="select-edit-assigned-to"
                              >
                                <span className="truncate">
                                  {field.value || "Select assignee(s)..."}
                                </span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0" align="start">
                            <div className="p-2 border-b">
                              <Input
                                placeholder="Search users or groups..."
                                className="h-8"
                                data-testid="input-search-assignees"
                              />
                            </div>
                            <ScrollArea className="h-[200px]">
                              <div className="p-2">
                                {assigneesData?.groups && assigneesData.groups.length > 0 && (
                                  <>
                                    <div className="text-xs font-medium text-muted-foreground mb-1 px-2">Groups</div>
                                    {assigneesData.groups.map((group) => (
                                      <div
                                        key={group.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer"
                                        onClick={() => {
                                          const current = field.value || "";
                                          const items = current.split(",").map(s => s.trim()).filter(Boolean);
                                          if (items.includes(group.label)) {
                                            field.onChange(items.filter(i => i !== group.label).join(", "));
                                          } else {
                                            field.onChange([...items, group.label].join(", "));
                                          }
                                        }}
                                        data-testid={`option-group-${group.key}`}
                                      >
                                        <Checkbox
                                          checked={(field.value || "").split(",").map(s => s.trim()).includes(group.label)}
                                        />
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm">{group.label}</span>
                                      </div>
                                    ))}
                                  </>
                                )}
                                {assigneesData?.users && assigneesData.users.length > 0 && (
                                  <>
                                    <div className="text-xs font-medium text-muted-foreground mb-1 mt-2 px-2">Users</div>
                                    {assigneesData.users.map((user) => (
                                      <div
                                        key={user.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer"
                                        onClick={() => {
                                          const current = field.value || "";
                                          const items = current.split(",").map(s => s.trim()).filter(Boolean);
                                          if (items.includes(user.label)) {
                                            field.onChange(items.filter(i => i !== user.label).join(", "));
                                          } else {
                                            field.onChange([...items, user.label].join(", "));
                                          }
                                        }}
                                        data-testid={`option-user-${user.id}`}
                                      >
                                        <Checkbox
                                          checked={(field.value || "").split(",").map(s => s.trim()).includes(user.label)}
                                        />
                                        <span className="text-sm">{user.label}</span>
                                      </div>
                                    ))}
                                  </>
                                )}
                                {(!assigneesData?.users?.length && !assigneesData?.groups?.length) && (
                                  <div className="text-sm text-muted-foreground text-center py-4">
                                    No users or groups available
                                  </div>
                                )}
                              </div>
                            </ScrollArea>
                            {field.value && (
                              <div className="border-t p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => field.onChange("")}
                                >
                                  Clear selection
                                </Button>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
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
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scheduled Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-edit-scheduled-date"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Setting a date will auto-set status to "Scheduled"</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="trouble"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trouble Code</FormLabel>
                        <Select value={(field.value as string) || "__none__"} onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-trouble">
                              <SelectValue placeholder="Select trouble code..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {troubleCodes.map((tc) => (
                              <SelectItem key={tc.id} value={tc.code}>
                                {tc.code} - {tc.label}
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

  if (isCreatingWorkOrder) {
    return (
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => {
              setIsCreatingWorkOrder(false);
              form.reset();
            }} 
            className="mb-4"
            data-testid="button-back-to-work-orders"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Work Orders
          </Button>
          <h1 className="text-2xl font-bold" data-testid="text-create-work-order-title">Create Work Order</h1>
          <p className="text-muted-foreground mt-1">Add a new utility meter work order to {project?.name}</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerWoId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Order ID *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="WO-001" data-testid="input-create-customer-wo-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer ID *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="CUST-001" data-testid="input-create-customer-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-create-customer-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="serviceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-create-service-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {serviceTypes.map((type) => (
                              <SelectItem key={type.id} value={type.label}>{type.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="oldMeterType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old Meter Type</FormLabel>
                        <Select 
                          value={(field.value as string) || "__none__"} 
                          onValueChange={(val) => {
                            if (val === "__create_new__") {
                              openCreateMeterTypeDialog("oldMeterType");
                            } else {
                              field.onChange(val === "__none__" ? "" : val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-create-old-meter-type">
                              <SelectValue placeholder="Select old meter type..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {meterTypes.map((mt) => (
                              <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                            ))}
                            <SelectItem value="__create_new__" className="text-primary font-medium">
                              <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Create New</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newMeterType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Meter Type</FormLabel>
                        <Select 
                          value={(field.value as string) || "__none__"} 
                          onValueChange={(val) => {
                            if (val === "__create_new__") {
                              openCreateMeterTypeDialog("newMeterType");
                            } else {
                              field.onChange(val === "__none__" ? "" : val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-create-new-meter-type">
                              <SelectValue placeholder="Select new meter type..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {meterTypes.map((mt) => (
                              <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                            ))}
                            <SelectItem value="__create_new__" className="text-primary font-medium">
                              <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Create New</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Address *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="123 Main Street" data-testid="input-create-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="City" data-testid="input-create-city" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="State" data-testid="input-create-state" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="zip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="12345" data-testid="input-create-zip" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="555-123-4567" data-testid="input-create-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="email@example.com" data-testid="input-create-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="route"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Route</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Route A" data-testid="input-create-route" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="zone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Zone 1" data-testid="input-create-zone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="oldMeterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old Meter ID</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="OLD-12345" data-testid="input-create-old-meter-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
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
                            data-testid="input-create-old-meter-reading" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newMeterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Meter ID</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="NEW-67890" data-testid="input-create-new-meter-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
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
                            data-testid="input-create-new-meter-reading" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="oldGps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Old GPS Coordinates</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-create-old-gps" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newGps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New GPS Coordinates</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="40.7128,-74.0060" data-testid="input-create-new-gps" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="assignedTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned To</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between font-normal"
                                data-testid="select-create-assigned-to"
                              >
                                <span className="truncate">
                                  {field.value || "Select assignee(s)..."}
                                </span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0" align="start">
                            <div className="p-2 border-b">
                              <Input
                                placeholder="Search users or groups..."
                                className="h-8"
                                data-testid="input-search-create-assignees"
                              />
                            </div>
                            <ScrollArea className="h-[200px]">
                              <div className="p-2">
                                {assigneesData?.groups && assigneesData.groups.length > 0 && (
                                  <>
                                    <div className="text-xs font-medium text-muted-foreground mb-1 px-2">Groups</div>
                                    {assigneesData.groups.map((group) => (
                                      <div
                                        key={group.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer"
                                        onClick={() => {
                                          const current = field.value || "";
                                          const items = current.split(",").map(s => s.trim()).filter(Boolean);
                                          if (items.includes(group.label)) {
                                            field.onChange(items.filter(i => i !== group.label).join(", "));
                                          } else {
                                            field.onChange([...items, group.label].join(", "));
                                          }
                                        }}
                                        data-testid={`option-create-group-${group.key}`}
                                      >
                                        <Checkbox
                                          checked={(field.value || "").split(",").map(s => s.trim()).includes(group.label)}
                                        />
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm">{group.label}</span>
                                      </div>
                                    ))}
                                  </>
                                )}
                                {assigneesData?.users && assigneesData.users.length > 0 && (
                                  <>
                                    <div className="text-xs font-medium text-muted-foreground mb-1 mt-2 px-2">Users</div>
                                    {assigneesData.users.map((user) => (
                                      <div
                                        key={user.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer"
                                        onClick={() => {
                                          const current = field.value || "";
                                          const items = current.split(",").map(s => s.trim()).filter(Boolean);
                                          if (items.includes(user.label)) {
                                            field.onChange(items.filter(i => i !== user.label).join(", "));
                                          } else {
                                            field.onChange([...items, user.label].join(", "));
                                          }
                                        }}
                                        data-testid={`option-create-user-${user.id}`}
                                      >
                                        <Checkbox
                                          checked={(field.value || "").split(",").map(s => s.trim()).includes(user.label)}
                                        />
                                        <span className="text-sm">{user.label}</span>
                                      </div>
                                    ))}
                                  </>
                                )}
                                {(!assigneesData?.users?.length && !assigneesData?.groups?.length) && (
                                  <div className="text-sm text-muted-foreground text-center py-4">
                                    No users or groups available
                                  </div>
                                )}
                              </div>
                            </ScrollArea>
                            {field.value && (
                              <div className="border-t p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => field.onChange("")}
                                >
                                  Clear selection
                                </Button>
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scheduled Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-create-scheduled-date"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Setting a date will auto-set status to "Scheduled"</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="trouble"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trouble Code</FormLabel>
                        <Select value={(field.value as string) || "__none__"} onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-create-trouble">
                              <SelectValue placeholder="Select trouble code..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {troubleCodes.map((tc) => (
                              <SelectItem key={tc.id} value={tc.code}>
                                {tc.code} - {tc.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." data-testid="input-create-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => {
                    setIsCreatingWorkOrder(false);
                    form.reset();
                  }}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-create-work-order">
                    {createMutation.isPending ? "Creating..." : "Create Work Order"}
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
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
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
            <Button onClick={() => setIsCreatingWorkOrder(true)} data-testid="button-create-work-order">
              <Plus className="h-4 w-4 mr-2" />
              New Work Order
            </Button>
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

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search work orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-work-orders"
              />
            </div>
            <Button 
              variant={showFilters ? "secondary" : "outline"} 
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && <Badge variant="secondary" className="ml-2">{[selectedStatus !== "all", selectedServiceType !== "all", dateFrom, dateTo].filter(Boolean).length}</Badge>}
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={exportToCSV} data-testid="button-export-csv">
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" onClick={exportToExcel} data-testid="button-export-excel">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
              <Button variant="outline" onClick={exportToPDF} data-testid="button-export-pdf">
                <FileText className="h-4 w-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>
          
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
              <div>
                <Label htmlFor="filter-status">Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger id="filter-status" data-testid="select-filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {workOrderStatuses.map((status) => (
                      <SelectItem key={status.id} value={status.label}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="filter-service-type">Service Type</Label>
                <Select value={selectedServiceType} onValueChange={setSelectedServiceType}>
                  <SelectTrigger id="filter-service-type" data-testid="select-filter-service-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Service Types</SelectItem>
                    {serviceTypes.map((type) => (
                      <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="filter-date-from">Created From</Label>
                <Input
                  id="filter-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-filter-date-from"
                />
              </div>
              <div>
                <Label htmlFor="filter-date-to">Created To</Label>
                <Input
                  id="filter-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-filter-date-to"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results count */}
      {(searchQuery || hasActiveFilters) && (
        <div className="text-sm text-muted-foreground">
          Showing {filteredAndSortedWorkOrders.length} of {workOrders.length} work orders
        </div>
      )}

      {workOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No work orders yet</p>
            {user?.role !== "customer" && (
              <Button variant="outline" className="mt-4" onClick={() => setIsCreatingWorkOrder(true)}>
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

      <Dialog open={createMeterTypeOpen} onOpenChange={setCreateMeterTypeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Meter Type</DialogTitle>
            <DialogDescription>
              Add a new meter type to this project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="product-id">Product ID *</Label>
              <Input
                id="product-id"
                value={newMeterTypeProductId}
                onChange={(e) => setNewMeterTypeProductId(e.target.value)}
                placeholder="e.g. MTR-001"
                data-testid="input-new-meter-type-product-id"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="product-label">Product Label *</Label>
              <Input
                id="product-label"
                value={newMeterTypeLabel}
                onChange={(e) => setNewMeterTypeLabel(e.target.value)}
                placeholder="e.g. 5/8 Inch Water Meter"
                data-testid="input-new-meter-type-label"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="product-description">Description (optional)</Label>
              <Textarea
                id="product-description"
                value={newMeterTypeDescription}
                onChange={(e) => setNewMeterTypeDescription(e.target.value)}
                placeholder="Optional description..."
                data-testid="input-new-meter-type-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateMeterTypeOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateMeterTypeSubmit}
              disabled={createMeterTypeMutation.isPending}
              data-testid="button-create-meter-type-submit"
            >
              {createMeterTypeMutation.isPending ? "Creating..." : "Create Meter Type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
