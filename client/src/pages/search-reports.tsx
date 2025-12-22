import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ColumnSelector, type ColumnConfig } from "@/components/column-selector";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { FilterSelector, type FilterConfig } from "@/components/filter-selector";
import { useFilterPreferences } from "@/hooks/use-filter-preferences";
import { Search, Download, FileSpreadsheet, FileText, FileDown, Filter, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Project, ServiceTypeRecord, WorkOrderStatus, MeterType, TroubleCode, User, UserGroup } from "@shared/schema";
import * as XLSX from "xlsx";
import { format } from "date-fns";

type SearchResult = {
  projectId: number;
  projectName: string;
  workOrder: {
    id: number;
    customerWoId?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
    email?: string | null;
    route?: string | null;
    zone?: string | null;
    serviceType?: string | null;
    oldMeterId?: string | null;
    oldMeterReading?: number | null;
    newMeterId?: string | null;
    newMeterReading?: number | null;
    oldGps?: string | null;
    newGps?: string | null;
    status: string;
    scheduledDate?: string | null;
    assignedUserId?: string | null;
    assignedGroupId?: number | null;
    createdBy?: string | null;
    updatedBy?: string | null;
    completedAt?: string | null;
    trouble?: string | null;
    notes?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    oldMeterType?: string | null;
    newMeterType?: string | null;
  };
};

type SearchResponse = {
  results: SearchResult[];
  total: number;
  projectsSearched: number;
};

