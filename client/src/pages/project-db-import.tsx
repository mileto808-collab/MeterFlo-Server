import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Database, 
  Plus, 
  ArrowLeft, 
  Settings, 
  Play, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  XCircle,
  Edit,
  Trash2,
  RefreshCw,
  Eye,
  History,
  Server,
  ShieldAlert,
  Loader2
} from "lucide-react";
import type { Project, ExternalDatabaseConfig, ImportConfig, ImportHistory } from "@shared/schema";

type ConnectionForm = {
  name: string;
  databaseType: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslEnabled: boolean;
};

type ImportConfigForm = {
  name: string;
  sqlQuery: string;
  columnMapping: Record<string, string>;
  scheduleFrequency: string;
  customCronExpression: string;
  isEnabled: boolean;
};

const workOrderFields = [
  { key: "customerWoId", label: "Customer WO ID", required: true },
  { key: "customerId", label: "Customer ID", required: true },
  { key: "customerName", label: "Customer Name", required: true },
  { key: "address", label: "Address", required: true },
  { key: "city", label: "City", required: false },
  { key: "state", label: "State", required: false },
  { key: "zip", label: "ZIP", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "email", label: "Email", required: false },
  { key: "route", label: "Route", required: false },
  { key: "zone", label: "Zone", required: false },
  { key: "serviceType", label: "Service Type", required: true },
  { key: "oldMeterId", label: "Old Meter ID", required: false },
  { key: "oldMeterReading", label: "Old Meter Reading", required: false },
  { key: "oldGps", label: "Old GPS", required: false },
  { key: "oldMeterType", label: "Old Meter Type", required: false },
  { key: "newMeterType", label: "New Meter Type", required: false },
  { key: "status", label: "Status", required: false },
  { key: "scheduledDate", label: "Scheduled Date & Time", required: false },
  { key: "trouble", label: "Trouble", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "assignedTo", label: "Assigned To", required: false },
  { key: "createdBy", label: "Created By", required: false },
  { key: "completedAt", label: "Completed At", required: false },
];

const databaseTypes = [
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "mariadb", label: "MariaDB", defaultPort: 3306 },
  { value: "mssql", label: "SQL Server", defaultPort: 1433 },
  { value: "oracle", label: "Oracle", defaultPort: 1521 },
  { value: "sqlite", label: "SQLite", defaultPort: 0 },
];

const scheduleFrequencies = [
  { value: "manual", label: "Manual Only" },
  { value: "every_15_minutes", label: "Every 15 Minutes" },
  { value: "every_30_minutes", label: "Every 30 Minutes" },
  { value: "hourly", label: "Every Hour" },
  { value: "every_2_hours", label: "Every 2 Hours" },
  { value: "every_6_hours", label: "Every 6 Hours" },
  { value: "every_12_hours", label: "Every 12 Hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom Cron Expression" },
];

const defaultConnectionForm: ConnectionForm = {
  name: "",
  databaseType: "postgresql",
  host: "",
  port: 5432,
  databaseName: "",
  username: "",
  password: "",
  sslEnabled: false,
};

const defaultImportConfigForm: ImportConfigForm = {
  name: "",
  sqlQuery: "SELECT * FROM your_table LIMIT 100",
  columnMapping: {},
  scheduleFrequency: "manual",
  customCronExpression: "",
  isEnabled: true,
};

