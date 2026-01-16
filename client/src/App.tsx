import { Switch, Route, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useGlobalEvents } from "@/hooks/useProjectEvents";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useState, useRef, useCallback, useEffect } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import Landing from "@/pages/landing";
import TurnstilePage from "@/pages/turnstile";
import Dashboard from "@/pages/dashboard";
import WorkOrders from "@/pages/work-orders";
import WorkOrderDetail from "@/pages/work-order-detail";
import Projects from "@/pages/projects";
import ProjectForm from "@/pages/project-form";
import ProjectWorkOrders from "@/pages/project-work-orders";
import ProjectImport from "@/pages/project-import";
import ProjectDbImport from "@/pages/project-db-import";
import ProjectFtpFiles from "@/pages/project-ftp-files";
import ProjectFiles from "@/pages/project-files";
import WorkOrderFiles from "@/pages/work-order-files";
import SearchReports from "@/pages/search-reports";
import Maintenance from "@/pages/maintenance";
import Users from "@/pages/users";
import Settings from "@/pages/settings";
import Documentation from "@/pages/documentation";
import NotFound from "@/pages/not-found";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-md bg-primary animate-pulse" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

function AuthenticatedRouter() {
  const { user } = useAuth();
  const { hasPermission, isLoading } = usePermissions();
  const role = user?.role || "user";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      
      {role === "customer" && (
        <>
          <Route path="/work-orders" component={WorkOrders} />
          <Route path="/work-orders/:id" component={WorkOrderDetail} />
        </>
      )}
      
      {hasPermission("nav.projects") && (
        <>
          <Route path="/projects" component={Projects} />
          <Route path="/projects/new" component={ProjectForm} />
          <Route path="/projects/:id/edit" component={ProjectForm} />
          <Route path="/projects/:projectId/db-import" component={ProjectDbImport} />
        </>
      )}
      
      {hasPermission("nav.users") && (
        <Route path="/users" component={Users} />
      )}
      
      {hasPermission("nav.maintenance") && (
        <Route path="/maintenance" component={Maintenance} />
      )}
      
      {hasPermission("nav.settings") && (
        <Route path="/settings" component={Settings} />
      )}
      
      {role === "admin" && (
        <Route path="/documentation" component={Documentation} />
      )}
      
      {(role === "admin" || role === "user") && (
        <>
          <Route path="/projects/:projectId/work-orders" component={ProjectWorkOrders} />
          <Route path="/projects/:projectId/files" component={ProjectFiles} />
          <Route path="/projects/:projectId/ftp-files" component={ProjectFtpFiles} />
          <Route path="/projects/:projectId/work-orders/:workOrderId/files" component={WorkOrderFiles} />
          <Route path="/projects/:projectId/import" component={ProjectImport} />
        </>
      )}
      
      {hasPermission("nav.searchReports") && (
        <Route path="/search" component={SearchReports} />
      )}
      
      <Route component={NotFound} />
    </Switch>
  );
}

function UpdateNotification() {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canSeeUpdates = user?.role === "admin" || hasPermission("settings.webUpdate");

  interface WebUpdateConfig {
    webUpdateUrl: string | null;
    lastCheck: string | null;
    cachedRelease: {
      latestVersion: string;
      currentVersion: string;
      updateAvailable: boolean;
      releaseName: string;
    } | null;
  }

  const { data } = useQuery<WebUpdateConfig>({
    queryKey: ["/api/settings/web-update-config"],
    enabled: canSeeUpdates,
    refetchInterval: 1000 * 60 * 30,
  });

  if (!canSeeUpdates || !data?.cachedRelease?.updateAvailable) {
    return null;
  }

  return (
    <Link href="/settings">
      <Badge variant="outline" className="gap-1 cursor-pointer" data-testid="badge-update-available">
        <ArrowUpCircle className="h-3 w-3" />
        <span className="hidden sm:inline">Update v{data.cachedRelease.latestVersion}</span>
        <span className="sm:hidden">Update</span>
      </Badge>
    </Link>
  );
}

const SIDEBAR_STORAGE_KEY = "meterflo-sidebar-width";
const DEFAULT_SIDEBAR_SIZE = 15;
const MAX_SIDEBAR_SIZE = 30;
const COLLAPSED_SIZE = 3;

function ResizableLayoutContent() {
  const { open, setOpen, toggleSidebar: providerToggle } = useSidebar();
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  
  const [lastExpandedSize, setLastExpandedSize] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        return saved ? parseFloat(saved) : DEFAULT_SIDEBAR_SIZE;
      } catch {
        return DEFAULT_SIDEBAR_SIZE;
      }
    }
    return DEFAULT_SIDEBAR_SIZE;
  });
  
  useEffect(() => {
    if (sidebarPanelRef.current) {
      if (open) {
        sidebarPanelRef.current.resize(lastExpandedSize);
      } else {
        sidebarPanelRef.current.resize(COLLAPSED_SIZE);
      }
    }
  }, [open, lastExpandedSize]);
  
  const handleSidebarResize = useCallback((sizes: number[]) => {
    const newSize = sizes[0];
    const collapsed = newSize <= COLLAPSED_SIZE + 1;
    
    if (collapsed !== !open) {
      setOpen(!collapsed);
    }
    
    if (!collapsed && newSize > COLLAPSED_SIZE + 1) {
      setLastExpandedSize(newSize);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SIDEBAR_STORAGE_KEY, String(newSize));
        } catch {
          // Ignore storage errors
        }
      }
    }
  }, [open, setOpen]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-screen w-full"
      onLayout={handleSidebarResize}
    >
      <ResizablePanel
        ref={sidebarPanelRef}
        defaultSize={lastExpandedSize}
        minSize={COLLAPSED_SIZE}
        maxSize={MAX_SIDEBAR_SIZE}
        className="bg-sidebar relative overflow-hidden"
        collapsible
        collapsedSize={COLLAPSED_SIZE}
      >
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          <AppSidebar resizable />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle className="hover:bg-primary/20 transition-colors" />
      <ResizablePanel defaultSize={100 - lastExpandedSize} minSize={50}>
        <div className="flex flex-col h-full min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b border-border sticky top-0 z-50 bg-background">
            <div className="flex items-center">
              <SidebarTrigger 
                className="md:hidden" 
                data-testid="button-sidebar-toggle" 
              />
              <button 
                onClick={providerToggle}
                className="hidden md:flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent transition-colors"
                data-testid="button-sidebar-toggle-desktop"
                aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <UpdateNotification />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <AuthenticatedRouter />
          </main>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function AuthenticatedLayout() {
  useGlobalEvents();

  return (
    <SidebarProvider defaultOpen={true}>
      <ResizableLayoutContent />
    </SidebarProvider>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Switch>
      <Route path="/turnstile" component={TurnstilePage} />
      <Route>
        {isAuthenticated ? <AuthenticatedLayout /> : <Landing />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
