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
} from "lucide-react";
import { format } from "date-fns";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const { data: projects = [], isLoading, refetch } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/maintenance/projects"],
  });

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
            <Database className="h-5 w-5" />
            Project Databases
          </CardTitle>
          <CardDescription>
            View database statistics and perform backup/restore operations
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
                          {format(new Date(project.stats.lastModified), "MMM d, yyyy h:mm a")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
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
    </div>
  );
}
