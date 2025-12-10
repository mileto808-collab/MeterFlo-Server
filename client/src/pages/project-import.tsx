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
import { FileUp, CheckCircle, AlertCircle, ShieldAlert, Upload, FileSpreadsheet, FileJson, Info } from "lucide-react";
import type { Project } from "@shared/schema";
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
  oldMeterId?: string;
  oldMeterReading?: number;
  newMeterId?: string;
  newMeterReading?: number;
  oldGps?: string;
  newGps?: string;
  priority?: string;
  status?: string;
  notes?: string;
  assignedTo?: string;
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
  oldMeterId: string;
  oldMeterReading: string;
  newMeterId: string;
  newMeterReading: string;
  oldGps: string;
  newGps: string;
  priority: string;
  status: string;
  notes: string;
  assignedTo: string;
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
  oldMeterId: "",
  oldMeterReading: "",
  newMeterId: "",
  newMeterReading: "",
  oldGps: "",
  newGps: "",
  priority: "",
  status: "",
  notes: "",
  assignedTo: "",
};

const parseIntOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = parseInt(trimmed, 10);
  return isNaN(parsed) ? undefined : parsed;
};

export default function ProjectImport() {
  const [, params] = useRoute("/projects/:projectId/import");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [jsonInput, setJsonInput] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [activeTab, setActiveTab] = useState("file");
  
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [rawData, setRawData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(defaultColumnMapping);
  const [previewData, setPreviewData] = useState<ParsedWorkOrder[]>([]);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project, isLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  useEffect(() => {
    if (projectError) {
      const errorMsg = (projectError as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
      }
    }
  }, [projectError]);

  const importMutation = useMutation({
    mutationFn: async (workOrders: any[]) => {
      if (accessDenied) throw new Error("403: Access denied");
      const response = await apiRequest("POST", `/api/projects/${projectId}/import`, { workOrders });
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
        setAccessDenied(true);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
      } else {
        toast({ title: "Import failed", description: errorMsg, variant: "destructive" });
      }
    },
  });

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
      { field: "oldMeterId", variants: ["old meter", "old meter id", "oldmeterid", "old_meter_id", "current meter", "existing meter", "old_meter"] },
      { field: "oldMeterReading", variants: ["old meter reading", "old reading", "oldmeterreading", "old_meter_reading", "current reading", "existing reading"] },
      { field: "newMeterId", variants: ["new meter", "new meter id", "newmeterid", "new_meter_id", "replacement meter", "new_meter"] },
      { field: "newMeterReading", variants: ["new meter reading", "new reading", "newmeterreading", "new_meter_reading", "replacement reading"] },
      { field: "oldGps", variants: ["old gps", "old_gps", "oldgps", "current gps", "existing gps", "old coordinates"] },
      { field: "newGps", variants: ["new gps", "new_gps", "newgps", "new coordinates"] },
      { field: "priority", variants: ["priority", "urgency", "importance"] },
      { field: "status", variants: ["status", "state", "condition", "wo status"] },
      { field: "notes", variants: ["notes", "comments", "remarks", "description"] },
      { field: "assignedTo", variants: ["assigned", "assignedto", "assigned to", "technician", "worker", "assignee", "tech"] },
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
        oldMeterId: getValueByHeader(columnMapping.oldMeterId) || undefined,
        oldMeterReading: columnMapping.oldMeterReading ? parseIntOrUndefined(getValueByHeader(columnMapping.oldMeterReading)) : undefined,
        newMeterId: getValueByHeader(columnMapping.newMeterId) || undefined,
        newMeterReading: columnMapping.newMeterReading ? parseIntOrUndefined(getValueByHeader(columnMapping.newMeterReading)) : undefined,
        oldGps: getValueByHeader(columnMapping.oldGps) || undefined,
        newGps: getValueByHeader(columnMapping.newGps) || undefined,
        priority: getValueByHeader(columnMapping.priority) || undefined,
        status: getValueByHeader(columnMapping.status) || undefined,
        notes: getValueByHeader(columnMapping.notes) || undefined,
        assignedTo: getValueByHeader(columnMapping.assignedTo) || undefined,
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
      importMutation.mutate(workOrders);
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

      const priority = getValueByHeader(columnMapping.priority).toLowerCase();
      const status = getValueByHeader(columnMapping.status).toLowerCase();
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
        oldMeterId: getValueByHeader(columnMapping.oldMeterId) || undefined,
        oldMeterReading: columnMapping.oldMeterReading ? parseIntOrUndefined(getValueByHeader(columnMapping.oldMeterReading)) : undefined,
        newMeterId: getValueByHeader(columnMapping.newMeterId) || undefined,
        newMeterReading: columnMapping.newMeterReading ? parseIntOrUndefined(getValueByHeader(columnMapping.newMeterReading)) : undefined,
        oldGps: getValueByHeader(columnMapping.oldGps) || undefined,
        newGps: getValueByHeader(columnMapping.newGps) || undefined,
        priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
        status: ["pending", "in_progress", "completed", "cancelled"].includes(status) ? status : "pending",
        notes: getValueByHeader(columnMapping.notes) || undefined,
        assignedTo: getValueByHeader(columnMapping.assignedTo) || undefined,
      };

      return workOrder;
    }).filter(wo => wo.customerWoId && wo.customerId && wo.customerName && wo.address);

    if (workOrders.length === 0) {
      toast({ title: "No valid work orders to import. Ensure required fields are mapped.", variant: "destructive" });
      return;
    }

    importMutation.mutate(workOrders);
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
        </TabsList>

        <TabsContent value="file" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload File
              </CardTitle>
              <CardDescription>
                Upload a CSV or Excel file containing utility meter work orders
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
                Prepare your file with utility meter work order data
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
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">old_meter_id, new_meter_id</span> - Meter IDs</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">old_gps, new_gps</span> - GPS coordinates</div>
                    <div><span className="font-mono bg-muted px-2 py-1 rounded">priority, status, notes</span> - Work order details</div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Example CSV</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`customer_wo_id,customer_id,customer_name,address,city,state,zip,service_type,route,zone,old_meter_id
WO-001,CUST-123,John Smith,123 Main St,Springfield,IL,62701,Water,Route A,Zone 1,MTR-OLD-001
WO-002,CUST-456,Jane Doe,456 Oak Ave,Springfield,IL,62702,Electric,Route B,Zone 2,MTR-OLD-002
WO-003,CUST-789,Bob Wilson,789 Pine Rd,Springfield,IL,62703,Gas,Route A,Zone 1,MTR-OLD-003`}
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
                  <MappingSelect field="oldMeterId" label="Old Meter ID" />
                  <MappingSelect field="oldMeterReading" label="Old Meter Reading" />
                  <MappingSelect field="newMeterId" label="New Meter ID" />
                  <MappingSelect field="newMeterReading" label="New Meter Reading" />
                  <MappingSelect field="oldGps" label="Old GPS" />
                  <MappingSelect field="newGps" label="New GPS" />
                  <MappingSelect field="priority" label="Priority" />
                  <MappingSelect field="status" label="Status" />
                  <MappingSelect field="notes" label="Notes" />
                  <MappingSelect field="assignedTo" label="Assigned To" />
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
                        <TableHead>Old Meter</TableHead>
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
                          <TableCell>{wo.oldMeterId || "-"}</TableCell>
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
    </div>
  );
}
