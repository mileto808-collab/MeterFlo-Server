import { Link, useLocation } from "wouter";
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  ClipboardList,
  LayoutDashboard,
  Users,
  FolderOpen,
  FileUp,
  Settings,
  LogOut,
  Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const role = user?.role || "user";

  const adminMenuItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Work Orders", url: "/work-orders", icon: ClipboardList },
    { title: "Projects", url: "/projects", icon: FolderOpen },
    { title: "Users", url: "/users", icon: Users },
    { title: "Import Data", url: "/import", icon: FileUp },
    { title: "Settings", url: "/settings", icon: Settings },
  ];

  const userMenuItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Work Orders", url: "/work-orders", icon: ClipboardList },
    { title: "Projects", url: "/projects", icon: FolderOpen },
  ];

  const customerMenuItems = [
    { title: "My Work Orders", url: "/", icon: ClipboardList },
  ];

  const menuItems =
    role === "admin"
      ? adminMenuItems
      : role === "customer"
        ? customerMenuItems
        : userMenuItems;

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
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
              {menuItems.map((item) => {
                const isActive = location === item.url || 
                  (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
                : user?.email || "User"}
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