export default function SearchReports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatExport, formatCustom } = useTimezone();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProjectState] = useState<string>("all");
  
  const setSelectedProject = (value: string) => {
    setSelectedProjectState(value);
  };
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedServiceType, setSelectedServiceType] = useState<string>("all");
  const [filterCustomerWoId, setFilterCustomerWoId] = useState("");
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
  const [filterOldMeterType, setFilterOldMeterType] = useState("all");
  const [filterNewMeterId, setFilterNewMeterId] = useState("");
  const [filterNewMeterType, setFilterNewMeterType] = useState("all");
  const [filterScheduledDateFrom, setFilterScheduledDateFrom] = useState("");
  const [filterScheduledDateTo, setFilterScheduledDateTo] = useState("");
  const [filterAssignedTo, setFilterAssignedTo] = useState("all");
  const [filterAssignedGroup, setFilterAssignedGroup] = useState("all");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");
  const [filterUpdatedBy, setFilterUpdatedBy] = useState("all");
  const [filterCompletedAtFrom, setFilterCompletedAtFrom] = useState("");
  const [filterCompletedAtTo, setFilterCompletedAtTo] = useState("");
  const [filterTroubleCode, setFilterTroubleCode] = useState("all");
  const [filterNotes, setFilterNotes] = useState("");
  const [filterCreatedAtFrom, setFilterCreatedAtFrom] = useState("");
  const [filterCreatedAtTo, setFilterCreatedAtTo] = useState("");
  const [filterUpdatedAtFrom, setFilterUpdatedAtFrom] = useState("");
  const [filterUpdatedAtTo, setFilterUpdatedAtTo] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortCriteria, setSortCriteria] = useState<Array<{ column: string; direction: "asc" | "desc" }>>([]);
  const [stateRestored, setStateRestored] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  const columns: ColumnConfig[] = useMemo(() => [
    { key: "projectName", label: "Project", required: true },
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
    { key: "actions", label: "Actions", required: true },
  ], []);

  const { visibleColumns, setVisibleColumns, isColumnVisible, isLoading: columnPrefsLoading, orderedColumns } = useColumnPreferences("search_reports", columns);

  // Filter configuration - matches columns (excluding attachments and signature_data)
  const searchFilters: FilterConfig[] = useMemo(() => [
    { key: "searchQuery", label: "Search Text" },
    { key: "projectName", label: "Project" },
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
    { key: "troubleCode", label: "Trouble Code" },
    { key: "notes", label: "Notes" },
    { key: "createdAt", label: "Created At" },
    { key: "updatedAt", label: "Updated At" },
  ], []);

  const { visibleFilters, setVisibleFilters, isFilterVisible, isLoading: filterPrefsLoading } = useFilterPreferences("search-reports", searchFilters);

  // Restore search state from sessionStorage if returning from work order edit
  useEffect(() => {
    const savedState = sessionStorage.getItem('searchReportsState');
    if (savedState && !stateRestored) {
      try {
        const state = JSON.parse(savedState);
        setSearchQuery(state.searchQuery || "");
        setSelectedProjectState(state.selectedProject || "all");
        setSelectedStatus(state.selectedStatus || "all");
        setSelectedServiceType(state.selectedServiceType || "all");
        setIsSearchActive(state.isSearchActive || false);
        setStateRestored(true);
        // Clear the stored state after restoring
        sessionStorage.removeItem('searchReportsState');
      } catch (e) {
        console.error("Failed to restore search state:", e);
      }
    }
  }, [stateRestored]);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: serviceTypes = [] } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
  });

  const { data: workOrderStatuses = [] } = useQuery<WorkOrderStatus[]>({
    queryKey: ["/api/work-order-statuses"],
  });

  const { data: meterTypes = [] } = useQuery<MeterType[]>({
    queryKey: ["/api/meter-types", { projectId: selectedProject !== "all" ? selectedProject : undefined }],
    queryFn: async () => {
      const url = selectedProject !== "all" 
        ? `/api/meter-types?projectId=${selectedProject}`
        : "/api/meter-types";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch meter types");
      return response.json();
    },
  });

  const { data: troubleCodes = [] } = useQuery<TroubleCode[]>({
    queryKey: ["/api/trouble-codes"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: userGroups = [] } = useQuery<UserGroup[]>({
    queryKey: ["/api/user-groups"],
  });

  // Helper to get assigned user name from ID
  const getAssignedUserName = (userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.username || null;
  };

  // Helper to get assigned group name from ID
  const getAssignedGroupName = (groupId: number | null | undefined): string | null => {
    if (!groupId) return null;
    const group = userGroups.find(g => g.id === groupId);
    return group?.name || null;
  };

  // Helper to get trouble code label from code
  const getTroubleCodeLabel = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const troubleCode = troubleCodes.find(tc => tc.code === code);
    return troubleCode?.label || code;
  };

  // Helper to get color hex from color name
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

  const buildSearchParams = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.append("query", searchQuery);
    if (selectedProject !== "all") params.append("projectId", selectedProject);
    if (selectedStatus !== "all") params.append("status", selectedStatus);
    if (selectedServiceType !== "all") params.append("serviceType", selectedServiceType);
    if (filterCreatedAtFrom) params.append("dateFrom", filterCreatedAtFrom);
    if (filterCreatedAtTo) params.append("dateTo", filterCreatedAtTo);
    return params.toString();
  };

  const { data: searchResults, isLoading: searchLoading, refetch } = useQuery<SearchResponse>({
    queryKey: ["/api/search/work-orders", buildSearchParams()],
    queryFn: async () => {
      const params = buildSearchParams();
      const response = await fetch(`/api/search/work-orders?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: isSearchActive,
  });

  const handleSearch = () => {
    setIsSearchActive(true);
    refetch();
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedProject("all");
    setSelectedStatus("all");
    setSelectedServiceType("all");
    setFilterCustomerWoId("");
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
    setFilterOldMeterType("all");
    setFilterNewMeterId("");
    setFilterNewMeterType("all");
    setFilterScheduledDateFrom("");
    setFilterScheduledDateTo("");
    setFilterAssignedTo("all");
    setFilterAssignedGroup("all");
    setFilterCreatedBy("all");
    setFilterUpdatedBy("all");
    setFilterCompletedAtFrom("");
    setFilterCompletedAtTo("");
    setFilterTroubleCode("all");
    setFilterNotes("");
    setFilterCreatedAtFrom("");
    setFilterCreatedAtTo("");
    setFilterUpdatedAtFrom("");
    setFilterUpdatedAtTo("");
    setIsSearchActive(false);
    setSortCriteria([]);
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
    projectName: { label: "Project", sortKey: "projectName" },
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
        onClick={(e) => handleSort(sortKey, e)}
        title="Click to sort. Shift+click to add to multi-column sort."
        data-testid={`header-${key}`}
      >
        {config.label} {getSortIcon(sortKey)}
      </TableHead>
    );
  };

  // Render a table data cell for a given column key and result
  const renderDataCell = (key: string, result: SearchResult) => {
    const wo = result.workOrder;
    switch (key) {
      case "projectName":
        return <TableCell key={key}>{result.projectName}</TableCell>;
      case "customerWoId":
        return <TableCell key={key} className="font-medium">{wo.customerWoId || "-"}</TableCell>;
      case "customerId":
        return <TableCell key={key}>{wo.customerId || "-"}</TableCell>;
      case "customerName":
        return <TableCell key={key}>{wo.customerName || "-"}</TableCell>;
      case "address":
        return <TableCell key={key} className="max-w-xs truncate">{wo.address || "-"}</TableCell>;
      case "city":
        return <TableCell key={key}>{wo.city || "-"}</TableCell>;
      case "state":
        return <TableCell key={key}>{wo.state || "-"}</TableCell>;
      case "zip":
        return <TableCell key={key}>{wo.zip || "-"}</TableCell>;
      case "phone":
        return <TableCell key={key}>{wo.phone || "-"}</TableCell>;
      case "email":
        return <TableCell key={key}>{wo.email || "-"}</TableCell>;
      case "route":
        return <TableCell key={key}>{wo.route || "-"}</TableCell>;
      case "zone":
        return <TableCell key={key}>{wo.zone || "-"}</TableCell>;
      case "serviceType":
        return <TableCell key={key}>{getServiceTypeBadge(wo.serviceType)}</TableCell>;
      case "oldMeterId":
        return <TableCell key={key}>{wo.oldMeterId || "-"}</TableCell>;
      case "oldMeterReading":
        return <TableCell key={key}>{wo.oldMeterReading ?? "-"}</TableCell>;
      case "oldMeterType":
        return <TableCell key={key}>{wo.oldMeterType || "-"}</TableCell>;
      case "newMeterId":
        return <TableCell key={key}>{wo.newMeterId || "-"}</TableCell>;
      case "newMeterReading":
        return <TableCell key={key}>{wo.newMeterReading ?? "-"}</TableCell>;
      case "newMeterType":
        return <TableCell key={key}>{wo.newMeterType || "-"}</TableCell>;
      case "oldGps":
        return <TableCell key={key}>{wo.oldGps || "-"}</TableCell>;
      case "newGps":
        return <TableCell key={key}>{wo.newGps || "-"}</TableCell>;
      case "status":
        return <TableCell key={key}>{getStatusBadge(wo.status)}</TableCell>;
      case "scheduledDate":
        return <TableCell key={key}>{wo.scheduledDate ? formatCustom(wo.scheduledDate, "MMM d, yyyy") : "-"}</TableCell>;
      case "assignedTo":
        return <TableCell key={key}>{getAssignedUserName(wo.assignedUserId) || "-"}</TableCell>;
      case "assignedGroup":
        return <TableCell key={key}>{getAssignedGroupName(wo.assignedGroupId) || "-"}</TableCell>;
      case "createdBy":
        return <TableCell key={key}>{wo.createdBy || "-"}</TableCell>;
      case "updatedBy":
        return <TableCell key={key}>{wo.updatedBy || "-"}</TableCell>;
      case "completedAt":
        return <TableCell key={key}>{wo.completedAt ? formatCustom(wo.completedAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>;
      case "trouble":
        return <TableCell key={key}>{getTroubleCodeLabel(wo.trouble) || "-"}</TableCell>;
      case "notes":
        return <TableCell key={key} className="max-w-xs truncate">{wo.notes || "-"}</TableCell>;
      case "createdAt":
        return <TableCell key={key}>{wo.createdAt ? formatCustom(wo.createdAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>;
      case "updatedAt":
        return <TableCell key={key}>{wo.updatedAt ? formatCustom(wo.updatedAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>;
      default:
        return null;
    }
  };

  const filteredAndSortedResults = useMemo(() => {
    if (!searchResults?.results) return [];
    let results = [...searchResults.results];

    // Apply client-side filters
    if (filterCustomerWoId) {
      results = results.filter(r => (r.workOrder.customerWoId || '').toLowerCase().includes(filterCustomerWoId.toLowerCase()));
    }
    if (filterCustomerId) {
      results = results.filter(r => (r.workOrder.customerId || '').toLowerCase().includes(filterCustomerId.toLowerCase()));
    }
    if (filterCustomerName) {
      results = results.filter(r => (r.workOrder.customerName || '').toLowerCase().includes(filterCustomerName.toLowerCase()));
    }
    if (filterAddress) {
      results = results.filter(r => (r.workOrder.address || '').toLowerCase().includes(filterAddress.toLowerCase()));
    }
    if (filterCity) {
      results = results.filter(r => (r.workOrder.city || '').toLowerCase().includes(filterCity.toLowerCase()));
    }
    if (filterState) {
      results = results.filter(r => (r.workOrder.state || '').toLowerCase().includes(filterState.toLowerCase()));
    }
    if (filterZip) {
      results = results.filter(r => (r.workOrder.zip || '').toLowerCase().includes(filterZip.toLowerCase()));
    }
    if (filterPhone) {
      results = results.filter(r => (r.workOrder.phone || '').toLowerCase().includes(filterPhone.toLowerCase()));
    }
    if (filterEmail) {
      results = results.filter(r => (r.workOrder.email || '').toLowerCase().includes(filterEmail.toLowerCase()));
    }
    if (filterRoute) {
      results = results.filter(r => (r.workOrder.route || '').toLowerCase().includes(filterRoute.toLowerCase()));
    }
    if (filterZone) {
      results = results.filter(r => (r.workOrder.zone || '').toLowerCase().includes(filterZone.toLowerCase()));
    }
    if (filterOldMeterId) {
      results = results.filter(r => (r.workOrder.oldMeterId || '').toLowerCase().includes(filterOldMeterId.toLowerCase()));
    }
    if (filterOldMeterType !== "all") {
      results = results.filter(r => (r.workOrder.oldMeterType || '') === filterOldMeterType);
    }
    if (filterNewMeterId) {
      results = results.filter(r => (r.workOrder.newMeterId || '').toLowerCase().includes(filterNewMeterId.toLowerCase()));
    }
    if (filterNewMeterType !== "all") {
      results = results.filter(r => (r.workOrder.newMeterType || '') === filterNewMeterType);
    }
    if (filterAssignedTo !== "all") {
      // Look up user label from selected ID for fallback comparison
      const selectedUser = users.find(u => u.id === filterAssignedTo);
      const selectedUserLabel = selectedUser?.username || (selectedUser?.firstName && selectedUser?.lastName ? `${selectedUser.firstName} ${selectedUser.lastName}` : null);
      results = results.filter(r => {
        const wo = r.workOrder as any;
        // ID-based match (normalize both to strings for comparison)
        if (wo.assignedUserId && String(wo.assignedUserId) === String(filterAssignedTo)) return true;
        return false;
      });
    }
    if (filterAssignedGroup !== "all") {
      // Look up group name from selected ID for fallback comparison
      const selectedGroup = userGroups.find(g => String(g.id) === filterAssignedGroup);
      const selectedGroupName = selectedGroup?.name;
      results = results.filter(r => {
        const wo = r.workOrder as any;
        // ID-based match
        if (wo.assignedGroupId && String(wo.assignedGroupId) === filterAssignedGroup) return true;
        return false;
      });
    }
    if (filterCreatedBy !== "all") {
      // Look up user label from selected ID for fallback comparison
      const selectedUser = users.find(u => u.id === filterCreatedBy);
      const selectedUserLabel = selectedUser?.username || (selectedUser?.firstName && selectedUser?.lastName ? `${selectedUser.firstName} ${selectedUser.lastName}` : null);
      results = results.filter(r => {
        const wo = r.workOrder as any;
        // First try ID-based match (normalize both to strings for comparison)
        if (wo.createdById && String(wo.createdById) === String(filterCreatedBy)) return true;
        // Fall back to user name match
        if (selectedUserLabel && wo.createdBy === selectedUserLabel) return true;
        return false;
      });
    }
    if (filterUpdatedBy !== "all") {
      // Look up user label from selected ID for fallback comparison
      const selectedUser = users.find(u => u.id === filterUpdatedBy);
      const selectedUserLabel = selectedUser?.username || (selectedUser?.firstName && selectedUser?.lastName ? `${selectedUser.firstName} ${selectedUser.lastName}` : null);
      results = results.filter(r => {
        const wo = r.workOrder as any;
        // First try ID-based match (normalize both to strings for comparison)
        if (wo.updatedById && String(wo.updatedById) === String(filterUpdatedBy)) return true;
        // Fall back to user name match
        if (selectedUserLabel && wo.updatedBy === selectedUserLabel) return true;
        return false;
      });
    }
    if (filterTroubleCode !== "all") {
      if (filterTroubleCode === "none") {
        results = results.filter(r => !((r.workOrder as any).trouble) && !((r.workOrder as any).troubleCode));
      } else {
        results = results.filter(r => {
          const trouble = (r.workOrder as any).trouble || '';
          const troubleCode = (r.workOrder as any).troubleCode || '';
          return trouble === filterTroubleCode || troubleCode === filterTroubleCode;
        });
      }
    }
    if (filterNotes) {
      results = results.filter(r => (r.workOrder.notes || '').toLowerCase().includes(filterNotes.toLowerCase()));
    }
    if (filterScheduledDateFrom || filterScheduledDateTo) {
      results = results.filter(r => {
        const scheduledDate = (r.workOrder as any).scheduledDate;
        if (!scheduledDate) return false;
        const dateStr = scheduledDate.substring(0, 10);
        if (filterScheduledDateFrom && dateStr < filterScheduledDateFrom) return false;
        if (filterScheduledDateTo && dateStr > filterScheduledDateTo) return false;
        return true;
      });
    }
    if (filterCompletedAtFrom || filterCompletedAtTo) {
      results = results.filter(r => {
        if (!r.workOrder.completedAt) return false;
        const dateStr = r.workOrder.completedAt.substring(0, 10);
        if (filterCompletedAtFrom && dateStr < filterCompletedAtFrom) return false;
        if (filterCompletedAtTo && dateStr > filterCompletedAtTo) return false;
        return true;
      });
    }
    if (filterCreatedAtFrom || filterCreatedAtTo) {
      results = results.filter(r => {
        if (!r.workOrder.createdAt) return false;
        const dateStr = r.workOrder.createdAt.substring(0, 10);
        if (filterCreatedAtFrom && dateStr < filterCreatedAtFrom) return false;
        if (filterCreatedAtTo && dateStr > filterCreatedAtTo) return false;
        return true;
      });
    }
    if (filterUpdatedAtFrom || filterUpdatedAtTo) {
      results = results.filter(r => {
        if (!r.workOrder.updatedAt) return false;
        const dateStr = r.workOrder.updatedAt.substring(0, 10);
        if (filterUpdatedAtFrom && dateStr < filterUpdatedAtFrom) return false;
        if (filterUpdatedAtTo && dateStr > filterUpdatedAtTo) return false;
        return true;
      });
    }

    // Apply multi-column sorting with proper value normalization
    if (sortCriteria.length > 0) {
      const dateColumns = ['scheduledDate', 'completedAt', 'createdAt', 'updatedAt'];
      const numericColumns = ['oldMeterReading', 'newMeterReading'];
      
      results.sort((a, b) => {
        for (const criterion of sortCriteria) {
          let aVal, bVal;
          if (criterion.column === 'projectName') {
            aVal = a.projectName || '';
            bVal = b.projectName || '';
          } else {
            aVal = (a.workOrder as any)[criterion.column];
            bVal = (b.workOrder as any)[criterion.column];
          }
          
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
            return criterion.direction === 'asc' ? comparison : -comparison;
          }
        }
        return 0;
      });
    }
    return results;
  }, [searchResults?.results, sortCriteria, filterCustomerWoId, filterCustomerId, filterCustomerName, filterAddress, filterCity, filterState, filterZip, filterPhone, filterEmail, filterRoute, filterZone, filterOldMeterId, filterOldMeterType, filterNewMeterId, filterNewMeterType, filterAssignedTo, filterAssignedGroup, filterCreatedBy, filterUpdatedBy, filterTroubleCode, filterNotes, filterScheduledDateFrom, filterScheduledDateTo, filterCompletedAtFrom, filterCompletedAtTo, filterCreatedAtFrom, filterCreatedAtTo, filterUpdatedAtFrom, filterUpdatedAtTo, users, userGroups]);

  // Calculate active filters
  const activeFiltersArray = [
    selectedProject !== "all",
    selectedStatus !== "all",
    selectedServiceType !== "all",
    filterCustomerWoId !== "",
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
    filterOldMeterId !== "",
    filterOldMeterType !== "all",
    filterNewMeterId !== "",
    filterNewMeterType !== "all",
    filterScheduledDateFrom !== "",
    filterScheduledDateTo !== "",
    filterAssignedTo !== "all",
    filterAssignedGroup !== "all",
    filterCreatedBy !== "all",
    filterUpdatedBy !== "all",
    filterCompletedAtFrom !== "",
    filterCompletedAtTo !== "",
    filterTroubleCode !== "all",
    filterNotes !== "",
    filterCreatedAtFrom !== "",
    filterCreatedAtTo !== "",
    filterUpdatedAtFrom !== "",
    filterUpdatedAtTo !== "",
  ];
  const hasActiveFilters = activeFiltersArray.some(Boolean);
  const activeFilterCount = activeFiltersArray.filter(Boolean).length;

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
      return <Badge variant="outline" className="text-xs">Unknown</Badge>;
    }
    const statusRecord = workOrderStatuses.find(
      s => s.code === status || s.label === status
    );
    if (statusRecord && statusRecord.color) {
      const bgColor = getStatusColorHex(statusRecord.color);
      const textColor = ['yellow', 'orange'].includes(statusRecord.color) ? '#000' : '#fff';
      return (
        <Badge 
          className="text-xs"
          style={{ backgroundColor: bgColor, color: textColor, borderColor: bgColor }}
        >
          {statusRecord.label}
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">{status}</Badge>;
  };

  const getServiceTypeBadge = (serviceType: string | null | undefined) => {
    if (!serviceType) {
      return <Badge variant="outline" className="text-xs">-</Badge>;
    }
    const serviceTypeRecord = serviceTypes.find(
      st => st.code === serviceType || st.label === serviceType
    );
    if (serviceTypeRecord && serviceTypeRecord.color) {
      const bgColor = getServiceTypeColorHex(serviceTypeRecord.color);
      const textColor = ['yellow', 'orange'].includes(serviceTypeRecord.color) ? '#000' : '#fff';
      return (
        <Badge 
          className="text-xs"
          style={{ backgroundColor: bgColor, color: textColor, borderColor: bgColor }}
        >
          {serviceTypeRecord.label}
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">{serviceType}</Badge>;
  };

  // Helper to get export value for a column key
  const getExportValue = (r: SearchResult, key: string): string => {
    switch (key) {
      case "projectName": return r.projectName;
      case "customerWoId": return r.workOrder.customerWoId || "";
      case "customerId": return r.workOrder.customerId || "";
      case "customerName": return r.workOrder.customerName || "";
      case "address": return r.workOrder.address || "";
      case "city": return r.workOrder.city || "";
      case "state": return r.workOrder.state || "";
      case "zip": return r.workOrder.zip || "";
      case "phone": return r.workOrder.phone || "";
      case "email": return r.workOrder.email || "";
      case "route": return r.workOrder.route || "";
      case "zone": return r.workOrder.zone || "";
      case "serviceType": return r.workOrder.serviceType || "";
      case "oldMeterId": return r.workOrder.oldMeterId || "";
      case "oldMeterType": return r.workOrder.oldMeterType || "";
      case "oldMeterReading": return r.workOrder.oldMeterReading?.toString() ?? "";
      case "newMeterId": return r.workOrder.newMeterId || "";
      case "newMeterReading": return r.workOrder.newMeterReading?.toString() ?? "";
      case "newMeterType": return r.workOrder.newMeterType || "";
      case "oldGps": return r.workOrder.oldGps || "";
      case "newGps": return r.workOrder.newGps || "";
      case "status": return r.workOrder.status;
      case "scheduledDate": return r.workOrder.scheduledDate ? formatExport(r.workOrder.scheduledDate) : "";
      case "assignedTo": return getAssignedUserName(r.workOrder.assignedUserId) || "";
      case "assignedGroup": return getAssignedGroupName(r.workOrder.assignedGroupId) || "";
      case "createdBy": return r.workOrder.createdBy || "";
      case "updatedBy": return r.workOrder.updatedBy || "";
      case "completedAt": return r.workOrder.completedAt ? formatExport(r.workOrder.completedAt) : "";
      case "trouble": return getTroubleCodeLabel(r.workOrder.trouble) || "";
      case "notes": return r.workOrder.notes || "";
      case "createdAt": return r.workOrder.createdAt ? formatExport(r.workOrder.createdAt) : "";
      case "updatedAt": return r.workOrder.updatedAt ? formatExport(r.workOrder.updatedAt) : "";
      default: return "";
    }
  };

  const exportToCSV = () => {
    if (!searchResults?.results.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use orderedColumns for correct order, filtering out 'actions'
    const exportColumns = orderedColumns.filter(col => col.key !== "actions");
    const headers = exportColumns.map(col => col.label);
    const rows = searchResults.results.map(r => 
      exportColumns.map(col => getExportValue(r, col.key))
    );

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `work-orders-${formatCustom(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({ title: "CSV exported successfully" });
  };

  const exportToExcel = () => {
    if (!searchResults?.results.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use orderedColumns for correct order, filtering out 'actions'
    const exportColumns = orderedColumns.filter(col => col.key !== "actions");
    
    const data = searchResults.results.map(r => {
      const row: Record<string, string> = {};
      exportColumns.forEach(col => {
        row[col.label] = getExportValue(r, col.key);
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Orders");
    XLSX.writeFile(workbook, `work-orders-${formatCustom(new Date(), "yyyy-MM-dd")}.xlsx`);

    toast({ title: "Excel file exported successfully" });
  };

  const exportToPDF = () => {
    if (!searchResults?.results.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    // Use orderedColumns for correct order, filtering out 'actions'
    const exportColumns = orderedColumns.filter(col => col.key !== "actions");

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Work Orders Report</title>
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
        <h1>Utility Meter Work Orders Report</h1>
        <div class="meta">
          <p>Generated: ${formatCustom(new Date(), "MMMM d, yyyy 'at' h:mm a")}</p>
          <p>Total Results: ${searchResults.total}</p>
          <p>Projects Searched: ${searchResults.projectsSearched}</p>
        </div>
        <table>
          <thead>
            <tr>
              ${exportColumns.map(col => `<th>${col.label}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${searchResults.results.map(r => `
              <tr>
                ${exportColumns.map(col => `<td>${getExportValue(r, col.key) || "-"}</td>`).join("")}
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Search & Reports</h1>
        <p className="text-muted-foreground">Search work orders across all your projects and generate reports</p>
      </div>

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
              {hasActiveFilters && <Badge variant="secondary" className="ml-2">{activeFilterCount}</Badge>}
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Clear Filters
              </Button>
            )}
            {sortCriteria.length > 0 && (
              <Button variant="ghost" onClick={clearSort} data-testid="button-clear-sort">
                <X className="h-4 w-4 mr-1" />
                Clear Sort ({sortCriteria.length})
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={handleSearch} disabled={searchLoading} data-testid="button-search">
              <Search className="h-4 w-4 mr-2" />
              {searchLoading ? "Searching..." : "Search"}
            </Button>
            <FilterSelector
              allFilters={searchFilters}
              visibleFilters={visibleFilters}
              onChange={setVisibleFilters}
              disabled={filterPrefsLoading}
            />
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
            {isFilterVisible("projectName") && (
              <div className="min-w-[180px]">
                <Label>Project</Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger data-testid="select-project">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("serviceType") && (
              <div className="min-w-[180px]">
                <Label>Service Type</Label>
                <Select value={selectedServiceType} onValueChange={setSelectedServiceType}>
                  <SelectTrigger data-testid="select-service-type">
                    <SelectValue placeholder="All Service Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Service Types</SelectItem>
                    {serviceTypes.map((st) => (
                      <SelectItem key={st.id} value={st.label}>{st.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("status") && (
              <div className="min-w-[180px]">
                <Label>Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="All Statuses" />
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
            {isFilterVisible("customerWoId") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-customer-wo-id">WO ID</Label>
                <Input id="filter-customer-wo-id" placeholder="Filter..." value={filterCustomerWoId} onChange={(e) => setFilterCustomerWoId(e.target.value)} data-testid="input-filter-customer-wo-id" />
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
              <div className="min-w-[150px]">
                <Label htmlFor="filter-city">City</Label>
                <Input id="filter-city" placeholder="Filter..." value={filterCity} onChange={(e) => setFilterCity(e.target.value)} data-testid="input-filter-city" />
              </div>
            )}
            {isFilterVisible("state") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-state">State</Label>
                <Input id="filter-state" placeholder="Filter..." value={filterState} onChange={(e) => setFilterState(e.target.value)} data-testid="input-filter-state" />
              </div>
            )}
            {isFilterVisible("zip") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-zip">ZIP</Label>
                <Input id="filter-zip" placeholder="Filter..." value={filterZip} onChange={(e) => setFilterZip(e.target.value)} data-testid="input-filter-zip" />
              </div>
            )}
            {isFilterVisible("phone") && (
              <div className="min-w-[150px]">
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
              <div className="min-w-[150px]">
                <Label htmlFor="filter-route">Route</Label>
                <Input id="filter-route" placeholder="Filter..." value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)} data-testid="input-filter-route" />
              </div>
            )}
            {isFilterVisible("zone") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-zone">Zone</Label>
                <Input id="filter-zone" placeholder="Filter..." value={filterZone} onChange={(e) => setFilterZone(e.target.value)} data-testid="input-filter-zone" />
              </div>
            )}
            {isFilterVisible("oldMeterId") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-old-meter-id">Old Meter ID</Label>
                <Input id="filter-old-meter-id" placeholder="Filter..." value={filterOldMeterId} onChange={(e) => setFilterOldMeterId(e.target.value)} data-testid="input-filter-old-meter-id" />
              </div>
            )}
            {isFilterVisible("oldMeterType") && meterTypes.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-old-meter-type">Old Meter Type</Label>
                <Select value={filterOldMeterType} onValueChange={setFilterOldMeterType}>
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
            {isFilterVisible("newMeterId") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-new-meter-id">New Meter ID</Label>
                <Input id="filter-new-meter-id" placeholder="Filter..." value={filterNewMeterId} onChange={(e) => setFilterNewMeterId(e.target.value)} data-testid="input-filter-new-meter-id" />
              </div>
            )}
            {isFilterVisible("newMeterType") && meterTypes.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-new-meter-type">New Meter Type</Label>
                <Select value={filterNewMeterType} onValueChange={setFilterNewMeterType}>
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
            {isFilterVisible("scheduledDate") && (
              <div className="min-w-[280px]">
                <Label>Scheduled Date</Label>
                <div className="flex gap-2 items-center">
                  <Input id="filter-scheduled-date-from" type="date" value={filterScheduledDateFrom} onChange={(e) => setFilterScheduledDateFrom(e.target.value)} data-testid="input-filter-scheduled-date-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="filter-scheduled-date-to" type="date" value={filterScheduledDateTo} onChange={(e) => setFilterScheduledDateTo(e.target.value)} data-testid="input-filter-scheduled-date-to" className="flex-1" />
                </div>
              </div>
            )}
            {isFilterVisible("assignedTo") && users.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-assigned-to">Assigned To (User)</Label>
                <Select value={filterAssignedTo} onValueChange={setFilterAssignedTo}>
                  <SelectTrigger id="filter-assigned-to" data-testid="select-filter-assigned-to">
                    <SelectValue placeholder="All Users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.username || `${u.firstName} ${u.lastName}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("assignedGroup") && userGroups.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-assigned-group">Assigned To (Group)</Label>
                <Select value={filterAssignedGroup} onValueChange={setFilterAssignedGroup}>
                  <SelectTrigger id="filter-assigned-group" data-testid="select-filter-assigned-group">
                    <SelectValue placeholder="All Groups" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {userGroups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("createdBy") && users.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-created-by">Created By</Label>
                <Select value={filterCreatedBy} onValueChange={setFilterCreatedBy}>
                  <SelectTrigger id="filter-created-by" data-testid="select-filter-created-by">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.username || `${u.firstName} ${u.lastName}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("updatedBy") && users.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-updated-by">Updated By</Label>
                <Select value={filterUpdatedBy} onValueChange={setFilterUpdatedBy}>
                  <SelectTrigger id="filter-updated-by" data-testid="select-filter-updated-by">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.username || `${u.firstName} ${u.lastName}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isFilterVisible("completedAt") && (
              <div className="min-w-[280px]">
                <Label>Completed At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="filter-completed-at-from" type="date" value={filterCompletedAtFrom} onChange={(e) => setFilterCompletedAtFrom(e.target.value)} data-testid="input-filter-completed-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="filter-completed-at-to" type="date" value={filterCompletedAtTo} onChange={(e) => setFilterCompletedAtTo(e.target.value)} data-testid="input-filter-completed-at-to" className="flex-1" />
                </div>
              </div>
            )}
            {isFilterVisible("troubleCode") && troubleCodes.length > 0 && (
              <div className="min-w-[180px]">
                <Label htmlFor="filter-trouble-code">Trouble Code</Label>
                <Select value={filterTroubleCode} onValueChange={setFilterTroubleCode}>
                  <SelectTrigger id="filter-trouble-code" data-testid="select-filter-trouble-code">
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
            {isFilterVisible("notes") && (
              <div className="min-w-[150px]">
                <Label htmlFor="filter-notes">Notes</Label>
                <Input id="filter-notes" placeholder="Filter..." value={filterNotes} onChange={(e) => setFilterNotes(e.target.value)} data-testid="input-filter-notes" />
              </div>
            )}
            {isFilterVisible("createdAt") && (
              <div className="min-w-[280px]">
                <Label>Created At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="filter-created-at-from" type="date" value={filterCreatedAtFrom} onChange={(e) => setFilterCreatedAtFrom(e.target.value)} data-testid="input-filter-created-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="filter-created-at-to" type="date" value={filterCreatedAtTo} onChange={(e) => setFilterCreatedAtTo(e.target.value)} data-testid="input-filter-created-at-to" className="flex-1" />
                </div>
              </div>
            )}
            {isFilterVisible("updatedAt") && (
              <div className="min-w-[280px]">
                <Label>Updated At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="filter-updated-at-from" type="date" value={filterUpdatedAtFrom} onChange={(e) => setFilterUpdatedAtFrom(e.target.value)} data-testid="input-filter-updated-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="filter-updated-at-to" type="date" value={filterUpdatedAtTo} onChange={(e) => setFilterUpdatedAtTo(e.target.value)} data-testid="input-filter-updated-at-to" className="flex-1" />
                </div>
              </div>
            )}
            </div>
          )}
        </CardContent>
      </Card>

      {searchResults && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Search Results</CardTitle>
                  <CardDescription>
                    Found {searchResults.total} work order{searchResults.total !== 1 ? "s" : ""} across {searchResults.projectsSearched} project{searchResults.projectsSearched !== 1 ? "s" : ""}
                  </CardDescription>
                </div>
                {searchResults.results.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    <ColumnSelector
                      allColumns={columns}
                      visibleColumns={visibleColumns}
                      onChange={setVisibleColumns}
                      disabled={columnPrefsLoading}
                      orderedColumns={orderedColumns}
                    />
                    <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export-csv">
                      <FileText className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToExcel} data-testid="button-export-excel">
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToPDF} data-testid="button-export-pdf">
                      <FileDown className="h-4 w-4 mr-2" />
                      PDF
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {searchResults.results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Search className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No work orders found matching your criteria</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {orderedColumns.filter(col => col.key !== "actions").map(col => renderHeaderCell(col.key))}
                        {isColumnVisible("actions") && <TableHead>Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAndSortedResults.map((result, index) => (
                        <TableRow key={`${result.projectId}-${result.workOrder.id}-${index}`} data-testid={`row-result-${index}`}>
                          {orderedColumns.filter(col => col.key !== "actions").map(col => renderDataCell(col.key, result))}
                          {isColumnVisible("actions") && (
                            <TableCell>
                              <Link 
                                href={`/projects/${result.projectId}/work-orders?edit=${result.workOrder.id}&from=search`}
                                onClick={() => {
                                  const searchState = {
                                    searchQuery,
                                    selectedProject,
                                    selectedStatus,
                                    selectedServiceType,
                                    isSearchActive,
                                  };
                                  sessionStorage.setItem('searchReportsState', JSON.stringify(searchState));
                                }}
                              >
                                <Button variant="ghost" size="sm" data-testid={`button-view-${index}`}>
                                  View
                                </Button>
                              </Link>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!isSearchActive && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Use the filters above to search for work orders</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
