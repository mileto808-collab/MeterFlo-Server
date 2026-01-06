import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, File, Trash2, ArrowLeft, ShieldAlert, Download, FolderSync, RefreshCw } from "lucide-react";
import type { Project } from "@shared/schema";
import { useTimezone } from "@/hooks/use-timezone";

interface FtpFile {
  name: string;
  size: number;
  modifiedAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function ProjectFtpFiles() {
  const { formatDateTime } = useTimezone();
  const [, params] = useRoute("/projects/:projectId/ftp-files");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [accessDeniedForProject, setAccessDeniedForProject] = useState<number | null>(null);
  const accessDenied = accessDeniedForProject === projectId;

  const { data: project, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: files = [], isLoading, error: filesError, refetch } = useQuery<FtpFile[]>({
    queryKey: [`/api/projects/${projectId}/ftp-files`],
    enabled: !!projectId && !accessDenied,
    retry: false,
  });

  useEffect(() => {
    const error = projectError || filesError;
    if (error) {
      const errorMsg = (error as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDeniedForProject(projectId);
      }
    }
  }, [projectError, filesError]);

  const uploadFile = async (file: File) => {
    if (accessDenied) {
      toast({ title: "Access denied", variant: "destructive" });
      return;
    }
    
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/ftp-files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (response.status === 403) {
        setAccessDeniedForProject(projectId);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
        return;
      }
      
      if (!response.ok) {
        const data = await response.json();
        toast({ title: data.message || "Upload failed", variant: "destructive" });
        return;
      }
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/ftp-files`] });
      toast({ title: "File uploaded successfully" });
    } catch (error) {
      toast({ title: "Failed to upload file", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (filename: string) => {
    if (accessDenied) {
      toast({ title: "Access denied", variant: "destructive" });
      return;
    }
    
    try {
      const response = await fetch(`/api/projects/${projectId}/ftp-files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        credentials: "include",
      });
      
      if (response.status === 403) {
        toast({ title: "Access denied", description: "Admin access required", variant: "destructive" });
        return;
      }
      
      if (!response.ok) {
        throw new Error("Delete failed");
      }
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/ftp-files`] });
      toast({ title: "File deleted" });
    } catch (error) {
      toast({ title: "Failed to delete file", variant: "destructive" });
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadFile(file);
      event.target.value = "";
    }
  };

  const role = user?.role || "user";

  if (!projectId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Invalid project ID</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="p-6 space-y-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access this project's FTP files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            FTP Files - {project?.name || "Loading..."}
          </h1>
          <p className="text-muted-foreground">
            Files in this directory can be automatically processed by scheduled file imports
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <FolderSync className="h-5 w-5" />
              <CardTitle>Project FTP Files</CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh-files"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".csv,.xlsx,.xls,.txt"
                onChange={handleFileChange}
                data-testid="input-file-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-upload-file"
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? "Uploading..." : "Upload File"}
              </Button>
            </div>
          </div>
          <CardDescription>
            Upload CSV or Excel files here for scheduled import processing. The latest file in this directory will be picked up by the file import scheduler.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FolderSync className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No files in FTP directory</p>
              <p className="text-sm">Upload CSV or Excel files to be processed by scheduled imports</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.name} data-testid={`row-file-${file.name}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <File className="h-4 w-4 text-muted-foreground" />
                        {file.name}
                      </div>
                    </TableCell>
                    <TableCell>{formatFileSize(file.size)}</TableCell>
                    <TableCell>
                      {formatDateTime(file.modifiedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/projects/${projectId}/ftp-files/${encodeURIComponent(file.name)}/download`}
                          download
                        >
                          <Button variant="ghost" size="icon" data-testid={`button-download-${file.name}`}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </a>
                        {role === "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteFile(file.name)}
                            data-testid={`button-delete-${file.name}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
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

      <Card>
        <CardHeader>
          <CardTitle>How FTP File Import Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. Upload CSV or Excel files to this directory manually or via external FTP/SFTP tools.</p>
          <p>2. Configure a scheduled file import in the File Import page with column mapping and schedule.</p>
          <p>3. The scheduler will automatically pick up the latest file in this directory and process it to create work orders.</p>
          <p>4. After processing, the import history will show the results and any errors.</p>
        </CardContent>
      </Card>
    </div>
  );
}
