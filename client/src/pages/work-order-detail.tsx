import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import type { WorkOrder, Project, User } from "@shared/schema";
import { ArrowLeft, Edit, Calendar, User as UserIcon, FolderOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTimezone } from "@/hooks/use-timezone";

export default function WorkOrderDetail() {
  const [, params] = useRoute("/work-orders/:id");
  const id = params?.id;

  const { user } = useAuth();
  const { formatDate, formatDateTime } = useTimezone();
  const role = user?.role || "user";

  const { data: workOrder, isLoading } = useQuery<WorkOrder>({
    queryKey: ["/api/work-orders", id],
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: role === "admin",
  });

  const getProjectName = (projectId: number | null) => {
    if (!projectId || !projects) return "No project assigned";
    const project = projects.find((p) => p.id === projectId);
    return project?.name || "Unknown project";
  };

  const getAssigneeName = (assigneeId: string | null) => {
    if (!assigneeId || !users) return "Unassigned";
    const assignee = users.find((u) => u.id === assigneeId);
    if (!assignee) return "Unknown user";
    return assignee.firstName && assignee.lastName
      ? `${assignee.firstName} ${assignee.lastName}`
      : assignee.email || assignee.id;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
      case "in_progress":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
      case "completed":
        return "bg-green-500/10 text-green-600 dark:text-green-400";
      case "cancelled":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-500/10 text-red-600 dark:text-red-400";
      case "high":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
      case "medium":
        return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
      case "low":
        return "bg-green-500/10 text-green-600 dark:text-green-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const canEdit = role === "admin" || role === "user";

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/work-orders">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">Work Order Not Found</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              The requested work order could not be found.
            </p>
            <Link href="/work-orders">
              <Button className="mt-4" data-testid="button-back-to-list">
                Back to Work Orders
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-4">
          <Link href="/work-orders">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold" data-testid="text-work-order-title">
                {workOrder.title}
              </h1>
              <Badge
                variant="secondary"
                className={`${getStatusColor(workOrder.status)} capitalize`}
              >
                {workOrder.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Work Order #{workOrder.id}
            </p>
          </div>
        </div>
        {canEdit && (
          <Link href={`/work-orders/${workOrder.id}/edit`}>
            <Button data-testid="button-edit">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Description
                </h3>
                <p className="text-sm" data-testid="text-description">
                  {workOrder.description || "No description provided"}
                </p>
              </div>

              {workOrder.notes && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-notes">
                    {workOrder.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {workOrder.attachments && workOrder.attachments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Attachments</CardTitle>
                <CardDescription>
                  {workOrder.attachments.length} file(s) attached
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {workOrder.attachments.map((attachment, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-md bg-muted"
                    >
                      <span className="text-sm">{attachment}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Badge
                  variant="secondary"
                  className={`${getPriorityColor(workOrder.priority)} capitalize`}
                >
                  {workOrder.priority} priority
                </Badge>
              </div>

              <Separator />

              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Project</p>
                  <p className="text-sm font-medium" data-testid="text-project">
                    {getProjectName(workOrder.projectId)}
                  </p>
                </div>
              </div>

              {role === "admin" && (
                <div className="flex items-center gap-3">
                  <UserIcon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Assigned To</p>
                    <p className="text-sm font-medium" data-testid="text-assignee">
                      {getAssigneeName(workOrder.assignedTo)}
                    </p>
                  </div>
                </div>
              )}

              {workOrder.dueDate && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Due Date</p>
                    <p className="text-sm font-medium" data-testid="text-due-date">
                      {formatDate(workOrder.dueDate)}
                    </p>
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="text-sm font-medium" data-testid="text-created">
                    {workOrder.createdAt
                      ? formatDistanceToNow(new Date(workOrder.createdAt), {
                          addSuffix: true,
                        })
                      : "Unknown"}
                  </p>
                </div>
              </div>

              {workOrder.completedAt && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-green-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">
                      {formatDateTime(workOrder.completedAt)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
