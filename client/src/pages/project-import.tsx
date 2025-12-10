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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FileUp, CheckCircle, AlertCircle, ShieldAlert, Upload, FileSpreadsheet, FileJson } from "lucide-react";
import type { Project } from "@shared/schema";
import * as XLSX from "xlsx";

type ParsedWorkOrder = {
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  notes?: string;
  dueDate?: string;
};

type ColumnMapping = {
  title: string;
  description: string;
  priority: string;
  status: string;
  notes: string;
  dueDate: string;
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
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    title: "",
    description: "",
    priority: "",
    status: "",
    notes: "",
    dueDate: "",
  });
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
        toast({ title: "Import failed", variant: "destructive" });
      }
    },
  });

  const resetFileState = () => {
    setRawData([]);
    setHeaders([]);
    setPreviewData([]);
    setFileName("");
    setColumnMapping({
      title: "",
      description: "",
      priority: "",
      status: "",
      notes: "",
      dueDate: "",
    });
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
      setColumnMapping({
        title: "",
        description: "",
        priority: "",
        status: "",
        notes: "",
        dueDate: "",
      });
    }
  };

  const autoMapColumns = (headerRow: string[]) => {
    const newMapping: ColumnMapping = {
      title: "",
      description: "",
      priority: "",
      status: "",
      notes: "",
      dueDate: "",
    };

    const titleVariants = ["title", "name", "subject", "work order", "workorder", "wo title"];
    const descVariants = ["description", "desc", "details", "summary"];
    const priorityVariants = ["priority", "urgency", "importance"];
    const statusVariants = ["status", "state", "condition"];
    const notesVariants = ["notes", "comments", "remarks"];
    const dateVariants = ["due date", "duedate", "due", "deadline", "date"];

    headerRow.forEach((header) => {
      const lower = header.toLowerCase();
      if (titleVariants.some(v => lower.includes(v)) && !newMapping.title) {
        newMapping.title = header;
      } else if (descVariants.some(v => lower.includes(v)) && !newMapping.description) {
        newMapping.description = header;
      } else if (priorityVariants.some(v => lower.includes(v)) && !newMapping.priority) {
        newMapping.priority = header;
      } else if (statusVariants.some(v => lower.includes(v)) && !newMapping.status) {
        newMapping.status = header;
      } else if (notesVariants.some(v => lower.includes(v)) && !newMapping.notes) {
        newMapping.notes = header;
      } else if (dateVariants.some(v => lower.includes(v)) && !newMapping.dueDate) {
        newMapping.dueDate = header;
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
        title: getValueByHeader(columnMapping.title) || "Untitled",
        description: getValueByHeader(columnMapping.description),
        priority: getValueByHeader(columnMapping.priority),
        status: getValueByHeader(columnMapping.status),
        notes: getValueByHeader(columnMapping.notes),
        dueDate: getValueByHeader(columnMapping.dueDate),
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
    if (!columnMapping.title) {
      toast({ title: "Please map at least the Title column", variant: "destructive" });
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

      const workOrder: ParsedWorkOrder = {
        title: getValueByHeader(columnMapping.title) || "Untitled",
        description: getValueByHeader(columnMapping.description) || undefined,
        priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
        status: ["pending", "in_progress", "completed", "cancelled"].includes(status) ? status : "pending",
        notes: getValueByHeader(columnMapping.notes) || undefined,
        dueDate: getValueByHeader(columnMapping.dueDate) || undefined,
      };

      return workOrder;
    }).filter(wo => wo.title && wo.title !== "Untitled");

    if (workOrders.length === 0) {
      toast({ title: "No valid work orders to import", variant: "destructive" });
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
                Upload a CSV or Excel file (.csv, .xlsx, .xls) containing work orders
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

          {headers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Column Mapping</CardTitle>
                <CardDescription>
                  Map your file columns to work order fields
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <Label>Title (Required)</Label>
                    <Select 
                      value={columnMapping.title} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, title: v }))}
                    >
                      <SelectTrigger data-testid="select-map-title">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Select 
                      value={columnMapping.description} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, description: v }))}
                    >
                      <SelectTrigger data-testid="select-map-description">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select 
                      value={columnMapping.priority} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, priority: v }))}
                    >
                      <SelectTrigger data-testid="select-map-priority">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select 
                      value={columnMapping.status} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, status: v }))}
                    >
                      <SelectTrigger data-testid="select-map-status">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Select 
                      value={columnMapping.notes} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, notes: v }))}
                    >
                      <SelectTrigger data-testid="select-map-notes">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <Select 
                      value={columnMapping.dueDate} 
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, dueDate: v }))}
                    >
                      <SelectTrigger data-testid="select-map-due-date">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {previewData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Preview (First 10 rows)</CardTitle>
                <CardDescription>
                  Review how your data will be imported
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{row.title}</TableCell>
                          <TableCell className="max-w-xs truncate">{row.description || "-"}</TableCell>
                          <TableCell>{row.priority || "medium"}</TableCell>
                          <TableCell>{row.status || "pending"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    Total rows to import: {(hasHeader ? rawData.length - 1 : rawData.length)}
                  </p>
                  <Button
                    onClick={handleFileImport}
                    disabled={!columnMapping.title || importMutation.isPending}
                    data-testid="button-import-file"
                  >
                    <FileUp className="h-4 w-4 mr-2" />
                    {importMutation.isPending ? "Importing..." : "Import Work Orders"}
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
                <FileUp className="h-5 w-5" />
                Import JSON Data
              </CardTitle>
              <CardDescription>
                Paste JSON data to import multiple work orders at once
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="json-input">JSON Data</Label>
                <Textarea
                  id="json-input"
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder={`[\n  {\n    "title": "Work Order 1",\n    "description": "Description here",\n    "priority": "medium",\n    "status": "pending"\n  }\n]`}
                  className="font-mono min-h-[200px]"
                  data-testid="textarea-json-input"
                />
              </div>
              <Button
                onClick={handleJsonImport}
                disabled={!jsonInput.trim() || importMutation.isPending}
                data-testid="button-import-json"
              >
                <FileUp className="h-4 w-4 mr-2" />
                {importMutation.isPending ? "Importing..." : "Import Work Orders"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>JSON Format Reference</CardTitle>
              <CardDescription>Expected format for importing work orders</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
{`[
  {
    "title": "Work Order Title (required)",
    "description": "Optional description",
    "priority": "low | medium | high | urgent",
    "status": "pending | in_progress | completed | cancelled",
    "notes": "Optional notes",
    "dueDate": "2024-12-31T00:00:00Z"
  }
]`}
              </pre>
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
          <CardContent className="space-y-4">
            <p data-testid="text-import-result">
              Successfully imported <strong>{importResult.imported}</strong> work orders
            </p>
            {importResult.errors.length > 0 && (
              <div>
                <p className="font-medium text-destructive mb-2">Errors ({importResult.errors.length}):</p>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {importResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
