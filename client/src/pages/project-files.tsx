import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, File, Trash2, ArrowLeft, ShieldAlert, Download, Folder, List, Grid, Image as ImageIcon, Eye, MoreVertical } from "lucide-react";
import type { Project } from "@shared/schema";
import { useTimezone } from "@/hooks/use-timezone";

type ViewMode = "list" | "thumbnail";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff"];

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return IMAGE_EXTENSIONS.includes(ext);
}

interface ProjectFile {
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

export default function ProjectFiles() {
  const { formatDateTime } = useTimezone();
  const [, params] = useRoute("/projects/:projectId/files");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [accessDeniedForProject, setAccessDeniedForProject] = useState<number | null>(null);
  const accessDenied = accessDeniedForProject === projectId;
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const { data: project, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: files = [], isLoading, error: filesError } = useQuery<ProjectFile[]>({
    queryKey: [`/api/projects/${projectId}/files`],
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

  const getDownloadUrl = (filename: string) => {
    return `/api/projects/${projectId}/files/${encodeURIComponent(filename)}/download`;
  };

  const viewFile = (filename: string) => {
    window.open(getDownloadUrl(filename) + "?mode=view", "_blank");
  };

  const downloadFile = (filename: string) => {
    const link = document.createElement("a");
    link.href = getDownloadUrl(filename);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const uploadFile = async (file: File) => {
    if (accessDenied) {
      toast({ title: "Access denied", variant: "destructive" });
      return;
    }
    
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
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
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files`] });
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
      const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}`, {
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
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files`] });
      toast({ title: "File deleted" });
    } catch (error) {
      toast({ title: "Failed to delete file", variant: "destructive" });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    event.target.value = "";
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Invalid project</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ShieldAlert className="h-16 w-16 text-destructive" />
          <h2 className="text-2xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground max-w-md">
            You don't have permission to access files for this project.
            Please contact an administrator if you believe this is an error.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const canUpload = user?.role === "admin" || user?.role === "user";
  const canDelete = user?.role === "admin";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/projects/${projectId}/work-orders`}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Project Documents</h1>
          <p className="text-muted-foreground">
            {project?.name || "Loading..."} - Project-level files
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Project Files</CardTitle>
              <CardDescription>Documents shared across the entire project</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="icon"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "thumbnail" ? "default" : "ghost"}
                size="icon"
                onClick={() => setViewMode("thumbnail")}
                data-testid="button-view-thumbnail"
              >
                <Grid className="h-4 w-4" />
              </Button>
            </div>
            {canUpload && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileSelect}
                  data-testid="input-file-upload"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-upload"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Uploading..." : "Upload File"}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-muted-foreground">Loading files...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <File className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No files uploaded yet</p>
              {canUpload && (
                <p className="text-sm text-muted-foreground">
                  Click "Upload File" to add your first document
                </p>
              )}
            </div>
          ) : viewMode === "list" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead className="w-32">Size</TableHead>
                  <TableHead className="w-44">Modified</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow 
                    key={file.name} 
                    data-testid={`row-file-${file.name}`}
                  >
                    <TableCell className="font-medium">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-2 hover-elevate rounded-md p-1 -m-1 cursor-pointer w-full text-left">
                            {isImageFile(file.name) ? (
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <File className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span data-testid={`text-filename-${file.name}`}>{file.name}</span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => viewFile(file.name)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadFile(file.name)}>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatFileSize(file.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(file.modifiedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${file.name}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => viewFile(file.name)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadFile(file.name)}>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                          {canDelete && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => deleteFile(file.name)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {files.map((file) => (
                <DropdownMenu key={file.name}>
                  <DropdownMenuTrigger asChild>
                    <div
                      className="relative group flex flex-col items-center p-3 rounded-md border hover-elevate cursor-pointer"
                      data-testid={`thumbnail-item-${file.name}`}
                    >
                      <div className="w-full aspect-square flex items-center justify-center bg-muted rounded-md overflow-hidden mb-2">
                        {isImageFile(file.name) ? (
                          <img
                            src={getDownloadUrl(file.name)}
                            alt={file.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <File className="h-12 w-12 text-muted-foreground" />
                        )}
                      </div>
                      <span className="text-xs text-center truncate w-full" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => viewFile(file.name)}>
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadFile(file.name)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </DropdownMenuItem>
                    {canDelete && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteFile(file.name)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
