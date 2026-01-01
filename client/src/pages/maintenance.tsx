import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { useTimezone } from "@/hooks/use-timezone";
import { usePermissions } from "@/hooks/usePermissions";
import type { Project } from "@shared/schema";

interface ProjectWithStats extends Project {
  stats: {
    totalRecords: number;
    tableSize: string;
    lastModified: string | null;
  } | null;
}

export default function Maintenance() {
  const { toast } = useToast();
  const { formatDateTime } = useTimezone();
  const { hasPermission, isLoading: isPermissionsLoading } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const systemFileInputRef = useRef<HTMLInputElement>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [systemRestoreDialogOpen, setSystemRestoreDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [systemClearExisting, setSystemClearExisting] = useState(false);
  const [restoreFiles, setRestoreFiles] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSystemBackup, setIsSystemBackup] = useState(false);
  const [isSystemRestoring, setIsSystemRestoring] = useState(false);

  const { data: projects = [], isLoading, refetch } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/maintenance/projects"],
  });

  const canProjectBackup = !isPermissionsLoading && hasPermission("maintenance.projectBackup");
  const canProjectRestore = !isPermissionsLoading && hasPermission("maintenance.projectRestore");
  const canSystemBackup = !isPermissionsLoading && hasPermission("maintenance.systemBackup");
  const canSystemRestore = !isPermissionsLoading && hasPermission("maintenance.systemRestore");

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
      const response = await fetch("/api/system/backup", {
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create full system backup");
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `full_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Full System Backup Created",
        description: "Successfully backed up all databases and project files",
      });
    } catch (error) {
      toast({
        title: "Backup failed",
        description: error instanceof Error ? error.message : "Failed to create full system backup",
        variant: "destructive",
      });
    } finally {
      setIsSystemBackup(false);
    }
  };

  const openSystemRestoreDialog = () => {
    setSystemClearExisting(false);
    setRestoreFiles(true);
    setSystemRestoreDialogOpen(true);
  };

  const handleSystemRestoreFileSelect = () => {
    systemFileInputRef.current?.click();
  };

  const handleSystemFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSystemRestoring(true);
    
    try {
      const formData = new FormData();
      formData.append("backup", file);
      formData.append("clearExisting", String(systemClearExisting));
      formData.append("restoreFiles", String(restoreFiles));

      const response = await fetch("/api/system/restore", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to restore full system backup");
      }

      // Handle both new SQL format and legacy JSON format responses
      let description: string;
      if (result.format === "pg_dump_sql") {
        // New SQL format
        description = `Restored ${result.schemas?.length || 0} database schemas and ${result.filesRestored || 0} files${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
      } else {
        // Legacy JSON format
        const mainTablesCount = result.mainTablesRestored 
          ? Object.values(result.mainTablesRestored as Record<string, number>).reduce((a, b) => a + b, 0) 
          : 0;
        description = `Restored ${mainTablesCount} main database records, ${result.projectsRestored || 0} project databases, and ${result.filesRestored || 0} files${result.errors?.length > 0 ? ` with ${result.errors.length} errors` : ""}`;
      }
      
      toast({
        title: "Full System Restore Completed",
        description,
      });

      if (result.errors?.length > 0) {
        console.error("Restore errors:", result.errors);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/projects"] });
      setSystemRestoreDialogOpen(false);
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Failed to restore full system backup",
        variant: "destructive",
      });
    } finally {
      setIsSystemRestoring(false);
      if (systemFileInputRef.current) {
        systemFileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Wrench className="h-6 w-6" />
            Database Maintenance
          </h1>
          <p className="text-muted-foreground">
            Backup and restore project databases
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Stats
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Full System Backup
          </CardTitle>
          <CardDescription>
            Create or restore a complete backup using PostgreSQL native format (pg_dump). Supports foreign key constraints and can be restored to another PostgreSQL instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 p-4 border rounded-md bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <FolderArchive className="h-5 w-5 text-primary" />
                <span className="font-medium">Backup Contents</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 ml-7">
                <li>Main database (users, projects, settings, groups, permissions)</li>
                <li>All project databases ({projects.length} projects)</li>
                <li>All project files and documents</li>
                <li>SQL format compatible with pg_restore</li>
              </ul>
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
                          Download Full Backup
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
                  {!canSystemBackup && !canSystemRestore && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Lock className="h-4 w-4" />
                      <span>No permissions for system backup/restore</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
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
                {projects.map((project) => (
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
      </Card>

      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
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
      </Dialog>

      <Dialog open={systemRestoreDialogOpen} onOpenChange={setSystemRestoreDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Restore Full System Backup
            </DialogTitle>
            <DialogDescription>
              Restore the entire system from a backup archive
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">
                This will restore the main database, all project databases, and optionally all project files.
                This is a major operation that may overwrite existing data.
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

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="restore-files"
                  checked={restoreFiles}
                  onCheckedChange={(checked) => setRestoreFiles(checked === true)}
                  data-testid="checkbox-restore-files"
                />
                <Label htmlFor="restore-files" className="text-sm font-medium">
                  Restore project files and documents
                </Label>
              </div>
            </div>

            <input
              type="file"
              ref={systemFileInputRef}
              className="hidden"
              accept=".zip"
              onChange={handleSystemFileChange}
              data-testid="input-system-restore-file"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSystemRestoreDialogOpen(false)}
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
      </Dialog>
    </div>
  );
}
