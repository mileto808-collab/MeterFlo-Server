import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FileUp, CheckCircle, AlertCircle, ShieldAlert, Upload, FileSpreadsheet, FileJson, Info, Clock, Play, Trash2, Edit, Plus, Calendar, FolderSync, Settings, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Project, FileImportConfig } from "@shared/schema";
import { Link } from "wouter";
import { useTimezone } from "@/hooks/use-timezone";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";

type ParsedWorkOrder = {
  customerWoId: string;
  customerId: string;
  customerName: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  route?: string;
  zone?: string;
  serviceType: string;
  oldSystemId?: string;
  oldSystemReading?: number;
  oldGps?: string;
  oldSystemType?: string;
  newSystemType?: string;
  status?: string;
  scheduledAt?: string;
  scheduledBy?: string;
  trouble?: string;
  notes?: string;
  assignedUserId?: string;
  assignedGroupId?: string;
  createdBy?: string;
  completedBy?: string;
  completedAt?: string;
};

type ColumnMapping = {
  customerWoId: string;
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  route: string;
  zone: string;
  serviceType: string;
  oldSystemId: string;
  oldSystemReading: string;
  oldGps: string;
  oldSystemType: string;
  newSystemType: string;
  status: string;
  scheduledAt: string;
  scheduledBy: string;
  trouble: string;
  notes: string;
  assignedUserId: string;
  assignedGroupId: string;
  createdBy: string;
  completedBy: string;
  completedAt: string;
};

const defaultColumnMapping: ColumnMapping = {
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
  oldSystemReading: "",
  oldGps: "",
  oldSystemType: "",
  newSystemType: "",
  status: "",
  scheduledAt: "",
  scheduledBy: "",
  trouble: "",
  notes: "",
  assignedUserId: "",
  assignedGroupId: "",
  createdBy: "",
  completedBy: "",
  completedAt: "",
};

const parseIntOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = parseInt(trimmed, 10);
  return isNaN(parsed) ? undefined : parsed;
};

