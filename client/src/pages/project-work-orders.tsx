import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ColumnSelector, type ColumnConfig } from "@/components/column-selector";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { type FilterConfig } from "@/components/filter-selector";
import { SortDialog } from "@/components/SortDialog";
import { RouteSheetDialog } from "@/components/RouteSheetDialog";
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
import { formatDateTimeInTimezone, formatForExport, formatInTimezone } from "@/lib/timezone";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { usePageHeader } from "@/contexts/page-header-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardList, Trash2, ShieldAlert, Folder, Pencil, Upload, ArrowLeft, Search, ArrowUpDown, ArrowUp, ArrowDown, Download, FileSpreadsheet, FileText, Filter, X, Route, ChevronRight, Paperclip, Eye, FileIcon, ChevronsUp, UserPlus, UserMinus, AlertTriangle, Loader2, Wrench, Home, Gauge, Cpu, Calendar } from "lucide-react";
import { BackToTop } from "@/components/ui/back-to-top";
import { TablePagination } from "@/components/ui/table-pagination";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";
import type { Project, WorkOrderStatus, TroubleCode, ServiceTypeRecord, SystemType, ModuleType } from "@shared/schema";
import { insertProjectWorkOrderSchema, permissionKeys } from "@shared/schema";
import { usePermissions } from "@/hooks/usePermissions";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Users, ChevronDown, ChevronUp, BarChart3, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SignaturePad, { SignaturePadRef } from "@/components/signature-pad";
import { WorkOrderDetail } from "@/components/work-order-detail";
import { ScannerInput } from "@/components/scanner-input";
import { GPSCapture } from "@/components/gps-capture";
import { StartSystemChangeoutDialog } from "@/components/start-system-changeout-dialog";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { WorkOrderCalendar } from "@/components/work-order-calendar";
import { WorkOrderFiltersDialog } from "@/components/work-order-filters-dialog";
import { Calendar as CalendarIcon, List } from "lucide-react";

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
  
  // Track editing work order ID in a ref for SSE callback (avoids stale closure)
  const editingWorkOrderIdRef = useRef<number | null>(null);
  
  // Helper function to recursively convert snake_case keys to camelCase
  const snakeToCamelCase = (data: any): any => {
    if (data === null || data === undefined) {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map(snakeToCamelCase);
    }
    if (typeof data === "object" && !(data instanceof Date)) {
      const result: Record<string, any> = {};
      for (const key of Object.keys(data)) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        result[camelKey] = snakeToCamelCase(data[key]);
      }
      return result;
    }
    return data;
  };
  
  // SSE callback to refresh work order detail when updated by another user
  const handleWorkOrderUpdated = useCallback(async (workOrderId: number) => {
    if (editingWorkOrderIdRef.current === workOrderId && projectId) {
      try {
        const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrderId}`, {
          credentials: "include",
        });
        if (response.ok) {
          const rawWorkOrder = await response.json();
          // Transform snake_case API response to camelCase for component compatibility
          const updatedWorkOrder = snakeToCamelCase(rawWorkOrder) as ProjectWorkOrder;
          setEditingWorkOrder(updatedWorkOrder);
        }
      } catch (error) {
        console.error("Failed to refresh work order from SSE event:", error);
      }
    }
  }, [projectId]);
  
  useProjectEvents(projectId, { onWorkOrderUpdated: handleWorkOrderUpdated });
  
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const { setHeaderContent } = usePageHeader();
  const { toast } = useToast();
  const { timezone: globalTimezone } = useTimezone();
  const [, navigate] = useLocation();
  const [isCreatingWorkOrder, setIsCreatingWorkOrder] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<ProjectWorkOrder | null>(null);
  
  // Keep ref in sync with editingWorkOrder state for SSE callback
  useEffect(() => {
    editingWorkOrderIdRef.current = editingWorkOrder?.id ?? null;
  }, [editingWorkOrder]);
  const [accessDeniedForProject, setAccessDeniedForProject] = useState<number | null>(null);
  const accessDenied = accessDeniedForProject === projectId;
  const [searchQuery, setSearchQuery] = useState("");
  const [sortCriteria, setSortCriteria] = useState<Array<{ column: string; direction: "asc" | "desc" }>>([]);
  const [showRouteSheetDialog, setShowRouteSheetDialog] = useState(false);
  const [showStartSystemChangeout, setShowStartSystemChangeout] = useState(false);
  const [autoLaunchSystemChangeout, setAutoLaunchSystemChangeout] = useState(false);
  const [autoLaunchChangeoutScope, setAutoLaunchChangeoutScope] = useState<"system" | "module" | "both">("system");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedServiceType, setSelectedServiceType] = useState<string>("all");
  const [selectedAssignedTo, setSelectedAssignedTo] = useState<string>("all");
  const [selectedAssignedGroup, setSelectedAssignedGroup] = useState<string>("all");
  const [selectedTrouble, setSelectedTrouble] = useState<string>("all");
  const [selectedOldSystemType, setSelectedOldSystemType] = useState<string>("all");
  const [selectedNewSystemType, setSelectedNewSystemType] = useState<string>("all");
  const [selectedOldModuleType, setSelectedOldModuleType] = useState<string>("all");
  const [selectedNewModuleType, setSelectedNewModuleType] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showMobileStats, setShowMobileStats] = useState(false);
  const [showMobileTools, setShowMobileTools] = useState(() => {
    // Default to expanded on desktop (md breakpoint = 768px)
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return false;
  });
  const [filterSystemWoId, setFilterSystemWoId] = useState("");
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
  const [filterOldSystemId, setFilterOldSystemId] = useState("");
  const [filterNewSystemId, setFilterNewSystemId] = useState("");
  const [filterOldModuleId, setFilterOldModuleId] = useState("");
  const [filterNewModuleId, setFilterNewModuleId] = useState("");
  const [filterScheduledDateFrom, setFilterScheduledDateFrom] = useState("");
  const [filterScheduledDateTo, setFilterScheduledDateTo] = useState("");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");
  const [filterUpdatedBy, setFilterUpdatedBy] = useState("all");
  const [filterScheduledBy, setFilterScheduledBy] = useState("all");
  const [filterCompletedBy, setFilterCompletedBy] = useState("all");
  const [filterCompletedAtFrom, setFilterCompletedAtFrom] = useState("");
  const [filterCompletedAtTo, setFilterCompletedAtTo] = useState("");
  const [filterNotes, setFilterNotes] = useState("");
  const [filterCreatedAtFrom, setFilterCreatedAtFrom] = useState("");
  const [filterCreatedAtTo, setFilterCreatedAtTo] = useState("");
  const [filterUpdatedAtFrom, setFilterUpdatedAtFrom] = useState("");
  const [filterUpdatedAtTo, setFilterUpdatedAtTo] = useState("");
  const [createSystemTypeOpen, setCreateSystemTypeOpen] = useState(false);
  const [systemTypeField, setSystemTypeField] = useState<"oldSystemType" | "newSystemType" | "editOldSystemType" | "editNewSystemType" | null>(null);
  const [cameFromSearch, setCameFromSearch] = useState(false);
  const [newSystemTypeProductId, setNewSystemTypeProductId] = useState("");
  const [newSystemTypeLabel, setNewSystemTypeLabel] = useState("");
  const [newSystemTypeDescription, setNewSystemTypeDescription] = useState("");
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
  const [bulkAssignAction, setBulkAssignAction] = useState<"assign" | "unassign">("assign");
  const [bulkAssigneeType, setBulkAssigneeType] = useState<"user" | "group">("user");
  const [bulkAssigneeId, setBulkAssigneeId] = useState<string>("");
  const [bulkAssignStep, setBulkAssignStep] = useState<"select" | "confirm">("select");
  const [bulkAssignCheckResult, setBulkAssignCheckResult] = useState<{
    total: number;
    assignableCount: number;
    existingAssignments: number;
    completedCount: number;
    closedCount: number;
    scheduledCount: number;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isAutoPageSize, setIsAutoPageSize] = useState(true);
  const [selectedWorkOrderIds, setSelectedWorkOrderIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showBulkStatusDialog, setShowBulkStatusDialog] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState<string>("");
  const [bulkStatusCheckResult, setBulkStatusCheckResult] = useState<{
    total: number;
    eligibleCount: number;
    scheduledCount: number;
    completedCount: number;
    troubleCount: number;
    canClose: boolean;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [workOrderForCalendarScheduling, setWorkOrderForCalendarScheduling] = useState<ProjectWorkOrder | null>(null);

  const signaturePadRef = useRef<SignaturePadRef>(null);
  const editSignaturePadRef = useRef<SignaturePadRef>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const historyPushedRef = useRef(false);

  // Define system and module column keys for filtering (used throughout component)
  const systemColumnKeys = ["oldSystemId", "oldSystemReading", "oldSystemType", "newSystemId", "newSystemReading", "newSystemType"];
  const moduleColumnKeys = ["oldModuleId", "oldModuleRead", "oldModuleType", "newModuleId", "newModuleRead", "newModuleType"];

  // Column configuration for the work orders table
  const workOrderColumns: ColumnConfig[] = useMemo(() => [
    { key: "id", label: "System WO ID" },
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
    { key: "oldSystemId", label: "Old System ID" },
    { key: "oldSystemReading", label: "Old System Reading" },
    { key: "oldSystemType", label: "Old System Type" },
    { key: "newSystemId", label: "New System ID" },
    { key: "newSystemReading", label: "New System Reading" },
    { key: "newSystemType", label: "New System Type" },
    { key: "oldModuleId", label: "Old Module ID" },
    { key: "oldModuleRead", label: "Old Module Reading" },
    { key: "oldModuleType", label: "Old Module Type" },
    { key: "newModuleId", label: "New Module ID" },
    { key: "newModuleRead", label: "New Module Reading" },
    { key: "newModuleType", label: "New Module Type" },
    { key: "oldGps", label: "Old GPS" },
    { key: "newGps", label: "New GPS" },
    { key: "status", label: "Status" },
    { key: "scheduledAt", label: "Scheduled At" },
    { key: "scheduledBy", label: "Scheduled By" },
    { key: "assignedTo", label: "Assigned User" },
    { key: "assignedGroup", label: "Assigned Group" },
    { key: "createdBy", label: "Created By" },
    { key: "updatedBy", label: "Updated By" },
    { key: "completedAt", label: "Completed At" },
    { key: "completedBy", label: "Completed By" },
    { key: "trouble", label: "Trouble" },
    { key: "notes", label: "Notes" },
    { key: "createdAt", label: "Created At" },
    { key: "updatedAt", label: "Updated At" },
  ], []);

  const { visibleColumns, setVisibleColumns, isColumnVisible, isLoading: columnPrefsLoading, orderedColumns, stickyColumns, setStickyColumns } = useColumnPreferences("work_orders", workOrderColumns);

  // Filter configuration - matches columns (excluding attachments and signature_data)
  const workOrderFilters: FilterConfig[] = useMemo(() => [
    { key: "id", label: "System WO ID" },
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
    { key: "oldSystemId", label: "Old System ID" },
    { key: "oldSystemType", label: "Old System Type" },
    { key: "newSystemId", label: "New System ID" },
    { key: "newSystemType", label: "New System Type" },
    { key: "oldModuleId", label: "Old Module ID" },
    { key: "oldModuleType", label: "Old Module Type" },
    { key: "newModuleId", label: "New Module ID" },
    { key: "newModuleType", label: "New Module Type" },
    { key: "status", label: "Status" },
    { key: "scheduledAt", label: "Scheduled At" },
    { key: "scheduledBy", label: "Scheduled By" },
    { key: "assignedTo", label: "Assigned To (User)" },
    { key: "assignedGroup", label: "Assigned To (Group)" },
    { key: "createdBy", label: "Created By" },
    { key: "updatedBy", label: "Updated By" },
    { key: "completedAt", label: "Completed At" },
    { key: "completedBy", label: "Completed By" },
    { key: "trouble", label: "Trouble" },
    { key: "notes", label: "Notes" },
    { key: "createdAt", label: "Created At" },
    { key: "updatedAt", label: "Updated At" },
  ], []);


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
      serviceType: "",
      oldSystemId: "",
      oldSystemReading: undefined,
      newSystemId: "",
      newSystemReading: undefined,
      oldGps: "",
      newGps: "",
      notes: "",
      assignedUserId: undefined,
      assignedGroupId: undefined,
      scheduledAt: "",
      trouble: "",
      oldSystemType: "",
      newSystemType: "",
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
      serviceType: "",
      oldSystemId: "",
      oldSystemReading: undefined,
      newSystemId: "",
      newSystemReading: undefined,
      oldGps: "",
      newGps: "",
      notes: "",
      status: "Open",
      assignedUserId: undefined,
      assignedGroupId: undefined,
      scheduledAt: "",
      trouble: "",
      oldSystemType: "",
      newSystemType: "",
      oldModuleId: "",
      oldModuleRead: undefined,
      oldModuleType: "",
      newModuleId: "",
      newModuleRead: undefined,
      newModuleType: "",
    },
  });

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });


  // Use project-specific timezone with fallback to global timezone
  const effectiveTimezone = project?.timezone || globalTimezone;
  
  // Project-aware date formatting functions
  const formatDateTime = useCallback((date: string | Date | null | undefined): string => {
    return formatDateTimeInTimezone(date, effectiveTimezone);
  }, [effectiveTimezone]);
  
  const formatExport = useCallback((date: string | Date | null | undefined): string => {
    return formatForExport(date, effectiveTimezone);
  }, [effectiveTimezone]);
  
  const formatCustom = useCallback((date: string | Date | null | undefined, formatStr: string): string => {
    return formatInTimezone(date, effectiveTimezone, formatStr);
  }, [effectiveTimezone]);

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

  const { data: allServiceTypes = [], isLoading: allServiceTypesLoading } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
  });

  // Fetch project-specific service types (if any assigned)
  const { data: projectServiceTypes = [], isLoading: projectServiceTypesLoading } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/projects", projectId, "service-types"],
    enabled: !!projectId && !accessDenied,
  });

  // Use project service types if any are assigned, otherwise use all service types
  // Always fall back to all types when project-specific data is still loading or on error
  const serviceTypes = useMemo(() => {
    // If project service types are still loading, show all types as fallback
    if (projectServiceTypesLoading && allServiceTypes.length > 0) {
      return allServiceTypes;
    }
    // If project has assigned service types, use those
    if (projectServiceTypes.length > 0) {
      return projectServiceTypes;
    }
    // Otherwise use all service types
    return allServiceTypes;
  }, [projectServiceTypes, allServiceTypes, projectServiceTypesLoading]);

  const { data: systemTypes = [] } = useQuery<SystemType[]>({
    queryKey: ["/api/system-types", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/system-types?projectId=${projectId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!projectId && !accessDenied,
  });

  const { data: moduleTypes = [] } = useQuery<ModuleType[]>({
    queryKey: ["/api/module-types", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/module-types?projectId=${projectId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!projectId && !accessDenied,
  });

  const { data: workOrderFiles = [], isLoading: filesLoading } = useQuery<string[]>({
    queryKey: [`/api/projects/${projectId}/work-orders/${editingWorkOrder?.id}/files`],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/work-orders/${editingWorkOrder?.id}/files`, { credentials: "include" });
      return res.json();
    },
    enabled: !!projectId && !!editingWorkOrder?.id,
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
        setAccessDeniedForProject(projectId);
      }
    }
  }, [projectError, workOrdersError, statsError]);

  // Reset filters when project changes
  useEffect(() => {
    setSearchQuery("");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setShowFilters(false);
    setIsCreatingWorkOrder(false);
    // Clean up history if we had pushed a state before project change
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      // Use replaceState to avoid navigation, just clear the marker
      window.history.replaceState({}, "", window.location.pathname);
    }
    setEditingWorkOrder(null);
    setCameFromSearch(false);
  }, [projectId]);

  // Handle ?edit=workOrderId&from=search query parameters OR history.state to auto-open a work order
  // This handles both deep links from search results AND browser back from Manage Attachments page
  useEffect(() => {
    // Skip if already editing a work order or no work orders loaded yet
    if (editingWorkOrder || workOrders.length === 0) {
      return;
    }

    // First check query parameters (priority for deep links)
    const searchParams = new URLSearchParams(window.location.search);
    const editId = searchParams.get("edit");
    const fromSearch = searchParams.get("from") === "search";
    if (editId) {
      const workOrderToEdit = workOrders.find((wo) => wo.id === parseInt(editId));
      if (workOrderToEdit) {
        setEditingWorkOrder(workOrderToEdit);
        if (fromSearch) {
          setCameFromSearch(true);
        }
        // Clear the query parameter from URL without refreshing
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
    }

    // Then check history.state (for browser back from Manage Attachments)
    const historyState = window.history.state;
    if (historyState?.workOrderDetail && historyState?.workOrderId) {
      const workOrderToRestore = workOrders.find((wo) => wo.id === historyState.workOrderId);
      if (workOrderToRestore) {
        // Restore the detail view - the history state is already there, so set the ref
        historyPushedRef.current = true;
        setEditingWorkOrder(workOrderToRestore);
      } else {
        // Work order not found - clear the stale history state
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [workOrders, editingWorkOrder]);

  // Handle browser back button when work order detail is open
  useEffect(() => {
    // When detail view opens, push a synthetic history state
    if (editingWorkOrder && !historyPushedRef.current) {
      window.history.pushState({ workOrderDetail: true, workOrderId: editingWorkOrder.id }, "");
      historyPushedRef.current = true;
    }

    const handlePopState = (event: PopStateEvent) => {
      // Only respond if we pushed state AND we're not navigating INTO another workOrderDetail state
      // (event.state is the NEW state we're navigating to after back is pressed)
      if (historyPushedRef.current && !event.state?.workOrderDetail) {
        historyPushedRef.current = false;
        // Refetch work orders to show updated data when returning to list via browser back
        queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
        queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
        setEditingWorkOrder(null);
        setCameFromSearch(false);
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [editingWorkOrder, projectId]);

  // Close detail view - handles both UI button and ensures history is clean
  const closeDetailView = useCallback(() => {
    // Refetch work orders to show updated data when returning to list
    queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
    queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
    
    if (historyPushedRef.current) {
      // If we pushed a history state, use history.back() to clean it up
      // The popstate handler will see historyPushedRef.current === true and close the view
      // Do NOT clear historyPushedRef here - let the popstate handler do it
      window.history.back();
    } else {
      // Fallback: just close the detail view directly
      setEditingWorkOrder(null);
      setCameFromSearch(false);
    }
    // Reset auto-launch flag when closing
    setAutoLaunchSystemChangeout(false);
  }, [projectId]);

  // Scroll to top when opening a work order detail
  useEffect(() => {
    if (editingWorkOrder) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
    }
  }, [editingWorkOrder?.id]);

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
        serviceType: (editingWorkOrder.serviceType as any) || "",
        oldSystemId: editingWorkOrder.oldSystemId || "",
        oldSystemReading: editingWorkOrder.oldSystemReading !== null ? Number(editingWorkOrder.oldSystemReading) : undefined,
        newSystemId: editingWorkOrder.newSystemId || "",
        newSystemReading: editingWorkOrder.newSystemReading !== null ? Number(editingWorkOrder.newSystemReading) : undefined,
        oldGps: editingWorkOrder.oldGps || "",
        newGps: editingWorkOrder.newGps || "",
        notes: editingWorkOrder.notes || "",
        status: editingWorkOrder.status || "Open",
        assignedUserId: (editingWorkOrder as any).assignedUserId || undefined,
        assignedGroupId: (editingWorkOrder as any).assignedGroupId || undefined,
        scheduledAt: (editingWorkOrder as any).scheduledAt || "",
        trouble: (editingWorkOrder as any).trouble || "",
        oldSystemType: (editingWorkOrder as any).oldSystemType || "",
        newSystemType: (editingWorkOrder as any).newSystemType || "",
        oldModuleId: (editingWorkOrder as any).oldModuleId || "",
        oldModuleRead: (editingWorkOrder as any).oldModuleRead ?? undefined,
        oldModuleType: (editingWorkOrder as any).oldModuleType || "",
        newModuleId: (editingWorkOrder as any).newModuleId || "",
        newModuleRead: (editingWorkOrder as any).newModuleRead ?? undefined,
        newModuleType: (editingWorkOrder as any).newModuleType || "",
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

  // Validation for Completed status - requires either system OR module data (or both), plus GPS and signature
  const validateCompletedStatus = (data: any, signatureData: string | null, signatureName: string): string[] => {
    const missingFields: string[] = [];
    
    // Determine if this work order has system data or module data
    const hasSystemData = data.oldSystemId || data.newSystemId;
    const hasModuleData = data.oldModuleId || data.newModuleId;
    
    // Validate system data if present
    const systemMissingFields: string[] = [];
    if (hasSystemData) {
      if (!data.oldSystemId) systemMissingFields.push("Old System ID");
      if (data.oldSystemReading === null || data.oldSystemReading === undefined || data.oldSystemReading === "") systemMissingFields.push("Old System Reading");
      if (!data.newSystemId) systemMissingFields.push("New System ID");
      if (data.newSystemReading === null || data.newSystemReading === undefined || data.newSystemReading === "") systemMissingFields.push("New System Reading");
    }
    
    // Validate module data if present
    const moduleMissingFields: string[] = [];
    if (hasModuleData) {
      if (!data.oldModuleId) moduleMissingFields.push("Old Module ID");
      if (data.oldModuleRead === null || data.oldModuleRead === undefined || data.oldModuleRead === "") moduleMissingFields.push("Old Module Reading");
      if (!data.newModuleId) moduleMissingFields.push("New Module ID");
      if (data.newModuleRead === null || data.newModuleRead === undefined || data.newModuleRead === "") moduleMissingFields.push("New Module Reading");
    }
    
    // Must have at least one complete set (system or module)
    if (!hasSystemData && !hasModuleData) {
      missingFields.push("System or Module data (at least one required)");
    } else {
      // Add missing fields from whichever data type is present
      missingFields.push(...systemMissingFields, ...moduleMissingFields);
    }
    
    // Always required fields
    if (!data.newGps) missingFields.push("New GPS");
    if (!signatureData) missingFields.push("Signature");
    if (!signatureName) missingFields.push("Signature Name");
    return missingFields;
  };

  const normalizeOptionalFields = (data: WorkOrderFormData, existingWo?: any) => {
    // For reading fields:
    // - undefined = form field not touched, preserve existing value
    // - "" = user cleared the field, set to null
    // - 0 or other number = valid reading value
    const getReadingValue = (formValue: any, existingValue: any) => {
      if (formValue === undefined) return existingValue ?? null;
      if (formValue === "") return null;
      return formValue;
    };
    
    // For string ID fields:
    // - undefined = form field not touched, preserve existing value
    // - "" = user cleared the field, set to null
    // - any string = use the value
    const getIdValue = (formValue: any, existingValue: any) => {
      if (formValue === undefined) return existingValue || null;
      if (formValue === "") return null;
      return formValue || null;
    };
    
    return {
      ...data,
      city: data.city || null,
      state: data.state || null,
      zip: data.zip || null,
      phone: data.phone || null,
      email: data.email || null,
      route: data.route || null,
      zone: data.zone || null,
      oldSystemId: getIdValue(data.oldSystemId, existingWo?.oldSystemId),
      oldSystemReading: getReadingValue(data.oldSystemReading, existingWo?.oldSystemReading),
      newSystemId: getIdValue(data.newSystemId, existingWo?.newSystemId),
      newSystemReading: getReadingValue(data.newSystemReading, existingWo?.newSystemReading),
      oldGps: data.oldGps || null,
      newGps: data.newGps || null,
      notes: data.notes || null,
      trouble: (data as any).trouble || null,
      oldSystemType: getIdValue((data as any).oldSystemType, existingWo?.oldSystemType),
      newSystemType: getIdValue((data as any).newSystemType, existingWo?.newSystemType),
      oldModuleId: getIdValue((data as any).oldModuleId, existingWo?.oldModuleId),
      oldModuleRead: getReadingValue((data as any).oldModuleRead, existingWo?.oldModuleRead),
      oldModuleType: getIdValue((data as any).oldModuleType, existingWo?.oldModuleType),
      newModuleId: getIdValue((data as any).newModuleId, existingWo?.newModuleId),
      newModuleRead: getReadingValue((data as any).newModuleRead, existingWo?.newModuleRead),
      newModuleType: getIdValue((data as any).newModuleType, existingWo?.newModuleType),
      assignedUserId: (data as any).assignedUserId ?? null,
      assignedGroupId: (data as any).assignedGroupId ?? null,
      scheduledAt: (data as any).scheduledAt || null,
    };
  };

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
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setIsCreatingWorkOrder(false);
      form.reset();
      signaturePadRef.current?.clear();
      toast({ title: "Work order created" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
      } else {
        toast({ title: "Failed to create work order", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<WorkOrderFormData>) => {
      if (accessDenied) throw new Error("403: Access denied");
      const existingWo = editingWorkOrder as any;
      const normalizedData = normalizeOptionalFields(data as WorkOrderFormData, existingWo);
      const troubleStatus = workOrderStatuses.find(s => s.label === "Trouble")?.label || "Trouble";
      if ((data as any).trouble) {
        (normalizedData as any).status = troubleStatus;
      }
      const signatureDataFromPad = editSignaturePadRef.current?.getSignatureData() || null;
      const signatureNameFromPad = editSignaturePadRef.current?.getSignatureName() || "";
      
      // Use new signature data if provided, otherwise fall back to existing
      const finalSignatureData = signatureDataFromPad || existingWo?.signatureData || null;
      const finalSignatureName = signatureNameFromPad || existingWo?.signatureName || "";
      
      // Validate required fields for Completed status
      const completedStatus = workOrderStatuses.find(s => s.label === "Completed")?.label || "Completed";
      if ((data as any).status === completedStatus || (normalizedData as any).status === completedStatus) {
        const checkData = {
          ...existingWo,
          ...normalizedData,
          attachments: existingWo?.attachments || normalizedData.attachments,
        };
        const missingFields = validateCompletedStatus(checkData, finalSignatureData, finalSignatureName);
        if (missingFields.length > 0) {
          throw new Error(`Cannot set status to Completed. Missing required fields: ${missingFields.join(", ")}`);
        }
      }
      
      return apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${id}`, {
        ...normalizedData,
        signatureData: finalSignatureData,
        signatureName: finalSignatureName || null,
      });
    },
    onSuccess: async (response) => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      // Keep the form open with refreshed data
      try {
        const updatedWorkOrder = await response.json();
        setEditingWorkOrder(updatedWorkOrder);
      } catch {
        // If we can't parse the response, refetch the work order
        if (editingWorkOrder?.id) {
          const refetchRes = await fetch(`/api/projects/${projectId}/work-orders/${editingWorkOrder.id}`, { credentials: 'include' });
          if (refetchRes.ok) {
            const refetchedWo = await refetchRes.json();
            setEditingWorkOrder(refetchedWo);
          }
        }
      }
      toast({ title: "Work order updated" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
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
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      toast({ title: "Work order deleted" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
        toast({ title: "Access denied", variant: "destructive" });
      } else {
        toast({ title: "Failed to delete work order", variant: "destructive" });
      }
    },
  });

  const createSystemTypeMutation = useMutation({
    mutationFn: async (data: { productId: string; productLabel: string; productDescription?: string }): Promise<SystemType> => {
      const res = await apiRequest("POST", "/api/system-types", {
        ...data,
        projectIds: [projectId],
      });
      return res.json();
    },
    onSuccess: (newSystemType: SystemType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-types", projectId] });
      if (systemTypeField === "oldSystemType") {
        form.setValue("oldSystemType", newSystemType.productId);
      } else if (systemTypeField === "newSystemType") {
        form.setValue("newSystemType", newSystemType.productId);
      } else if (systemTypeField === "editOldSystemType") {
        editForm.setValue("oldSystemType", newSystemType.productId);
      } else if (systemTypeField === "editNewSystemType") {
        editForm.setValue("newSystemType", newSystemType.productId);
      }
      setCreateSystemTypeOpen(false);
      setNewSystemTypeProductId("");
      setNewSystemTypeLabel("");
      setNewSystemTypeDescription("");
      setSystemTypeField(null);
      toast({ title: "System type created" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create system type", description: error?.message, variant: "destructive" });
    },
  });

  const checkAssignmentsMutation = useMutation({
    mutationFn: async (workOrderIds: number[]) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/work-orders/check-assignments`, {
        workOrderIds,
      });
      return res.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to check assignments", description: error?.message, variant: "destructive" });
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (params: {
      workOrderIds: number[];
      action: "assign" | "unassign";
      assigneeType?: "user" | "group";
      assigneeId?: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/work-orders/bulk-assign`, params);
      return res.json();
    },
    onSuccess: async (result) => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setShowBulkAssignDialog(false);
      resetBulkAssignState();
      toast({ 
        title: result.message || "Work orders updated",
        description: result.skipped > 0 ? `${result.skipped} work order(s) were skipped (Completed/Scheduled status)` : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to assign work orders", description: error?.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (workOrderIds: number[]) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/work-orders/bulk-delete`, { workOrderIds });
      return res.json();
    },
    onSuccess: async (result) => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setSelectedWorkOrderIds(new Set());
      setShowBulkDeleteDialog(false);
      toast({ 
        title: `${result.deletedCount} work order(s) deleted`,
        description: result.errors?.length > 0 ? `${result.errors.length} failed` : undefined,
      });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        toast({ title: "Access denied", description: "You don't have permission to delete work orders", variant: "destructive" });
      } else {
        toast({ title: "Failed to delete work orders", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const checkBulkStatusMutation = useMutation({
    mutationFn: async (workOrderIds: number[]) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/work-orders/check-bulk-status`, {
        workOrderIds,
      });
      return res.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to check work order statuses", description: error?.message, variant: "destructive" });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async (params: {
      workOrderIds: number[];
      status: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/work-orders/bulk-status`, params);
      return res.json();
    },
    onSuccess: async (result) => {
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setShowBulkStatusDialog(false);
      setBulkStatusValue("");
      setBulkStatusCheckResult(null);
      toast({ 
        title: `${result.updatedCount} work order(s) updated`,
        description: result.skipped > 0 ? `${result.skipped} work order(s) were skipped (Scheduled/Completed/Trouble status)` : undefined,
      });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        toast({ title: "Access denied", description: "You don't have permission to update work orders", variant: "destructive" });
      } else {
        toast({ title: "Failed to update work orders", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const handleBulkDelete = () => {
    if (selectedWorkOrderIds.size === 0) {
      toast({ title: "No work orders selected", variant: "destructive" });
      return;
    }
    setShowBulkDeleteDialog(true);
  };

  const confirmBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedWorkOrderIds));
  };

  const handleOpenBulkStatus = async () => {
    const workOrderIds = filteredAndSortedWorkOrders.map(wo => wo.id);
    if (workOrderIds.length === 0) {
      toast({ title: "No work orders to update", description: "Apply filters to select work orders first", variant: "destructive" });
      return;
    }
    
    setBulkStatusValue("");
    setBulkStatusCheckResult(null);
    setShowBulkStatusDialog(true);
    
    const result = await checkBulkStatusMutation.mutateAsync(workOrderIds);
    setBulkStatusCheckResult(result);
  };

  const handleBulkStatusSubmit = () => {
    const workOrderIds = filteredAndSortedWorkOrders.map(wo => wo.id);
    
    if (!bulkStatusValue) {
      toast({ title: "Please select a status", variant: "destructive" });
      return;
    }
    
    bulkStatusMutation.mutate({
      workOrderIds,
      status: bulkStatusValue,
    });
  };

  const toggleWorkOrderSelection = (id: number) => {
    setSelectedWorkOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const currentPageIds = paginatedWorkOrders.map(wo => wo.id);
    const allSelected = currentPageIds.every(id => selectedWorkOrderIds.has(id));
    
    setSelectedWorkOrderIds(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        currentPageIds.forEach(id => newSet.delete(id));
      } else {
        currentPageIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  const selectAllFiltered = () => {
    const allFilteredIds = filteredAndSortedWorkOrders.map(wo => wo.id);
    setSelectedWorkOrderIds(new Set(allFilteredIds));
  };

  const clearAllSelections = () => {
    setSelectedWorkOrderIds(new Set());
  };

  const resetBulkAssignState = () => {
    setBulkAssignAction("assign");
    setBulkAssigneeType("user");
    setBulkAssigneeId("");
    setBulkAssignStep("select");
    setBulkAssignCheckResult(null);
  };

  const handleOpenBulkAssign = async () => {
    const workOrderIds = filteredAndSortedWorkOrders.map(wo => wo.id);
    if (workOrderIds.length === 0) {
      toast({ title: "No work orders to assign", description: "Apply filters to select work orders first", variant: "destructive" });
      return;
    }
    
    resetBulkAssignState();
    setShowBulkAssignDialog(true);
    
    const result = await checkAssignmentsMutation.mutateAsync(workOrderIds);
    setBulkAssignCheckResult(result);
  };

  const handleBulkAssignSubmit = () => {
    const workOrderIds = filteredAndSortedWorkOrders.map(wo => wo.id);
    
    if (bulkAssignAction === "assign") {
      if (!bulkAssigneeId) {
        toast({ title: "Please select an assignee", variant: "destructive" });
        return;
      }
      bulkAssignMutation.mutate({
        workOrderIds,
        action: "assign",
        assigneeType: bulkAssigneeType,
        assigneeId: bulkAssigneeId,
      });
    } else {
      bulkAssignMutation.mutate({
        workOrderIds,
        action: "unassign",
      });
    }
  };

  const handleCreateSystemTypeSubmit = () => {
    if (!newSystemTypeProductId.trim() || !newSystemTypeLabel.trim()) {
      toast({ title: "Product ID and Label are required", variant: "destructive" });
      return;
    }
    createSystemTypeMutation.mutate({
      productId: newSystemTypeProductId.trim(),
      productLabel: newSystemTypeLabel.trim(),
      productDescription: newSystemTypeDescription.trim() || undefined,
    });
  };

  const openCreateSystemTypeDialog = (field: "oldSystemType" | "newSystemType" | "editOldSystemType" | "editNewSystemType") => {
    if (!hasPermission('workOrders.edit')) {
      return;
    }
    if (!projectId) {
      toast({ title: "Project not loaded", description: "Please wait for the project to load", variant: "destructive" });
      return;
    }
    setSystemTypeField(field);
    setNewSystemTypeProductId("");
    setNewSystemTypeLabel("");
    setNewSystemTypeDescription("");
    setCreateSystemTypeOpen(true);
  };

  const onSubmit = (data: WorkOrderFormData) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: WorkOrderFormData) => {
    if (!hasPermission('workOrders.edit')) {
      toast({ title: "Permission denied", description: "You do not have permission to edit work orders.", variant: "destructive" });
      return;
    }
    if (editingWorkOrder) {
      updateMutation.mutate({ id: editingWorkOrder.id, ...data });
    }
  };

  const handleEdit = (workOrder: ProjectWorkOrder) => {
    setEditingWorkOrder(workOrder);
  };

  const handleReschedule = async (workOrderId: number, scheduledAt: string, assignedUserId?: string | null, notes?: string | null) => {
    if (!hasPermission('workOrders.calendar')) {
      toast({ title: "Permission denied", description: "You do not have permission to reschedule work orders.", variant: "destructive" });
      return;
    }
    try {
      const payload: Record<string, any> = { scheduledAt };
      if (assignedUserId !== undefined) {
        payload.assignedUserId = assignedUserId;
      }
      if (notes) {
        payload.appendNotes = notes;
      }
      await apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${workOrderId}`, payload);
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      await queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      toast({ title: "Work order scheduled" });
    } catch (error: any) {
      const errorMsg = error?.message || "";
      toast({ title: "Failed to schedule work order", description: errorMsg, variant: "destructive" });
    }
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

  // Helper to get trouble code label from code
  const getTroubleCodeLabel = (code: string | null | undefined): string => {
    if (!code) return "";
    const troubleCode = troubleCodes.find(tc => tc.code === code);
    return troubleCode?.label || code;
  };

  // Helper to get combined assignment display (for exports and legacy display)
  const getAssignmentDisplay = (workOrder: ProjectWorkOrder): string => {
    const woAny = workOrder as any;
    const userName = woAny.assignedUserDisplay || getAssignedUserName(woAny.assignedUserId);
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

  const handleSort = (column: string, event: React.MouseEvent) => {
    const existingIndex = sortCriteria.findIndex(sc => sc.column === column);
    
    if (event.shiftKey) {
      // Shift-click: add to or modify existing sort criteria
      if (existingIndex >= 0) {
        // Toggle direction of existing column
        const newCriteria = [...sortCriteria];
        newCriteria[existingIndex] = {
          ...newCriteria[existingIndex],
          direction: newCriteria[existingIndex].direction === "asc" ? "desc" : "asc"
        };
        setSortCriteria(newCriteria);
      } else {
        // Add as new sort criterion
        setSortCriteria([...sortCriteria, { column, direction: "asc" }]);
      }
    } else {
      // Regular click: replace all with single column sort
      if (existingIndex >= 0 && sortCriteria.length === 1) {
        // Toggle direction if it's the only sort column
        setSortCriteria([{ column, direction: sortCriteria[0].direction === "asc" ? "desc" : "asc" }]);
      } else {
        // Set as sole sort column
        setSortCriteria([{ column, direction: "asc" }]);
      }
    }
  };

  const clearSort = () => {
    setSortCriteria([]);
  };

  const getSortIcon = (column: string) => {
    const sortIndex = sortCriteria.findIndex(sc => sc.column === column);
    if (sortIndex < 0) {
      return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-50" />;
    }
    const direction = sortCriteria[sortIndex].direction;
    const priority = sortCriteria.length > 1 ? (
      <span className="ml-0.5 text-[10px] font-bold">{sortIndex + 1}</span>
    ) : null;
    return (
      <>
        {direction === "asc" 
          ? <ArrowUp className="ml-1 h-3 w-3 inline" />
          : <ArrowDown className="ml-1 h-3 w-3 inline" />}
        {priority}
      </>
    );
  };

  // Column header configuration for dynamic rendering
  const columnHeaderConfig: Record<string, { label: string; sortKey?: string }> = {
    id: { label: "System WO ID", sortKey: "id" },
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
    oldSystemId: { label: "Old System ID", sortKey: "oldSystemId" },
    oldSystemReading: { label: "Old System Reading", sortKey: "oldSystemReading" },
    oldSystemType: { label: "Old System Type", sortKey: "oldSystemType" },
    newSystemId: { label: "New System ID", sortKey: "newSystemId" },
    newSystemReading: { label: "New System Reading", sortKey: "newSystemReading" },
    newSystemType: { label: "New System Type", sortKey: "newSystemType" },
    oldModuleId: { label: "Old Module ID", sortKey: "oldModuleId" },
    oldModuleRead: { label: "Old Module Reading", sortKey: "oldModuleRead" },
    oldModuleType: { label: "Old Module Type", sortKey: "oldModuleType" },
    newModuleId: { label: "New Module ID", sortKey: "newModuleId" },
    newModuleRead: { label: "New Module Reading", sortKey: "newModuleRead" },
    newModuleType: { label: "New Module Type", sortKey: "newModuleType" },
    oldGps: { label: "Old GPS", sortKey: "oldGps" },
    newGps: { label: "New GPS", sortKey: "newGps" },
    status: { label: "Status", sortKey: "status" },
    scheduledAt: { label: "Scheduled At", sortKey: "scheduledAt" },
    scheduledBy: { label: "Scheduled By", sortKey: "scheduledBy" },
    assignedTo: { label: "Assigned User", sortKey: "assignedUserId" },
    assignedGroup: { label: "Assigned Group", sortKey: "assignedGroupId" },
    createdBy: { label: "Created By", sortKey: "createdBy" },
    updatedBy: { label: "Updated By", sortKey: "updatedBy" },
    completedAt: { label: "Completed At", sortKey: "completedAt" },
    completedBy: { label: "Completed By", sortKey: "completedBy" },
    trouble: { label: "Trouble", sortKey: "trouble" },
    notes: { label: "Notes", sortKey: "notes" },
    createdAt: { label: "Created At", sortKey: "createdAt" },
    updatedAt: { label: "Updated At", sortKey: "updatedAt" },
  };

  // Fixed width for sticky columns to ensure proper offset calculation
  const STICKY_COLUMN_WIDTH = 160; // px

  // Calculate sticky column offsets based on ordered visible columns
  // This function is used during rendering when filteredStickyColumns and filteredOrderedColumns are available
  // We use a callback pattern to access filtered values at render time
  const getStickyStyleImpl = (key: string, isHeader: boolean, activeStickyColumns: string[], orderedColsForSticky: {key: string}[]): { className: string; style?: React.CSSProperties } => {
    if (!activeStickyColumns.includes(key)) {
      return { className: isHeader ? "sticky top-0 z-30 bg-muted" : "" };
    }
    
    // Find position of this column among all sticky columns in the visible order
    const visibleStickyColumns = orderedColsForSticky.filter(col => activeStickyColumns.includes(col.key)).map(col => col.key);
    const stickyIndex = visibleStickyColumns.indexOf(key);
    
    // Calculate left offset based on fixed sticky column width
    const leftOffset = stickyIndex * STICKY_COLUMN_WIDTH;
    
    const stickyClass = isHeader 
      ? "sticky top-0 z-40 bg-muted shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
      : "sticky z-20 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]";
    
    return {
      className: stickyClass,
      style: { left: `${leftOffset}px`, minWidth: `${STICKY_COLUMN_WIDTH}px`, maxWidth: `${STICKY_COLUMN_WIDTH}px` }
    };
  };
  
  // Wrapper function that applies filtering to sticky columns based on hasSystems/hasModules
  const getStickyStyle = (key: string, isHeader: boolean = false): { className: string; style?: React.CSSProperties } => {
    // Filter sticky columns and ordered columns to exclude unavailable system/module columns
    const activeStickyColumns = stickyColumns.filter(k => 
      (!systemColumnKeys.includes(k) || hasSystems) && (!moduleColumnKeys.includes(k) || hasModules)
    );
    const filteredOrderedCols = orderedColumns.filter(col => 
      (!systemColumnKeys.includes(col.key) || hasSystems) && (!moduleColumnKeys.includes(col.key) || hasModules)
    );
    return getStickyStyleImpl(key, isHeader, activeStickyColumns, filteredOrderedCols);
  };

  // Render a table header cell for a given column key
  const renderHeaderCell = (key: string, isFirst: boolean = false) => {
    const config = columnHeaderConfig[key];
    if (!config) return null;
    const sortKey = config.sortKey || key;
    const { className: stickyClass, style: stickyStyle } = getStickyStyle(key, true);
    return (
      <TableHead 
        key={key}
        className={`${stickyClass} cursor-pointer select-none whitespace-nowrap`}
        style={stickyStyle}
        onClick={(e) => handleSort(sortKey, e)}
        title="Click to sort. Shift+click to add to multi-column sort."
      >
        {config.label} {getSortIcon(sortKey)}
      </TableHead>
    );
  };

  // Render a table data cell for a given column key and work order
  const renderDataCell = (key: string, workOrder: ProjectWorkOrder, isFirst: boolean = false) => {
    const woAny = workOrder as any;
    const { className: stickyClass, style: stickyStyle } = getStickyStyle(key, false);
    const baseClass = stickyClass;
    const cellStyle = stickyStyle || {};
    switch (key) {
      case "id":
        return <TableCell key={key} className={`font-medium text-muted-foreground ${baseClass}`} style={cellStyle} data-testid={`text-system-wo-id-${workOrder.id}`}>{workOrder.id}</TableCell>;
      case "customerWoId":
        return <TableCell key={key} className={`font-medium ${baseClass}`} style={cellStyle} data-testid={`text-wo-id-${workOrder.id}`}>{workOrder.customerWoId || "-"}</TableCell>;
      case "customerId":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.customerId || "-"}</TableCell>;
      case "customerName":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.customerName || "-"}</TableCell>;
      case "address":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-address-${workOrder.id}`}>{workOrder.address || "-"}</TableCell>;
      case "city":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.city || "-"}</TableCell>;
      case "state":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.state || "-"}</TableCell>;
      case "zip":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.zip || "-"}</TableCell>;
      case "phone":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.phone || "-"}</TableCell>;
      case "email":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.email || "-"}</TableCell>;
      case "route":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-route-${workOrder.id}`}>{workOrder.route || "-"}</TableCell>;
      case "zone":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-zone-${workOrder.id}`}>{workOrder.zone || "-"}</TableCell>;
      case "serviceType":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-service-${workOrder.id}`}>{getServiceTypeBadge(workOrder.serviceType)}</TableCell>;
      case "oldSystemId":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-old-system-${workOrder.id}`}>{workOrder.oldSystemId || "-"}</TableCell>;
      case "oldSystemReading":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.oldSystemReading ?? "-"}</TableCell>;
      case "oldSystemType":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.oldSystemType || "-"}</TableCell>;
      case "newSystemId":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.newSystemId || "-"}</TableCell>;
      case "newSystemReading":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.newSystemReading ?? "-"}</TableCell>;
      case "newSystemType":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.newSystemType || "-"}</TableCell>;
      case "oldModuleId":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.oldModuleId || "-"}</TableCell>;
      case "oldModuleRead":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.oldModuleRead ?? "-"}</TableCell>;
      case "oldModuleType":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.oldModuleType || "-"}</TableCell>;
      case "newModuleId":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.newModuleId || "-"}</TableCell>;
      case "newModuleRead":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.newModuleRead ?? "-"}</TableCell>;
      case "newModuleType":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.newModuleType || "-"}</TableCell>;
      case "oldGps":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.oldGps || "-"}</TableCell>;
      case "newGps":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.newGps || "-"}</TableCell>;
      case "status":
        return <TableCell key={key} className={baseClass} style={cellStyle} data-testid={`text-status-${workOrder.id}`}>{getStatusBadge(workOrder.status)}</TableCell>;
      case "scheduledAt":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.scheduledAt ? formatDateTime(woAny.scheduledAt) : "-"}</TableCell>;
      case "scheduledBy":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.scheduledByDisplay || getAssignedUserName(woAny.scheduledBy) || "-"}</TableCell>;
      case "assignedTo":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.assignedUserDisplay || getAssignedUserName(woAny.assignedUserId) || "-"}</TableCell>;
      case "assignedGroup":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{getAssignedGroupName(woAny.assignedGroupId) || "-"}</TableCell>;
      case "createdBy":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.createdBy || "-"}</TableCell>;
      case "updatedBy":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.updatedBy || "-"}</TableCell>;
      case "completedAt":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "-"}</TableCell>;
      case "completedBy":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{woAny.completedByDisplay || getAssignedUserName(woAny.completedBy) || "-"}</TableCell>;
      case "trouble":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{getTroubleCodeLabel(woAny.trouble) || "-"}</TableCell>;
      case "notes":
        return <TableCell key={key} className={`max-w-xs truncate ${baseClass}`} style={cellStyle}>{workOrder.notes || "-"}</TableCell>;
      case "createdAt":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.createdAt ? formatDateTime(workOrder.createdAt) : "-"}</TableCell>;
      case "updatedAt":
        return <TableCell key={key} className={baseClass} style={cellStyle}>{workOrder.updatedAt ? formatDateTime(workOrder.updatedAt) : "-"}</TableCell>;
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
          wo.oldSystemId,
          wo.newSystemId,
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
    
    // Filter by old system type (handle both productId and productLabel formats)
    if (selectedOldSystemType !== "all") {
      result = result.filter(wo => {
        const oldSystemType = (wo as any).oldSystemType;
        if (!oldSystemType) return false;
        // Direct match with productId
        if (oldSystemType === selectedOldSystemType) return true;
        // Check if it matches the productLabel of the selected system type
        const selectedSystemType = systemTypes.find(mt => mt.productId === selectedOldSystemType);
        if (selectedSystemType && oldSystemType === selectedSystemType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by new system type (handle both productId and productLabel formats)
    if (selectedNewSystemType !== "all") {
      result = result.filter(wo => {
        const newSystemType = (wo as any).newSystemType;
        if (!newSystemType) return false;
        // Direct match with productId
        if (newSystemType === selectedNewSystemType) return true;
        // Check if it matches the productLabel of the selected system type
        const selectedSystemType = systemTypes.find(mt => mt.productId === selectedNewSystemType);
        if (selectedSystemType && newSystemType === selectedSystemType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by old module type (handle both productId and productLabel formats)
    if (selectedOldModuleType !== "all") {
      result = result.filter(wo => {
        const oldModuleType = (wo as any).oldModuleType;
        if (!oldModuleType) return false;
        // Direct match with productId
        if (oldModuleType === selectedOldModuleType) return true;
        // Check if it matches the productLabel of the selected module type
        const selectedModuleType = moduleTypes.find(mt => mt.productId === selectedOldModuleType);
        if (selectedModuleType && oldModuleType === selectedModuleType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by new module type (handle both productId and productLabel formats)
    if (selectedNewModuleType !== "all") {
      result = result.filter(wo => {
        const newModuleType = (wo as any).newModuleType;
        if (!newModuleType) return false;
        // Direct match with productId
        if (newModuleType === selectedNewModuleType) return true;
        // Check if it matches the productLabel of the selected module type
        const selectedModuleType = moduleTypes.find(mt => mt.productId === selectedNewModuleType);
        if (selectedModuleType && newModuleType === selectedModuleType.productLabel) return true;
        return false;
      });
    }
    
    // Filter by system work order ID
    if (filterSystemWoId.trim()) {
      result = result.filter(wo => String(wo.id).includes(filterSystemWoId.trim()));
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
    if (filterOldSystemId.trim()) {
      result = result.filter(wo => wo.oldSystemId?.toLowerCase().includes(filterOldSystemId.toLowerCase()));
    }
    if (filterNewSystemId.trim()) {
      result = result.filter(wo => wo.newSystemId?.toLowerCase().includes(filterNewSystemId.toLowerCase()));
    }
    if (filterOldModuleId.trim()) {
      result = result.filter(wo => (wo as any).oldModuleId?.toLowerCase().includes(filterOldModuleId.toLowerCase()));
    }
    if (filterNewModuleId.trim()) {
      result = result.filter(wo => (wo as any).newModuleId?.toLowerCase().includes(filterNewModuleId.toLowerCase()));
    }
    if (filterScheduledDateFrom || filterScheduledDateTo) {
      result = result.filter(wo => {
        const scheduledAt = (wo as any).scheduledAt;
        if (!scheduledAt) return false;
        const dateStr = scheduledAt.substring(0, 10);
        if (filterScheduledDateFrom && dateStr < filterScheduledDateFrom) return false;
        if (filterScheduledDateTo && dateStr > filterScheduledDateTo) return false;
        return true;
      });
    }
    if (filterCreatedBy !== "all") {
      // Look up username from selected user ID - createdBy stores username in database
      const selectedUser = assigneesData?.users?.find(u => u.id === filterCreatedBy);
      const selectedUsername = selectedUser?.username;
      result = result.filter(wo => {
        // createdBy stores username - compare against username
        if (selectedUsername && wo.createdBy === selectedUsername) return true;
        // Also try direct ID match in case createdBy stores ID
        if (wo.createdBy && String(wo.createdBy) === String(filterCreatedBy)) return true;
        return false;
      });
    }
    if (filterUpdatedBy !== "all") {
      // Look up username from selected user ID - updatedBy stores username in database
      const selectedUser = assigneesData?.users?.find(u => u.id === filterUpdatedBy);
      const selectedUsername = selectedUser?.username;
      result = result.filter(wo => {
        // updatedBy stores username - compare against username
        if (selectedUsername && wo.updatedBy === selectedUsername) return true;
        // Also try direct ID match in case updatedBy stores ID
        if (wo.updatedBy && String(wo.updatedBy) === String(filterUpdatedBy)) return true;
        return false;
      });
    }
    if (filterScheduledBy !== "all") {
      result = result.filter(wo => {
        const woAny = wo as any;
        // scheduledBy stores user ID directly - compare IDs
        return woAny.scheduledBy && String(woAny.scheduledBy) === String(filterScheduledBy);
      });
    }
    if (filterCompletedBy !== "all") {
      result = result.filter(wo => {
        const woAny = wo as any;
        // completedBy stores user ID directly - compare IDs
        return woAny.completedBy && String(woAny.completedBy) === String(filterCompletedBy);
      });
    }
    if (filterCompletedAtFrom || filterCompletedAtTo) {
      result = result.filter(wo => {
        if (!wo.completedAt) return false;
        const dateStr = String(wo.completedAt).substring(0, 10);
        if (filterCompletedAtFrom && dateStr < filterCompletedAtFrom) return false;
        if (filterCompletedAtTo && dateStr > filterCompletedAtTo) return false;
        return true;
      });
    }
    if (filterNotes.trim()) {
      result = result.filter(wo => wo.notes?.toLowerCase().includes(filterNotes.toLowerCase()));
    }
    if (filterCreatedAtFrom || filterCreatedAtTo) {
      result = result.filter(wo => {
        if (!wo.createdAt) return false;
        const dateStr = String(wo.createdAt).substring(0, 10);
        if (filterCreatedAtFrom && dateStr < filterCreatedAtFrom) return false;
        if (filterCreatedAtTo && dateStr > filterCreatedAtTo) return false;
        return true;
      });
    }
    if (filterUpdatedAtFrom || filterUpdatedAtTo) {
      result = result.filter(wo => {
        if (!wo.updatedAt) return false;
        const dateStr = String(wo.updatedAt).substring(0, 10);
        if (filterUpdatedAtFrom && dateStr < filterUpdatedAtFrom) return false;
        if (filterUpdatedAtTo && dateStr > filterUpdatedAtTo) return false;
        return true;
      });
    }
    
    // Multi-column sort with proper value normalization
    if (sortCriteria.length > 0) {
      const dateColumns = ['scheduledAt', 'completedAt', 'createdAt', 'updatedAt'];
      const numericColumns = ['oldSystemReading', 'newSystemReading'];
      
      result.sort((a, b) => {
        for (const criterion of sortCriteria) {
          let aVal = (a as any)[criterion.column];
          let bVal = (b as any)[criterion.column];
          let comparison = 0;
          
          if (dateColumns.includes(criterion.column)) {
            // Compare dates as timestamps
            const aTime = aVal ? new Date(aVal).getTime() : 0;
            const bTime = bVal ? new Date(bVal).getTime() : 0;
            comparison = aTime - bTime;
          } else if (numericColumns.includes(criterion.column)) {
            // Compare as numbers
            const aNum = aVal ? parseFloat(aVal) : 0;
            const bNum = bVal ? parseFloat(bVal) : 0;
            comparison = aNum - bNum;
          } else {
            // Default string comparison
            comparison = String(aVal || "").localeCompare(String(bVal || ""));
          }
          
          if (comparison !== 0) {
            return criterion.direction === "asc" ? comparison : -comparison;
          }
        }
        return 0;
      });
    }
    
    return result;
  }, [workOrders, searchQuery, sortCriteria, selectedStatus, selectedServiceType, selectedAssignedTo, selectedAssignedGroup, selectedTrouble, selectedOldSystemType, selectedNewSystemType, selectedOldModuleType, selectedNewModuleType, systemTypes, moduleTypes, assigneesData, filterSystemWoId, filterCustomerId, filterCustomerName, filterAddress, filterCity, filterState, filterZip, filterPhone, filterEmail, filterRoute, filterZone, filterOldSystemId, filterNewSystemId, filterOldModuleId, filterNewModuleId, filterScheduledDateFrom, filterScheduledDateTo, filterCreatedBy, filterUpdatedBy, filterScheduledBy, filterCompletedBy, filterCompletedAtFrom, filterCompletedAtTo, filterNotes, filterCreatedAtFrom, filterCreatedAtTo, filterUpdatedAtFrom, filterUpdatedAtTo]);

  const totalPages = Math.ceil(filteredAndSortedWorkOrders.length / pageSize);
  const paginatedWorkOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredAndSortedWorkOrders.slice(startIndex, startIndex + pageSize);
  }, [filteredAndSortedWorkOrders, currentPage, pageSize]);

  // Calculate selection states for UI
  const allFilteredSelected = filteredAndSortedWorkOrders.length > 0 && 
    filteredAndSortedWorkOrders.every(wo => selectedWorkOrderIds.has(wo.id));
  const someSelected = selectedWorkOrderIds.size > 0;
  const allCurrentPageSelected = paginatedWorkOrders.length > 0 && 
    paginatedWorkOrders.every(wo => selectedWorkOrderIds.has(wo.id));

  useEffect(() => {
    setCurrentPage(1);
    setSelectedWorkOrderIds(new Set());
  }, [workOrders, searchQuery, selectedStatus, selectedServiceType, selectedAssignedTo, selectedAssignedGroup, selectedTrouble, selectedOldSystemType, selectedNewSystemType, selectedOldModuleType, selectedNewModuleType, filterSystemWoId, filterCustomerId, filterCustomerName, filterAddress, filterCity, filterState, filterZip, filterPhone, filterEmail, filterRoute, filterZone, filterOldSystemId, filterNewSystemId, filterOldModuleId, filterNewModuleId, filterScheduledDateFrom, filterScheduledDateTo, filterCreatedBy, filterUpdatedBy, filterScheduledBy, filterCompletedBy, filterCompletedAtFrom, filterCompletedAtTo, filterNotes, filterCreatedAtFrom, filterCreatedAtTo, filterUpdatedAtFrom, filterUpdatedAtTo, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Set sticky header content - now that filteredAndSortedWorkOrders is available
  // Only set project-level header when NOT viewing a work order detail
  useEffect(() => {
    if (!project || !user || editingWorkOrder) {
      // Don't set project header when viewing a work order detail
      // The work-order-detail component will set its own header
      if (!editingWorkOrder) {
        setHeaderContent(null);
      }
      return;
    }
    
    const content = (
      <div className="flex items-center gap-2 w-full">
        <div className="flex flex-col min-w-0 mr-2 flex-shrink-0">
          <span className="font-semibold text-sm truncate">{project.name}</span>
          <span className="text-xs text-muted-foreground">Work Orders</span>
        </div>
      </div>
    );
    
    setHeaderContent(content);
  }, [project, user, projectId, hasPermission, viewMode, setHeaderContent, editingWorkOrder]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageSizeChange = (size: number) => {
    setIsAutoPageSize(false);
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleAutoModeToggle = useCallback(() => {
    setIsAutoPageSize(true);
  }, []);

  // Auto page size calculation - matches Search & Reports exactly
  useLayoutEffect(() => {
    if (!isAutoPageSize || viewMode !== "table") return;

    const calculateOptimalPageSize = () => {
      const container = tableScrollRef.current;
      if (!container) return;
      
      const rowHeight = 52;
      const tableHeaderHeight = 48;
      
      const containerHeight = container.clientHeight;
      const availableHeight = containerHeight - tableHeaderHeight;
      if (availableHeight <= 0) return;
      
      const optimalRows = Math.floor(availableHeight / rowHeight);
      const clampedRows = Math.max(5, Math.min(100, optimalRows));
      
      setPageSize((prevSize) => {
        if (prevSize !== clampedRows) {
          setCurrentPage(1);
        }
        return clampedRows;
      });
    };

    const rafId = requestAnimationFrame(calculateOptimalPageSize);
    window.addEventListener("resize", calculateOptimalPageSize);
    
    const container = tableScrollRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (container) {
      resizeObserver = new ResizeObserver(calculateOptimalPageSize);
      resizeObserver.observe(container);
    }
    
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", calculateOptimalPageSize);
      resizeObserver?.disconnect();
    };
  }, [isAutoPageSize, workOrders.length]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setSelectedAssignedTo("all");
    setSelectedAssignedGroup("all");
    setSelectedTrouble("all");
    setSelectedOldSystemType("all");
    setSelectedNewSystemType("all");
    setSelectedOldModuleType("all");
    setSelectedNewModuleType("all");
    setFilterSystemWoId("");
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
    setFilterOldSystemId("");
    setFilterNewSystemId("");
    setFilterOldModuleId("");
    setFilterNewModuleId("");
    setFilterScheduledDateFrom("");
    setFilterScheduledDateTo("");
    setFilterCreatedBy("all");
    setFilterUpdatedBy("all");
    setFilterScheduledBy("all");
    setFilterCompletedBy("all");
    setFilterCompletedAtFrom("");
    setFilterCompletedAtTo("");
    setFilterNotes("");
    setFilterCreatedAtFrom("");
    setFilterCreatedAtTo("");
    setFilterUpdatedAtFrom("");
    setFilterUpdatedAtTo("");
    setCurrentPage(1);
  };

  const hasActiveFilters = selectedStatus !== "all" || selectedServiceType !== "all" || selectedAssignedTo !== "all" || selectedAssignedGroup !== "all" || selectedTrouble !== "all" || selectedOldSystemType !== "all" || selectedNewSystemType !== "all" || selectedOldModuleType !== "all" || selectedNewModuleType !== "all" || filterSystemWoId !== "" || filterCustomerId !== "" || filterCustomerName !== "" || filterAddress !== "" || filterCity !== "" || filterState !== "" || filterZip !== "" || filterPhone !== "" || filterEmail !== "" || filterRoute !== "" || filterZone !== "" || filterOldSystemId !== "" || filterNewSystemId !== "" || filterOldModuleId !== "" || filterNewModuleId !== "" || filterScheduledDateFrom !== "" || filterScheduledDateTo !== "" || filterCreatedBy !== "all" || filterUpdatedBy !== "all" || filterScheduledBy !== "all" || filterCompletedBy !== "all" || filterCompletedAtFrom !== "" || filterCompletedAtTo !== "" || filterNotes !== "" || filterCreatedAtFrom !== "" || filterCreatedAtTo !== "" || filterUpdatedAtFrom !== "" || filterUpdatedAtTo !== "";

  const activeFilterCount = [
    selectedStatus !== "all",
    selectedServiceType !== "all",
    selectedAssignedTo !== "all",
    selectedAssignedGroup !== "all",
    selectedTrouble !== "all",
    selectedOldSystemType !== "all",
    selectedNewSystemType !== "all",
    selectedOldModuleType !== "all",
    selectedNewModuleType !== "all",
    filterSystemWoId !== "",
    filterCustomerId !== "",
    filterCustomerName !== "",
    filterAddress !== "",
    filterCity !== "",
    filterState !== "",
    filterZip !== "",
    filterPhone !== "",
    filterEmail !== "",
    filterRoute !== "",
    filterZone !== "",
    filterOldSystemId !== "",
    filterNewSystemId !== "",
    filterOldModuleId !== "",
    filterNewModuleId !== "",
    filterScheduledDateFrom !== "" || filterScheduledDateTo !== "",
    filterCreatedBy !== "all",
    filterUpdatedBy !== "all",
    filterScheduledBy !== "all",
    filterCompletedBy !== "all",
    filterCompletedAtFrom !== "" || filterCompletedAtTo !== "",
    filterNotes !== "",
    filterCreatedAtFrom !== "" || filterCreatedAtTo !== "",
    filterUpdatedAtFrom !== "" || filterUpdatedAtTo !== "",
  ].filter(Boolean).length;

  // Determine if project uses systems and/or modules based on configured types OR work order data
  // Check both type configurations AND actual work order data for flexibility
  const workOrdersHaveSystemData = workOrders?.some(wo => 
    wo.oldSystemId || wo.newSystemId || wo.oldSystemType || wo.newSystemType
  ) ?? false;
  const workOrdersHaveModuleData = workOrders?.some(wo => 
    (wo as any).oldModuleId || (wo as any).newModuleId || (wo as any).oldModuleType || (wo as any).newModuleType
  ) ?? false;
  
  const hasSystems = systemTypes.length > 0 || workOrdersHaveSystemData;
  const hasModules = moduleTypes.length > 0 || workOrdersHaveModuleData;
  
  // Filter workOrderColumns to only show system/module columns when applicable
  const filteredWorkOrderColumns = useMemo(() => {
    return workOrderColumns.filter(col => {
      if (systemColumnKeys.includes(col.key) && !hasSystems) return false;
      if (moduleColumnKeys.includes(col.key) && !hasModules) return false;
      return true;
    });
  }, [workOrderColumns, hasSystems, hasModules]);
  
  // Filter visibleColumns to exclude columns that aren't in filteredWorkOrderColumns
  const availableColumnKeys = useMemo(() => new Set(filteredWorkOrderColumns.map(c => c.key)), [filteredWorkOrderColumns]);
  const filteredVisibleColumns = useMemo(() => visibleColumns.filter(key => availableColumnKeys.has(key)), [visibleColumns, availableColumnKeys]);
  
  // Filter orderedColumns to exclude unavailable columns (for column selector and exports)
  const filteredOrderedColumns = useMemo(() => orderedColumns.filter(col => availableColumnKeys.has(col.key)), [orderedColumns, availableColumnKeys]);
  
  // Filter stickyColumns to exclude unavailable columns
  const filteredStickyColumns = useMemo(() => stickyColumns.filter(key => availableColumnKeys.has(key)), [stickyColumns, availableColumnKeys]);

  const getStatusLabel = (status: string): string => {
    if (!status) return "";
    const statusRecord = workOrderStatuses.find(s => s.code === status || s.label === status);
    return statusRecord?.label || status;
  };

  // Helper to get export value for a column key
  const getExportValue = (wo: ProjectWorkOrder, key: string): string => {
    switch (key) {
      case "id": return String(wo.id);
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
      case "oldSystemId": return wo.oldSystemId || "";
      case "oldSystemType": return wo.oldSystemType?.toString() || "";
      case "oldSystemReading": return wo.oldSystemReading?.toString() ?? "";
      case "newSystemId": return wo.newSystemId || "";
      case "newSystemReading": return wo.newSystemReading?.toString() ?? "";
      case "newSystemType": return wo.newSystemType?.toString() || "";
      case "oldModuleId": return (wo as any).oldModuleId || "";
      case "oldModuleRead": return (wo as any).oldModuleRead?.toString() ?? "";
      case "oldModuleType": return (wo as any).oldModuleType?.toString() || "";
      case "newModuleId": return (wo as any).newModuleId || "";
      case "newModuleRead": return (wo as any).newModuleRead?.toString() ?? "";
      case "newModuleType": return (wo as any).newModuleType?.toString() || "";
      case "oldGps": return wo.oldGps || "";
      case "newGps": return wo.newGps || "";
      case "status": return getStatusLabel(wo.status);
      case "scheduledAt": return (wo as any).scheduledAt ? formatExport((wo as any).scheduledAt) : "";
      case "scheduledBy": return (wo as any).scheduledByDisplay || getAssignedUserName((wo as any).scheduledBy) || "";
      case "assignedTo": return (wo as any).assignedUserDisplay || getAssignedUserName((wo as any).assignedUserId) || "";
      case "assignedGroup": return getAssignedGroupName((wo as any).assignedGroupId) || "";
      case "createdBy": return wo.createdBy || "";
      case "updatedBy": return wo.updatedBy || "";
      case "completedAt": return wo.completedAt ? formatExport(wo.completedAt) : "";
      case "completedBy": return (wo as any).completedByDisplay || getAssignedUserName((wo as any).completedBy) || "";
      case "trouble": return getTroubleCodeLabel(wo.trouble) || "";
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

    // Use filteredVisibleColumns in user's preferred order (excludes unavailable system/module columns)
    const columnMap = new Map(filteredWorkOrderColumns.map(c => [c.key, c]));
    const exportColumns = filteredVisibleColumns
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

    // Use filteredVisibleColumns in user's preferred order (excludes unavailable system/module columns)
    const columnMap = new Map(filteredWorkOrderColumns.map(c => [c.key, c]));
    const exportColumns = filteredVisibleColumns
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

    // Use filteredVisibleColumns in user's preferred order (excludes unavailable system/module columns)
    const columnMap = new Map(filteredWorkOrderColumns.map(c => [c.key, c]));
    const exportColumns = filteredVisibleColumns
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

  // Placeholder useEffect for header - actual content is set later after filteredAndSortedWorkOrders is available
  // This hook must exist before early returns to follow React hooks rules
  const headerSetRef = useRef(false);
  useEffect(() => {
    // Cleanup on unmount
    return () => {
      setHeaderContent(null);
    };
  }, [setHeaderContent]);

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

  const systemTypeDialog = (
    <Dialog open={createSystemTypeOpen} onOpenChange={setCreateSystemTypeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New System Type</DialogTitle>
          <DialogDescription>
            Add a new system type to this project.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="product-id">Product ID *</Label>
            <Input
              id="product-id"
              value={newSystemTypeProductId}
              onChange={(e) => setNewSystemTypeProductId(e.target.value)}
              placeholder="e.g. MTR-001"
              data-testid="input-new-system-type-product-id"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="product-label">Product Label *</Label>
            <Input
              id="product-label"
              value={newSystemTypeLabel}
              onChange={(e) => setNewSystemTypeLabel(e.target.value)}
              placeholder="e.g. 5/8 Inch Water System"
              data-testid="input-new-system-type-label"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="product-description">Description (optional)</Label>
            <Textarea
              id="product-description"
              value={newSystemTypeDescription}
              onChange={(e) => setNewSystemTypeDescription(e.target.value)}
              placeholder="Optional description..."
              data-testid="input-new-system-type-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreateSystemTypeOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateSystemTypeSubmit}
            disabled={createSystemTypeMutation.isPending}
            data-testid="button-create-system-type-submit"
          >
            {createSystemTypeMutation.isPending ? "Creating..." : "Create System Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (editingWorkOrder) {
    return (
      <>
        <WorkOrderDetail
          key={editingWorkOrder.id}
          workOrder={editingWorkOrder}
          form={editForm}
          onSubmit={onEditSubmit}
          onBack={closeDetailView}
          isSubmitting={updateMutation.isPending}
          projectId={projectId!}
          projectName={project?.name}
          cameFromSearch={cameFromSearch}
          serviceTypes={serviceTypes}
          systemTypes={systemTypes}
          moduleTypes={moduleTypes}
          workOrderStatuses={workOrderStatuses}
          troubleCodes={troubleCodes}
          assigneesData={assigneesData}
          workOrderFiles={workOrderFiles}
          filesLoading={filesLoading}
          formatDateTime={formatDateTime}
          getAssignedUserName={getAssignedUserName}
          signaturePadRef={editSignaturePadRef}
          openCreateSystemTypeDialog={openCreateSystemTypeDialog}
          toast={toast}
          canEdit={hasPermission('workOrders.edit')}
          canSystemChangeout={hasPermission('workOrders.meterChangeout')}
          autoLaunchSystemChangeout={autoLaunchSystemChangeout}
          autoLaunchChangeoutScope={autoLaunchChangeoutScope}
          operationalHours={{
            enabled: project?.operationalHoursEnabled ?? false,
            start: project?.operationalHoursStart ?? null,
            end: project?.operationalHoursEnd ?? null,
          }}
          wizardConfig={{
            wizardMode: (project?.wizardMode as "changeout" | "reading_only" | "user_choice") ?? "changeout",
            gpsMode: (project?.wizardGpsMode as "automatic" | "manual_step" | "disabled") ?? "automatic",
            showNotesStep: project?.wizardShowNotesStep ?? true,
            showGpsStep: project?.wizardShowGpsStep ?? true,
            showBeforePhotosStep: project?.wizardShowBeforePhotosStep ?? true,
            showAfterPhotosStep: project?.wizardShowAfterPhotosStep ?? true,
            showSignatureStep: project?.wizardShowSignatureStep ?? true,
          }}
          searchMethodSettings={{
            searchShowBarcodeScan: (project as any)?.searchShowBarcodeScan !== false,
            searchShowQrCodeScan: (project as any)?.searchShowQrCodeScan !== false,
            searchShowManualEntry: (project as any)?.searchShowManualEntry !== false,
            searchShowHidScanner: (project as any)?.searchShowHidScanner !== false,
          }}
          canScheduleInCalendar={hasPermission('workOrders.calendar')}
          onScheduleInCalendar={() => {
            // Store the work order to schedule, close detail view, and switch to calendar
            if (editingWorkOrder) {
              setWorkOrderForCalendarScheduling(editingWorkOrder);
              closeDetailView();
              setViewMode("calendar");
            }
          }}
          onSystemChangeoutComplete={async () => {
            // Use refetchQueries instead of invalidateQueries to ensure data is loaded before closing
            // Also invalidate the files query so attachment count is fresh when work order is reopened
            await Promise.all([
              queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
              queryClient.refetchQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] }),
              queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/${editingWorkOrder?.id}/files`] }),
            ]);
            toast({
              title: "Success",
              description: "System changeout completed successfully!",
            });
            closeDetailView();
          }}
        />
        {systemTypeDialog}
      </>
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
          <p className="text-muted-foreground mt-1">Add a new utility system work order to {project?.name}</p>
        </div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Accordion type="multiple" defaultValue={["customer", "system", "module", "scheduling"]} className="space-y-3">
              
              {/* Customer & Site Information */}
              <AccordionItem value="customer" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-create-customer">
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-primary" />
                    <span className="font-medium">Customer & Site</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
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
                                <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
                              ))}
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
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* System Details */}
              <AccordionItem value="system" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-create-system">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" />
                    <span className="font-medium">System Details</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Old System - Left Column */}
                    <div className="space-y-4 border-l-4 border-l-green-500 pl-4">
                      <h4 className="text-sm font-semibold text-green-600">Old System</h4>
                      <FormField
                        control={form.control}
                        name="oldSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="OLD-12345" 
                                data-testid="input-create-old-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System Type</FormLabel>
                            <div className="flex gap-1">
                              <Select 
                                value={field.value || "__none__"} 
                                onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-create-old-system-type" className="flex-1">
                                    <SelectValue placeholder="Select type..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">None</SelectItem>
                                  {Array.isArray(systemTypes) && systemTypes.map((mt) => (
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
                                  openCreateSystemTypeDialog("oldSystemType");
                                }}
                                data-testid="button-create-old-system-type"
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
                        name="oldSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-create-old-system-reading" 
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
                            <FormLabel>GPS Coordinates</FormLabel>
                            <FormControl>
                              <GPSCapture 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="40.7128,-74.0060" 
                                data-testid="input-create-old-gps" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* New System - Right Column */}
                    <div className="space-y-4 border-l-4 border-l-cyan-500 pl-4">
                      <h4 className="text-sm font-semibold text-cyan-600">New System</h4>
                      <FormField
                        control={form.control}
                        name="newSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="NEW-67890" 
                                data-testid="input-create-new-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System Type</FormLabel>
                            <div className="flex gap-1">
                              <Select 
                                value={field.value || "__none__"} 
                                onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-create-new-system-type" className="flex-1">
                                    <SelectValue placeholder="Select type..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">None</SelectItem>
                                  {Array.isArray(systemTypes) && systemTypes.map((mt) => (
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
                                  openCreateSystemTypeDialog("newSystemType");
                                }}
                                data-testid="button-create-new-system-type"
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
                        name="newSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="67890" 
                                data-testid="input-create-new-system-reading" 
                              />
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
                            <FormLabel>GPS Coordinates</FormLabel>
                            <FormControl>
                              <GPSCapture 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="40.7128,-74.0060" 
                                data-testid="input-create-new-gps" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Module Details */}
              <AccordionItem value="module" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-create-module">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" />
                    <span className="font-medium">Module Details</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Old Module - Left Column */}
                    <div className="space-y-4 border-l-4 border-l-green-500 pl-4">
                      <h4 className="text-sm font-semibold text-green-600">Old Module</h4>
                      <FormField
                        control={form.control}
                        name="oldModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-12345" 
                                data-testid="input-create-old-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-create-old-module-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {Array.isArray(moduleTypes) && moduleTypes.map((mt) => (
                                  <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-create-old-module-read" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* New Module - Right Column */}
                    <div className="space-y-4 border-l-4 border-l-cyan-500 pl-4">
                      <h4 className="text-sm font-semibold text-cyan-600">New Module</h4>
                      <FormField
                        control={form.control}
                        name="newModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-67890" 
                                data-testid="input-create-new-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-create-new-module-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {Array.isArray(moduleTypes) && moduleTypes.map((mt) => (
                                  <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="67890" 
                                data-testid="input-create-new-module-read" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Assignment & Scheduling */}
              <AccordionItem value="scheduling" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-create-scheduling">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    <span className="font-medium">Assignment & Scheduling</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          <Select value={field.value ?? "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : v)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-create-assigned-group">
                                <SelectValue placeholder="Select group..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {assigneesData?.groups?.map((group) => (
                                <SelectItem key={group.id} value={group.key || group.label}>
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
                      name="scheduledAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Scheduled At</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={field.value}
                              onChange={field.onChange}
                              data-testid="input-create-scheduled-at"
                              placeholder="Select schedule date/time"
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
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Notes */}
              <AccordionItem value="notes" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-create-notes">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="font-medium">Notes</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." className="min-h-[100px]" data-testid="input-create-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>

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
        name="oldSystemId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Old System ID</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="OLD-12345" data-testid="input-old-system-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="oldSystemReading"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Old System Reading</FormLabel>
            <FormControl>
              <Input 
                type="number" 
                {...field} 
                value={field.value ?? ""} 
                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                placeholder="12345" 
                data-testid="input-old-system-reading" 
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="newSystemId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>New System ID</FormLabel>
            <FormControl>
              <Input {...field} value={field.value || ""} placeholder="NEW-67890" data-testid="input-new-system-id" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="newSystemReading"
        render={({ field }) => (
          <FormItem>
            <FormLabel>New System Reading</FormLabel>
            <FormControl>
              <Input 
                type="number" 
                {...field} 
                value={field.value ?? ""} 
                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                placeholder="67890" 
                data-testid="input-new-system-reading" 
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
    <div className="p-4 flex flex-col gap-2 h-[calc(100vh-72px)] overflow-hidden">
      {stats && viewMode !== "calendar" && showStats && (
        <>
          {/* Mobile toggle for stats */}
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0 md:hidden w-full justify-between"
            onClick={() => setShowMobileStats(!showMobileStats)}
            data-testid="button-toggle-mobile-stats"
          >
            <span className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {showMobileStats ? "Hide Stats" : "Show Stats"}
            </span>
            {showMobileStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          {/* Stats grid - always visible on desktop, toggleable on mobile */}
          <div className={`flex-shrink-0 grid grid-cols-2 md:grid-cols-6 gap-1.5 ${showMobileStats ? "" : "hidden md:grid"}`}>
            {workOrderStatuses
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((status) => (
                <Card key={status.id} className="py-1.5">
                  <CardHeader className="py-1 px-3">
                    <CardDescription className="text-xs">{status.label}</CardDescription>
                    <CardTitle className="text-lg" data-testid={`stat-${status.label.toLowerCase().replace(/\s+/g, '-')}`}>
                      {stats.statusCounts[status.label] || 0}
                    </CardTitle>
                  </CardHeader>
                </Card>
              ))}
            <Card className="py-1.5">
              <CardHeader className="py-1 px-3">
                <CardDescription className="text-xs">Total</CardDescription>
                <CardTitle className="text-lg" data-testid="stat-total">{stats.total}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </>
      )}

      {/* Start Changeout/Reading Capture button - mobile only (hidden on desktop) */}
      {user?.role !== "customer" && hasPermission(permissionKeys.WORK_ORDERS_METER_CHANGEOUT) && (
        <Button 
          size="sm"
          onClick={() => setShowStartSystemChangeout(true)} 
          data-testid="button-start-system-changeout-mobile"
          className="flex-shrink-0 bg-green-600 text-white dark:bg-green-600 w-full md:hidden"
        >
          {project?.wizardMode === "reading_only" ? (
            <Gauge className="h-3.5 w-3.5 mr-1" />
          ) : (
            <Wrench className="h-3.5 w-3.5 mr-1" />
          )}
          <span>{project?.wizardMode === "reading_only" ? "Start Reading Capture" : "Start Changeout"}</span>
        </Button>
      )}

      {/* Search and Tools - collapsible on both desktop and mobile */}
      <>
        {/* Toggle for search/tools - visible on all screen sizes */}
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0 w-full justify-between"
          onClick={() => setShowMobileTools(!showMobileTools)}
          data-testid="button-toggle-mobile-tools"
        >
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {showMobileTools ? "Hide Search & Tools" : "Show Search & Tools"}
          </span>
          {showMobileTools ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        {/* Search/Tools card - collapsible on all screen sizes */}
        {showMobileTools && (
        <Card className="flex-shrink-0">
        <CardContent className="py-2 px-3 space-y-2">
            {/* Row 1: Search, Filters, Actions | Right: Assign, View Toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search work orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  data-testid="input-search-work-orders"
                />
              </div>
              <WorkOrderFiltersDialog
                hasSystems={hasSystems}
                hasModules={hasModules}
                filterSystemWoId={filterSystemWoId}
                setFilterSystemWoId={setFilterSystemWoId}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                selectedStatus={selectedStatus}
                setSelectedStatus={setSelectedStatus}
                selectedServiceType={selectedServiceType}
                setSelectedServiceType={setSelectedServiceType}
                selectedAssignedTo={selectedAssignedTo}
                setSelectedAssignedTo={setSelectedAssignedTo}
                selectedAssignedGroup={selectedAssignedGroup}
                setSelectedAssignedGroup={setSelectedAssignedGroup}
                selectedTrouble={selectedTrouble}
                setSelectedTrouble={setSelectedTrouble}
                filterCustomerId={filterCustomerId}
                setFilterCustomerId={setFilterCustomerId}
                filterCustomerName={filterCustomerName}
                setFilterCustomerName={setFilterCustomerName}
                filterAddress={filterAddress}
                setFilterAddress={setFilterAddress}
                filterCity={filterCity}
                setFilterCity={setFilterCity}
                filterState={filterState}
                setFilterState={setFilterState}
                filterZip={filterZip}
                setFilterZip={setFilterZip}
                filterPhone={filterPhone}
                setFilterPhone={setFilterPhone}
                filterEmail={filterEmail}
                setFilterEmail={setFilterEmail}
                filterRoute={filterRoute}
                setFilterRoute={setFilterRoute}
                filterZone={filterZone}
                setFilterZone={setFilterZone}
                filterOldSystemId={filterOldSystemId}
                setFilterOldSystemId={setFilterOldSystemId}
                filterNewSystemId={filterNewSystemId}
                setFilterNewSystemId={setFilterNewSystemId}
                selectedOldSystemType={selectedOldSystemType}
                setSelectedOldSystemType={setSelectedOldSystemType}
                selectedNewSystemType={selectedNewSystemType}
                setSelectedNewSystemType={setSelectedNewSystemType}
                filterOldModuleId={filterOldModuleId}
                setFilterOldModuleId={setFilterOldModuleId}
                filterNewModuleId={filterNewModuleId}
                setFilterNewModuleId={setFilterNewModuleId}
                selectedOldModuleType={selectedOldModuleType}
                setSelectedOldModuleType={setSelectedOldModuleType}
                selectedNewModuleType={selectedNewModuleType}
                setSelectedNewModuleType={setSelectedNewModuleType}
                filterScheduledDateFrom={filterScheduledDateFrom}
                setFilterScheduledDateFrom={setFilterScheduledDateFrom}
                filterScheduledDateTo={filterScheduledDateTo}
                setFilterScheduledDateTo={setFilterScheduledDateTo}
                filterCreatedBy={filterCreatedBy}
                setFilterCreatedBy={setFilterCreatedBy}
                filterUpdatedBy={filterUpdatedBy}
                setFilterUpdatedBy={setFilterUpdatedBy}
                filterScheduledBy={filterScheduledBy}
                setFilterScheduledBy={setFilterScheduledBy}
                filterCompletedBy={filterCompletedBy}
                setFilterCompletedBy={setFilterCompletedBy}
                filterCompletedAtFrom={filterCompletedAtFrom}
                setFilterCompletedAtFrom={setFilterCompletedAtFrom}
                filterCompletedAtTo={filterCompletedAtTo}
                setFilterCompletedAtTo={setFilterCompletedAtTo}
                filterNotes={filterNotes}
                setFilterNotes={setFilterNotes}
                filterCreatedAtFrom={filterCreatedAtFrom}
                setFilterCreatedAtFrom={setFilterCreatedAtFrom}
                filterCreatedAtTo={filterCreatedAtTo}
                setFilterCreatedAtTo={setFilterCreatedAtTo}
                filterUpdatedAtFrom={filterUpdatedAtFrom}
                setFilterUpdatedAtFrom={setFilterUpdatedAtFrom}
                filterUpdatedAtTo={filterUpdatedAtTo}
                setFilterUpdatedAtTo={setFilterUpdatedAtTo}
                systemTypes={systemTypes}
                moduleTypes={moduleTypes}
                assigneesData={assigneesData}
                workOrderStatuses={workOrderStatuses}
                serviceTypes={serviceTypes}
                troubleCodes={troubleCodes}
                hasActiveFilters={hasActiveFilters}
                activeFilterCount={activeFilterCount}
                clearAllFilters={clearFilters}
              />
              {/* Start Changeout - desktop only (hidden on mobile) */}
              {user?.role !== "customer" && hasPermission(permissionKeys.WORK_ORDERS_METER_CHANGEOUT) && (
                <Button 
                  size="sm"
                  onClick={() => setShowStartSystemChangeout(true)} 
                  data-testid="button-start-system-changeout-desktop"
                  className="hidden md:flex bg-green-600 text-white dark:bg-green-600"
                >
                  {project?.wizardMode === "reading_only" ? (
                    <Gauge className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 mr-1" />
                  )}
                  <span>{project?.wizardMode === "reading_only" ? "Start Reading Capture" : "Start Changeout"}</span>
                </Button>
              )}
              {hasPermission(permissionKeys.WORK_ORDERS_EDIT) && selectedWorkOrderIds.size > 0 && (
                <Button variant="outline" size="sm" onClick={handleOpenBulkStatus} data-testid="button-set-status">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                  Set Status ({selectedWorkOrderIds.size})
                </Button>
              )}
              {hasPermission(permissionKeys.WORK_ORDERS_DELETE) && selectedWorkOrderIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleBulkDelete} data-testid="button-delete-selected">
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete ({selectedWorkOrderIds.size})
                </Button>
              )}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear Filters
                </Button>
              )}
              {sortCriteria.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSort} data-testid="button-clear-sort">
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear Sort ({sortCriteria.length})
                </Button>
              )}
              {/* Right-aligned: Assign Work Orders, View Toggle */}
              <div className="flex-1" />
              <div className="flex items-center gap-2 flex-wrap">
                {hasPermission(permissionKeys.WORK_ORDERS_ASSIGN) && (
                  <Button variant="outline" size="sm" onClick={handleOpenBulkAssign} data-testid="button-assign-work-orders">
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Assign Work Orders
                  </Button>
                )}
                {hasPermission('workOrders.calendar') && (
                  <div className="flex items-center border rounded-md flex-shrink-0">
                    <Button
                      variant={viewMode === "table" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("table")}
                      className="rounded-r-none"
                      data-testid="button-view-table"
                    >
                      <List className="h-3.5 w-3.5 mr-1" />
                      WO List
                    </Button>
                    <Button
                      variant={viewMode === "calendar" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("calendar")}
                      className="rounded-l-none"
                      data-testid="button-view-calendar"
                    >
                      <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                      Calendar
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {/* Row 2: Stats, Columns, Sort | Right: CSV, Excel, PDF, Route Sheet */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={showStats ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowStats(!showStats)}
                data-testid="button-toggle-stats"
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1" />
                {showStats ? "Hide Stats" : "Show Stats"}
              </Button>
              <ColumnSelector
                allColumns={filteredWorkOrderColumns}
                visibleColumns={filteredVisibleColumns}
                onChange={setVisibleColumns}
                disabled={columnPrefsLoading}
                orderedColumns={filteredOrderedColumns}
                stickyColumns={filteredStickyColumns}
                onStickyChange={setStickyColumns}
              />
              <SortDialog
                sortCriteria={sortCriteria}
                setSortCriteria={setSortCriteria}
                columns={filteredWorkOrderColumns}
              />
              {hasPermission(permissionKeys.WORK_ORDERS_CREATE) && (
                <Button variant="outline" size="sm" onClick={() => setIsCreatingWorkOrder(true)} data-testid="button-create-work-order">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  New Work Order
                </Button>
              )}
              {/* Right-aligned: Export buttons */}
              <div className="flex-1" />
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export-csv">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportToExcel} data-testid="button-export-excel">
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={exportToPDF} data-testid="button-export-pdf-workorders">
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowRouteSheetDialog(true)} data-testid="button-route-sheet-workorders">
                  <Route className="h-3.5 w-3.5 mr-1" />
                  Route Sheet
                </Button>
              </div>
            </div>
          </CardContent>
          </Card>
        )}
      </>

      {/* Results count - hidden in calendar view */}
      {viewMode !== "calendar" && workOrders.length > 0 && (searchQuery || hasActiveFilters) && (
        <div className="text-sm text-muted-foreground flex-shrink-0">
          Filtered: {filteredAndSortedWorkOrders.length} of {workOrders.length} work orders
        </div>
      )}

      {viewMode === "calendar" && hasPermission('workOrders.calendar') ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0 h-[calc(100vh-180px)] min-h-[500px]">
            <WorkOrderCalendar
              workOrders={workOrders}
              statuses={workOrderStatuses}
              serviceTypes={serviceTypes}
              onWorkOrderClick={handleEdit}
              onReschedule={handleReschedule}
              projectId={projectId!}
              assigneesData={assigneesData}
              initialWorkOrderForScheduling={workOrderForCalendarScheduling}
              onInitialSchedulingHandled={() => setWorkOrderForCalendarScheduling(null)}
              projectTimezone={project?.timezone || undefined}
            />
          </CardContent>
        </Card>
      ) : workOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No work orders yet</p>
            {hasPermission(permissionKeys.WORK_ORDERS_CREATE) && (
              <Button variant="outline" className="mt-4" onClick={() => setIsCreatingWorkOrder(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Work Order
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="flex flex-col flex-1 min-h-0">
          <CardContent className="flex-1 min-h-0 flex flex-col p-0">
            <div ref={tableScrollRef} className="overflow-x-auto overflow-y-auto w-full flex-1 min-h-0">
              <Table ref={tableRef} noWrapper>
                <TableHeader>
                  <TableRow>
                    {hasPermission(permissionKeys.WORK_ORDERS_DELETE) && (
                      <TableHead className="sticky top-0 left-0 z-40 bg-muted w-10">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className="flex items-center gap-1 cursor-pointer">
                              <Checkbox
                                checked={allFilteredSelected ? true : someSelected ? "indeterminate" : false}
                                onCheckedChange={toggleSelectAll}
                                aria-label="Select all"
                                data-testid="checkbox-select-all"
                              />
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={toggleSelectAll} data-testid="menu-select-page">
                              {allCurrentPageSelected ? "Deselect This Page" : "Select This Page"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={selectAllFiltered} data-testid="menu-select-all-filtered">
                              Select All Filtered ({filteredAndSortedWorkOrders.length})
                            </DropdownMenuItem>
                            {someSelected && (
                              <DropdownMenuItem onClick={clearAllSelections} data-testid="menu-clear-selection">
                                Clear Selection ({selectedWorkOrderIds.size})
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableHead>
                    )}
                    {filteredVisibleColumns.map((key, index) => renderHeaderCell(key, index === 0))}
                    {user?.role !== "customer" && <TableHead className="sticky top-0 z-30 bg-muted whitespace-nowrap">Actions</TableHead>}
                    <TableHead className="sticky top-0 z-30 bg-muted w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedWorkOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={filteredVisibleColumns.length + (user?.role !== "customer" ? 1 : 0) + 1 + (hasPermission(permissionKeys.WORK_ORDERS_DELETE) ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                        No work orders match your search
                      </TableCell>
                    </TableRow>
                  ) : paginatedWorkOrders.map((workOrder) => (
                    <TableRow 
                      key={workOrder.id} 
                      data-testid={`row-work-order-${workOrder.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, a, [role="button"], input[type="checkbox"]')) return;
                        handleEdit(workOrder);
                      }}
                    >
                      {hasPermission(permissionKeys.WORK_ORDERS_DELETE) && (
                        <TableCell className="w-10">
                          <Checkbox
                            checked={selectedWorkOrderIds.has(workOrder.id)}
                            onCheckedChange={() => toggleWorkOrderSelection(workOrder.id)}
                            aria-label={`Select work order ${workOrder.customerWoId}`}
                            data-testid={`checkbox-select-${workOrder.id}`}
                          />
                        </TableCell>
                      )}
                      {filteredVisibleColumns.map((key, index) => renderDataCell(key, workOrder, index === 0))}
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
                      <TableCell className="w-8 text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filteredAndSortedWorkOrders.length}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              className="mt-4"
              isAutoMode={isAutoPageSize}
              onAutoModeToggle={handleAutoModeToggle}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={showBulkAssignDialog} onOpenChange={(open) => { 
        setShowBulkAssignDialog(open); 
        if (!open) resetBulkAssignState(); 
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Work Orders</DialogTitle>
            <DialogDescription>
              Assign or unassign the {filteredAndSortedWorkOrders.length} filtered work order(s).
            </DialogDescription>
          </DialogHeader>
          
          {checkAssignmentsMutation.isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Checking assignments...</span>
            </div>
          ) : bulkAssignCheckResult ? (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-md space-y-1 text-sm">
                <p><strong>{bulkAssignCheckResult.assignableCount}</strong> work order(s) can be assigned</p>
                {bulkAssignCheckResult.completedCount > 0 && (
                  <p className="text-muted-foreground">{bulkAssignCheckResult.completedCount} Completed (will be skipped)</p>
                )}
                {bulkAssignCheckResult.closedCount > 0 && (
                  <p className="text-muted-foreground">{bulkAssignCheckResult.closedCount} Closed (will be skipped)</p>
                )}
                {bulkAssignCheckResult.scheduledCount > 0 && (
                  <p className="text-muted-foreground">{bulkAssignCheckResult.scheduledCount} Scheduled (will be skipped)</p>
                )}
              </div>
              
              {bulkAssignCheckResult.existingAssignments > 0 && bulkAssignAction === "assign" && (
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3 rounded-md flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">Warning: Existing Assignments</p>
                    <p className="text-yellow-700 dark:text-yellow-300">{bulkAssignCheckResult.existingAssignments} work order(s) already have assignments. Continuing will replace them.</p>
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={bulkAssignAction === "assign" ? "default" : "outline"}
                    onClick={() => setBulkAssignAction("assign")}
                    className="flex-1"
                    data-testid="button-bulk-action-assign"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Assign
                  </Button>
                  <Button
                    variant={bulkAssignAction === "unassign" ? "default" : "outline"}
                    onClick={() => setBulkAssignAction("unassign")}
                    className="flex-1"
                    data-testid="button-bulk-action-unassign"
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Unassign
                  </Button>
                </div>
                
                {bulkAssignAction === "assign" && (
                  <>
                    <div className="flex gap-2">
                      <Button
                        variant={bulkAssigneeType === "user" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => { setBulkAssigneeType("user"); setBulkAssigneeId(""); }}
                        data-testid="button-assignee-type-user"
                      >
                        User
                      </Button>
                      <Button
                        variant={bulkAssigneeType === "group" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => { setBulkAssigneeType("group"); setBulkAssigneeId(""); }}
                        data-testid="button-assignee-type-group"
                      >
                        Group
                      </Button>
                    </div>
                    
                    <Select value={bulkAssigneeId} onValueChange={setBulkAssigneeId}>
                      <SelectTrigger data-testid="select-bulk-assignee">
                        <SelectValue placeholder={`Select ${bulkAssigneeType === "user" ? "a user" : "a group"}...`} />
                      </SelectTrigger>
                      <SelectContent>
                        {bulkAssigneeType === "user" ? (
                          assigneesData?.users.map((u) => (
                            <SelectItem key={u.id} value={u.id} data-testid={`select-user-${u.id}`}>
                              {u.label} {u.username ? `(${u.username})` : ""}
                            </SelectItem>
                          ))
                        ) : (
                          assigneesData?.groups.map((g) => (
                            <SelectItem key={g.id} value={g.id} data-testid={`select-group-${g.id}`}>
                              {g.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>
          ) : null}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkAssignDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleBulkAssignSubmit}
              disabled={bulkAssignMutation.isPending || checkAssignmentsMutation.isPending || !bulkAssignCheckResult || bulkAssignCheckResult.assignableCount === 0 || (bulkAssignAction === "assign" && !bulkAssigneeId)}
              data-testid="button-bulk-assign-submit"
            >
              {bulkAssignMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : bulkAssignAction === "assign" ? (
                `Assign ${bulkAssignCheckResult?.assignableCount || 0} Work Orders`
              ) : (
                `Unassign ${bulkAssignCheckResult?.assignableCount || 0} Work Orders`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {systemTypeDialog}

      <RouteSheetDialog
        open={showRouteSheetDialog}
        onOpenChange={setShowRouteSheetDialog}
        workOrders={filteredAndSortedWorkOrders.map(wo => ({
          customerWoId: wo.customerWoId || String(wo.id),
          address: wo.address || "",
          oldSystemNumber: wo.oldSystemId || null,
          newSystemNumber: wo.newSystemId || null,
          oldModuleId: (wo as any).oldModuleId || null,
          newModuleId: (wo as any).newModuleId || null,
        }))}
        projectName={project?.name}
      />

      {projectId && (
        <StartSystemChangeoutDialog
          isOpen={showStartSystemChangeout}
          onClose={() => setShowStartSystemChangeout(false)}
          projectId={projectId}
          onWorkOrderFound={(workOrder, scope) => {
            setAutoLaunchChangeoutScope(scope);
            setAutoLaunchSystemChangeout(true);
            setEditingWorkOrder(workOrder);
          }}
          wizardMode={(project?.wizardMode as "changeout" | "reading_only" | "user_choice") ?? "changeout"}
          searchMethodSettings={{
            searchShowBarcodeScan: (project as any)?.searchShowBarcodeScan !== false,
            searchShowQrCodeScan: (project as any)?.searchShowQrCodeScan !== false,
            searchShowManualEntry: (project as any)?.searchShowManualEntry !== false,
            searchShowHidScanner: (project as any)?.searchShowHidScanner !== false,
          }}
        />
      )}

      <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Work Orders</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedWorkOrderIds.size} work order(s)? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDeleteDialog(false)} data-testid="button-cancel-bulk-delete">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedWorkOrderIds.size} Work Order(s)`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkStatusDialog} onOpenChange={(open) => { 
        setShowBulkStatusDialog(open); 
        if (!open) {
          setBulkStatusValue("");
          setBulkStatusCheckResult(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Work Order Status</DialogTitle>
            <DialogDescription>
              Set status for the {filteredAndSortedWorkOrders.length} filtered work order(s).
            </DialogDescription>
          </DialogHeader>
          
          {checkBulkStatusMutation.isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Checking work orders...</span>
            </div>
          ) : bulkStatusCheckResult ? (() => {
            // Calculate effective eligible count based on selected status
            const isClosingSelected = (bulkStatusValue || "").toLowerCase() === "closed";
            const canCloseCompletedTrouble = isClosingSelected && bulkStatusCheckResult.canClose;
            const effectiveEligibleCount = canCloseCompletedTrouble 
              ? bulkStatusCheckResult.eligibleCount + bulkStatusCheckResult.completedCount + bulkStatusCheckResult.troubleCount
              : bulkStatusCheckResult.eligibleCount;
            const completedSkipCount = canCloseCompletedTrouble ? 0 : bulkStatusCheckResult.completedCount;
            const troubleSkipCount = canCloseCompletedTrouble ? 0 : bulkStatusCheckResult.troubleCount;
            const hasAnyEligible = bulkStatusCheckResult.eligibleCount > 0 || 
              (bulkStatusCheckResult.canClose && (bulkStatusCheckResult.completedCount > 0 || bulkStatusCheckResult.troubleCount > 0));
            
            return (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-md space-y-1 text-sm">
                <p><strong>{effectiveEligibleCount}</strong> work order(s) can be updated</p>
                {bulkStatusCheckResult.scheduledCount > 0 && (
                  <p className="text-muted-foreground">{bulkStatusCheckResult.scheduledCount} Scheduled (will be skipped)</p>
                )}
                {completedSkipCount > 0 && (
                  <p className="text-muted-foreground">{completedSkipCount} Completed (will be skipped)</p>
                )}
                {troubleSkipCount > 0 && (
                  <p className="text-muted-foreground">{troubleSkipCount} Trouble (will be skipped)</p>
                )}
                {isClosingSelected && canCloseCompletedTrouble && (bulkStatusCheckResult.completedCount > 0 || bulkStatusCheckResult.troubleCount > 0) && (
                  <p className="text-green-600 dark:text-green-400">
                    {bulkStatusCheckResult.completedCount + bulkStatusCheckResult.troubleCount} Completed/Trouble will be closed
                  </p>
                )}
              </div>
              
              {hasAnyEligible && (
                <div className="space-y-2">
                  <Label>Select New Status</Label>
                  <Select value={bulkStatusValue} onValueChange={setBulkStatusValue}>
                    <SelectTrigger data-testid="select-bulk-status">
                      <SelectValue placeholder="Select status..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workOrderStatuses
                        .filter(s => !["Scheduled", "Completed", "Trouble"].includes(s.label))
                        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                        .map(status => (
                          <SelectItem key={status.id} value={status.label} data-testid={`option-status-${status.label.toLowerCase().replace(/\s+/g, '-')}`}>
                            {status.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowBulkStatusDialog(false)} data-testid="button-cancel-bulk-status">
                  Cancel
                </Button>
                <Button
                  onClick={handleBulkStatusSubmit}
                  disabled={bulkStatusMutation.isPending || checkBulkStatusMutation.isPending || !bulkStatusCheckResult || effectiveEligibleCount === 0 || !bulkStatusValue}
                  data-testid="button-confirm-bulk-status"
                >
                  {bulkStatusMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    `Set Status for ${effectiveEligibleCount} Work Order(s)`
                  )}
                </Button>
              </DialogFooter>
            </div>
            );
          })() : null}
        </DialogContent>
      </Dialog>

      <BackToTop containerRef={tableScrollRef} />
    </div>
  );
}