export default function ProjectDbImport() {
  const [, params] = useRoute("/projects/:projectId/db-import");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [accessDenied, setAccessDenied] = useState(false);
  
  const [activeTab, setActiveTab] = useState("connections");
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [showImportConfigDialog, setShowImportConfigDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "connection" | "import"; id: number; name: string } | null>(null);
  
  const [connectionForm, setConnectionForm] = useState<ConnectionForm>(defaultConnectionForm);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  
  const [importConfigForm, setImportConfigForm] = useState<ImportConfigForm>(defaultImportConfigForm);
  const [editingImportConfigId, setEditingImportConfigId] = useState<number | null>(null);
  const [selectedDbConfigId, setSelectedDbConfigId] = useState<number | null>(null);
  
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedHistoryConfigId, setSelectedHistoryConfigId] = useState<number | null>(null);

  const { data: project, isLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: dbConfigs = [], refetch: refetchConfigs } = useQuery<ExternalDatabaseConfig[]>({
    queryKey: ["/api/projects", projectId, "database-configs"],
    enabled: !!projectId && !accessDenied,
  });

  const { data: importConfigs = [], refetch: refetchImportConfigs } = useQuery<ImportConfig[]>({
    queryKey: ["/api/projects", projectId, "import-configs"],
    enabled: !!projectId && !accessDenied,
  });

  const { data: importHistory = [] } = useQuery<ImportHistory[]>({
    queryKey: ["/api/import-configs", selectedHistoryConfigId, "history"],
    enabled: !!selectedHistoryConfigId && showHistoryDialog,
  });

  useEffect(() => {
    if (projectError) {
      const errorMsg = (projectError as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
      }
    }
  }, [projectError]);

  const createConnectionMutation = useMutation({
    mutationFn: async (data: ConnectionForm) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/database-configs`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Database connection created" });
      setShowConnectionDialog(false);
      setConnectionForm(defaultConnectionForm);
      refetchConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create connection", description: error.message, variant: "destructive" });
    },
  });

  const updateConnectionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ConnectionForm> }) => {
      const response = await apiRequest("PATCH", `/api/database-configs/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Database connection updated" });
      setShowConnectionDialog(false);
      setConnectionForm(defaultConnectionForm);
      setEditingConnectionId(null);
      refetchConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update connection", description: error.message, variant: "destructive" });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/database-configs/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Database connection deleted" });
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      refetchConfigs();
      refetchImportConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete connection", description: error.message, variant: "destructive" });
    },
  });

  const createImportConfigMutation = useMutation({
    mutationFn: async ({ dbConfigId, data }: { dbConfigId: number; data: ImportConfigForm }) => {
      const response = await apiRequest("POST", `/api/database-configs/${dbConfigId}/import-configs`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Import configuration created" });
      setShowImportConfigDialog(false);
      setImportConfigForm(defaultImportConfigForm);
      setSelectedDbConfigId(null);
      setPreviewData(null);
      setPreviewColumns([]);
      refetchImportConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create import configuration", description: error.message, variant: "destructive" });
    },
  });

  const updateImportConfigMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ImportConfigForm> }) => {
      const response = await apiRequest("PATCH", `/api/import-configs/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Import configuration updated" });
      setShowImportConfigDialog(false);
      setImportConfigForm(defaultImportConfigForm);
      setEditingImportConfigId(null);
      setPreviewData(null);
      setPreviewColumns([]);
      refetchImportConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update import configuration", description: error.message, variant: "destructive" });
    },
  });

  const deleteImportConfigMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/import-configs/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Import configuration deleted" });
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      refetchImportConfigs();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete import configuration", description: error.message, variant: "destructive" });
    },
  });

  const runImportMutation = useMutation({
    mutationFn: async (configId: number) => {
      const response = await apiRequest("POST", `/api/import-configs/${configId}/run`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ 
          title: "Import completed", 
          description: `Imported ${data.imported} records${data.failed > 0 ? `, ${data.failed} failed` : ""}` 
        });
      } else {
        toast({ title: "Import failed", description: data.error, variant: "destructive" });
      }
      refetchImportConfigs();
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to run import", description: error.message, variant: "destructive" });
    },
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    
    try {
      const payload = editingConnectionId 
        ? { configId: editingConnectionId, ...connectionForm }
        : connectionForm;
        
      const response = await apiRequest("POST", "/api/database-configs/test-connection", payload);
      const result = await response.json();
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ success: false, message: error.message || "Connection test failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePreviewQuery = async () => {
    if (!selectedDbConfigId || !importConfigForm.sqlQuery) return;
    
    setIsPreviewLoading(true);
    setPreviewData(null);
    setPreviewColumns([]);
    
    try {
      const response = await apiRequest("POST", `/api/database-configs/${selectedDbConfigId}/preview-query`, {
        sqlQuery: importConfigForm.sqlQuery,
        limit: 10,
      });
      const result = await response.json();
      
      if (result.success && result.data && result.data.length > 0) {
        setPreviewData(result.data);
        setPreviewColumns(Object.keys(result.data[0]));
      } else if (!result.success) {
        toast({ title: "Query failed", description: result.error, variant: "destructive" });
      } else {
        toast({ title: "No data returned", description: "The query returned no results" });
      }
    } catch (error: any) {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleDatabaseTypeChange = (type: string) => {
    const dbType = databaseTypes.find(t => t.value === type);
    setConnectionForm({
      ...connectionForm,
      databaseType: type,
      port: dbType?.defaultPort || 5432,
    });
  };

  const openEditConnection = (config: ExternalDatabaseConfig) => {
    setConnectionForm({
      name: config.name,
      databaseType: config.databaseType,
      host: config.host,
      port: config.port,
      databaseName: config.databaseName,
      username: config.username,
      password: "********",
      sslEnabled: config.sslEnabled || false,
    });
    setEditingConnectionId(config.id);
    setTestResult(null);
    setShowConnectionDialog(true);
  };

  const openNewConnection = () => {
    setConnectionForm(defaultConnectionForm);
    setEditingConnectionId(null);
    setTestResult(null);
    setShowConnectionDialog(true);
  };

  const openNewImportConfig = (dbConfigId: number) => {
    setImportConfigForm(defaultImportConfigForm);
    setSelectedDbConfigId(dbConfigId);
    setEditingImportConfigId(null);
    setPreviewData(null);
    setPreviewColumns([]);
    setShowImportConfigDialog(true);
  };

  const openEditImportConfig = (config: ImportConfig) => {
    setImportConfigForm({
      name: config.name,
      sqlQuery: config.sqlQuery,
      columnMapping: (config.columnMapping as Record<string, string>) || {},
      scheduleFrequency: config.scheduleFrequency,
      customCronExpression: config.customCronExpression || "",
      isEnabled: config.isEnabled || false,
    });
    setSelectedDbConfigId(config.externalDbConfigId);
    setEditingImportConfigId(config.id);
    setPreviewData(null);
    setPreviewColumns([]);
    setShowImportConfigDialog(true);
  };

  const openHistory = (configId: number) => {
    setSelectedHistoryConfigId(configId);
    setShowHistoryDialog(true);
  };

  const handleDeleteClick = (type: "connection" | "import", id: number, name: string) => {
    setDeleteTarget({ type, id, name });
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "connection") {
      deleteConnectionMutation.mutate(deleteTarget.id);
    } else {
      deleteImportConfigMutation.mutate(deleteTarget.id);
    }
  };

  const handleSaveConnection = () => {
    if (editingConnectionId) {
      const updateData = { ...connectionForm };
      if (updateData.password === "********") {
        delete (updateData as any).password;
      }
      updateConnectionMutation.mutate({ id: editingConnectionId, data: updateData });
    } else {
      createConnectionMutation.mutate(connectionForm);
    }
  };

  const handleSaveImportConfig = () => {
    if (!selectedDbConfigId) return;
    
    if (editingImportConfigId) {
      updateImportConfigMutation.mutate({ id: editingImportConfigId, data: importConfigForm });
    } else {
      createImportConfigMutation.mutate({ dbConfigId: selectedDbConfigId, data: importConfigForm });
    }
  };

  if (accessDenied) {
    return (
      <div className="container mx-auto p-6">
        <Card className="max-w-lg mx-auto">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <ShieldAlert className="h-12 w-12 text-destructive" />
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>You do not have permission to access this project</CardDescription>
              <Button onClick={() => navigate("/")} data-testid="button-go-dashboard">
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${projectId}/work-orders`)} data-testid="button-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">External Database Import/Export</h1>
          <p className="text-muted-foreground">{project?.name}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList data-testid="tabs-import">
          <TabsTrigger value="connections" data-testid="tab-connections">
            <Database className="h-4 w-4 mr-2" />
            Database Connections
          </TabsTrigger>
          <TabsTrigger value="imports" data-testid="tab-imports">
            <Settings className="h-4 w-4 mr-2" />
            Import Configurations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-muted-foreground">Configure connections to external databases for importing/exporting work orders</p>
            <Button onClick={openNewConnection} data-testid="button-add-connection">
              <Plus className="h-4 w-4 mr-2" />
              Add Connection
            </Button>
          </div>

          {dbConfigs.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No database connections configured</p>
                  <p className="text-sm">Add a connection to get started</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {dbConfigs.map((config) => (
                <Card key={config.id} data-testid={`card-connection-${config.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        <CardTitle className="text-lg" data-testid={`text-connection-name-${config.id}`}>{config.name}</CardTitle>
                        <Badge variant={config.isActive ? "default" : "secondary"}>
                          {config.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditConnection(config)} data-testid={`button-edit-connection-${config.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteClick("connection", config.id, config.name)} data-testid={`button-delete-connection-${config.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Type:</span>
                        <span className="ml-2 font-medium">{config.databaseType}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Host:</span>
                        <span className="ml-2 font-medium">{config.host}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Database:</span>
                        <span className="ml-2 font-medium">{config.databaseName}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Last Test:</span>
                        <span className="ml-2">
                          {config.lastTestedAt ? (
                            <span className="flex items-center gap-1">
                              {config.lastTestResult ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              {new Date(config.lastTestedAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openNewImportConfig(config.id)} data-testid={`button-add-import-config-${config.id}`}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Import Config
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="imports" className="space-y-4">
          <p className="text-muted-foreground">Configure SQL queries and schedules for importing work orders from external databases</p>

          {importConfigs.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8 text-muted-foreground">
                  <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No import configurations</p>
                  <p className="text-sm">Add a database connection first, then create import configurations</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {importConfigs.map((config) => {
                const dbConfig = dbConfigs.find(db => db.id === config.externalDbConfigId);
                return (
                  <Card key={config.id} data-testid={`card-import-config-${config.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg" data-testid={`text-import-name-${config.id}`}>{config.name}</CardTitle>
                          <Badge variant={config.isEnabled ? "default" : "secondary"}>
                            {config.isEnabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Badge variant="outline">
                            <Clock className="h-3 w-3 mr-1" />
                            {scheduleFrequencies.find(f => f.value === config.scheduleFrequency)?.label || config.scheduleFrequency}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => runImportMutation.mutate(config.id)}
                            disabled={runImportMutation.isPending}
                            data-testid={`button-run-import-${config.id}`}
                          >
                            {runImportMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openHistory(config.id)} data-testid={`button-history-${config.id}`}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEditImportConfig(config)} data-testid={`button-edit-import-${config.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteClick("import", config.id, config.name)} data-testid={`button-delete-import-${config.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Database:</span>
                          <span className="ml-2 font-medium">{dbConfig?.name || "Unknown"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Last Run:</span>
                          <span className="ml-2">
                            {config.lastRunAt ? (
                              <span className="flex items-center gap-1">
                                {config.lastRunStatus === "success" && <CheckCircle className="h-4 w-4 text-green-500" />}
                                {config.lastRunStatus === "partial" && <AlertCircle className="h-4 w-4 text-yellow-500" />}
                                {config.lastRunStatus === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
                                {new Date(config.lastRunAt).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Records:</span>
                          <span className="ml-2 font-medium">{config.lastRunRecordCount ?? 0}</span>
                        </div>
                      </div>
                      {config.lastRunMessage && (
                        <p className="mt-2 text-sm text-muted-foreground">{config.lastRunMessage}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showConnectionDialog} onOpenChange={setShowConnectionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingConnectionId ? "Edit Database Connection" : "Add Database Connection"}</DialogTitle>
            <DialogDescription>Configure connection to an external database</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="conn-name">Connection Name</Label>
              <Input
                id="conn-name"
                value={connectionForm.name}
                onChange={(e) => setConnectionForm({ ...connectionForm, name: e.target.value })}
                placeholder="e.g., Production MySQL"
                data-testid="input-connection-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-type">Database Type</Label>
              <Select value={connectionForm.databaseType} onValueChange={handleDatabaseTypeChange}>
                <SelectTrigger data-testid="select-database-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {databaseTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 grid gap-2">
                <Label htmlFor="conn-host">Host</Label>
                <Input
                  id="conn-host"
                  value={connectionForm.host}
                  onChange={(e) => setConnectionForm({ ...connectionForm, host: e.target.value })}
                  placeholder="localhost or IP address"
                  data-testid="input-connection-host"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-port">Port</Label>
                <Input
                  id="conn-port"
                  type="number"
                  value={connectionForm.port}
                  onChange={(e) => setConnectionForm({ ...connectionForm, port: parseInt(e.target.value) || 0 })}
                  data-testid="input-connection-port"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-db">Database Name</Label>
              <Input
                id="conn-db"
                value={connectionForm.databaseName}
                onChange={(e) => setConnectionForm({ ...connectionForm, databaseName: e.target.value })}
                placeholder="Database name"
                data-testid="input-connection-database"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="conn-user">Username</Label>
                <Input
                  id="conn-user"
                  value={connectionForm.username}
                  onChange={(e) => setConnectionForm({ ...connectionForm, username: e.target.value })}
                  data-testid="input-connection-username"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-pass">Password</Label>
                <Input
                  id="conn-pass"
                  type="password"
                  value={connectionForm.password}
                  onChange={(e) => setConnectionForm({ ...connectionForm, password: e.target.value })}
                  data-testid="input-connection-password"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="conn-ssl"
                checked={connectionForm.sslEnabled}
                onCheckedChange={(checked) => setConnectionForm({ ...connectionForm, sslEnabled: checked })}
                data-testid="switch-ssl"
              />
              <Label htmlFor="conn-ssl">Enable SSL</Label>
            </div>
            {testResult && (
              <div className={`p-3 rounded-md ${testResult.success ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <span className={testResult.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>
                    {testResult.message}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleTestConnection} disabled={isTesting} data-testid="button-test-connection">
              {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            <Button 
              onClick={handleSaveConnection} 
              disabled={createConnectionMutation.isPending || updateConnectionMutation.isPending}
              data-testid="button-save-connection"
            >
              {(createConnectionMutation.isPending || updateConnectionMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportConfigDialog} onOpenChange={setShowImportConfigDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingImportConfigId ? "Edit Import Configuration" : "Add Import Configuration"}</DialogTitle>
            <DialogDescription>Configure SQL query and column mapping for importing work orders</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="import-name">Configuration Name</Label>
              <Input
                id="import-name"
                value={importConfigForm.name}
                onChange={(e) => setImportConfigForm({ ...importConfigForm, name: e.target.value })}
                placeholder="e.g., Daily Work Order Sync"
                data-testid="input-import-name"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="import-query">SQL Query</Label>
                <Button variant="outline" size="sm" onClick={handlePreviewQuery} disabled={isPreviewLoading} data-testid="button-preview-query">
                  {isPreviewLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                  Preview
                </Button>
              </div>
              <Textarea
                id="import-query"
                value={importConfigForm.sqlQuery}
                onChange={(e) => setImportConfigForm({ ...importConfigForm, sqlQuery: e.target.value })}
                className="font-mono text-sm min-h-[100px]"
                placeholder="SELECT * FROM work_orders WHERE status = 'pending'"
                data-testid="textarea-sql-query"
              />
            </div>

            {previewData && previewColumns.length > 0 && (
              <div className="grid gap-2">
                <Label>Query Preview ({previewData.length} rows)</Label>
                <ScrollArea className="h-[150px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewColumns.slice(0, 8).map((col) => (
                          <TableHead key={col} className="text-xs">{col}</TableHead>
                        ))}
                        {previewColumns.length > 8 && <TableHead className="text-xs">...</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.slice(0, 5).map((row, idx) => (
                        <TableRow key={idx}>
                          {previewColumns.slice(0, 8).map((col) => (
                            <TableCell key={col} className="text-xs truncate max-w-[100px]">
                              {String(row[col] ?? "")}
                            </TableCell>
                          ))}
                          {previewColumns.length > 8 && <TableCell className="text-xs">...</TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}

            {previewColumns.length > 0 && (
              <div className="grid gap-2">
                <Label>Column Mapping</Label>
                <p className="text-sm text-muted-foreground">Map source columns to work order fields. Required fields are marked with *</p>
                <ScrollArea className="h-[250px] border rounded-md p-3">
                  <div className="grid gap-3">
                    {workOrderFields.map((field) => (
                      <div key={field.key} className="grid grid-cols-2 gap-4 items-center">
                        <Label className="text-sm">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        <Select
                          value={importConfigForm.columnMapping[field.key] || ""}
                          onValueChange={(value) => setImportConfigForm({
                            ...importConfigForm,
                            columnMapping: { ...importConfigForm.columnMapping, [field.key]: value === "_none_" ? "" : value },
                          })}
                        >
                          <SelectTrigger data-testid={`select-mapping-${field.key}`}>
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">-- Not mapped --</SelectItem>
                            {previewColumns.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="import-schedule">Schedule Frequency</Label>
                <Select
                  value={importConfigForm.scheduleFrequency}
                  onValueChange={(value) => setImportConfigForm({ ...importConfigForm, scheduleFrequency: value })}
                >
                  <SelectTrigger data-testid="select-schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scheduleFrequencies.map((freq) => (
                      <SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id="import-enabled"
                  checked={importConfigForm.isEnabled}
                  onCheckedChange={(checked) => setImportConfigForm({ ...importConfigForm, isEnabled: checked })}
                  data-testid="switch-enabled"
                />
                <Label htmlFor="import-enabled">Enabled</Label>
              </div>
            </div>
            
            {importConfigForm.scheduleFrequency === "custom" && (
              <div className="grid gap-2">
                <Label htmlFor="custom-cron">Custom Cron Expression</Label>
                <Input
                  id="custom-cron"
                  value={importConfigForm.customCronExpression}
                  onChange={(e) => setImportConfigForm({ ...importConfigForm, customCronExpression: e.target.value })}
                  placeholder="*/5 * * * * (every 5 minutes)"
                  data-testid="input-custom-cron"
                />
                <p className="text-xs text-muted-foreground">
                  Format: minute hour day-of-month month day-of-week. Examples: "0 */2 * * *" (every 2 hours), "30 8 * * 1-5" (8:30 AM weekdays)
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportConfigDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleSaveImportConfig}
              disabled={createImportConfigMutation.isPending || updateImportConfigMutation.isPending}
              data-testid="button-save-import-config"
            >
              {(createImportConfigMutation.isPending || updateImportConfigMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import History</DialogTitle>
            <DialogDescription>Recent import runs for this configuration</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[400px]">
            {importHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No import history</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Imported</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.startedAt ? new Date(entry.startedAt).toLocaleString() : "-"}</TableCell>
                      <TableCell>
                        <Badge variant={
                          entry.status === "success" ? "default" :
                          entry.status === "partial" ? "secondary" :
                          entry.status === "running" ? "outline" : "destructive"
                        }>
                          {entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.recordsImported ?? 0}</TableCell>
                      <TableCell>{entry.recordsFailed ?? 0}</TableCell>
                      <TableCell>{entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
              {deleteTarget?.type === "connection" && " All associated import configurations will also be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
