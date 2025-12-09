import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Upload, FileText, Check, AlertCircle, Loader2 } from "lucide-react";

export default function Import() {
  const { toast } = useToast();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);

  const importMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/import/work-orders", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setImportResult(data);
      toast({ title: "Import Complete", description: `Successfully imported ${data.success} work orders` });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === "application/json" || droppedFile.name.endsWith(".csv") || droppedFile.name.endsWith(".json")) {
        setFile(droppedFile);
        setImportResult(null);
      } else {
        toast({ title: "Invalid File", description: "Please upload a CSV or JSON file", variant: "destructive" });
      }
    }
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setImportResult(null);
    }
  };

  const handleImport = () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    importMutation.mutate(formData);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="text-import-title">Import Data</h1>
        <p className="text-muted-foreground mt-1">Upload work orders from CSV or JSON files</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
          <CardDescription>Drag and drop a file or click to browse. Supported formats: CSV, JSON</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            data-testid="dropzone"
          >
            <input
              type="file"
              accept=".csv,.json"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
              data-testid="input-file"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Drop your file here, or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">CSV or JSON files up to 10MB</p>
                </div>
              </div>
            </label>
          </div>

          {file && (
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium" data-testid="text-filename">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <Button onClick={handleImport} disabled={importMutation.isPending} data-testid="button-import">
                {importMutation.isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</>) : "Import"}
              </Button>
            </div>
          )}

          {importResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
                <Check className="h-5 w-5 text-green-600" />
                <p className="text-green-700 dark:text-green-400" data-testid="text-success">
                  Successfully imported {importResult.success} work orders
                </p>
              </div>
              {importResult.errors.length > 0 && (
                <div className="p-4 bg-destructive/10 rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <p className="font-medium text-destructive">Errors ({importResult.errors.length})</p>
                  </div>
                  <ul className="list-disc list-inside text-sm text-destructive space-y-1">
                    {importResult.errors.slice(0, 5).map((err, i) => (<li key={i}>{err}</li>))}
                    {importResult.errors.length > 5 && (<li>...and {importResult.errors.length - 5} more errors</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="pt-4 border-t">
            <h3 className="font-medium mb-2">Expected Format</h3>
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-2">CSV columns or JSON fields:</p>
              <code className="text-xs font-mono">title, description, status, priority, projectId, dueDate, notes</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
