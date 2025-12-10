import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Project, User } from "@shared/schema";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  TrendingUp,
  Users,
  FolderOpen,
  Plus,
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role || "user";

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: role === "admin",
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold" data-testid="text-dashboard-title">
          {role === "customer" ? "Customer Portal" : "Dashboard"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {role === "admin" 
            ? "Overview of your work order management system"
            : role === "customer"
              ? "View completed work orders for your projects"
              : "Access your assigned projects"}
        </p>
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
                <div className="text-3xl font-bold">{projects.length}</div>
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

      <Card data-testid="card-projects-list">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>
              {role === "admin" ? "All Projects" : "Your Projects"}
            </CardTitle>
            <CardDescription>
              {role === "admin" 
                ? "Select a project to manage work orders"
                : role === "customer"
                  ? "View completed work orders"
                  : "Access your assigned projects"}
            </CardDescription>
          </div>
          {role === "admin" && (
            <Link href="/projects/new">
              <Button size="sm" data-testid="button-new-project-quick">
                <Plus className="h-4 w-4 mr-1" />
                New Project
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border rounded-md">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.length > 0 ? (
            <div className="space-y-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}/work-orders`}
                  className="flex items-start gap-4 p-4 rounded-md border hover-elevate cursor-pointer"
                  data-testid={`link-project-${project.id}`}
                >
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <FolderOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{project.name}</span>
                      {project.isActive && (
                        <Badge variant="secondary" className="text-xs">Active</Badge>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-1">
                {role === "admin" ? "No projects yet" : "No assigned projects"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {role === "admin"
                  ? "Create your first project to get started"
                  : "Contact your administrator to be assigned to a project"}
              </p>
              {role === "admin" && (
                <Link href="/projects/new">
                  <Button data-testid="button-create-first-project">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Project
                  </Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {role === "admin" && (
        <div className="mt-6">
          <Card data-testid="card-quick-actions">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common administration tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Link href="/projects/new">
                  <Button variant="outline" className="w-full justify-start">
                    <FolderOpen className="h-4 w-4 mr-3" />
                    New Project
                  </Button>
                </Link>
                <Link href="/users">
                  <Button variant="outline" className="w-full justify-start">
                    <Users className="h-4 w-4 mr-3" />
                    Manage Users
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button variant="outline" className="w-full justify-start">
                    <ClipboardList className="h-4 w-4 mr-3" />
                    Settings
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
