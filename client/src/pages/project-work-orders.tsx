import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardList, AlertCircle, Upload, Trash2, ShieldAlert } from "lucide-react";
import type { Project } from "@shared/schema";
import type { ProjectWorkOrder } from "../../../server/projectDb";

const workOrderFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  notes: z.string().optional(),
});

type WorkOrderFormData = z.infer<typeof workOrderFormSchema>;

export default function ProjectWorkOrders() {
  const [, params] = useRoute("/projects/:projectId/work-orders");
  const projectId = params?.projectId ? parseInt(params.projectId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const form = useForm<WorkOrderFormData>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      notes: "",
    },
  });

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
    retry: false,
  });

  const { data: workOrders = [], isLoading: workOrdersLoading, error: workOrdersError } = useQuery<ProjectWorkOrder[]>({
    queryKey: [`/api/projects/${projectId}/work-orders`],
    enabled: !!projectId && !accessDenied,
    retry: false,
  });

  const { data: stats, error: statsError } = useQuery<{ pending: number; inProgress: number; completed: number; total: number }>({
    queryKey: [`/api/projects/${projectId}/work-orders/stats`],
    enabled: !!projectId && !accessDenied,
    retry: false,
  });

  useEffect(() => {
    const error = projectError || workOrdersError || statsError;
    if (error) {
      const errorMsg = (error as any).message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
      }
    }
  }, [projectError, workOrdersError, statsError]);

  const createMutation = useMutation({
    mutationFn: async (data: WorkOrderFormData) => {
      if (accessDenied) throw new Error("403: Access denied");
      return apiRequest("POST", `/api/projects/${projectId}/work-orders`, {
        ...data,
        status: "pending",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      setIsCreateOpen(false);
      form.reset();
      toast({ title: "Work order created" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", description: "You are not assigned to this project", variant: "destructive" });
      } else {
        toast({ title: "Failed to create work order", variant: "destructive" });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; status?: string; priority?: string }) => {
      if (accessDenied) throw new Error("403: Access denied");
      return apiRequest("PATCH", `/api/projects/${projectId}/work-orders/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      toast({ title: "Work order updated" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", variant: "destructive" });
      } else {
        toast({ title: "Failed to update work order", variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (accessDenied) throw new Error("403: Access denied");
      return apiRequest("DELETE", `/api/projects/${projectId}/work-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders/stats`] });
      toast({ title: "Work order deleted" });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "";
      if (errorMsg.startsWith("403:") || errorMsg.includes("403")) {
        setAccessDenied(true);
        toast({ title: "Access denied", variant: "destructive" });
      } else {
        toast({ title: "Failed to delete work order", variant: "destructive" });
      }
    },
  });

  const onSubmit = (data: WorkOrderFormData) => {
    createMutation.mutate(data);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline">Pending</Badge>;
      case "in_progress":
        return <Badge variant="default">In Progress</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return <Badge variant="destructive">Urgent</Badge>;
      case "high":
        return <Badge variant="default">High</Badge>;
      case "medium":
        return <Badge variant="secondary">Medium</Badge>;
      case "low":
        return <Badge variant="outline">Low</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
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

  if (projectLoading || workOrdersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-project-title">{project?.name}</h1>
          <p className="text-muted-foreground">Work Orders</p>
        </div>
        {user?.role !== "customer" && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-work-order">
                <Plus className="h-4 w-4 mr-2" />
                New Work Order
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Work Order</DialogTitle>
                <DialogDescription>Add a new work order to this project</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Work order title"
                            data-testid="input-work-order-title"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Work order description"
                            data-testid="input-work-order-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-work-order-priority">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      data-testid="button-submit-work-order"
                    >
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-pending">{stats.pending}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>In Progress</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-in-progress">{stats.inProgress}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-completed">{stats.completed}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl" data-testid="stat-total">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {workOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No work orders yet</p>
            {user?.role !== "customer" && (
              <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Work Order
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {workOrders.map((workOrder) => (
            <Card key={workOrder.id} data-testid={`card-work-order-${workOrder.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{workOrder.title}</CardTitle>
                    {workOrder.description && (
                      <CardDescription className="mt-1">{workOrder.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {getStatusBadge(workOrder.status)}
                    {getPriorityBadge(workOrder.priority)}
                  </div>
                </div>
              </CardHeader>
              {user?.role !== "customer" && (
                <CardFooter className="flex gap-2 flex-wrap">
                  <Select
                    value={workOrder.status}
                    onValueChange={(value) => updateMutation.mutate({ id: workOrder.id, status: value })}
                  >
                    <SelectTrigger className="w-[140px]" data-testid={`select-status-${workOrder.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Link href={`/projects/${projectId}/work-orders/${workOrder.id}/files`}>
                    <Button variant="outline" size="sm">
                      <Upload className="h-4 w-4 mr-2" />
                      Files
                    </Button>
                  </Link>
                  {user?.role === "admin" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(workOrder.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${workOrder.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardFooter>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
