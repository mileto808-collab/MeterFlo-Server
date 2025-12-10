import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, File, Trash2, ArrowLeft, ShieldAlert } from "lucide-react";
import type { Project } from "@shared/schema";

export default function WorkOrderFiles() {
  const [, params] = useRoute("/projects/:projectId/work-orders/:workOrderId/files");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const workOrderId = params?.workOrderId ? parseInt(params.workOrderId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const { data: project, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: files = [], isLoading, error: filesError } = useQuery<string[]>({
    queryKey: [`/api/projects/${projectId}/work-orders/${workOrderId}/files`],
    enabled: !!projectId && !!workOrderId && !accessDenied,
    retry: false,
  });

  useEffect(() => {
    const error = projectError || filesError;
    if (error) {
      const errorMsg = (error as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
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
      const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrderId}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (response.status === 403) {
        setAccessDenied(true);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
        return;
      }
      
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/${workOrderId}/files`] });
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
      const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrderId}/files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        credentials: "include",
      });
      
      if (response.status === 403) {
        setAccessDenied(true);
        toast({ title: "Access denied", variant: "destructive" });
        return;
      }
      
      if (!response.ok) {
        throw new Error("Delete failed");
      }
      
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/${workOrderId}/files`] });
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

  if (!projectId || !workOrderId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Invalid work order</p>
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

  if (user?.role === "customer") {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">You do not have permission to manage files</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href={`/projects/${projectId}/work-orders`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Work Orders
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Work Order Files</h1>
        <p className="text-muted-foreground">Project: {project?.name} | Work Order #{workOrderId}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Files
          </CardTitle>
          <CardDescription>
            Add files to this work order
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="button-upload-file"
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Uploading..." : "Select File"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            {files.length} file{files.length !== 1 ? "s" : ""} attached
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading files...</p>
          ) : files.length === 0 ? (
            <p className="text-muted-foreground">No files uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {files.map((filename) => (
                <div
                  key={filename}
                  className="flex items-center justify-between p-3 rounded-md border"
                  data-testid={`file-item-${filename}`}
                >
                  <div className="flex items-center gap-3">
                    <File className="h-5 w-5 text-muted-foreground" />
                    <span className="truncate">{filename}</span>
                  </div>
                  {user?.role === "admin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteFile(filename)}
                      data-testid={`button-delete-file-${filename}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
