import { useLocation } from "wouter";
import { NavLink } from "@/components/nav-link";
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
import { usePermissions } from "@/hooks/usePermissions";
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
  const { user, hasPermission } = usePermissions();
  const role = user?.role || "user";
  const [openProjects, setOpenProjects] = useState<number[]>([]);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
  });

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
            <span className="font-semibold text-sm">MeterFlo</span>
            <span className="text-xs text-muted-foreground">Meter Work Orders</span>
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
                  <NavLink href="/">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {role === "customer" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith("/work-orders")}
                    data-testid="nav-work-orders"
                  >
                    <NavLink href="/work-orders">
                      <ClipboardList className="h-4 w-4" />
                      <span>Work Orders</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("nav.projects") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/projects"}
                    data-testid="nav-projects"
                  >
                    <NavLink href="/projects">
                      <FolderOpen className="h-4 w-4" />
                      <span>Projects</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("nav.users") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/users"}
                    data-testid="nav-users"
                  >
                    <NavLink href="/users">
                      <Users className="h-4 w-4" />
                      <span>Users</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("nav.maintenance") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/maintenance"}
                    data-testid="nav-maintenance"
                  >
                    <NavLink href="/maintenance">
                      <Wrench className="h-4 w-4" />
                      <span>Maintenance</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("nav.settings") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/settings"}
                    data-testid="nav-settings"
                  >
                    <NavLink href="/settings">
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasPermission("nav.searchReports") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/search"}
                    data-testid="nav-search"
                  >
                    <NavLink href="/search">
                      <Search className="h-4 w-4" />
                      <span>Search & Reports</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasPermission("project.workOrders") && projects.length > 0 && (
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
                            {hasPermission("project.workOrders") && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.startsWith(`/projects/${project.id}/work-orders`)}
                                  data-testid={`nav-project-${project.id}-work-orders`}
                                >
                                  <NavLink href={`/projects/${project.id}/work-orders`}>
                                    <ClipboardList className="h-3 w-3" />
                                    <span>Work Orders</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                            {hasPermission("project.documents") && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.startsWith(`/projects/${project.id}/files`)}
                                  data-testid={`nav-project-${project.id}-documents`}
                                >
                                  <NavLink href={`/projects/${project.id}/files`}>
                                    <FileText className="h-3 w-3" />
                                    <span>Project Documents</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                            {hasPermission("project.import") && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.startsWith(`/projects/${project.id}/import`)}
                                  data-testid={`nav-project-${project.id}-import`}
                                >
                                  <NavLink href={`/projects/${project.id}/import`}>
                                    <Upload className="h-3 w-3" />
                                    <span>File Import</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                            {hasPermission("project.ftpFiles") && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.startsWith(`/projects/${project.id}/ftp-files`)}
                                  data-testid={`nav-project-${project.id}-ftp-files`}
                                >
                                  <NavLink href={`/projects/${project.id}/ftp-files`}>
                                    <FolderSync className="h-3 w-3" />
                                    <span>FTP Files</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                            {hasPermission("project.dbImport") && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.startsWith(`/projects/${project.id}/db-import`)}
                                  data-testid={`nav-project-${project.id}-db-import`}
                                >
                                  <NavLink href={`/projects/${project.id}/db-import`}>
                                    <Database className="h-3 w-3" />
                                    <span>Database Import/Export</span>
                                  </NavLink>
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
