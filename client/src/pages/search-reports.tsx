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
import { Search, Download, FileSpreadsheet, FileText, FileDown, Filter, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Project, ServiceTypeRecord, WorkOrderStatus, MeterType } from "@shared/schema";
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
    assignedTo?: string | null;
    createdBy?: string | null;
    completedAt?: string | null;
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
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProjectState] = useState<string>("all");
  
  const setSelectedProject = (value: string) => {
    setSelectedProjectState(value);
    setSelectedMeterType("all");
  };
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedServiceType, setSelectedServiceType] = useState<string>("all");
  const [selectedMeterType, setSelectedMeterType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [stateRestored, setStateRestored] = useState(false);

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
        setSelectedMeterType(state.selectedMeterType || "all");
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
    if (selectedMeterType !== "all") params.append("oldMeterType", selectedMeterType);
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
    setSelectedMeterType("all");
    setDateFrom("");
    setDateTo("");
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

  const sortedResults = useMemo(() => {
    if (!searchResults?.results) return [];
    let results = [...searchResults.results];
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
  }, [searchResults?.results, sortColumn, sortDirection]);

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

  const exportToCSV = () => {
    if (!searchResults?.results.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const headers = ["Project", "WO ID", "Customer ID", "Customer Name", "Address", "City", "State", "ZIP", "Phone", "Email", "Route", "Zone", "Service Type", "Old Meter Type", "New Meter Type", "Old Meter ID", "Old Meter Reading", "New Meter ID", "New Meter Reading", "Old GPS", "New GPS", "Status", "Assigned To", "Created At", "Completed At", "Notes"];
    const rows = searchResults.results.map(r => [
      r.projectName,
      r.workOrder.customerWoId || "",
      r.workOrder.customerId || "",
      r.workOrder.customerName || "",
      r.workOrder.address || "",
      r.workOrder.city || "",
      r.workOrder.state || "",
      r.workOrder.zip || "",
      r.workOrder.phone || "",
      r.workOrder.email || "",
      r.workOrder.route || "",
      r.workOrder.zone || "",
      r.workOrder.serviceType || "",
      r.workOrder.oldMeterType || "",
      r.workOrder.newMeterType || "",
      r.workOrder.oldMeterId || "",
      r.workOrder.oldMeterReading ?? "",
      r.workOrder.newMeterId || "",
      r.workOrder.newMeterReading ?? "",
      r.workOrder.oldGps || "",
      r.workOrder.newGps || "",
      r.workOrder.status,
      r.workOrder.assignedTo || "",
      r.workOrder.createdAt ? format(new Date(r.workOrder.createdAt), "yyyy-MM-dd HH:mm") : "",
      r.workOrder.completedAt ? format(new Date(r.workOrder.completedAt), "yyyy-MM-dd HH:mm") : "",
      r.workOrder.notes || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `work-orders-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({ title: "CSV exported successfully" });
  };

  const exportToExcel = () => {
    if (!searchResults?.results.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const data = searchResults.results.map(r => ({
      "Project": r.projectName,
      "WO ID": r.workOrder.customerWoId || "",
      "Customer ID": r.workOrder.customerId || "",
      "Customer Name": r.workOrder.customerName || "",
      "Address": r.workOrder.address || "",
      "City": r.workOrder.city || "",
      "State": r.workOrder.state || "",
      "ZIP": r.workOrder.zip || "",
      "Phone": r.workOrder.phone || "",
      "Email": r.workOrder.email || "",
      "Route": r.workOrder.route || "",
      "Zone": r.workOrder.zone || "",
      "Service Type": r.workOrder.serviceType || "",
      "Old Meter Type": r.workOrder.oldMeterType || "",
      "New Meter Type": r.workOrder.newMeterType || "",
      "Old Meter ID": r.workOrder.oldMeterId || "",
      "Old Meter Reading": r.workOrder.oldMeterReading ?? "",
      "New Meter ID": r.workOrder.newMeterId || "",
      "New Meter Reading": r.workOrder.newMeterReading ?? "",
      "Old GPS": r.workOrder.oldGps || "",
      "New GPS": r.workOrder.newGps || "",
      "Status": r.workOrder.status,
      "Assigned To": r.workOrder.assignedTo || "",
      "Created At": r.workOrder.createdAt ? format(new Date(r.workOrder.createdAt), "yyyy-MM-dd HH:mm") : "",
      "Completed At": r.workOrder.completedAt ? format(new Date(r.workOrder.completedAt), "yyyy-MM-dd HH:mm") : "",
      "Notes": r.workOrder.notes || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Orders");
    XLSX.writeFile(workbook, `work-orders-${format(new Date(), "yyyy-MM-dd")}.xlsx`);

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
          <p>Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}</p>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Search Filters
          </CardTitle>
          <CardDescription>
            Filter work orders by project, status, service type, or text search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search-query">Search Text</Label>
              <Input
                id="search-query"
                placeholder="Search in WO ID, name, address, meter ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-query"
              />
            </div>
            <div>
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
            <div>
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
            <div>
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
            <div>
              <Label>Meter Type</Label>
              <Select value={selectedMeterType} onValueChange={setSelectedMeterType}>
                <SelectTrigger data-testid="select-meter-type">
                  <SelectValue placeholder="All Meter Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meter Types</SelectItem>
                  {meterTypes.map((mt) => (
                    <SelectItem key={mt.id} value={mt.productLabel}>{mt.productLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="date-from">Created From</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div>
              <Label htmlFor="date-to">Created To</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleSearch} disabled={searchLoading} data-testid="button-search">
              <Search className="h-4 w-4 mr-2" />
              {searchLoading ? "Searching..." : "Search"}
            </Button>
            <Button variant="outline" onClick={clearFilters} data-testid="button-clear">
              <X className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          </div>
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
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('projectName')} data-testid="header-project">
                          Project{getSortIcon('projectName')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('customerWoId')} data-testid="header-wo-id">
                          WO ID{getSortIcon('customerWoId')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('address')} data-testid="header-address">
                          Address{getSortIcon('address')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('serviceType')} data-testid="header-service">
                          Service{getSortIcon('serviceType')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('route')} data-testid="header-route">
                          Route{getSortIcon('route')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('zone')} data-testid="header-zone">
                          Zone{getSortIcon('zone')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldMeterId')} data-testid="header-old-meter">
                          Old Meter{getSortIcon('oldMeterId')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('oldMeterType')} data-testid="header-old-meter-type">
                          Old Meter Type{getSortIcon('oldMeterType')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('newMeterType')} data-testid="header-new-meter-type">
                          New Meter Type{getSortIcon('newMeterType')}
                        </TableHead>
                        <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort('status')} data-testid="header-status">
                          Status{getSortIcon('status')}
                        </TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedResults.map((result, index) => (
                        <TableRow key={`${result.projectId}-${result.workOrder.id}-${index}`} data-testid={`row-result-${index}`}>
                          <TableCell>{result.projectName}</TableCell>
                          <TableCell className="font-medium">{result.workOrder.customerWoId || "-"}</TableCell>
                          <TableCell className="max-w-xs truncate">{result.workOrder.address || "-"}</TableCell>
                          <TableCell>{getServiceTypeBadge(result.workOrder.serviceType)}</TableCell>
                          <TableCell>{result.workOrder.route || "-"}</TableCell>
                          <TableCell>{result.workOrder.zone || "-"}</TableCell>
                          <TableCell>{result.workOrder.oldMeterId || "-"}</TableCell>
                          <TableCell>{result.workOrder.oldMeterType || "-"}</TableCell>
                          <TableCell>{result.workOrder.newMeterType || "-"}</TableCell>
                          <TableCell>{getStatusBadge(result.workOrder.status)}</TableCell>
                          <TableCell>
                            <Link 
                              href={`/projects/${result.projectId}/work-orders?edit=${result.workOrder.id}&from=search`}
                              onClick={() => {
                                // Store search state in sessionStorage before navigating
                                const searchState = {
                                  searchQuery,
                                  selectedProject,
                                  selectedStatus,
                                  selectedServiceType,
                                  selectedMeterType,
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
