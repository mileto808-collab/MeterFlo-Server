import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FileUp, CheckCircle, AlertCircle, ShieldAlert } from "lucide-react";
import type { Project } from "@shared/schema";

export default function ProjectImport() {
  const [, params] = useRoute("/projects/:projectId/import");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [jsonInput, setJsonInput] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

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

  const handleImport = () => {
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
            onClick={handleImport}
            disabled={!jsonInput.trim() || importMutation.isPending}
            data-testid="button-import"
          >
            <FileUp className="h-4 w-4 mr-2" />
            {importMutation.isPending ? "Importing..." : "Import Work Orders"}
          </Button>
        </CardContent>
      </Card>

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
    </div>
  );
}
