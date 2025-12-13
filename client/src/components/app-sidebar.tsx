import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  ClipboardList,
  LayoutDashboard,
  Users,
  FolderOpen,
  Settings,
  LogOut,
  ChevronRight,
  Search,
  Wrench,
  FileText,
  Database,
  Upload,
  FolderSync,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import type { Project } from "@shared/schema";

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const role = user?.role || "user";
  const [openProjects, setOpenProjects] = useState<number[]>([]);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
  });

  const { data: userPermissions = [] } = useQuery<string[]>({
    queryKey: ["/api/users", user?.id, "permissions"],
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch(`/api/users/${user.id}/permissions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const hasPermission = (permission: string) => {
    if (role === "admin") return true;
    return userPermissions.includes(permission);
  };

  const toggleProject = (projectId: number) => {
    setOpenProjects((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.username) {
      return user.username[0].toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  const getRoleBadgeVariant = () => {
    switch (role) {
      case "admin":
        return "default";
      case "customer":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <ClipboardList className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm">WorkFlow Pro</span>
            <span className="text-xs text-muted-foreground">Work Orders</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {role === "admin" ? "Administration" : role === "customer" ? "Customer Portal" : "Navigation"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/"}
                  data-testid="nav-dashboard"
                >
                  <Link href="/">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {role === "customer" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith("/work-orders")}
                    data-testid="nav-work-orders"
                  >
                    <Link href="/work-orders">
                      <ClipboardList className="h-4 w-4" />
                      <span>Work Orders</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("projects.manage") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/projects"}
                    data-testid="nav-projects"
                  >
                    <Link href="/projects">
                      <FolderOpen className="h-4 w-4" />
                      <span>Projects</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("users.manage") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/users"}
                    data-testid="nav-users"
                  >
                    <Link href="/users">
                      <Users className="h-4 w-4" />
                      <span>Users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("maintenance.manage") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/maintenance"}
                    data-testid="nav-maintenance"
                  >
                    <Link href="/maintenance">
                      <Wrench className="h-4 w-4" />
                      <span>Maintenance</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("settings.manage") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/settings"}
                    data-testid="nav-settings"
                  >
                    <Link href="/settings">
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("search.reports") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/search"}
                    data-testid="nav-search"
                  >
                    <Link href="/search">
                      <Search className="h-4 w-4" />
                      <span>Search & Reports</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasPermission("projects.view") && projects.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects.map((project) => {
                  const isOpen = openProjects.includes(project.id);
                  const isProjectActive = location.startsWith(`/projects/${project.id}`);
                  
                  return (
                    <Collapsible
                      key={project.id}
                      open={isOpen || isProjectActive}
                      onOpenChange={() => toggleProject(project.id)}
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={isProjectActive}
                            data-testid={`nav-project-${project.id}`}
                          >
                            <FolderOpen className="h-4 w-4" />
                            <span className="flex-1 truncate">{project.name}</span>
                            <ChevronRight
                              className={`h-4 w-4 transition-transform ${
                                isOpen || isProjectActive ? "rotate-90" : ""
                              }`}
                            />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location === `/projects/${project.id}/work-orders`}
                                data-testid={`nav-project-${project.id}-work-orders`}
                              >
                                <Link href={`/projects/${project.id}/work-orders`}>
                                  <ClipboardList className="h-3 w-3" />
                                  <span>Work Orders</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location === `/projects/${project.id}/files`}
                                data-testid={`nav-project-${project.id}-documents`}
                              >
                                <Link href={`/projects/${project.id}/files`}>
                                  <FileText className="h-3 w-3" />
                                  <span>Project Documents</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location === `/projects/${project.id}/import`}
                                data-testid={`nav-project-${project.id}-import`}
                              >
                                <Link href={`/projects/${project.id}/import`}>
                                  <Upload className="h-3 w-3" />
                                  <span>File Import</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location === `/projects/${project.id}/ftp-files`}
                                data-testid={`nav-project-${project.id}-ftp-files`}
                              >
                                <Link href={`/projects/${project.id}/ftp-files`}>
                                  <FolderSync className="h-3 w-3" />
                                  <span>FTP Files</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            {role === "admin" && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location === `/projects/${project.id}/db-import`}
                                  data-testid={`nav-project-${project.id}-db-import`}
                                >
                                  <Link href={`/projects/${project.id}/db-import`}>
                                    <Database className="h-3 w-3" />
                                    <span>Database Import/Export</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9">
            <AvatarImage
              src={user?.profileImageUrl || undefined}
              alt={user?.firstName || "User"}
              className="object-cover"
            />
            <AvatarFallback>{getInitials()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">
              {user?.firstName && user?.lastName
                ? `${user.firstName} ${user.lastName}`
                : user?.username || user?.email || "User"}
            </span>
            <Badge
              variant={getRoleBadgeVariant()}
              className="w-fit text-xs capitalize"
            >
              {role}
            </Badge>
          </div>
        </div>
        <a href="/api/logout">
          <Button variant="ghost" className="w-full justify-start" data-testid="button-logout">
            <LogOut className="h-4 w-4 mr-2" />
            Log Out
          </Button>
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
