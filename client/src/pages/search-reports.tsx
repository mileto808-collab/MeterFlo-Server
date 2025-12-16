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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
  const [filterScheduledDate, setFilterScheduledDate] = useState("");
  const [filterAssignedTo, setFilterAssignedTo] = useState("all");
  const [filterAssignedGroup, setFilterAssignedGroup] = useState("all");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");
  const [filterUpdatedBy, setFilterUpdatedBy] = useState("all");
  const [filterCompletedAt, setFilterCompletedAt] = useState("");
  const [filterTroubleCode, setFilterTroubleCode] = useState("all");
  const [filterNotes, setFilterNotes] = useState("");
  const [filterCreatedAt, setFilterCreatedAt] = useState("");
  const [filterUpdatedAt, setFilterUpdatedAt] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
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

  const { visibleColumns, setVisibleColumns, isColumnVisible, isLoading: columnPrefsLoading } = useColumnPreferences("search_reports", columns);

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
    { key: "dateFrom", label: "Date From" },
    { key: "dateTo", label: "Date To" },
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
        setDateFrom(state.dateFrom || "");
        setDateTo(state.dateTo || "");
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
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
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
    setDateFrom("");
    setDateTo("");
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
    setFilterScheduledDate("");
    setFilterAssignedTo("all");
    setFilterAssignedGroup("all");
    setFilterCreatedBy("all");
    setFilterUpdatedBy("all");
    setFilterCompletedAt("");
    setFilterTroubleCode("all");
    setFilterNotes("");
    setFilterCreatedAt("");
    setFilterUpdatedAt("");
    setIsSearchActive(false);
    setSortColumn(null);
    setSortDirection("asc");
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
    if (filterScheduledDate) {
      results = results.filter(r => {
        const scheduledDate = (r.workOrder as any).scheduledDate;
        if (!scheduledDate) return false;
        return scheduledDate.startsWith(filterScheduledDate);
      });
    }
    if (filterCompletedAt) {
      results = results.filter(r => {
        if (!r.workOrder.completedAt) return false;
        return r.workOrder.completedAt.startsWith(filterCompletedAt);
      });
    }
    if (filterCreatedAt) {
      results = results.filter(r => {
        if (!r.workOrder.createdAt) return false;
        return r.workOrder.createdAt.startsWith(filterCreatedAt);
      });
    }
    if (filterUpdatedAt) {
      results = results.filter(r => {
        if (!r.workOrder.updatedAt) return false;
        return r.workOrder.updatedAt.startsWith(filterUpdatedAt);
      });
    }

    // Apply sorting
    if (sortColumn) {
      results.sort((a, b) => {
        let aVal, bVal;
        if (sortColumn === 'projectName') {
          aVal = a.projectName || '';
          bVal = b.projectName || '';
        } else {
          aVal = (a.workOrder as any)[sortColumn] || '';
          bVal = (b.workOrder as any)[sortColumn] || '';
        }
        const comparison = String(aVal).localeCompare(String(bVal));
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    return results;
  }, [searchResults?.results, sortColumn, sortDirection, filterCustomerWoId, filterCustomerId, filterCustomerName, filterAddress, filterCity, filterState, filterZip, filterPhone, filterEmail, filterRoute, filterZone, filterOldMeterId, filterOldMeterType, filterNewMeterId, filterNewMeterType, filterAssignedTo, filterAssignedGroup, filterCreatedBy, filterUpdatedBy, filterTroubleCode, filterNotes, filterScheduledDate, filterCompletedAt, filterCreatedAt, filterUpdatedAt, users, userGroups]);

  // Calculate active filters
  const activeFiltersArray = [
    selectedProject !== "all",
    selectedStatus !== "all",
    selectedServiceType !== "all",
    dateFrom !== "",
    dateTo !== "",
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
    filterScheduledDate !== "",
    filterAssignedTo !== "all",
    filterAssignedGroup !== "all",
    filterCreatedBy !== "all",
    filterUpdatedBy !== "all",
    filterCompletedAt !== "",
    filterTroubleCode !== "all",
    filterNotes !== "",
    filterCreatedAt !== "",
    filterUpdatedAt !== "",
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
      case "trouble": return r.workOrder.trouble || "";
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

    // Filter columns for export (exclude 'actions' as it's not a data column)
    const exportColumns = columns.filter(col => col.key !== "actions" && visibleColumns.includes(col.key));
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

    // Filter columns for export (exclude 'actions' as it's not a data column)
    const exportColumns = columns.filter(col => col.key !== "actions" && visibleColumns.includes(col.key));
    
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
          .service-water { color: #0066cc; }
          .service-electric { color: #cc9900; }
          .service-gas { color: #cc6600; }
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
              <th>Project</th>
              <th>WO ID</th>
              <th>Customer</th>
              <th>Address</th>
              <th>Service</th>
              <th>Route</th>
              <th>Zone</th>
              <th>Old Meter</th>
              <th>Old Meter Type</th>
              <th>Old Reading</th>
              <th>New Meter</th>
              <th>New Meter Type</th>
              <th>New Reading</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${searchResults.results.map(r => `
              <tr>
                <td>${r.projectName}</td>
                <td>${r.workOrder.customerWoId || "-"}</td>
                <td>${r.workOrder.customerName || "-"}</td>
                <td>${r.workOrder.address || "-"}</td>
                <td class="service-${(r.workOrder.serviceType || "").toLowerCase()}">${r.workOrder.serviceType || "-"}</td>
                <td>${r.workOrder.route || "-"}</td>
                <td>${r.workOrder.zone || "-"}</td>
                <td>${r.workOrder.oldMeterId || "-"}</td>
                <td>${r.workOrder.oldMeterType || "-"}</td>
                <td>${r.workOrder.oldMeterReading ?? "-"}</td>
                <td>${r.workOrder.newMeterId || "-"}</td>
                <td>${r.workOrder.newMeterType || "-"}</td>
                <td>${r.workOrder.newMeterReading ?? "-"}</td>
                <td>${r.workOrder.status.replace("_", " ")}</td>
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
                Clear
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
            {isFilterVisible("dateFrom") && (
              <div className="min-w-[180px]">
                <Label htmlFor="date-from">Created From</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
            )}
            {isFilterVisible("dateTo") && (
              <div className="min-w-[180px]">
                <Label htmlFor="date-to">Created To</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-date-to"
                />
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
              <div className="min-w-[150px]">
                <Label htmlFor="filter-scheduled-date">Scheduled Date</Label>
                <Input id="filter-scheduled-date" type="date" value={filterScheduledDate} onChange={(e) => setFilterScheduledDate(e.target.value)} data-testid="input-filter-scheduled-date" />
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
              <div className="min-w-[150px]">
                <Label htmlFor="filter-completed-at">Completed At</Label>
                <Input id="filter-completed-at" type="date" value={filterCompletedAt} onChange={(e) => setFilterCompletedAt(e.target.value)} data-testid="input-filter-completed-at" />
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
                <ScrollArea className="w-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isColumnVisible("projectName") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('projectName')} data-testid="header-project">
                            Project{getSortIcon('projectName')}
                          </TableHead>
                        )}
                        {isColumnVisible("customerWoId") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('customerWoId')} data-testid="header-wo-id">
                            WO ID{getSortIcon('customerWoId')}
                          </TableHead>
                        )}
                        {isColumnVisible("customerId") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('customerId')} data-testid="header-customer-id">
                            Customer ID{getSortIcon('customerId')}
                          </TableHead>
                        )}
                        {isColumnVisible("customerName") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('customerName')} data-testid="header-customer-name">
                            Customer Name{getSortIcon('customerName')}
                          </TableHead>
                        )}
                        {isColumnVisible("address") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('address')} data-testid="header-address">
                            Address{getSortIcon('address')}
                          </TableHead>
                        )}
                        {isColumnVisible("city") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('city')} data-testid="header-city">
                            City{getSortIcon('city')}
                          </TableHead>
                        )}
                        {isColumnVisible("state") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('state')} data-testid="header-state">
                            State{getSortIcon('state')}
                          </TableHead>
                        )}
                        {isColumnVisible("zip") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('zip')} data-testid="header-zip">
                            ZIP{getSortIcon('zip')}
                          </TableHead>
                        )}
                        {isColumnVisible("phone") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('phone')} data-testid="header-phone">
                            Phone{getSortIcon('phone')}
                          </TableHead>
                        )}
                        {isColumnVisible("email") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('email')} data-testid="header-email">
                            Email{getSortIcon('email')}
                          </TableHead>
                        )}
                        {isColumnVisible("serviceType") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('serviceType')} data-testid="header-service">
                            Service{getSortIcon('serviceType')}
                          </TableHead>
                        )}
                        {isColumnVisible("route") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('route')} data-testid="header-route">
                            Route{getSortIcon('route')}
                          </TableHead>
                        )}
                        {isColumnVisible("zone") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('zone')} data-testid="header-zone">
                            Zone{getSortIcon('zone')}
                          </TableHead>
                        )}
                        {isColumnVisible("oldMeterId") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldMeterId')} data-testid="header-old-meter">
                            Old Meter{getSortIcon('oldMeterId')}
                          </TableHead>
                        )}
                        {isColumnVisible("oldMeterType") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldMeterType')} data-testid="header-old-meter-type">
                            Old Meter Type{getSortIcon('oldMeterType')}
                          </TableHead>
                        )}
                        {isColumnVisible("oldMeterReading") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldMeterReading')} data-testid="header-old-meter-reading">
                            Old Meter Reading{getSortIcon('oldMeterReading')}
                          </TableHead>
                        )}
                        {isColumnVisible("newMeterId") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('newMeterId')} data-testid="header-new-meter-id">
                            New Meter ID{getSortIcon('newMeterId')}
                          </TableHead>
                        )}
                        {isColumnVisible("newMeterReading") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('newMeterReading')} data-testid="header-new-meter-reading">
                            New Meter Reading{getSortIcon('newMeterReading')}
                          </TableHead>
                        )}
                        {isColumnVisible("newMeterType") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('newMeterType')} data-testid="header-new-meter-type">
                            New Meter Type{getSortIcon('newMeterType')}
                          </TableHead>
                        )}
                        {isColumnVisible("oldGps") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldGps')} data-testid="header-old-gps">
                            Old GPS{getSortIcon('oldGps')}
                          </TableHead>
                        )}
                        {isColumnVisible("newGps") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('newGps')} data-testid="header-new-gps">
                            New GPS{getSortIcon('newGps')}
                          </TableHead>
                        )}
                        {isColumnVisible("status") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('status')} data-testid="header-status">
                            Status{getSortIcon('status')}
                          </TableHead>
                        )}
                        {isColumnVisible("scheduledDate") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('scheduledDate')} data-testid="header-scheduled-date">
                            Scheduled Date{getSortIcon('scheduledDate')}
                          </TableHead>
                        )}
                        {isColumnVisible("assignedTo") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('assignedTo')} data-testid="header-assigned-to">
                            Assigned User{getSortIcon('assignedTo')}
                          </TableHead>
                        )}
                        {isColumnVisible("assignedGroup") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('assignedGroup')} data-testid="header-assigned-group">
                            Assigned Group{getSortIcon('assignedGroup')}
                          </TableHead>
                        )}
                        {isColumnVisible("createdBy") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('createdBy')} data-testid="header-created-by">
                            Created By{getSortIcon('createdBy')}
                          </TableHead>
                        )}
                        {isColumnVisible("updatedBy") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('updatedBy')} data-testid="header-updated-by">
                            Updated By{getSortIcon('updatedBy')}
                          </TableHead>
                        )}
                        {isColumnVisible("completedAt") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('completedAt')} data-testid="header-completed-at">
                            Completed At{getSortIcon('completedAt')}
                          </TableHead>
                        )}
                        {isColumnVisible("trouble") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('trouble')} data-testid="header-trouble">
                            Trouble{getSortIcon('trouble')}
                          </TableHead>
                        )}
                        {isColumnVisible("notes") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('notes')} data-testid="header-notes">
                            Notes{getSortIcon('notes')}
                          </TableHead>
                        )}
                        {isColumnVisible("createdAt") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('createdAt')} data-testid="header-created-at">
                            Created At{getSortIcon('createdAt')}
                          </TableHead>
                        )}
                        {isColumnVisible("updatedAt") && (
                          <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('updatedAt')} data-testid="header-updated-at">
                            Updated At{getSortIcon('updatedAt')}
                          </TableHead>
                        )}
                        {isColumnVisible("actions") && <TableHead>Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAndSortedResults.map((result, index) => (
                        <TableRow key={`${result.projectId}-${result.workOrder.id}-${index}`} data-testid={`row-result-${index}`}>
                          {isColumnVisible("projectName") && <TableCell>{result.projectName}</TableCell>}
                          {isColumnVisible("customerWoId") && <TableCell className="font-medium">{result.workOrder.customerWoId || "-"}</TableCell>}
                          {isColumnVisible("customerId") && <TableCell>{result.workOrder.customerId || "-"}</TableCell>}
                          {isColumnVisible("customerName") && <TableCell>{result.workOrder.customerName || "-"}</TableCell>}
                          {isColumnVisible("address") && <TableCell className="max-w-xs truncate">{result.workOrder.address || "-"}</TableCell>}
                          {isColumnVisible("city") && <TableCell>{result.workOrder.city || "-"}</TableCell>}
                          {isColumnVisible("state") && <TableCell>{result.workOrder.state || "-"}</TableCell>}
                          {isColumnVisible("zip") && <TableCell>{result.workOrder.zip || "-"}</TableCell>}
                          {isColumnVisible("phone") && <TableCell>{result.workOrder.phone || "-"}</TableCell>}
                          {isColumnVisible("email") && <TableCell>{result.workOrder.email || "-"}</TableCell>}
                          {isColumnVisible("serviceType") && <TableCell>{getServiceTypeBadge(result.workOrder.serviceType)}</TableCell>}
                          {isColumnVisible("route") && <TableCell>{result.workOrder.route || "-"}</TableCell>}
                          {isColumnVisible("zone") && <TableCell>{result.workOrder.zone || "-"}</TableCell>}
                          {isColumnVisible("oldMeterId") && <TableCell>{result.workOrder.oldMeterId || "-"}</TableCell>}
                          {isColumnVisible("oldMeterType") && <TableCell>{result.workOrder.oldMeterType || "-"}</TableCell>}
                          {isColumnVisible("oldMeterReading") && <TableCell>{result.workOrder.oldMeterReading ?? "-"}</TableCell>}
                          {isColumnVisible("newMeterId") && <TableCell>{result.workOrder.newMeterId || "-"}</TableCell>}
                          {isColumnVisible("newMeterReading") && <TableCell>{result.workOrder.newMeterReading ?? "-"}</TableCell>}
                          {isColumnVisible("newMeterType") && <TableCell>{result.workOrder.newMeterType || "-"}</TableCell>}
                          {isColumnVisible("oldGps") && <TableCell>{result.workOrder.oldGps || "-"}</TableCell>}
                          {isColumnVisible("newGps") && <TableCell>{result.workOrder.newGps || "-"}</TableCell>}
                          {isColumnVisible("status") && <TableCell>{getStatusBadge(result.workOrder.status)}</TableCell>}
                          {isColumnVisible("scheduledDate") && <TableCell>{result.workOrder.scheduledDate ? formatCustom(result.workOrder.scheduledDate, "MMM d, yyyy") : "-"}</TableCell>}
                          {isColumnVisible("assignedTo") && <TableCell>{getAssignedUserName(result.workOrder.assignedUserId) || "-"}</TableCell>}
                          {isColumnVisible("assignedGroup") && <TableCell>{getAssignedGroupName(result.workOrder.assignedGroupId) || "-"}</TableCell>}
                          {isColumnVisible("createdBy") && <TableCell>{result.workOrder.createdBy || "-"}</TableCell>}
                          {isColumnVisible("updatedBy") && <TableCell>{result.workOrder.updatedBy || "-"}</TableCell>}
                          {isColumnVisible("completedAt") && <TableCell>{result.workOrder.completedAt ? formatCustom(result.workOrder.completedAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>}
                          {isColumnVisible("trouble") && <TableCell>{result.workOrder.trouble || "-"}</TableCell>}
                          {isColumnVisible("notes") && <TableCell className="max-w-xs truncate">{result.workOrder.notes || "-"}</TableCell>}
                          {isColumnVisible("createdAt") && <TableCell>{result.workOrder.createdAt ? formatCustom(result.workOrder.createdAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>}
                          {isColumnVisible("updatedAt") && <TableCell>{result.workOrder.updatedAt ? formatCustom(result.workOrder.updatedAt, "MMM d, yyyy h:mm a") : "-"}</TableCell>}
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
                                    dateFrom,
                                    dateTo,
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
                </ScrollArea>
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
