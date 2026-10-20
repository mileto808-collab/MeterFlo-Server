import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { systemRestoreStore } from "@/lib/system-restore-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  HardDrive,
  AlertTriangle,
  Wrench,
  Archive,
  FolderArchive,
  Server,
  Lock,
  FileArchive,
  Files,
  Folder,
  Search,
} from "lucide-react";
import { useTimezone } from "@/hooks/use-timezone";
import { usePermissions } from "@/hooks/usePermissions";
import type { Project } from "@shared/schema";
import BackupWorkspace from "@/components/backup-workspace";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/backup-export";

interface ProjectWithStats extends Project {
  stats: {
    totalRecords: number;
    tableSize: string;
    lastModified: string | null;
  } | null;
}

interface FileStats {
  exists: boolean;
  totalSize: number;
  fileCount: number;
  folderCount: number;
  sizeFormatted: string;
}

export function ManualMaintenance({ embedded = true, active = true, section = "system" }: {
  embedded?: boolean;
  active?: boolean;
  section?: "system" | "projects" | "files";
}) {
  const { toast } = useToast();
  const { formatDateTime } = useTimezone();
  const { hasPermission, isLoading: isPermissionsLoading } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const systemFileInputRef = useRef<HTMLInputElement>(null);
  const projectFilesInputRef = useRef<HTMLInputElement>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [systemRestoreDialogOpen, setSystemRestoreDialogOpen] = useState(false);
  const [filesRestoreDialogOpen, setFilesRestoreDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [systemClearExisting, setSystemClearExisting] = useState(false);
  const [retainLocalSftp, setRetainLocalSftp] = useState(true);
  const [filesClearExisting, setFilesClearExisting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSystemBackup, setIsSystemBackup] = useState(false);
  const [isSystemRestoring, setIsSystemRestoring] = useState(false);
  const [isFilesRestoring, setIsFilesRestoring] = useState(false);
  const [backupType, setBackupType] = useState<"database" | "clean" | "files" | "project">("database");
  const [fileStats, setFileStats] = useState<Record<number, FileStats>>({});
  const [databaseSearch, setDatabaseSearch] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState("");
  const [filesSearch, setFilesSearch] = useState("");
  const [filesStatus, setFilesStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    stage: "uploading" | "processing";
    percent: number;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (isSystemRestoring && uploadProgress) systemRestoreStore.progress(uploadProgress);
  }, [isSystemRestoring, uploadProgress]);
  useEffect(() => {
    if (!active) {
      setRestoreDialogOpen(false);
      setSystemRestoreDialogOpen(false);
      setFilesRestoreDialogOpen(false);
    }
  }, [active]);

  const canProjectBackup = !isPermissionsLoading && hasPermission("maintenance.projectBackup");
  const canProjectRestore = !isPermissionsLoading && hasPermission("maintenance.projectRestore");
  const canSystemBackup = !isPermissionsLoading && hasPermission("maintenance.systemBackup");
  const canSystemRestore = !isPermissionsLoading && hasPermission("maintenance.systemRestore");
  const canAccessProjectMaintenance = canProjectBackup || canProjectRestore;
  const canAccessAnyBackupRestore = canAccessProjectMaintenance || canSystemBackup || canSystemRestore;
  const showSystem = section === "system";
  const showProjects = section === "projects";
  const showFiles = section === "files";
  const { data: projects = [], isLoading, refetch } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/maintenance/projects"],
    enabled: active && (showProjects || showFiles) && canAccessAnyBackupRestore,
  });
  const filteredDatabaseProjects = useMemo(() => {
    const query = databaseSearch.trim().toLocaleLowerCase();
    return projects.filter(project => {
      const matchesQuery = !query || `${project.name} ${project.description || ""} ${project.databaseName || ""}`.toLocaleLowerCase().includes(query);
      const matchesStatus = !databaseStatus || (databaseStatus === "active" ? project.isActive : !project.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [projects, databaseSearch, databaseStatus]);
  const filteredFilesProjects = useMemo(() => {
    const query = filesSearch.trim().toLocaleLowerCase();
    return projects.filter(project => {
      const matchesQuery = !query || `${project.name} ${project.description || ""}`.toLocaleLowerCase().includes(query);
      const matchesStatus = !filesStatus || (filesStatus === "active" ? project.isActive : !project.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [projects, filesSearch, filesStatus]);

  useEffect(() => {
    const fetchFileStats = async () => {
      const stats: Record<number, FileStats> = {};
      for (const project of projects) {
        try {
          const response = await fetch(`/api/projects/${project.id}/files/stats`, {
            credentials: "include",
          });
          if (response.ok) {
            stats[project.id] = await response.json();
          }
        } catch (e) {
        }
      }
      setFileStats(stats);
    };
    if (active && (showProjects || showFiles) && canAccessProjectMaintenance && projects.length > 0) {
      fetchFileStats();
    }
  }, [projects, canAccessProjectMaintenance, active, showProjects, showFiles]);

  const handleBackup = async (project: ProjectWithStats) => {
    try {
      const response = await fetch(`/api/projects/${project.id}/database/backup`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create backup");
      }
      
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${project.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Backup created",
        description: `Successfully backed up ${data.workOrders.length} work orders from ${project.name}`,
      });
    } catch (error) {
      toast({
        title: "Backup failed",
        description: error instanceof Error ? error.message : "Failed to create backup",
        variant: "destructive",
      });
    }
  };

  const openRestoreDialog = (project: ProjectWithStats) => {
    setSelectedProject(project);
    setClearExisting(false);
    setRestoreDialogOpen(true);
  };

  const handleRestoreFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    setIsRestoring(true);
    
    try {
      const formData = new FormData();
      formData.append("backup", file);
      formData.append("clearExisting", String(clearExisting));

      const response = await fetch(`/api/projects/${selectedProject.id}/database/restore`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to restore backup");
      }

      toast({
        title: "Restore completed",
        description: `Restored ${result.restored} work orders${result.errors.length > 0 ? ` with ${result.errors.length} errors` : ""}`,
      });

      if (result.errors.length > 0) {
        console.error("Restore errors:", result.errors);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/projects"] });
      setRestoreDialogOpen(false);
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Failed to restore backup",
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFullSystemBackup = async () => {
    setIsSystemBackup(true);
    try {
      const response = await fetch(`/api/system/backup?type=${backupType}`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create backup");
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filenamePrefix = backupType === "database" ? "full_db_backup" : 
                             backupType === "clean" ? "clean_db_backup" :
                             backupType === "files" ? "webapp_backup" : "project_backup";
      a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const description = backupType === "database" 
        ? "Successfully backed up full database with all projects" 
        : backupType === "clean"
        ? "Successfully backed up clean database (settings only, no users/projects)"
        : backupType === "files"
        ? "Successfully backed up web application source files"
        : "Successfully backed up all project data files";
      
      toast({
        title: "Backup Created",
        description,
      });
    } catch (error) {
      toast({
        title: "Backup failed",
        description: error instanceof Error ? error.message : "Failed to create backup",
        variant: "destructive",
      });
    } finally {
      setIsSystemBackup(false);
    }
  };

  const openSystemRestoreDialog = () => {
    setSystemClearExisting(false);
    setSystemRestoreDialogOpen(true);
  };

  const handleSystemRestoreFileSelect = () => {
    systemFileInputRef.current?.click();
  };

  const handleSystemFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!systemRestoreStore.begin()) return;
    // Preserve the initiating view/request even if restored sessions invalidate
    // a background authentication query while the server is still working.
    void queryClient.cancelQueries({ queryKey: ["/api/auth/user"] });
    void queryClient.cancelQueries({ queryKey: ["/api/access-locks/status"] });
    setSystemRestoreDialogOpen(false);

    setIsSystemRestoring(true);
    setUploadProgress({ stage: "uploading", percent: 0, message: "Preparing upload..." });
    
    try {
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      // Use chunked upload for files larger than one chunk, otherwise use direct upload
      if (file.size > CHUNK_SIZE) {
        // Step 1: Initialize chunked upload session
        setUploadProgress({ stage: "uploading", percent: 0, message: "Initializing upload..." });
        
        const initResponse = await fetch("/api/system/restore/init", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            totalChunks,
            clearExisting: systemClearExisting,
            sftpRestoreMode: retainLocalSftp ? "retain" : "replace",
          }),
        });
        
        if (!initResponse.ok) {
          const error = await initResponse.json();
          throw new Error(error.message || "Failed to initialize upload");
        }
        
        const { uploadId } = await initResponse.json();
        
        // Step 2: Upload chunks
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          
          const chunkFormData = new FormData();
          chunkFormData.append("chunk", chunk, file.name);
          chunkFormData.append("uploadId", uploadId);
          chunkFormData.append("chunkIndex", String(i));
          
          const percent = Math.round(((i + 1) / totalChunks) * 90); // 0-90% for upload
          setUploadProgress({ 
            stage: "uploading", 
            percent, 
            message: `Uploading chunk ${i + 1} of ${totalChunks}...` 
          });
          
          const chunkResponse = await fetch("/api/system/restore/chunk", {
            method: "POST",
            credentials: "include",
            body: chunkFormData,
          });
          
          if (!chunkResponse.ok) {
            const error = await chunkResponse.json();
            throw new Error(error.message || `Failed to upload chunk ${i + 1}`);
          }
        }
        
        // Step 3: Finalize and process
        setUploadProgress({ stage: "processing", percent: 95, message: "Processing restore..." });
        
        const finalizeResponse = await fetch("/api/system/restore/finalize", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        });
        
        const result = await finalizeResponse.json();
        
        if (!finalizeResponse.ok) {
          throw new Error(result.message || "Failed to finalize restore");
        }
        
        const incomplete = result.success === false || result.errors?.length > 0;
        setUploadProgress({ stage: "processing", percent: 100, message: incomplete ? "Restore incomplete" : "Complete!" });
        
        // Build success message
        let description: string;
        if (result.format === "pg_dump_sql" || result.format === "pg_dump_full" || result.format === "pg_dump_clean") {
          const cleanIndicator = result.format === "pg_dump_clean" ? " (clean backup)" : "";
          description = `Restored ${result.schemas?.length || 0} database schemas and ${result.filesRestored || 0} files${cleanIndicator}${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
        } else if (result.format === "project_files_only") {
          description = `Restored ${result.filesRestored || 0} project files`;
        } else if (result.format === "webapp_files_only") {
          description = `Restored ${result.filesRestored || 0} webapp files`;
        } else {
          const mainTablesCount = result.mainTablesRestored 
            ? Object.values(result.mainTablesRestored as Record<string, number>).reduce((a, b) => a + b, 0) 
            : 0;
          description = `Restored ${mainTablesCount} main database records, ${result.projectsRestored || 0} project databases, and ${result.filesRestored || 0} files${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
        }
        
        toast({
          title: incomplete ? "System Restore Incomplete" : "System Restore Completed",
          description: incomplete ? `${result.message || "Some data or files could not be restored."} ${description} Review server logs before resuming work.` : description,
          variant: incomplete ? "destructive" : "default",
        });
        systemRestoreStore.finish(incomplete ? "incomplete" : "complete",
          `${incomplete ? `${result.message || "Some data or files could not be restored."} ` : ""}${description}${result.warnings?.length ? ` ${result.warnings.length} restore warnings; review the server logs.` : ""}`);

        if (result.errors?.length > 0) {
          console.error("Restore errors:", result.errors);
        }
      } else {
        // Small file - use direct upload (original method)
        setUploadProgress({ stage: "uploading", percent: 50, message: "Uploading file..." });
        
        const formData = new FormData();
        formData.append("backup", file);
        formData.append("clearExisting", String(systemClearExisting));
        formData.append("sftpRestoreMode", retainLocalSftp ? "retain" : "replace");

        setUploadProgress({ stage: "processing", percent: 50,
          message: "Uploading backup and waiting for the server to restore it…" });
        const response = await fetch("/api/system/restore", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        setUploadProgress({ stage: "processing", percent: 90, message: "Processing restore..." });
        
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Failed to restore system backup");
        }

        const incomplete = result.success === false || result.errors?.length > 0;
        setUploadProgress({ stage: "processing", percent: 100, message: incomplete ? "Restore incomplete" : "Complete!" });

        // Handle both new SQL format and legacy JSON format responses
        let description: string;
        if (result.format === "pg_dump_sql" || result.format === "pg_dump_full" || result.format === "pg_dump_clean") {
          const cleanIndicator = result.format === "pg_dump_clean" ? " (clean backup)" : "";
          description = `Restored ${result.schemas?.length || 0} database schemas and ${result.filesRestored || 0} files${cleanIndicator}${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
        } else if (result.format === "project_files_only") {
          description = `Restored ${result.filesRestored || 0} project files`;
        } else if (result.format === "webapp_files_only") {
          description = `Restored ${result.filesRestored || 0} webapp files`;
        } else {
          const mainTablesCount = result.mainTablesRestored 
            ? Object.values(result.mainTablesRestored as Record<string, number>).reduce((a, b) => a + b, 0) 
            : 0;
          description = `Restored ${mainTablesCount} main database records, ${result.projectsRestored || 0} project databases, and ${result.filesRestored || 0} files${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
        }
        
        toast({
          title: incomplete ? "System Restore Incomplete" : "System Restore Completed",
          description: incomplete ? `${result.message || "Some data or files could not be restored."} ${description} Review server logs before resuming work.` : description,
          variant: incomplete ? "destructive" : "default",
        });
        systemRestoreStore.finish(incomplete ? "incomplete" : "complete",
          `${incomplete ? `${result.message || "Some data or files could not be restored."} ` : ""}${description}${result.warnings?.length ? ` ${result.warnings.length} restore warnings; review the server logs.` : ""}`);

        if (result.errors?.length > 0) {
          console.error("Restore errors:", result.errors);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/projects"] });
      setSystemRestoreDialogOpen(false);
    } catch (error) {
      systemRestoreStore.finish("unconfirmed",
        "The restore did not return a confirmed success. The server may still be working, or some changes may already have been applied. Check the server logs before starting another restore.");
      toast({
        title: "Restore not confirmed",
        description: error instanceof Error ? error.message : "Failed to restore system backup",
        variant: "destructive",
      });
    } finally {
      setIsSystemRestoring(false);
      setUploadProgress(null);
      if (systemFileInputRef.current) {
        systemFileInputRef.current.value = "";
      }
    }
  };

  const handleFilesBackup = async (project: ProjectWithStats) => {
    try {
      const response = await fetch(`/api/projects/${project.id}/files/backup`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create files backup");
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `files_${project.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const stats = fileStats[project.id];
      toast({
        title: "Files backup created",
        description: `Successfully backed up ${stats?.fileCount || 0} files from ${project.name}`,
      });
    } catch (error) {
      toast({
        title: "Files backup failed",
        description: error instanceof Error ? error.message : "Failed to create files backup",
        variant: "destructive",
      });
    }
  };

  const openFilesRestoreDialog = (project: ProjectWithStats) => {
    setSelectedProject(project);
    setFilesClearExisting(false);
    setFilesRestoreDialogOpen(true);
  };

  const handleFilesRestoreFileSelect = () => {
    projectFilesInputRef.current?.click();
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    setIsFilesRestoring(true);
    
    try {
      const formData = new FormData();
      formData.append("backup", file);
      formData.append("clearExisting", String(filesClearExisting));

      const response = await fetch(`/api/projects/${selectedProject.id}/files/restore`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to restore files");
      }

      toast({
        title: "Files restore completed",
        description: `Restored ${result.filesRestored} files${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`,
      });

      if (result.errors?.length > 0) {
        console.error("Files restore errors:", result.errors);
      }

      const fetchUpdatedStats = async () => {
        try {
          const response = await fetch(`/api/projects/${selectedProject.id}/files/stats`, {
            credentials: "include",
          });
          if (response.ok) {
            const stats = await response.json();
            setFileStats(prev => ({ ...prev, [selectedProject.id]: stats }));
          }
        } catch (e) {
        }
      };
      fetchUpdatedStats();
      setFilesRestoreDialogOpen(false);
    } catch (error) {
      toast({
        title: "Files restore failed",
        description: error instanceof Error ? error.message : "Failed to restore files",
        variant: "destructive",
      });
    } finally {
      setIsFilesRestoring(false);
      if (projectFilesInputRef.current) {
        projectFilesInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
      {!embedded && <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Wrench className="h-6 w-6" />
            Database Maintenance
          </h1>
          <p className="text-muted-foreground">
            Backup and restore project databases
          </p>
        </div>
        {canAccessAnyBackupRestore && (
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Stats
          </Button>
        )}
      </div>}

      {showSystem && (canSystemBackup || canSystemRestore) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              System Backup
            </CardTitle>
            <CardDescription>
              Create or restore a backup using PostgreSQL native format (pg_dump). Choose what to include in your backup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 p-4 border rounded-md bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <FolderArchive className="h-5 w-5 text-primary" />
                    <span className="font-medium">Backup Type</span>
                  </div>
                  <Select 
                    value={backupType} 
                    onValueChange={(value: "database" | "clean" | "files" | "project") => setBackupType(value)}
                    disabled={isSystemBackup}
                  >
                    <SelectTrigger className="w-full" data-testid="select-backup-type">
                      <SelectValue placeholder="Select backup type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="database" data-testid="select-item-database">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          <span>Full Database + Projects</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="clean" data-testid="select-item-clean">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4" />
                          <span>Full Clean Database No Projects or Users</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="files" data-testid="select-item-files">
                        <div className="flex items-center gap-2">
                          <FileArchive className="h-4 w-4" />
                          <span>Web App Files Only</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="project" data-testid="select-item-project">
                        <div className="flex items-center gap-2">
                          <FolderArchive className="h-4 w-4" />
                          <span>Project Files Only</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {backupType === "database" && (
                      <ul className="space-y-1 ml-1">
                        <li>Main database (users, projects, settings, groups, permissions)</li>
                        <li>All project databases ({projects.length} projects)</li>
                        <li>SQL format compatible with pg_restore</li>
                        <li>Complete database backup for full data migration</li>
                      </ul>
                    )}
                    {backupType === "clean" && (
                      <ul className="space-y-1 ml-1">
                        <li><strong>Includes:</strong> Full database schema + configuration data</li>
                        <li><strong>Configuration data:</strong> Roles, permissions, statuses, trouble codes, service types</li>
                        <li><strong>Users:</strong> Admin and file_import accounts only</li>
                        <li><strong>Disables:</strong> Cloudflare Turnstile (for easy login on fresh server)</li>
                        <li>Does NOT include projects, work orders, or other users</li>
                        <li><strong>Restore to:</strong> Empty database (no need to run migrations)</li>
                      </ul>
                    )}
                    {backupType === "files" && (
                      <ul className="space-y-1 ml-1">
                        <li>Web application source files only</li>
                        <li>Code, configuration, and scripts</li>
                        <li>Excludes: node_modules, .git, temp files</li>
                        <li>Excludes: project data files (use per-project backup)</li>
                        <li>Does not include database</li>
                      </ul>
                    )}
                    {backupType === "project" && (
                      <ul className="space-y-1 ml-1">
                        <li>Project data files only (uploads, attachments)</li>
                        <li>Work order files and documents</li>
                        <li>Does not include web app source files</li>
                        <li>Does not include database</li>
                      </ul>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 justify-center">
                  {isPermissionsLoading ? (
                    <>
                      <Skeleton className="h-9 w-40" />
                      <Skeleton className="h-9 w-40" />
                    </>
                  ) : (
                    <>
                      {canSystemBackup && (
                        <Button 
                          onClick={handleFullSystemBackup}
                          disabled={isSystemBackup}
                          data-testid="button-full-system-backup"
                        >
                          {isSystemBackup ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Creating Backup...
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-2" />
                              Download Backup
                            </>
                          )}
                        </Button>
                      )}
                      {canSystemRestore && (
                        <Button 
                          variant="outline" 
                          onClick={openSystemRestoreDialog}
                          data-testid="button-full-system-restore"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Restore from Backup
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showProjects && canAccessProjectMaintenance && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Project Databases
          </CardTitle>
          <CardDescription>
            View database statistics and perform individual project backup/restore operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InventoryMobileTools tab="backup-project-databases">
            <div className="mb-3 flex flex-col gap-2 rounded-md border bg-card p-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input aria-label="Search project databases" type="search" autoComplete="off" placeholder="Search projects" value={databaseSearch} onChange={event => setDatabaseSearch(event.target.value)} className="pl-9" />
              </div>
              <select aria-label="Filter project database status" value={databaseStatus} onChange={event => setDatabaseStatus(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">All project statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadCsv("meterflo-project-databases.csv",
                ["Project", "Status", "Database", "Records", "Size", "Last modified"],
                filteredDatabaseProjects.map(project => [project.name, project.isActive ? "Active" : "Inactive", project.databaseName || "", project.stats?.totalRecords ?? "", project.stats?.tableSize || "", project.stats?.lastModified || ""]))}
                disabled={!filteredDatabaseProjects.length}>
                <Download className="mr-1.5 h-4 w-4" /> Export CSV
              </Button>
              <p className="text-right text-xs text-muted-foreground" aria-live="polite">{filteredDatabaseProjects.length} of {projects.length}</p>
            </div>
          </InventoryMobileTools>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No projects found</p>
            </div>
          ) : filteredDatabaseProjects.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm">
              <p className="font-medium">No matching project databases</p>
              <p className="mt-1 text-muted-foreground">Adjust the search or status filter to see project records.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDatabaseProjects.map((project) => (
                  <TableRow key={project.id} data-testid={`row-project-${project.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium" data-testid={`text-project-name-${project.id}`}>
                          {project.name}
                        </span>
                        {project.isActive ? (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground truncate max-w-md">
                          {project.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {project.stats ? (
                        <div className="flex items-center gap-1">
                          <HardDrive className="h-4 w-4 text-muted-foreground" />
                          <span data-testid={`text-records-${project.id}`}>
                            {project.stats.totalRecords.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {project.stats ? (
                        <span data-testid={`text-size-${project.id}`}>{project.stats.tableSize}</span>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {project.stats?.lastModified ? (
                        <span data-testid={`text-modified-${project.id}`}>
                          {formatDateTime(project.stats.lastModified)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isPermissionsLoading ? (
                          <>
                            <Skeleton className="h-8 w-20" />
                            <Skeleton className="h-8 w-20" />
                          </>
                        ) : (
                          <>
                            {canProjectBackup && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleBackup(project)}
                                disabled={!project.databaseName}
                                data-testid={`button-backup-${project.id}`}
                              >
                                <Download className="h-4 w-4 mr-1" />
                                Backup
                              </Button>
                            )}
                            {canProjectRestore && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openRestoreDialog(project)}
                                disabled={!project.databaseName}
                                data-testid={`button-restore-${project.id}`}
                              >
                                <Upload className="h-4 w-4 mr-1" />
                                Restore
                              </Button>
                            )}
                            {!canProjectBackup && !canProjectRestore && (
                              <span className="text-muted-foreground text-sm flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                No access
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>}

      {showFiles && canAccessProjectMaintenance && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Files className="h-5 w-5" />
            Project Files
          </CardTitle>
          <CardDescription>
            View file storage statistics and perform file backup/restore operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InventoryMobileTools tab="backup-project-files">
            <div className="mb-3 flex flex-col gap-2 rounded-md border bg-card p-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input aria-label="Search project files" type="search" autoComplete="off" placeholder="Search projects" value={filesSearch} onChange={event => setFilesSearch(event.target.value)} className="pl-9" />
              </div>
              <select aria-label="Filter project files by project status" value={filesStatus} onChange={event => setFilesStatus(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">All project statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadCsv("meterflo-project-files.csv",
                ["Project", "Status", "Files", "Folders", "Total bytes", "Formatted size"],
                filteredFilesProjects.map(project => {
                  const stats = fileStats[project.id];
                  return [project.name, project.isActive ? "Active" : "Inactive", stats?.fileCount ?? "", stats?.folderCount ?? "", stats?.totalSize ?? "", stats?.sizeFormatted || ""];
                }))}
                disabled={!filteredFilesProjects.length}>
                <Download className="mr-1.5 h-4 w-4" /> Export CSV
              </Button>
              <p className="text-right text-xs text-muted-foreground" aria-live="polite">{filteredFilesProjects.length} of {projects.length}</p>
            </div>
          </InventoryMobileTools>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Files className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No projects found</p>
            </div>
          ) : filteredFilesProjects.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm">
              <p className="font-medium">No matching project files</p>
              <p className="mt-1 text-muted-foreground">Adjust the search or status filter to see project files.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Folders</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFilesProjects.map((project) => {
                  const stats = fileStats[project.id];
                  return (
                    <TableRow key={project.id} data-testid={`row-files-${project.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid={`text-files-project-name-${project.id}`}>
                            {project.name}
                          </span>
                          {project.isActive ? (
                            <Badge variant="default" className="text-xs">Active</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {stats ? (
                          <div className="flex items-center gap-1">
                            <FileArchive className="h-4 w-4 text-muted-foreground" />
                            <span data-testid={`text-file-count-${project.id}`}>
                              {stats.fileCount.toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <Skeleton className="h-4 w-12" />
                        )}
                      </TableCell>
                      <TableCell>
                        {stats ? (
                          <div className="flex items-center gap-1">
                            <Folder className="h-4 w-4 text-muted-foreground" />
                            <span data-testid={`text-folder-count-${project.id}`}>
                              {stats.folderCount.toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <Skeleton className="h-4 w-12" />
                        )}
                      </TableCell>
                      <TableCell>
                        {stats ? (
                          <span data-testid={`text-file-size-${project.id}`}>{stats.sizeFormatted}</span>
                        ) : (
                          <Skeleton className="h-4 w-16" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isPermissionsLoading ? (
                            <>
                              <Skeleton className="h-8 w-20" />
                              <Skeleton className="h-8 w-20" />
                            </>
                          ) : (
                            <>
                              {canProjectBackup && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleFilesBackup(project)}
                                  disabled={!stats?.exists}
                                  data-testid={`button-files-backup-${project.id}`}
                                >
                                  <Download className="h-4 w-4 mr-1" />
                                  Backup
                                </Button>
                              )}
                              {canProjectRestore && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openFilesRestoreDialog(project)}
                                  data-testid={`button-files-restore-${project.id}`}
                                >
                                  <Upload className="h-4 w-4 mr-1" />
                                  Restore
                                </Button>
                              )}
                              {!canProjectBackup && !canProjectRestore && (
                                <span className="text-muted-foreground text-sm flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  No access
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>}

      {showProjects && <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent onCloseAutoFocus={event => { if (!active) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Restore Database
            </DialogTitle>
            <DialogDescription>
              Restore work orders from a backup file to {selectedProject?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">
                Restoring a backup will add work orders to the database. Use the option below to
                clear existing data first if you want a complete replacement.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="clear-existing"
                checked={clearExisting}
                onCheckedChange={(checked) => setClearExisting(checked === true)}
                data-testid="checkbox-clear-existing"
              />
              <Label htmlFor="clear-existing" className="text-sm font-medium">
                Clear existing data before restore
              </Label>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json"
              onChange={handleFileChange}
              data-testid="input-restore-file"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreDialogOpen(false)}
              data-testid="button-cancel-restore"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRestoreFileSelect}
              disabled={isRestoring}
              data-testid="button-select-file"
            >
              {isRestoring ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Select Backup File
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {showSystem && <Dialog open={systemRestoreDialogOpen} onOpenChange={setSystemRestoreDialogOpen}>
        <DialogContent onCloseAutoFocus={event => { if (!active) event.preventDefault(); }} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Restore System Backup
            </DialogTitle>
            <DialogDescription>
              Restore from a backup archive (full database or clean database)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <label className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox checked={retainLocalSftp} onCheckedChange={value => setRetainLocalSftp(value === true)} />
              <span className="text-sm"><span className="block font-medium">Retain this instance's SFTP setup</span>
                <span className="text-muted-foreground">Recommended when restoring a Replit backup onto Windows/Linux. Keep local connection settings and accounts whose original projects still match. Uncheck to replace them with the backup's setup. SFTP remains paused until an administrator reviews and enables it; existing revocations and expiry still apply. The local SSH host key is never replaced.</span>
              </span>
            </label>
            <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">
                This will restore database tables from the backup file.
                For full backups, this includes all users, projects, and work orders.
                For clean backups, this clears projects, users (except admin and file_import), user groups, system types, module types, and disables Cloudflare Turnstile.
                Legacy JSON database restores roll back public and project data together if any project fails.
                Files are restored separately; an incomplete file restore does not undo the database restore.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="system-clear-existing"
                  checked={systemClearExisting}
                  onCheckedChange={(checked) => setSystemClearExisting(checked === true)}
                  data-testid="checkbox-system-clear-existing"
                />
                <Label htmlFor="system-clear-existing" className="text-sm font-medium">
                  Clear existing data before restore (recommended for full replacement)
                </Label>
              </div>

            </div>

            <input
              type="file"
              ref={systemFileInputRef}
              className="hidden"
              accept=".zip,.sql"
              onChange={handleSystemFileChange}
              data-testid="input-system-restore-file"
            />

            {uploadProgress && (
              <div className="space-y-2 p-4 rounded-md bg-muted">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {uploadProgress.stage === "uploading" ? "Uploading" : "Processing"}
                  </span>
                  <span className="text-muted-foreground">{uploadProgress.percent}%</span>
                </div>
                <Progress value={uploadProgress.percent} className="h-2" />
                <p className="text-xs text-muted-foreground">{uploadProgress.message}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSystemRestoreDialogOpen(false)}
              disabled={isSystemRestoring}
              data-testid="button-cancel-system-restore"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSystemRestoreFileSelect}
              disabled={isSystemRestoring}
              data-testid="button-select-system-file"
            >
              {isSystemRestoring ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Restoring System...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Select Backup Archive
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {showFiles && <Dialog open={filesRestoreDialogOpen} onOpenChange={setFilesRestoreDialogOpen}>
        <DialogContent onCloseAutoFocus={event => { if (!active) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Files className="h-5 w-5" />
              Restore Project Files
            </DialogTitle>
            <DialogDescription>
              Restore files from a backup archive to {selectedProject?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">
                Restoring files will add files to the project folder. Use the option below to
                clear existing files first if you want a complete replacement.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="files-clear-existing"
                checked={filesClearExisting}
                onCheckedChange={(checked) => setFilesClearExisting(checked === true)}
                data-testid="checkbox-files-clear-existing"
              />
              <Label htmlFor="files-clear-existing" className="text-sm font-medium">
                Clear existing files before restore
              </Label>
            </div>

            <input
              type="file"
              ref={projectFilesInputRef}
              className="hidden"
              accept=".zip"
              onChange={handleFilesChange}
              data-testid="input-files-restore"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFilesRestoreDialogOpen(false)}
              data-testid="button-cancel-files-restore"
            >
              Cancel
            </Button>
            <Button
              onClick={handleFilesRestoreFileSelect}
              disabled={isFilesRestoring}
              data-testid="button-select-files"
            >
              {isFilesRestoring ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Select Backup Archive
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

export default function Maintenance({ embedded = false, active = true }: { embedded?: boolean; active?: boolean }) {
  const { hasPermission, isLoading } = usePermissions();
  const canSystemBackup = !isLoading && hasPermission("maintenance.systemBackup");
  const canSystemRestore = !isLoading && hasPermission("maintenance.systemRestore");
  const canProjects = !isLoading && (hasPermission("maintenance.projectBackup") || hasPermission("maintenance.projectRestore"));
  const [section, setSection] = useState<"backup" | "system" | "projects" | "files">("backup");

  const renderManual = (manualSection: "system" | "projects" | "files") => (
    <ManualMaintenance embedded active={active && section === manualSection} section={manualSection} />
  );

  return (
    <div className={embedded ? "space-y-4" : "p-4 sm:p-6 space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Backup &amp; Restore</h1>
            <p className="text-sm text-muted-foreground">Protect MeterFlo data and recover it when needed.</p>
          </div>
        </div>
      )}
      <BackupWorkspace
        active={active && section === "backup"}
        canManage={canSystemBackup}
        onSectionChange={setSection}
        showSystemManual={canSystemBackup || canSystemRestore}
        showProjects={canProjects}
        renderManual={renderManual}
      />
    </div>
  );
}
