import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { WorkOrder, Project, User } from "@shared/schema";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  TrendingUp,
  Users,
  FolderOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role || "user";

  const { data: workOrders, isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: role !== "customer",
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: role === "admin",
  });

  const stats = {
    total: workOrders?.length || 0,
    pending: workOrders?.filter((w) => w.status === "pending").length || 0,
    inProgress: workOrders?.filter((w) => w.status === "in_progress").length || 0,
    completed: workOrders?.filter((w) => w.status === "completed").length || 0,
  };

  const recentWorkOrders = workOrders
    ?.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5);

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold" data-testid="text-dashboard-title">
          {role === "customer" ? "My Work Orders" : "Dashboard"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {role === "customer"
            ? "View completed work orders for your project"
            : "Overview of your work order management system"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card data-testid="card-stat-total">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Work Orders
            </CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {workOrdersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold">{stats.total}</div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-pending">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {workOrdersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {stats.pending}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-in-progress">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              In Progress
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {workOrdersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {stats.inProgress}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-stat-completed">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {workOrdersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {stats.completed}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {role === "admin" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card data-testid="card-stat-projects">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Projects
              </CardTitle>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-bold">{projects?.length || 0}</div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-users">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Users
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-bold">{users?.length || 0}</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-recent-work-orders">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Recent Work Orders</CardTitle>
              <CardDescription>Latest activity in the system</CardDescription>
            </div>
            {role !== "customer" && (
              <Link href="/work-orders/new">
                <Button size="sm" data-testid="button-new-work-order-quick">
                  <Plus className="h-4 w-4 mr-1" />
                  New
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {workOrdersLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-md" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentWorkOrders && recentWorkOrders.length > 0 ? (
              <div className="space-y-4">
                {recentWorkOrders.map((workOrder) => (
                  <Link
                    key={workOrder.id}
                    href={`/work-orders/${workOrder.id}`}
                    className="flex items-start gap-4 p-3 rounded-md hover-elevate cursor-pointer"
                    data-testid={`link-work-order-${workOrder.id}`}
                  >
                    <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <ClipboardList className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{workOrder.title}</span>
                        <Badge
                          variant="secondary"
                          className={`${getStatusColor(workOrder.status)} text-xs capitalize`}
                        >
                          {workOrder.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        <span className="font-mono text-xs">#{workOrder.id}</span>
                        <span>·</span>
                        <span>
                          {workOrder.createdAt
                            ? formatDistanceToNow(new Date(workOrder.createdAt), { addSuffix: true })
                            : "Unknown"}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`${getPriorityColor(workOrder.priority)} text-xs capitalize shrink-0`}
                    >
                      {workOrder.priority}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <ClipboardList className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-medium mb-1">No work orders yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {role !== "customer"
                    ? "Create your first work order to get started"
                    : "No completed work orders for your project yet"}
                </p>
                {role !== "customer" && (
                  <Link href="/work-orders/new">
                    <Button data-testid="button-create-first-work-order">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Work Order
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {role !== "customer" && (
          <Card data-testid="card-quick-actions">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3">
                <Link href="/work-orders/new">
                  <Button variant="outline" className="w-full justify-start" data-testid="button-quick-new-order">
                    <Plus className="h-4 w-4 mr-3" />
                    Create New Work Order
                  </Button>
                </Link>
                <Link href="/work-orders">
                  <Button variant="outline" className="w-full justify-start" data-testid="button-quick-view-orders">
                    <ClipboardList className="h-4 w-4 mr-3" />
                    View All Work Orders
                  </Button>
                </Link>
                {role === "admin" && (
                  <>
                    <Link href="/projects/new">
                      <Button variant="outline" className="w-full justify-start" data-testid="button-quick-new-project">
                        <FolderOpen className="h-4 w-4 mr-3" />
                        Create New Project
                      </Button>
                    </Link>
                    <Link href="/import">
                      <Button variant="outline" className="w-full justify-start" data-testid="button-quick-import">
                        <AlertCircle className="h-4 w-4 mr-3" />
                        Import Work Orders
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