export default function ProjectImport() {
  const { formatDateTime } = useTimezone();
  const [, params] = useRoute("/projects/:projectId/import");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [jsonInput, setJsonInput] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [accessDeniedForProject, setAccessDeniedForProject] = useState<number | null>(null);
  const accessDenied = accessDeniedForProject === projectId;
  const [activeTab, setActiveTab] = useState("file");
  
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [rawData, setRawData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(defaultColumnMapping);
  const [previewData, setPreviewData] = useState<ParsedWorkOrder[]>([]);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Scheduled import dialog state
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FileImportConfig | null>(null);
  const [deleteConfigId, setDeleteConfigId] = useState<number | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    name: "",
    delimiter: ",",
    hasHeader: true,
    scheduleFrequency: "daily",
    customCronExpression: "",
    isEnabled: true,
    columnMapping: { ...defaultColumnMapping } as Record<string, string>,
    processedFilePattern: "",
  });

  const { data: project, isLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: fileImportConfigs = [], refetch: refetchConfigs } = useQuery<FileImportConfig[]>({
    queryKey: [`/api/projects/${projectId}/file-import-configs`],
    enabled: !!projectId && !accessDenied,
  });

  useEffect(() => {
    if (projectError) {
      const errorMsg = (projectError as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
      }
    }
  }, [projectError]);

  const importMutation = useMutation({
    mutationFn: async ({ workOrders, fileName: importFileName, importSource }: { workOrders: any[]; fileName?: string; importSource?: string }) => {
      if (accessDenied) throw new Error("403: Access denied");
      const response = await apiRequest("POST", `/api/projects/${projectId}/import`, { 
        workOrders, 
        fileName: importFileName,
        importSource 
      });
      return response.json();
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      if (data.imported > 0) {
        toast({ title: `Imported ${data.imported} work orders` });
      }
      resetFileState();
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
      } else {
        toast({ title: "Import failed", description: errorMsg, variant: "destructive" });
      }
    },
  });

  const createConfigMutation = useMutation({
    mutationFn: async (data: typeof scheduleForm) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/file-import-configs`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule created successfully" });
      refetchConfigs();
      setScheduleDialogOpen(false);
      resetScheduleForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create schedule", description: error?.message, variant: "destructive" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof scheduleForm }) => {
      const response = await apiRequest("PATCH", `/api/file-import-configs/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule updated successfully" });
      refetchConfigs();
      setScheduleDialogOpen(false);
      resetScheduleForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update schedule", description: error?.message, variant: "destructive" });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/file-import-configs/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Schedule deleted successfully" });
      refetchConfigs();
      setDeleteConfigId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete schedule", description: error?.message, variant: "destructive" });
    },
  });

  const toggleConfigMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: number; isEnabled: boolean }) => {
      const response = await apiRequest("PATCH", `/api/file-import-configs/${id}`, { isEnabled });
      return response.json();
    },
    onSuccess: () => {
      refetchConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update schedule", description: error?.message, variant: "destructive" });
    },
  });

  const resetScheduleForm = () => {
    setEditingConfig(null);
    setScheduleForm({
      name: "",
      delimiter: ",",
      hasHeader: true,
      scheduleFrequency: "daily",
      customCronExpression: "",
      isEnabled: true,
      columnMapping: { ...defaultColumnMapping } as Record<string, string>,
      processedFilePattern: "",
    });
  };

  const openEditConfig = (config: FileImportConfig) => {
    setEditingConfig(config);
    setScheduleForm({
      name: config.name,
      delimiter: config.delimiter || ",",
      hasHeader: config.hasHeader !== false,
      scheduleFrequency: config.scheduleFrequency || "daily",
      customCronExpression: config.customCronExpression || "",
      isEnabled: config.isEnabled !== false,
      columnMapping: { ...defaultColumnMapping, ...(config.columnMapping as Record<string, string>) },
      processedFilePattern: config.processedFilePattern || "",
    });
    setScheduleDialogOpen(true);
  };

  const handleScheduleSubmit = () => {
    if (!scheduleForm.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (editingConfig) {
      updateConfigMutation.mutate({ id: editingConfig.id, data: scheduleForm });
    } else {
      createConfigMutation.mutate(scheduleForm);
    }
  };

  const resetFileState = () => {
    setRawData([]);
    setHeaders([]);
    setPreviewData([]);
    setFileName("");
    setColumnMapping(defaultColumnMapping);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const parseCSV = (text: string, delim: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentCell += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === delim) {
          currentRow.push(currentCell.trim());
          currentCell = "";
        } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell !== "")) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = "";
          if (char === "\r") i++;
        } else if (char === "\r") {
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell !== "")) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = "";
        } else {
          currentCell += char;
        }
      }
    }

    if (currentCell || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell !== "")) {
        rows.push(currentRow);
      }
    }

    return rows;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const extension = file.name.split(".").pop()?.toLowerCase();

    try {
      if (extension === "xlsx" || extension === "xls") {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 });
        processData(data as string[][]);
      } else if (extension === "csv" || extension === "txt") {
        const text = await file.text();
        const data = parseCSV(text, delimiter);
        processData(data);
      } else {
        toast({ title: "Unsupported file format", description: "Please upload CSV, TXT, XLS, or XLSX files", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error reading file", variant: "destructive" });
    }
  };

  const processData = (data: string[][], useHeader: boolean = hasHeader) => {
    if (data.length === 0) {
      toast({ title: "File is empty", variant: "destructive" });
      return;
    }

    setRawData(data);
    
    if (useHeader && data.length > 0) {
      const headerRow = data[0].map(h => String(h || "").trim());
      setHeaders(headerRow);
      autoMapColumns(headerRow);
    } else {
      const columnCount = Math.max(...data.map(row => row.length));
      const generatedHeaders = Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
      setHeaders(generatedHeaders);
      setColumnMapping(defaultColumnMapping);
    }
  };

  const autoMapColumns = (headerRow: string[]) => {
    const newMapping: ColumnMapping = { ...defaultColumnMapping };

    const mappings: { field: keyof ColumnMapping; variants: string[] }[] = [
      { field: "customerWoId", variants: ["wo id", "work order id", "workorderid", "customer_wo_id", "customerWoId", "wo_id", "woid"] },
      { field: "customerId", variants: ["customer id", "customerid", "customer_id", "cust id", "custid", "cust_id", "account"] },
      { field: "customerName", variants: ["customer name", "customername", "customer_name", "name", "cust name", "custname", "account name"] },
      { field: "address", variants: ["address", "street", "street address", "location", "service address"] },
      { field: "city", variants: ["city", "town"] },
      { field: "state", variants: ["state", "province", "st"] },
      { field: "zip", variants: ["zip", "zipcode", "zip code", "postal", "postal code"] },
      { field: "phone", variants: ["phone", "telephone", "tel", "contact phone", "phone number"] },
      { field: "email", variants: ["email", "e-mail", "mail", "contact email"] },
      { field: "route", variants: ["route", "route id", "route_id", "routeid"] },
      { field: "zone", variants: ["zone", "zone id", "zone_id", "zoneid", "area", "district"] },
      { field: "serviceType", variants: ["service type", "servicetype", "service_type", "type", "utility", "utility type", "meter type"] },
      { field: "oldSystemId", variants: ["old system", "old system id", "oldmeterid", "old_meter_id", "current system", "existing system", "old_meter"] },
      { field: "oldSystemReading", variants: ["old system reading", "old reading", "oldmeterreading", "old_meter_reading", "current reading", "existing reading"] },
      { field: "oldGps", variants: ["old gps", "old_gps", "oldgps", "current gps", "existing gps", "old coordinates"] },
      { field: "oldSystemType", variants: ["old system type", "old_meter_type", "oldmetertype", "current system type", "existing system type"] },
      { field: "newSystemType", variants: ["new meter type", "new_meter_type", "newmetertype", "replacement system type"] },
      { field: "status", variants: ["status", "state", "condition", "wo status"] },
      { field: "scheduledAt", variants: ["scheduled date", "scheduled_date", "scheduleddate", "schedule date", "schedule", "due date", "due_date", "scheduled datetime", "scheduled_datetime", "scheduled at", "scheduled_at", "scheduledat"] },
      { field: "scheduledBy", variants: ["scheduled by", "scheduled_by", "scheduledby", "scheduler"] },
      { field: "trouble", variants: ["trouble", "issue", "problem", "trouble code", "trouble_code"] },
      { field: "notes", variants: ["notes", "comments", "remarks", "description"] },
      { field: "assignedUserId", variants: ["assigned_user_id", "assigned user", "assigneduserid", "technician", "worker", "assignee", "tech"] },
      { field: "assignedGroupId", variants: ["assigned_group_id", "assigned group", "assignedgroupid", "team", "group", "crew"] },
      { field: "createdBy", variants: ["created by", "created_by", "createdby", "creator", "created by user"] },
      { field: "completedBy", variants: ["completed by", "completed_by", "completedby", "completer", "finished by"] },
      { field: "completedAt", variants: ["completed at", "completed_at", "completedat", "completion date", "completion_date", "completed date", "completed_date"] },
    ];

    headerRow.forEach((header) => {
      const lower = header.toLowerCase().trim();
      for (const mapping of mappings) {
        if (mapping.variants.some(v => lower === v || lower.includes(v)) && !newMapping[mapping.field]) {
          newMapping[mapping.field] = header;
          break;
        }
      }
    });

    setColumnMapping(newMapping);
  };

  useEffect(() => {
    if (rawData.length === 0 || headers.length === 0) {
      setPreviewData([]);
      return;
    }

    const dataRows = hasHeader ? rawData.slice(1) : rawData;
    const mapped = dataRows.slice(0, 10).map((row) => {
      const getValueByHeader = (headerName: string): string => {
        if (!headerName) return "";
        const index = headers.indexOf(headerName);
        return index >= 0 ? String(row[index] || "") : "";
      };

      const workOrder: ParsedWorkOrder = {
        customerWoId: getValueByHeader(columnMapping.customerWoId) || "",
        customerId: getValueByHeader(columnMapping.customerId) || "",
        customerName: getValueByHeader(columnMapping.customerName) || "",
        address: getValueByHeader(columnMapping.address) || "",
        city: getValueByHeader(columnMapping.city) || undefined,
        state: getValueByHeader(columnMapping.state) || undefined,
        zip: getValueByHeader(columnMapping.zip) || undefined,
        phone: getValueByHeader(columnMapping.phone) || undefined,
        email: getValueByHeader(columnMapping.email) || undefined,
        route: getValueByHeader(columnMapping.route) || undefined,
        zone: getValueByHeader(columnMapping.zone) || undefined,
        serviceType: getValueByHeader(columnMapping.serviceType) || "Water",
        oldSystemId: getValueByHeader(columnMapping.oldSystemId) || undefined,
        oldSystemReading: columnMapping.oldSystemReading ? parseIntOrUndefined(getValueByHeader(columnMapping.oldSystemReading)) : undefined,
        oldGps: getValueByHeader(columnMapping.oldGps) || undefined,
        oldSystemType: getValueByHeader(columnMapping.oldSystemType) || undefined,
        newSystemType: getValueByHeader(columnMapping.newSystemType) || undefined,
        status: getValueByHeader(columnMapping.status) || undefined,
        scheduledAt: getValueByHeader(columnMapping.scheduledAt) || undefined,
        scheduledBy: getValueByHeader(columnMapping.scheduledBy) || undefined,
        trouble: getValueByHeader(columnMapping.trouble) || undefined,
        notes: getValueByHeader(columnMapping.notes) || undefined,
        assignedUserId: getValueByHeader(columnMapping.assignedUserId) || undefined,
        assignedGroupId: getValueByHeader(columnMapping.assignedGroupId) || undefined,
        createdBy: getValueByHeader(columnMapping.createdBy) || undefined,
        completedBy: getValueByHeader(columnMapping.completedBy) || undefined,
        completedAt: getValueByHeader(columnMapping.completedAt) || undefined,
      };

      return workOrder;
    });

    setPreviewData(mapped);
  }, [rawData, headers, columnMapping, hasHeader]);

  const handleJsonImport = () => {
    try {
      const workOrders = JSON.parse(jsonInput);
      if (!Array.isArray(workOrders)) {
        toast({ title: "Invalid format: expected an array of work orders", variant: "destructive" });
        return;
      }
      importMutation.mutate({ workOrders, fileName: "json_text_input", importSource: "json_text" });
    } catch (error) {
      toast({ title: "Invalid JSON format", variant: "destructive" });
    }
  };

  const handleFileImport = () => {
    if (!columnMapping.customerWoId || !columnMapping.customerId || !columnMapping.customerName || !columnMapping.address || !columnMapping.serviceType) {
      toast({ title: "Please map required columns: Work Order ID, Customer ID, Customer Name, Address, and Service Type", variant: "destructive" });
      return;
    }

    const dataRows = hasHeader ? rawData.slice(1) : rawData;
    const workOrders = dataRows.map((row) => {
      const getValueByHeader = (headerName: string): string => {
        if (!headerName) return "";
        const index = headers.indexOf(headerName);
        return index >= 0 ? String(row[index] || "") : "";
      };

      const status = getValueByHeader(columnMapping.status);
      const serviceTypeRaw = getValueByHeader(columnMapping.serviceType);
      const serviceType = ["Water", "Electric", "Gas"].find(
        t => t.toLowerCase() === serviceTypeRaw.toLowerCase()
      ) || "Water";

      const workOrder: ParsedWorkOrder = {
        customerWoId: getValueByHeader(columnMapping.customerWoId),
        customerId: getValueByHeader(columnMapping.customerId),
        customerName: getValueByHeader(columnMapping.customerName),
        address: getValueByHeader(columnMapping.address),
        city: getValueByHeader(columnMapping.city) || undefined,
        state: getValueByHeader(columnMapping.state) || undefined,
        zip: getValueByHeader(columnMapping.zip) || undefined,
        phone: getValueByHeader(columnMapping.phone) || undefined,
        email: getValueByHeader(columnMapping.email) || undefined,
        route: getValueByHeader(columnMapping.route) || undefined,
        zone: getValueByHeader(columnMapping.zone) || undefined,
        serviceType,
        oldSystemId: getValueByHeader(columnMapping.oldSystemId) || undefined,
        oldSystemReading: columnMapping.oldSystemReading ? parseIntOrUndefined(getValueByHeader(columnMapping.oldSystemReading)) : undefined,
        oldGps: getValueByHeader(columnMapping.oldGps) || undefined,
        oldSystemType: getValueByHeader(columnMapping.oldSystemType) || undefined,
        newSystemType: getValueByHeader(columnMapping.newSystemType) || undefined,
        status: status || undefined,
        scheduledAt: getValueByHeader(columnMapping.scheduledAt) || undefined,
        scheduledBy: getValueByHeader(columnMapping.scheduledBy) || undefined,
        trouble: getValueByHeader(columnMapping.trouble) || undefined,
        notes: getValueByHeader(columnMapping.notes) || undefined,
        assignedUserId: getValueByHeader(columnMapping.assignedUserId) || undefined,
        assignedGroupId: getValueByHeader(columnMapping.assignedGroupId) || undefined,
        createdBy: getValueByHeader(columnMapping.createdBy) || undefined,
        completedBy: getValueByHeader(columnMapping.completedBy) || undefined,
        completedAt: getValueByHeader(columnMapping.completedAt) || undefined,
      };

      return workOrder;
    }).filter(wo => wo.customerWoId && wo.customerId && wo.customerName && wo.address);

    if (workOrders.length === 0) {
      toast({ title: "No valid work orders to import. Ensure required fields are mapped.", variant: "destructive" });
      return;
    }

    importMutation.mutate({ workOrders, fileName: fileName || "file_import", importSource: "manual_file" });
  };

  const reprocessWithDelimiter = (newDelimiter: string) => {
    setDelimiter(newDelimiter);
    if (fileInputRef.current?.files?.[0]) {
      const file = fileInputRef.current.files[0];
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "csv" || extension === "txt") {
        file.text().then(text => {
          const data = parseCSV(text, newDelimiter);
          processData(data);
        });
      }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (user?.role === "customer") {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">You do not have permission to import data</p>
      </div>
    );
  }

  const MappingSelect = ({ field, label, required = false }: { field: keyof ColumnMapping; label: string; required?: boolean }) => (
    <div>
      <Label>{label} {required && <span className="text-destructive">*</span>}</Label>
      <Select
        value={columnMapping[field] || ""}
        onValueChange={(v) => setColumnMapping(prev => ({ ...prev, [field]: v === "none" ? "" : v }))}
      >
        <SelectTrigger data-testid={`select-map-${field}`}>
          <SelectValue placeholder="Select column" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">-- Not Mapped --</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-project-title">{project?.name}</h1>
        <p className="text-muted-foreground">Import Work Orders</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="file" data-testid="tab-file">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            CSV / Excel
          </TabsTrigger>
          <TabsTrigger value="json" data-testid="tab-json">
            <FileJson className="h-4 w-4 mr-2" />
            JSON
          </TabsTrigger>
          <TabsTrigger value="scheduled" data-testid="tab-scheduled">
            <Clock className="h-4 w-4 mr-2" />
            Scheduled
          </TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload File
              </CardTitle>
              <CardDescription>
                Upload a CSV or Excel file containing utility system work orders
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Delimiter (for CSV files)</Label>
                  <Select value={delimiter} onValueChange={reprocessWithDelimiter}>
                    <SelectTrigger data-testid="select-delimiter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=",">Comma (,)</SelectItem>
                      <SelectItem value=";">Semicolon (;)</SelectItem>
                      <SelectItem value="\t">Tab</SelectItem>
                      <SelectItem value="|">Pipe (|)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label>First Row Contains Headers</Label>
                    <Select 
                      value={hasHeader ? "yes" : "no"} 
                      onValueChange={(v) => {
                        const newHasHeader = v === "yes";
                        setHasHeader(newHasHeader);
                        if (rawData.length > 0) {
                          processData(rawData, newHasHeader);
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-has-header">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div>
                <Label>Select File</Label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt"
                  onChange={handleFileUpload}
                  data-testid="input-file-upload"
                />
                {fileName && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Selected: {fileName}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Expected Data Format
              </CardTitle>
              <CardDescription>
                Prepare your file with utility system work order data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Required Columns</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">customer_wo_id</span> - Unique Work Order ID</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">customer_id</span> - Customer Account ID</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">customer_name</span> - Customer Name</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">address</span> - Service Address</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">service_type</span> - Water, Electric, or Gas</div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Optional Columns</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">city, state, zip</span> - Location details</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">phone, email</span> - Contact information</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">route, zone</span> - Service routing</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">old_system_id, old_system_reading</span> - Old system info</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">old_gps</span> - GPS coordinates</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">old_system_type, new_system_type</span> - System types</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">status, scheduled_at, scheduled_by, trouble, notes</span> - Work order details</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">assigned_user_id, assigned_group_id, created_by, completed_at</span> - Assignment and tracking</div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Example CSV</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`customer_wo_id,customer_id,customer_name,address,city,state,zip,service_type,route,zone,old_system_id
WO-001,CUST-123,John Smith,123 Main St,Springfield,IL,62701,Water,Route A,Zone 1,SYS-OLD-001
WO-002,CUST-456,Jane Doe,456 Oak Ave,Springfield,IL,62702,Electric,Route B,Zone 2,SYS-OLD-002
WO-003,CUST-789,Bob Wilson,789 Pine Rd,Springfield,IL,62703,Gas,Route A,Zone 1,SYS-OLD-003`}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {headers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Column Mapping</CardTitle>
                <CardDescription>
                  Map your file columns to work order fields. Fields marked with * are required.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <MappingSelect field="customerWoId" label="Work Order ID" required />
                  <MappingSelect field="customerId" label="Customer ID" required />
                  <MappingSelect field="customerName" label="Customer Name" required />
                  <MappingSelect field="address" label="Address" required />
                  <MappingSelect field="serviceType" label="Service Type" required />
                  <MappingSelect field="city" label="City" />
                  <MappingSelect field="state" label="State" />
                  <MappingSelect field="zip" label="ZIP Code" />
                  <MappingSelect field="phone" label="Phone" />
                  <MappingSelect field="email" label="Email" />
                  <MappingSelect field="route" label="Route" />
                  <MappingSelect field="zone" label="Zone" />
                  <MappingSelect field="oldSystemId" label="Old System ID" />
                  <MappingSelect field="oldSystemReading" label="Old System Reading" />
                  <MappingSelect field="oldGps" label="Old GPS" />
                  <MappingSelect field="oldSystemType" label="Old System Type" />
                  <MappingSelect field="newSystemType" label="New System Type" />
                  <MappingSelect field="status" label="Status" />
                  <MappingSelect field="scheduledAt" label="Scheduled At" />
                  <MappingSelect field="scheduledBy" label="Scheduled By" />
                  <MappingSelect field="trouble" label="Trouble" />
                  <MappingSelect field="notes" label="Notes" />
                  <MappingSelect field="assignedUserId" label="Assigned User" />
                  <MappingSelect field="assignedGroupId" label="Assigned Group" />
                  <MappingSelect field="createdBy" label="Created By" />
                  <MappingSelect field="completedBy" label="Completed By" />
                  <MappingSelect field="completedAt" label="Completed At" />
                </div>
              </CardContent>
            </Card>
          )}

          {previewData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Preview (First 10 rows)</CardTitle>
                <CardDescription>
                  Review mapped data before importing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="w-full">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>WO ID</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Old System</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.map((wo, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{wo.customerWoId || "-"}</TableCell>
                          <TableCell>{wo.customerName || "-"}</TableCell>
                          <TableCell>{wo.address || "-"}</TableCell>
                          <TableCell>{wo.serviceType || "-"}</TableCell>
                          <TableCell>{wo.route || "-"}</TableCell>
                          <TableCell>{wo.zone || "-"}</TableCell>
                          <TableCell>{wo.oldSystemId || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <div className="mt-4">
                  <Button
                    onClick={handleFileImport}
                    disabled={importMutation.isPending}
                    data-testid="button-import-file"
                  >
                    <FileUp className="h-4 w-4 mr-2" />
                    {importMutation.isPending ? "Importing..." : `Import ${hasHeader ? rawData.length - 1 : rawData.length} Work Orders`}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="json" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileJson className="h-5 w-5" />
                JSON Import
              </CardTitle>
              <CardDescription>
                Paste JSON array of work orders
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>JSON Data</Label>
                <Textarea
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder={`[
  {
    "customerWoId": "WO-001",
    "customerId": "CUST-123",
    "customerName": "John Smith",
    "address": "123 Main St",
    "serviceType": "Water",
    "route": "Route A",
    "zone": "Zone 1"
  }
]`}
                  className="min-h-[200px] font-mono text-sm"
                  data-testid="textarea-json"
                />
              </div>
              <Button
                onClick={handleJsonImport}
                disabled={importMutation.isPending || !jsonInput.trim()}
                data-testid="button-import-json"
              >
                <FileUp className="h-4 w-4 mr-2" />
                {importMutation.isPending ? "Importing..." : "Import JSON"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduled" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Scheduled File Imports
                  </CardTitle>
                  <CardDescription>
                    Configure automatic imports from the Project FTP Files directory
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/projects/${projectId}/ftp-files`}>
                    <Button variant="outline" size="sm">
                      <FolderSync className="h-4 w-4 mr-2" />
                      View FTP Files
                    </Button>
                  </Link>
                  <Button 
                    size="sm" 
                    onClick={() => {
                      resetScheduleForm();
                      setScheduleDialogOpen(true);
                    }}
                    data-testid="button-new-schedule"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New Schedule
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {fileImportConfigs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No scheduled imports configured</p>
                  <p className="text-sm mb-4">Upload files to the FTP directory and configure a schedule to automate imports.</p>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      resetScheduleForm();
                      setScheduleDialogOpen(true);
                    }}
                    data-testid="button-create-first-schedule"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Schedule
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>File Pattern</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Last Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fileImportConfigs.map((config) => (
                      <TableRow key={config.id} data-testid={`row-config-${config.id}`}>
                        <TableCell className="font-medium">{config.name}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {config.processedFilePattern || "*"}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {config.scheduleFrequency === "manual" ? "Manual" : config.scheduleFrequency?.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {config.lastRunAt ? formatDateTime(config.lastRunAt) : "Never"}
                        </TableCell>
                        <TableCell>
                          {config.lastRunStatus && (
                            <Badge 
                              variant={
                                config.lastRunStatus === "success" ? "default" :
                                config.lastRunStatus === "partial" ? "secondary" :
                                config.lastRunStatus === "failed" ? "destructive" : "outline"
                              }
                            >
                              {config.lastRunStatus}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={config.isEnabled === true}
                            onCheckedChange={(checked) => toggleConfigMutation.mutate({ id: config.id, isEnabled: checked })}
                            disabled={toggleConfigMutation.isPending}
                            data-testid={`switch-enabled-${config.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                try {
                                  const response = await apiRequest("POST", `/api/file-import-configs/${config.id}/run`);
                                  const result = await response.json();
                                  if (result.success) {
                                    toast({ title: `Import completed: ${result.imported} imported, ${result.failed} failed` });
                                  } else {
                                    toast({ title: "Import failed", description: result.error, variant: "destructive" });
                                  }
                                  refetchConfigs();
                                } catch (error: any) {
                                  toast({ title: "Failed to run import", variant: "destructive" });
                                }
                              }}
                              title="Run import now"
                              data-testid={`button-run-${config.id}`}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            {config.lastProcessedFile && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={async () => {
                                  try {
                                    const response = await apiRequest("POST", `/api/file-import-configs/${config.id}/reset`);
                                    const result = await response.json();
                                    if (result.success) {
                                      toast({ title: "Schedule reset", description: "The file can now be reprocessed." });
                                    } else {
                                      toast({ title: "Reset failed", description: result.message, variant: "destructive" });
                                    }
                                    refetchConfigs();
                                  } catch (error: any) {
                                    toast({ title: "Failed to reset schedule", variant: "destructive" });
                                  }
                                }}
                                title="Reset to allow reprocessing"
                                data-testid={`button-reset-${config.id}`}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditConfig(config)}
                              title="Edit schedule"
                              data-testid={`button-edit-${config.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteConfigId(config.id)}
                              title="Delete schedule"
                              data-testid={`button-delete-${config.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How Scheduled Imports Work</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="space-y-2">
                <p><strong className="text-foreground">1. Upload Files</strong> - Upload CSV, Excel, or JSON files to the Project FTP Files directory.</p>
                <p><strong className="text-foreground">2. File Matching</strong> - Each schedule can have its own file pattern to filter which files it processes.</p>
                <p><strong className="text-foreground">3. Automatic Processing</strong> - When the scheduled time arrives, the system finds the newest file matching the pattern and imports it.</p>
                <p><strong className="text-foreground">4. Skip Duplicates</strong> - Files that have already been processed by a schedule are skipped on subsequent runs.</p>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-foreground mb-2">File Pattern Matching</h4>
                <p className="mb-2">Use file patterns to have multiple schedules for different file types:</p>
                <div className="bg-muted rounded-md p-3 space-y-2">
                  <div className="flex gap-2 items-start">
                    <code className="bg-background px-1.5 py-0.5 rounded text-xs whitespace-nowrap">*</code>
                    <span>(default) Matches all files</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <code className="bg-background px-1.5 py-0.5 rounded text-xs whitespace-nowrap">meter_*.csv</code>
                    <span>Matches meter_jan.csv, meter_2024.csv, etc.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <code className="bg-background px-1.5 py-0.5 rounded text-xs whitespace-nowrap">install_*.xlsx</code>
                    <span>Matches install_batch1.xlsx, install_q1.xlsx, etc.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <code className="bg-background px-1.5 py-0.5 rounded text-xs whitespace-nowrap">WO_202?_*.csv</code>
                    <span>Matches WO_2024_jan.csv, WO_2025_feb.csv (? matches one character)</span>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-foreground mb-2">Multiple Schedules Example</h4>
                <p className="mb-2">If your customers upload different file formats for different work types:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Schedule A:</strong> Pattern <code className="bg-muted px-1 rounded">replacement_*.csv</code> with column mapping for meter replacements</li>
                  <li><strong>Schedule B:</strong> Pattern <code className="bg-muted px-1 rounded">newinstall_*.csv</code> with column mapping for new installations</li>
                  <li><strong>Schedule C:</strong> Pattern <code className="bg-muted px-1 rounded">disconnect_*.xlsx</code> with column mapping for disconnections</li>
                </ul>
                <p className="mt-2">Each schedule will only process files matching its pattern, allowing different column mappings for each file type.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Expected Data Format
              </CardTitle>
              <CardDescription>
                Prepare your files with the correct column structure
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">CSV Files</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Set the appropriate delimiter in your schedule configuration (comma, semicolon, tab, or pipe).</p>
                  <p>Enable "Has Header Row" if your file includes column headers in the first row.</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Excel Files (.xlsx/.xls)</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>The delimiter setting is ignored for Excel files - they are parsed automatically.</p>
                  <p>Enable "Has Header Row" if your file includes column headers in the first row.</p>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">JSON Files (.json)</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>JSON files should contain an array of work order objects. The delimiter and header settings are ignored for JSON files.</p>
                  <p>Example format:</p>
                  <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-x-auto">
{`[
  {
    "customerWoId": "WO-001",
    "customerId": "CUST-123",
    "customerName": "John Smith",
    "address": "123 Main St",
    "serviceType": "Water",
    "city": "Springfield",
    "state": "IL"
  }
]`}
                  </pre>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Required Columns</h4>
                <div className="text-sm">
                  <span className="font-mono bg-muted px-2 py-1 rounded">customer_wo_id</span>,{" "}
                  <span className="font-mono bg-muted px-2 py-1 rounded">customer_id</span>,{" "}
                  <span className="font-mono bg-muted px-2 py-1 rounded">customer_name</span>,{" "}
                  <span className="font-mono bg-muted px-2 py-1 rounded">address</span>,{" "}
                  <span className="font-mono bg-muted px-2 py-1 rounded">service_type</span>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Optional Columns</h4>
                <div className="text-sm text-muted-foreground">
                  city, state, zip, phone, email, route, zone, old_system_id, old_system_reading, old_gps, old_system_type, new_system_type, status, scheduled_at, scheduled_by, trouble, notes, assigned_user_id, assigned_group_id, created_by, completed_by, completed_at
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.errors.length === 0 ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-500" />
              )}
              Import Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2">Successfully imported: {importResult.imported} work orders</p>
            {importResult.errors.length > 0 && (
              <div>
                <p className="text-destructive mb-2">Errors ({importResult.errors.length}):</p>
                <ScrollArea className="h-[200px]">
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {importResult.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={(open) => {
        if (!open) resetScheduleForm();
        setScheduleDialogOpen(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Edit Schedule" : "Create Schedule"}</DialogTitle>
            <DialogDescription>
              Configure an automatic import schedule for files in the FTP directory
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                value={scheduleForm.name}
                onChange={(e) => setScheduleForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Daily Import"
                data-testid="input-schedule-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-delimiter">Delimiter</Label>
                <Select
                  value={scheduleForm.delimiter}
                  onValueChange={(value) => setScheduleForm(prev => ({ ...prev, delimiter: value }))}
                >
                  <SelectTrigger id="schedule-delimiter" data-testid="select-schedule-delimiter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Comma (,)</SelectItem>
                    <SelectItem value=";">Semicolon (;)</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                    <SelectItem value="|">Pipe (|)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule-frequency">Frequency</Label>
                <Select
                  value={scheduleForm.scheduleFrequency}
                  onValueChange={(value) => setScheduleForm(prev => ({ ...prev, scheduleFrequency: value }))}
                >
                  <SelectTrigger id="schedule-frequency" data-testid="select-schedule-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual Only</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="every_6_hours">Every 6 Hours</SelectItem>
                    <SelectItem value="every_12_hours">Every 12 Hours</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="custom">Custom Cron</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {scheduleForm.scheduleFrequency === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="cron-expression">Cron Expression</Label>
                <Input
                  id="cron-expression"
                  value={scheduleForm.customCronExpression}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, customCronExpression: e.target.value }))}
                  placeholder="0 */6 * * *"
                  data-testid="input-cron-expression"
                />
                <p className="text-xs text-muted-foreground">
                  Example: 0 9 * * * (daily at 9am), */30 * * * * (every 30 minutes)
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="file-pattern">File Pattern (Optional)</Label>
              <Input
                id="file-pattern"
                value={scheduleForm.processedFilePattern}
                onChange={(e) => setScheduleForm(prev => ({ ...prev, processedFilePattern: e.target.value }))}
                placeholder="*.csv"
                data-testid="input-file-pattern"
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Only process files matching this pattern. Leave blank to process any file.</p>
                <p><strong>Wildcards:</strong> <code className="bg-muted px-1 rounded">*</code> matches any characters, <code className="bg-muted px-1 rounded">?</code> matches single character</p>
                <p><strong>Examples:</strong></p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li><code className="bg-muted px-1 rounded">meter_replace_*.csv</code> - matches meter_replace_jan.csv, meter_replace_2024.csv</li>
                  <li><code className="bg-muted px-1 rounded">install_*.xlsx</code> - matches install_batch1.xlsx, install_q1.xlsx</li>
                  <li><code className="bg-muted px-1 rounded">WO_202?_*.csv</code> - matches WO_2024_jan.csv, WO_2025_feb.csv</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={scheduleForm.hasHeader}
                onCheckedChange={(checked) => setScheduleForm(prev => ({ ...prev, hasHeader: checked }))}
                id="schedule-has-header"
                data-testid="switch-schedule-has-header"
              />
              <Label htmlFor="schedule-has-header">First row contains headers</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={scheduleForm.isEnabled}
                onCheckedChange={(checked) => setScheduleForm(prev => ({ ...prev, isEnabled: checked }))}
                id="schedule-enabled"
                data-testid="switch-schedule-enabled"
              />
              <Label htmlFor="schedule-enabled">Enable schedule</Label>
            </div>

            <div className="space-y-2">
              <Label>Column Mapping</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Enter the column names from your CSV/Excel files that map to each field
              </p>
              <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
                {Object.keys(defaultColumnMapping).map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <Label className="min-w-[120px] text-sm">{field}</Label>
                    <Input
                      value={scheduleForm.columnMapping[field] || ""}
                      onChange={(e) => setScheduleForm(prev => ({
                        ...prev,
                        columnMapping: { ...prev.columnMapping, [field]: e.target.value }
                      }))}
                      placeholder={field}
                      className="h-8 text-sm"
                      data-testid={`input-mapping-${field}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setScheduleDialogOpen(false);
                resetScheduleForm();
              }}
              data-testid="button-cancel-schedule"
            >
              Cancel
            </Button>
            <Button
              onClick={handleScheduleSubmit}
              disabled={createConfigMutation.isPending || updateConfigMutation.isPending}
              data-testid="button-save-schedule"
            >
              {(createConfigMutation.isPending || updateConfigMutation.isPending) ? "Saving..." : "Save Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfigId !== null} onOpenChange={(open) => !open && setDeleteConfigId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scheduled import? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfigId && deleteConfigMutation.mutate(deleteConfigId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
