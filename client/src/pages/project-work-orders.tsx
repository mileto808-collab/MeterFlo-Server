import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { ColumnSelector, type ColumnConfig } from "@/components/column-selector";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { FilterSelector, type FilterConfig } from "@/components/filter-selector";
import { useFilterPreferences } from "@/hooks/use-filter-preferences";
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
import { useTimezone } from "@/hooks/use-timezone";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardList, Trash2, ShieldAlert, Folder, Pencil, Upload, ArrowLeft, Search, ArrowUpDown, ArrowUp, ArrowDown, Download, FileSpreadsheet, FileText, Filter, X } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";
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
import SignaturePad, { SignaturePadRef } from "@/components/signature-pad";

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
});

type WorkOrderFormData = z.infer<typeof workOrderFormSchema>;

export default function ProjectWorkOrders() {
  const [, params] = useRoute("/projects/:projectId/work-orders");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDateTime, formatExport, formatCustom } = useTimezone();
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
  const [selectedAssignedTo, setSelectedAssignedTo] = useState<string>("all");
  const [selectedAssignedGroup, setSelectedAssignedGroup] = useState<string>("all");
  const [selectedTrouble, setSelectedTrouble] = useState<string>("all");
  const [selectedOldMeterType, setSelectedOldMeterType] = useState<string>("all");
  const [selectedNewMeterType, setSelectedNewMeterType] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [filterCustomerName, setFilterCustomerName] = useState("");
  const [filterAddress, setFilterAddress] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterZip, setFilterZip] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterEmail, setFilterEmail] = useState("");
  const [filterRoute, setFilterRoute] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterOldMeterId, setFilterOldMeterId] = useState("");
  const [filterNewMeterId, setFilterNewMeterId] = useState("");
  const [filterScheduledDate, setFilterScheduledDate] = useState("");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");
  const [filterUpdatedBy, setFilterUpdatedBy] = useState("all");
  const [filterCompletedAt, setFilterCompletedAt] = useState("");
  const [filterNotes, setFilterNotes] = useState("");
  const [filterCreatedAt, setFilterCreatedAt] = useState("");
  const [filterUpdatedAt, setFilterUpdatedAt] = useState("");
  const [createMeterTypeOpen, setCreateMeterTypeOpen] = useState(false);
  const [meterTypeField, setMeterTypeField] = useState<"oldMeterType" | "newMeterType" | "editOldMeterType" | "editNewMeterType" | null>(null);
  const [cameFromSearch, setCameFromSearch] = useState(false);
  const [newMeterTypeProductId, setNewMeterTypeProductId] = useState("");
  const [newMeterTypeLabel, setNewMeterTypeLabel] = useState("");
  const [newMeterTypeDescription, setNewMeterTypeDescription] = useState("");

  const signaturePadRef = useRef<SignaturePadRef>(null);
  const editSignaturePadRef = useRef<SignaturePadRef>(null);

  // Column configuration for the work orders table
  const workOrderColumns: ColumnConfig[] = useMemo(() => [
    { key: "customerWoId", label: "WO ID", required: true },
    { key: "customerId", label: "Customer ID" },
    { key: "customerName", label: "Customer Name" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "ZIP" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "route", label: "Route" },
    { key: "zone", label: "Zone" },
    { key: "serviceType", label: "Service" },
    { key: "oldMeterId", label: "Old Meter ID" },
    { key: "oldMeterReading", label: "Old Meter Reading" },
    { key: "oldMeterType", label: "Old Meter Type" },
    { key: "newMeterId", label: "New Meter ID" },
    { key: "newMeterReading", label: "New Meter Reading" },
    { key: "newMeterType", label: "New Meter Type" },
    { key: "oldGps", label: "Old GPS" },
    { key: "newGps", label: "New GPS" },
    { key: "status", label: "Status" },
    { key: "scheduledDate", label: "Scheduled Date" },
    { key: "assignedTo", label: "Assigned User" },
    { key: "assignedGroup", label: "Assigned Group" },
    { key: "createdBy", label: "Created By" },
    { key: "updatedBy", label: "Updated By" },
    { key: "completedAt", label: "Completed At" },
    { key: "trouble", label: "Trouble" },
    { key: "notes", label: "Notes" },
    { key: "createdAt", label: "Created At" },
    { key: "updatedAt", label: "Updated At" },
  ], []);

  const { visibleColumns, setVisibleColumns, isColumnVisible, isLoading: columnPrefsLoading, orderedColumns } = useColumnPreferences("work_orders", workOrderColumns);

  // Filter configuration - matches columns (excluding attachments and signature_data)
  const workOrderFilters: FilterConfig[] = useMemo(() => [
    { key: "customerWoId", label: "WO ID" },
    { key: "customerId", label: "Customer ID" },
    { key: "customerName", label: "Customer Name" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "ZIP" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "route", label: "Route" },
    { key: "zone", label: "Zone" },
    { key: "serviceType", label: "Service Type" },
    { key: "oldMeterId", label: "Old Meter ID" },
    { key: "oldMeterType", label: "Old Meter Type" },
    { key: "newMeterId", label: "New Meter ID" },
    { key: "newMeterType", label: "New Meter Type" },
    { key: "status", label: "Status" },
    { key: "scheduledDate", label: "Scheduled Date" },
    { key: "assignedTo", label: "Assigned To (User)" },
    { key: "assignedGroup", label: "Assigned To (Group)" },
    { key: "createdBy", label: "Created By" },
    { key: "updatedBy", label: "Updated By" },
    { key: "completedAt", label: "Completed At" },
    { key: "trouble", label: "Trouble" },
    { key: "notes", label: "Notes" },
    { key: "createdAt", label: "Created At" },
    { key: "updatedAt", label: "Updated At" },
    { key: "dateFrom", label: "Date From" },
    { key: "dateTo", label: "Date To" },
  ], []);

  const { visibleFilters, setVisibleFilters, isFilterVisible, isLoading: filterPrefsLoading } = useFilterPreferences("work-orders", workOrderFilters);

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
      assignedUserId: undefined,
      assignedGroupId: undefined,
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
      assignedUserId: undefined,
      assignedGroupId: undefined,
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

  const { data: stats, error: statsError } = useQuery<{ statusCounts: Record<string, number>; total: number }>({
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
    setCameFromSearch(false);
  }, [projectId]);

  // Handle ?edit=workOrderId&from=search query parameters to auto-open a work order
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const editId = searchParams.get("edit");
    const fromSearch = searchParams.get("from") === "search";
    if (editId && workOrders.length > 0) {
      const workOrderToEdit = workOrders.find((wo) => wo.id === parseInt(editId));
      if (workOrderToEdit) {
        setEditingWorkOrder(workOrderToEdit);
        if (fromSearch) {
          setCameFromSearch(true);
        }
        // Clear the query parameter from URL without refreshing
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [workOrders]);

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
        assignedUserId: (editingWorkOrder as any).assignedUserId || undefined,
        assignedGroupId: (editingWorkOrder as any).assignedGroupId || undefined,
        scheduledDate: (editingWorkOrder as any).scheduledDate || "",
        trouble: (editingWorkOrder as any).trouble || "",
        oldMeterType: (editingWorkOrder as any).oldMeterType || "",
        newMeterType: (editingWorkOrder as any).newMeterType || "",
      });
      // Set signature data after a brief delay to ensure the ref is ready
      setTimeout(() => {
        if (editSignaturePadRef.current) {
          editSignaturePadRef.current.setSignatureData((editingWorkOrder as any).signatureData || null);
          editSignaturePadRef.current.setSignatureName((editingWorkOrder as any).signatureName || "");
        }
      }, 100);
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
    assignedUserId: (data as any).assignedUserId ?? null,
    assignedGroupId: (data as any).assignedGroupId ?? null,
  });

  const createMutation = useMutation({
    mutationFn: async (data: WorkOrderFormData) => {
      if (accessDenied) throw new Error("403: Access denied");
      const troubleStatus = workOrderStatuses.find(s => s.label === "Trouble")?.label || "Trouble";
      const defaultStatus = workOrderStatuses.find(s => s.isDefault)?.label || "Open";
      const status = (data as any).trouble ? troubleStatus : defaultStatus;
      const signatureData = signaturePadRef.current?.getSignatureData() || null;
      const signatureName = signaturePadRef.current?.getSignatureName() || "";
      return apiRequest("POST", `/api/projects/${projectId}/work-orders`, {
        ...normalizeOptionalFields(data),
        status,
        signatureData,
        signatureName: signatureName || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setIsCreatingWorkOrder(false);
      form.reset();
      signaturePadRef.current?.clear();
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
      const signatureData = editSignaturePadRef.current?.getSignatureData() || null;
      const signatureName = editSignaturePadRef.current?.getSignatureName() || "";
      return apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${id}`, {
        ...normalizedData,
        signatureData,
        signatureName: signatureName || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setEditingWorkOrder(null);
      setCameFromSearch(false);
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

  // Helper to get assigned user name from ID
  const getAssignedUserName = (userId: string | null | undefined): string => {
    if (!userId) return "";
    const user = assigneesData?.users?.find(u => u.id === userId);
    return user?.label || userId;
  };

  // Helper to get assigned group name from ID
  const getAssignedGroupName = (groupId: number | null | undefined): string => {
    if (!groupId) return "";
    // Group IDs from API are formatted as "group:123", so we match by extracting the numeric part
    const group = assigneesData?.groups?.find(g => g.id === `group:${groupId}`);
    return group?.label || String(groupId);
  };

  // Helper to get combined assignment display (for exports and legacy display)
  const getAssignmentDisplay = (workOrder: ProjectWorkOrder): string => {
    const woAny = workOrder as any;
    const userName = getAssignedUserName(woAny.assignedUserId);
    const groupName = getAssignedGroupName(woAny.assignedGroupId);
    if (userName && groupName) return `${userName} / ${groupName}`;
    return userName || groupName || "";
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

  // Column header configuration for dynamic rendering
  const columnHeaderConfig: Record<string, { label: string; sortKey?: string }> = {
    customerWoId: { label: "WO ID", sortKey: "customerWoId" },
    customerId: { label: "Customer ID", sortKey: "customerId" },
    customerName: { label: "Customer Name", sortKey: "customerName" },
    address: { label: "Address", sortKey: "address" },
    city: { label: "City", sortKey: "city" },
    state: { label: "State", sortKey: "state" },
    zip: { label: "ZIP", sortKey: "zip" },
    phone: { label: "Phone", sortKey: "phone" },
    email: { label: "Email", sortKey: "email" },
    route: { label: "Route", sortKey: "route" },
    zone: { label: "Zone", sortKey: "zone" },
    serviceType: { label: "Service", sortKey: "serviceType" },
    oldMeterId: { label: "Old Meter ID", sortKey: "oldMeterId" },
    oldMeterReading: { label: "Old Meter Reading", sortKey: "oldMeterReading" },
    oldMeterType: { label: "Old Meter Type", sortKey: "oldMeterType" },
    newMeterId: { label: "New Meter ID", sortKey: "newMeterId" },
    newMeterReading: { label: "New Meter Reading", sortKey: "newMeterReading" },
    newMeterType: { label: "New Meter Type", sortKey: "newMeterType" },
    oldGps: { label: "Old GPS", sortKey: "oldGps" },
    newGps: { label: "New GPS", sortKey: "newGps" },
    status: { label: "Status", sortKey: "status" },
    scheduledDate: { label: "Scheduled Date", sortKey: "scheduledDate" },
    assignedTo: { label: "Assigned User", sortKey: "assignedUserId" },
    assignedGroup: { label: "Assigned Group", sortKey: "assignedGroupId" },
    createdBy: { label: "Created By", sortKey: "createdBy" },
    updatedBy: { label: "Updated By", sortKey: "updatedBy" },
    completedAt: { label: "Completed At", sortKey: "completedAt" },
    trouble: { label: "Trouble", sortKey: "trouble" },
    notes: { label: "Notes", sortKey: "notes" },
    createdAt: { label: "Created At", sortKey: "createdAt" },
    updatedAt: { label: "Updated At", sortKey: "updatedAt" },
  };

  // Render a table header cell for a given column key
  const renderHeaderCell = (key: string) => {
    const config = columnHeaderConfig[key];
    if (!config) return null;
    const sortKey = config.sortKey || key;
    return (
      <TableHead 
        key={key}
        className="cursor-pointer select-none" 
        onClick={() => handleSort(sortKey)}
      >
        {config.label} {getSortIcon(sortKey)}
      </TableHead>
    );
  };

  // Render a table data cell for a given column key and work order
  const renderDataCell = (key: string, workOrder: ProjectWorkOrder) => {
    const woAny = workOrder as any;
    switch (key) {
      case "customerWoId":
        return <TableCell key={key} className="font-medium" data-testid={`text-wo-id-${workOrder.id}`}>{workOrder.customerWoId || "-"}</TableCell>;
      case "customerId":
        return <TableCell key={key}>{workOrder.customerId || "-"}</TableCell>;
      case "customerName":
        return <TableCell key={key}>{workOrder.customerName || "-"}</TableCell>;
      case "address":
        return <TableCell key={key} data-testid={`text-address-${workOrder.id}`}>{workOrder.address || "-"}</TableCell>;
      case "city":
        return <TableCell key={key}>{workOrder.city || "-"}</TableCell>;
      case "state":
        return <TableCell key={key}>{workOrder.state || "-"}</TableCell>;
      case "zip":
        return <TableCell key={key}>{workOrder.zip || "-"}</TableCell>;
      case "phone":
        return <TableCell key={key}>{workOrder.phone || "-"}</TableCell>;
      case "email":
        return <TableCell key={key}>{workOrder.email || "-"}</TableCell>;
      case "route":
        return <TableCell key={key} data-testid={`text-route-${workOrder.id}`}>{workOrder.route || "-"}</TableCell>;
      case "zone":
        return <TableCell key={key} data-testid={`text-zone-${workOrder.id}`}>{workOrder.zone || "-"}</TableCell>;
      case "serviceType":
        return <TableCell key={key} data-testid={`text-service-${workOrder.id}`}>{getServiceTypeBadge(workOrder.serviceType)}</TableCell>;
      case "oldMeterId":
        return <TableCell key={key} data-testid={`text-old-meter-${workOrder.id}`}>{workOrder.oldMeterId || "-"}</TableCell>;
      case "oldMeterReading":
        return <TableCell key={key}>{workOrder.oldMeterReading ?? "-"}</TableCell>;
      case "oldMeterType":
        return <TableCell key={key}>{woAny.oldMeterType || "-"}</TableCell>;
      case "newMeterId":
        return <TableCell key={key}>{workOrder.newMeterId || "-"}</TableCell>;
      case "newMeterReading":
        return <TableCell key={key}>{workOrder.newMeterReading ?? "-"}</TableCell>;
      case "newMeterType":
        return <TableCell key={key}>{woAny.newMeterType || "-"}</TableCell>;
      case "oldGps":
        return <TableCell key={key}>{workOrder.oldGps || "-"}</TableCell>;
      case "newGps":
        return <TableCell key={key}>{workOrder.newGps || "-"}</TableCell>;
      case "status":
        return <TableCell key={key} data-testid={`text-status-${workOrder.id}`}>{getStatusBadge(workOrder.status)}</TableCell>;
      case "scheduledDate":
        return <TableCell key={key}>{woAny.scheduledDate ? formatDateTime(woAny.scheduledDate) : "-"}</TableCell>;
      case "assignedTo":
        return <TableCell key={key}>{getAssignedUserName(woAny.assignedUserId) || "-"}</TableCell>;
      case "assignedGroup":
        return <TableCell key={key}>{getAssignedGroupName(woAny.assignedGroupId) || "-"}</TableCell>;
      case "createdBy":
        return <TableCell key={key}>{woAny.createdBy || "-"}</TableCell>;
      case "updatedBy":
        return <TableCell key={key}>{woAny.updatedBy || "-"}</TableCell>;
      case "completedAt":
        return <TableCell key={key}>{workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "-"}</TableCell>;
      case "trouble":
        return <TableCell key={key}>{woAny.trouble || "-"}</TableCell>;
      case "notes":
        return <TableCell key={key} className="max-w-xs truncate">{workOrder.notes || "-"}</TableCell>;
      case "createdAt":
        return <TableCell key={key}>{workOrder.createdAt ? formatDateTime(workOrder.createdAt) : "-"}</TableCell>;
      case "updatedAt":
        return <TableCell key={key}>{workOrder.updatedAt ? formatDateTime(workOrder.updatedAt) : "-"}</TableCell>;
      default:
        return null;
    }
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
    
    // Filter by assigned to user using ID
    if (selectedAssignedTo !== "all") {
      result = result.filter(wo => {
        const woAny = wo as any;
        return woAny.assignedUserId && String(woAny.assignedUserId) === String(selectedAssignedTo);
      });
    }
    
    // Filter by assigned to group using ID
    if (selectedAssignedGroup !== "all") {
      result = result.filter(wo => {
        const woAny = wo as any;
        return woAny.assignedGroupId && String(woAny.assignedGroupId) === selectedAssignedGroup;
      });
    }
    
    // Filter by trouble code (handle null, empty, whitespace, array/JSON, and comma-delimited values)
    if (selectedTrouble !== "all") {
      if (selectedTrouble === "none") {
        result = result.filter(wo => {
          const trouble = (wo as any).trouble;
          if (!trouble || trouble === null) return true;
          const troubleStr = String(trouble).trim();
          if (troubleStr === "" || troubleStr === "[]" || troubleStr === "null") return true;
          return false;
        });
      } else {
        result = result.filter(wo => {
          const trouble = (wo as any).trouble;
          if (!trouble) return false;
          const troubleStr = String(trouble);
          // Handle JSON array format
          if (troubleStr.startsWith("[")) {
            try {
              const troubleArray = JSON.parse(troubleStr);
              if (Array.isArray(troubleArray)) {
                return troubleArray.some(t => String(t).trim() === selectedTrouble);
              }
            } catch {
              // Not valid JSON, fall through to comma-split
            }
          }
          // Handle comma-delimited format
          const troubleValues = troubleStr.split(",").map(t => t.trim());
          return troubleValues.includes(selectedTrouble);
        });
      }
    }
    
    // Filter by old meter type (handle both productId and productLabel formats)
    if (selectedOldMeterType !== "all") {
      result = result.filter(wo => {
        const oldMeterType = (wo as any).oldMeterType;
        if (!oldMeterType) return false;
        // Direct match with productId
        if (oldMeterType === selectedOldMeterType) return true;
        // Check if it matches the productLabel of the selected meter type
        const selectedMeterType = meterTypes.find(mt => mt.productId === selectedOldMeterType);
        if (selectedMeterType && oldMeterType === selectedMeterType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by new meter type (handle both productId and productLabel formats)
    if (selectedNewMeterType !== "all") {
      result = result.filter(wo => {
        const newMeterType = (wo as any).newMeterType;
        if (!newMeterType) return false;
        // Direct match with productId
        if (newMeterType === selectedNewMeterType) return true;
        // Check if it matches the productLabel of the selected meter type
        const selectedMeterType = meterTypes.find(mt => mt.productId === selectedNewMeterType);
        if (selectedMeterType && newMeterType === selectedMeterType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by text fields
    if (filterCustomerId.trim()) {
      result = result.filter(wo => wo.customerId?.toLowerCase().includes(filterCustomerId.toLowerCase()));
    }
    if (filterCustomerName.trim()) {
      result = result.filter(wo => wo.customerName?.toLowerCase().includes(filterCustomerName.toLowerCase()));
    }
    if (filterAddress.trim()) {
      result = result.filter(wo => wo.address?.toLowerCase().includes(filterAddress.toLowerCase()));
    }
    if (filterCity.trim()) {
      result = result.filter(wo => wo.city?.toLowerCase().includes(filterCity.toLowerCase()));
    }
    if (filterState.trim()) {
      result = result.filter(wo => wo.state?.toLowerCase().includes(filterState.toLowerCase()));
    }
    if (filterZip.trim()) {
      result = result.filter(wo => wo.zip?.toLowerCase().includes(filterZip.toLowerCase()));
    }
    if (filterPhone.trim()) {
      result = result.filter(wo => wo.phone?.toLowerCase().includes(filterPhone.toLowerCase()));
    }
    if (filterEmail.trim()) {
      result = result.filter(wo => wo.email?.toLowerCase().includes(filterEmail.toLowerCase()));
    }
    if (filterRoute.trim()) {
      result = result.filter(wo => wo.route?.toLowerCase().includes(filterRoute.toLowerCase()));
    }
    if (filterZone.trim()) {
      result = result.filter(wo => wo.zone?.toLowerCase().includes(filterZone.toLowerCase()));
    }
    if (filterOldMeterId.trim()) {
      result = result.filter(wo => wo.oldMeterId?.toLowerCase().includes(filterOldMeterId.toLowerCase()));
    }
    if (filterNewMeterId.trim()) {
      result = result.filter(wo => wo.newMeterId?.toLowerCase().includes(filterNewMeterId.toLowerCase()));
    }
    if (filterScheduledDate) {
      result = result.filter(wo => (wo as any).scheduledDate?.includes(filterScheduledDate));
    }
    if (filterCreatedBy !== "all") {
      // Look up user label from selected ID for fallback comparison
      const selectedUser = assigneesData?.users?.find(u => u.id === filterCreatedBy);
      const selectedUserLabel = selectedUser?.label;
      result = result.filter(wo => {
        const woAny = wo as any;
        // First try ID-based match (normalize both to strings for comparison)
        if (woAny.createdById && String(woAny.createdById) === String(filterCreatedBy)) return true;
        // Fall back to user name match
        if (selectedUserLabel && woAny.createdBy === selectedUserLabel) return true;
        return false;
      });
    }
    if (filterUpdatedBy !== "all") {
      // Look up user label from selected ID for fallback comparison
      const selectedUser = assigneesData?.users?.find(u => u.id === filterUpdatedBy);
      const selectedUserLabel = selectedUser?.label;
      result = result.filter(wo => {
        const woAny = wo as any;
        // First try ID-based match (normalize both to strings for comparison)
        if (woAny.updatedById && String(woAny.updatedById) === String(filterUpdatedBy)) return true;
        // Fall back to user name match
        if (selectedUserLabel && woAny.updatedBy === selectedUserLabel) return true;
        return false;
      });
    }
    if (filterCompletedAt) {
      result = result.filter(wo => wo.completedAt && String(wo.completedAt).includes(filterCompletedAt));
    }
    if (filterNotes.trim()) {
      result = result.filter(wo => wo.notes?.toLowerCase().includes(filterNotes.toLowerCase()));
    }
    if (filterCreatedAt) {
      result = result.filter(wo => wo.createdAt && String(wo.createdAt).includes(filterCreatedAt));
    }
    if (filterUpdatedAt) {
      result = result.filter(wo => wo.updatedAt && String(wo.updatedAt).includes(filterUpdatedAt));
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
  }, [workOrders, searchQuery, sortColumn, sortDirection, selectedStatus, selectedServiceType, dateFrom, dateTo, selectedAssignedTo, selectedAssignedGroup, selectedTrouble, selectedOldMeterType, selectedNewMeterType, meterTypes, assigneesData, filterCustomerId, filterCustomerName, filterAddress, filterCity, filterState, filterZip, filterPhone, filterEmail, filterRoute, filterZone, filterOldMeterId, filterNewMeterId, filterScheduledDate, filterCreatedBy, filterUpdatedBy, filterCompletedAt, filterNotes, filterCreatedAt, filterUpdatedAt]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setDateFrom("");
    setDateTo("");
    setSelectedAssignedTo("all");
    setSelectedAssignedGroup("all");
    setSelectedTrouble("all");
    setSelectedOldMeterType("all");
    setSelectedNewMeterType("all");
    setFilterCustomerId("");
    setFilterCustomerName("");
    setFilterAddress("");
    setFilterCity("");
    setFilterState("");
    setFilterZip("");
    setFilterPhone("");
    setFilterEmail("");
    setFilterRoute("");
    setFilterZone("");
    setFilterOldMeterId("");
    setFilterNewMeterId("");
    setFilterScheduledDate("");
    setFilterCreatedBy("all");
    setFilterUpdatedBy("all");
    setFilterCompletedAt("");
    setFilterNotes("");
    setFilterCreatedAt("");
    setFilterUpdatedAt("");
  };

  const hasActiveFilters = selectedStatus !== "all" || selectedServiceType !== "all" || dateFrom !== "" || dateTo !== "" || selectedAssignedTo !== "all" || selectedAssignedGroup !== "all" || selectedTrouble !== "all" || selectedOldMeterType !== "all" || selectedNewMeterType !== "all" || filterCustomerId !== "" || filterCustomerName !== "" || filterAddress !== "" || filterCity !== "" || filterState !== "" || filterZip !== "" || filterPhone !== "" || filterEmail !== "" || filterRoute !== "" || filterZone !== "" || filterOldMeterId !== "" || filterNewMeterId !== "" || filterScheduledDate !== "" || filterCreatedBy !== "all" || filterUpdatedBy !== "all" || filterCompletedAt !== "" || filterNotes !== "" || filterCreatedAt !== "" || filterUpdatedAt !== "";

  // Helper to get export value for a column key
  const getExportValue = (wo: ProjectWorkOrder, key: string): string => {
    switch (key) {
      case "customerWoId": return wo.customerWoId || "";
      case "customerId": return wo.customerId || "";
      case "customerName": return wo.customerName || "";
      case "address": return wo.address || "";
      case "city": return wo.city || "";
      case "state": return wo.state || "";
      case "zip": return wo.zip || "";
      case "phone": return wo.phone || "";
      case "email": return wo.email || "";
      case "route": return wo.route || "";
      case "zone": return wo.zone || "";
      case "serviceType": return wo.serviceType || "";
      case "oldMeterId": return wo.oldMeterId || "";
      case "oldMeterType": return wo.oldMeterType || "";
      case "oldMeterReading": return wo.oldMeterReading?.toString() ?? "";
      case "newMeterId": return wo.newMeterId || "";
      case "newMeterReading": return wo.newMeterReading?.toString() ?? "";
      case "newMeterType": return wo.newMeterType || "";
      case "oldGps": return wo.oldGps || "";
      case "newGps": return wo.newGps || "";
      case "status": return wo.status;
      case "scheduledDate": return (wo as any).scheduledDate ? formatExport((wo as any).scheduledDate) : "";
      case "assignedTo": return getAssignedUserName((wo as any).assignedUserId) || "";
      case "assignedGroup": return getAssignedGroupName((wo as any).assignedGroupId) || "";
      case "createdBy": return wo.createdBy || "";
      case "updatedBy": return wo.updatedBy || "";
      case "completedAt": return wo.completedAt ? formatExport(wo.completedAt) : "";
      case "trouble": return wo.trouble || "";
      case "notes": return wo.notes || "";
      case "createdAt": return wo.createdAt ? formatExport(wo.createdAt) : "";
      case "updatedAt": return wo.updatedAt ? formatExport(wo.updatedAt) : "";
      default: return "";
    }
  };

  const exportToCSV = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use visibleColumns in user's preferred order
    const columnMap = new Map(workOrderColumns.map(c => [c.key, c]));
    const exportColumns = visibleColumns
      .filter(key => key !== "actions" && columnMap.has(key))
      .map(key => columnMap.get(key)!);
    const headers = exportColumns.map(col => col.label);
    const rows = filteredAndSortedWorkOrders.map(wo => 
      exportColumns.map(col => getExportValue(wo, col.key))
    );

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${project?.name || "work-orders"}-${formatCustom(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({ title: "CSV exported successfully" });
  };

  const exportToExcel = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use visibleColumns in user's preferred order
    const columnMap = new Map(workOrderColumns.map(c => [c.key, c]));
    const exportColumns = visibleColumns
      .filter(key => key !== "actions" && columnMap.has(key))
      .map(key => columnMap.get(key)!);
    
    const data = filteredAndSortedWorkOrders.map(wo => {
      const row: Record<string, string> = {};
      exportColumns.forEach(col => {
        row[col.label] = getExportValue(wo, col.key);
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Orders");
    XLSX.writeFile(workbook, `${project?.name || "work-orders"}-${formatCustom(new Date(), "yyyy-MM-dd")}.xlsx`);

    toast({ title: "Excel file exported successfully" });
  };

  const exportToPDF = () => {
    if (!filteredAndSortedWorkOrders.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use visibleColumns in user's preferred order
    const columnMap = new Map(workOrderColumns.map(c => [c.key, c]));
    const exportColumns = visibleColumns
      .filter(key => key !== "actions" && columnMap.has(key))
      .map(key => columnMap.get(key)!);

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
        </style>
      </head>
      <body>
        <h1>${project?.name || "Work Orders"} Report</h1>
        <div class="meta">
          <p>Generated: ${formatCustom(new Date(), "MMMM d, yyyy 'at' h:mm a")}</p>
          <p>Total Results: ${filteredAndSortedWorkOrders.length}</p>
        </div>
        <table>
          <thead>
            <tr>
              ${exportColumns.map(col => `<th>${col.label}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${filteredAndSortedWorkOrders.map(wo => `
              <tr>
                ${exportColumns.map(col => `<td>${getExportValue(wo, col.key) || "-"}</td>`).join("")}
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
          {cameFromSearch ? (
            <Link href="/search">
              <Button 
                variant="ghost" 
                className="mb-4"
                data-testid="button-back-to-search"
                onClick={() => setCameFromSearch(false)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Search
              </Button>
            </Link>
          ) : (
            <Button 
              variant="ghost" 
              onClick={() => {
                setEditingWorkOrder(null);
                setCameFromSearch(false);
              }} 
              className="mb-4"
              data-testid="button-back-to-work-orders"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Work Orders
            </Button>
          )}
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
                        <div className="flex gap-1">
                          <Select 
                            value={(field.value as string) || "__none__"} 
                            onValueChange={(val) => {
                              field.onChange(val === "__none__" ? "" : val);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-old-meter-type" className="flex-1">
                                <SelectValue placeholder="Select old meter type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {meterTypes.map((mt) => (
                                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCreateMeterTypeDialog("editOldMeterType");
                            }}
                            data-testid="button-create-edit-old-meter-type"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
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
                        <div className="flex gap-1">
                          <Select 
                            value={(field.value as string) || "__none__"} 
                            onValueChange={(val) => {
                              field.onChange(val === "__none__" ? "" : val);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-new-meter-type" className="flex-1">
                                <SelectValue placeholder="Select new meter type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {meterTypes.map((mt) => (
                                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCreateMeterTypeDialog("editNewMeterType");
                            }}
                            data-testid="button-create-edit-new-meter-type"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="md:col-span-2">
                    <SignaturePad 
                      ref={editSignaturePadRef}
                      initialSignatureData={(editingWorkOrder as any)?.signatureData}
                      initialSignatureName={(editingWorkOrder as any)?.signatureName}
                    />
                  </div>
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
                    name="assignedUserId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned User</FormLabel>
                        <Select value={field.value ?? "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : v)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-assigned-user">
                              <SelectValue placeholder="Select user..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {assigneesData?.users?.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.label}
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
                    name="assignedGroupId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Group</FormLabel>
                        <Select value={field.value != null ? `group:${field.value}` : "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v.replace("group:", "")))}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-assigned-group">
                              <SelectValue placeholder="Select group..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {assigneesData?.groups?.map((group) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.label}
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
                        <FormLabel>Scheduled Date & Time</FormLabel>
                        <FormControl>
                          <Input
                            type="datetime-local"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-edit-scheduled-date"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Setting a date/time will auto-set status to "Scheduled"</p>
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
                        value={editingWorkOrder.createdAt ? formatDateTime(editingWorkOrder.createdAt) : "-"} 
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
                        value={editingWorkOrder.updatedAt ? formatDateTime(editingWorkOrder.updatedAt) : "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-updated-at"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Completed At</label>
                      <Input 
                        value={editingWorkOrder.completedAt ? formatDateTime(editingWorkOrder.completedAt) : "-"} 
                        disabled 
                        className="mt-1 bg-muted"
                        data-testid="text-completed-at"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="outline" onClick={() => { setEditingWorkOrder(null); setCameFromSearch(false); }}>Cancel</Button>
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
                        <div className="flex gap-1">
                          <Select 
                            value={(field.value as string) || "__none__"} 
                            onValueChange={(val) => {
                              field.onChange(val === "__none__" ? "" : val);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-create-old-meter-type" className="flex-1">
                                <SelectValue placeholder="Select old meter type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {meterTypes.map((mt) => (
                                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCreateMeterTypeDialog("oldMeterType");
                            }}
                            data-testid="button-create-old-meter-type"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
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
                        <div className="flex gap-1">
                          <Select 
                            value={(field.value as string) || "__none__"} 
                            onValueChange={(val) => {
                              field.onChange(val === "__none__" ? "" : val);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-create-new-meter-type" className="flex-1">
                                <SelectValue placeholder="Select new meter type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {meterTypes.map((mt) => (
                                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCreateMeterTypeDialog("newMeterType");
                            }}
                            data-testid="button-create-new-meter-type"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="md:col-span-2">
                    <SignaturePad ref={signaturePadRef} />
                  </div>
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
                    name="assignedUserId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned User</FormLabel>
                        <Select value={field.value ?? "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : v)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-create-assigned-user">
                              <SelectValue placeholder="Select user..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {assigneesData?.users?.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.label}
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
                    name="assignedGroupId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Group</FormLabel>
                        <Select value={field.value != null ? `group:${field.value}` : "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v.replace("group:", "")))}>
                          <FormControl>
                            <SelectTrigger data-testid="select-create-assigned-group">
                              <SelectValue placeholder="Select group..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {assigneesData?.groups?.map((group) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.label}
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
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scheduled Date & Time</FormLabel>
                        <FormControl>
                          <Input
                            type="datetime-local"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-create-scheduled-date"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Setting a date/time will auto-set status to "Scheduled"</p>
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
                Project Documents
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
          {workOrderStatuses
            .slice()
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((status) => (
              <Card key={status.id}>
                <CardHeader className="pb-2">
                  <CardDescription>{status.label}</CardDescription>
                  <CardTitle className="text-2xl" data-testid={`stat-${status.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    {stats.statusCounts[status.label] || 0}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
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
              <ColumnSelector
                allColumns={workOrderColumns}
                visibleColumns={visibleColumns}
                onChange={setVisibleColumns}
                disabled={columnPrefsLoading}
                orderedColumns={orderedColumns}
              />
              <FilterSelector
                allFilters={workOrderFilters}
                visibleFilters={visibleFilters}
                onChange={setVisibleFilters}
                disabled={filterPrefsLoading}
              />
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
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
              {isFilterVisible("customerWoId") && (
                <div className="min-w-[200px] flex-1 max-w-md">
                  <Label htmlFor="filter-search">Search</Label>
                  <Input
                    id="filter-search"
                    placeholder="Search WO ID, name, address, meter..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-filter-search"
                  />
                </div>
              )}
              {isFilterVisible("status") && (
                <div className="min-w-[180px]">
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
              )}
              {isFilterVisible("serviceType") && (
                <div className="min-w-[180px]">
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
              )}
              {isFilterVisible("dateFrom") && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-date-from">Created From</Label>
                  <Input
                    id="filter-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    data-testid="input-filter-date-from"
                  />
                </div>
              )}
              {isFilterVisible("dateTo") && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-date-to">Created To</Label>
                  <Input
                    id="filter-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    data-testid="input-filter-date-to"
                  />
                </div>
              )}
              {isFilterVisible("assignedTo") && assigneesData && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-assigned-to">Assigned To (User)</Label>
                  <Select value={selectedAssignedTo} onValueChange={setSelectedAssignedTo}>
                    <SelectTrigger id="filter-assigned-to" data-testid="select-filter-assigned-to">
                      <SelectValue placeholder="All Users" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("assignedGroup") && assigneesData && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-assigned-group">Assigned To (Group)</Label>
                  <Select value={selectedAssignedGroup} onValueChange={setSelectedAssignedGroup}>
                    <SelectTrigger id="filter-assigned-group" data-testid="select-filter-assigned-group">
                      <SelectValue placeholder="All Groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Groups</SelectItem>
                      {assigneesData.groups.map((group) => (
                        <SelectItem key={group.id} value={String(group.id)}>{group.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("trouble") && troubleCodes.length > 0 && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-trouble">Trouble Code</Label>
                  <Select value={selectedTrouble} onValueChange={setSelectedTrouble}>
                    <SelectTrigger id="filter-trouble" data-testid="select-filter-trouble">
                      <SelectValue placeholder="All Trouble Codes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Trouble Codes</SelectItem>
                      <SelectItem value="none">No Trouble</SelectItem>
                      {troubleCodes.map((tc) => (
                        <SelectItem key={tc.id} value={tc.code}>{tc.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("oldMeterType") && meterTypes.length > 0 && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-old-meter-type">Old Meter Type</Label>
                  <Select value={selectedOldMeterType} onValueChange={setSelectedOldMeterType}>
                    <SelectTrigger id="filter-old-meter-type" data-testid="select-filter-old-meter-type">
                      <SelectValue placeholder="All Meter Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Meter Types</SelectItem>
                      {meterTypes.map((mt) => (
                        <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("newMeterType") && meterTypes.length > 0 && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-new-meter-type">New Meter Type</Label>
                  <Select value={selectedNewMeterType} onValueChange={setSelectedNewMeterType}>
                    <SelectTrigger id="filter-new-meter-type" data-testid="select-filter-new-meter-type">
                      <SelectValue placeholder="All Meter Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Meter Types</SelectItem>
                      {meterTypes.map((mt) => (
                        <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("customerId") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-customer-id">Customer ID</Label>
                  <Input id="filter-customer-id" placeholder="Filter..." value={filterCustomerId} onChange={(e) => setFilterCustomerId(e.target.value)} data-testid="input-filter-customer-id" />
                </div>
              )}
              {isFilterVisible("customerName") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-customer-name">Customer Name</Label>
                  <Input id="filter-customer-name" placeholder="Filter..." value={filterCustomerName} onChange={(e) => setFilterCustomerName(e.target.value)} data-testid="input-filter-customer-name" />
                </div>
              )}
              {isFilterVisible("address") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-address">Address</Label>
                  <Input id="filter-address" placeholder="Filter..." value={filterAddress} onChange={(e) => setFilterAddress(e.target.value)} data-testid="input-filter-address" />
                </div>
              )}
              {isFilterVisible("city") && (
                <div className="min-w-[120px]">
                  <Label htmlFor="filter-city">City</Label>
                  <Input id="filter-city" placeholder="Filter..." value={filterCity} onChange={(e) => setFilterCity(e.target.value)} data-testid="input-filter-city" />
                </div>
              )}
              {isFilterVisible("state") && (
                <div className="min-w-[100px]">
                  <Label htmlFor="filter-state">State</Label>
                  <Input id="filter-state" placeholder="Filter..." value={filterState} onChange={(e) => setFilterState(e.target.value)} data-testid="input-filter-state" />
                </div>
              )}
              {isFilterVisible("zip") && (
                <div className="min-w-[100px]">
                  <Label htmlFor="filter-zip">ZIP</Label>
                  <Input id="filter-zip" placeholder="Filter..." value={filterZip} onChange={(e) => setFilterZip(e.target.value)} data-testid="input-filter-zip" />
                </div>
              )}
              {isFilterVisible("phone") && (
                <div className="min-w-[120px]">
                  <Label htmlFor="filter-phone">Phone</Label>
                  <Input id="filter-phone" placeholder="Filter..." value={filterPhone} onChange={(e) => setFilterPhone(e.target.value)} data-testid="input-filter-phone" />
                </div>
              )}
              {isFilterVisible("email") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-email">Email</Label>
                  <Input id="filter-email" placeholder="Filter..." value={filterEmail} onChange={(e) => setFilterEmail(e.target.value)} data-testid="input-filter-email" />
                </div>
              )}
              {isFilterVisible("route") && (
                <div className="min-w-[100px]">
                  <Label htmlFor="filter-route">Route</Label>
                  <Input id="filter-route" placeholder="Filter..." value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)} data-testid="input-filter-route" />
                </div>
              )}
              {isFilterVisible("zone") && (
                <div className="min-w-[100px]">
                  <Label htmlFor="filter-zone">Zone</Label>
                  <Input id="filter-zone" placeholder="Filter..." value={filterZone} onChange={(e) => setFilterZone(e.target.value)} data-testid="input-filter-zone" />
                </div>
              )}
              {isFilterVisible("oldMeterId") && (
                <div className="min-w-[120px]">
                  <Label htmlFor="filter-old-meter-id">Old Meter ID</Label>
                  <Input id="filter-old-meter-id" placeholder="Filter..." value={filterOldMeterId} onChange={(e) => setFilterOldMeterId(e.target.value)} data-testid="input-filter-old-meter-id" />
                </div>
              )}
              {isFilterVisible("newMeterId") && (
                <div className="min-w-[120px]">
                  <Label htmlFor="filter-new-meter-id">New Meter ID</Label>
                  <Input id="filter-new-meter-id" placeholder="Filter..." value={filterNewMeterId} onChange={(e) => setFilterNewMeterId(e.target.value)} data-testid="input-filter-new-meter-id" />
                </div>
              )}
              {isFilterVisible("scheduledDate") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-scheduled-date">Scheduled Date</Label>
                  <Input id="filter-scheduled-date" type="date" value={filterScheduledDate} onChange={(e) => setFilterScheduledDate(e.target.value)} data-testid="input-filter-scheduled-date" />
                </div>
              )}
              {isFilterVisible("createdBy") && assigneesData && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-created-by">Created By</Label>
                  <Select value={filterCreatedBy} onValueChange={setFilterCreatedBy}>
                    <SelectTrigger id="filter-created-by" data-testid="select-filter-created-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("updatedBy") && assigneesData && (
                <div className="min-w-[180px]">
                  <Label htmlFor="filter-updated-by">Updated By</Label>
                  <Select value={filterUpdatedBy} onValueChange={setFilterUpdatedBy}>
                    <SelectTrigger id="filter-updated-by" data-testid="select-filter-updated-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isFilterVisible("completedAt") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-completed-at">Completed At</Label>
                  <Input id="filter-completed-at" type="date" value={filterCompletedAt} onChange={(e) => setFilterCompletedAt(e.target.value)} data-testid="input-filter-completed-at" />
                </div>
              )}
              {isFilterVisible("notes") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-notes">Notes</Label>
                  <Input id="filter-notes" placeholder="Filter..." value={filterNotes} onChange={(e) => setFilterNotes(e.target.value)} data-testid="input-filter-notes" />
                </div>
              )}
              {isFilterVisible("createdAt") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-created-at">Created At</Label>
                  <Input id="filter-created-at" type="date" value={filterCreatedAt} onChange={(e) => setFilterCreatedAt(e.target.value)} data-testid="input-filter-created-at" />
                </div>
              )}
              {isFilterVisible("updatedAt") && (
                <div className="min-w-[150px]">
                  <Label htmlFor="filter-updated-at">Updated At</Label>
                  <Input id="filter-updated-at" type="date" value={filterUpdatedAt} onChange={(e) => setFilterUpdatedAt(e.target.value)} data-testid="input-filter-updated-at" />
                </div>
              )}
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
            <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map(key => renderHeaderCell(key))}
                    {user?.role !== "customer" && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedWorkOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">
                        No work orders match your search
                      </TableCell>
                    </TableRow>
                  ) : filteredAndSortedWorkOrders.map((workOrder) => (
                    <TableRow key={workOrder.id} data-testid={`row-work-order-${workOrder.id}`}>
                      {visibleColumns.map(key => renderDataCell(key, workOrder))}
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
            </div>
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
