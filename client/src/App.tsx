import { Switch, Route, Link, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useGlobalEvents } from "@/hooks/useProjectEvents";
import { PageHeaderProvider, usePageHeader } from "@/contexts/page-header-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle } from "lucide-react";
import { lazy, Suspense, useState, useCallback, useEffect, useRef } from "react";
import { HttpLoginRecoveryAlert } from "@/components/http-login-recovery-alert";
import { RouteSessionCleanup } from "@/components/work-order-routing/route-session-cleanup";
import { AccessLockGate } from "@/components/access-locks/access-lock-gate";
import { SystemRestoreBoundary } from "@/components/system-restore-boundary";
import { PickupInboxButton } from "@/components/inventory/pickup-notices";
import { VehicleStockButton } from "@/components/inventory/vehicle-stock";

// Keep unrelated screens (and their large wizard dependencies) off the refresh path.
// Declare these outside render so navigating does not recreate component identities.
const CustomerExtension = lazy(() => import("@/pages/customer-extension"));
const Landing = lazy(() => import("@/pages/landing"));
const LoginPage = lazy(() => import("@/pages/login"));
const TurnstilePage = lazy(() => import("@/pages/turnstile"));
const MeterFloServerFeatures = lazy(() => import("@/pages/features/meterflo-server"));
const MeterFloMobileFeatures = lazy(() => import("@/pages/features/meterflo-mobile"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const WorkOrders = lazy(() => import("@/pages/work-orders"));
const WorkOrderDetail = lazy(() => import("@/pages/work-order-detail"));
const Projects = lazy(() => import("@/pages/projects"));
const ProjectForm = lazy(() => import("@/pages/project-form"));
const ProjectWorkOrders = lazy(() => import("@/pages/project-work-orders"));
const ProjectInventory = lazy(() => import("@/pages/project-inventory"));
const ProjectImport = lazy(() => import("@/pages/project-import"));
const ProjectDbImport = lazy(() => import("@/pages/project-db-import"));
const ProjectApiImport = lazy(() => import("@/pages/project-api-import"));
const ProjectCustomerApi = lazy(() => import("@/pages/project-customer-api"));
const ProjectFtpFiles = lazy(() => import("@/pages/project-ftp-files"));
const ProjectFiles = lazy(() => import("@/pages/project-files"));
const WorkOrderFiles = lazy(() => import("@/pages/work-order-files"));
const SearchReports = lazy(() => import("@/pages/search-reports"));
const Users = lazy(() => import("@/pages/users"));
const Settings = lazy(() => import("@/pages/settings"));
const Documentation = lazy(() => import("@/pages/documentation"));
const NotFound = lazy(() => import("@/pages/not-found"));
const GpsSetup = lazy(() => import("@/pages/gps-setup"));

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
      <Route path="/extensions/:extensionId/:screenId" component={CustomerExtension} />
      <Route path="/" component={Dashboard} />
      <Route path="/gps-setup" component={GpsSetup} />
      
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
          <Route path="/projects/:projectId/db-import" component={ProjectDbImport} />
        </>
      )}

      {(hasPermission("nav.projects") || hasPermission("projects.edit") || hasPermission("project.apiImport") || hasPermission("settings.customerApiLogs")) &&
        <Route path="/projects/:id/edit" component={ProjectForm} />}
      <Route path="/projects/:projectId/customer-api"><ProjectCustomerApi /></Route>
      
      {hasPermission("nav.users") && (
        <Route path="/users" component={Users} />
      )}
      
      {(hasPermission("nav.maintenance") || hasPermission("maintenance.projectBackup") || hasPermission("maintenance.projectRestore") ||
        hasPermission("maintenance.systemBackup") || hasPermission("maintenance.systemRestore") || hasPermission("maintenance.logManagement")) && (
        <Route path="/maintenance">
          <Redirect to={`/settings?section=${window.location.hash === "#log-maintenance" ? "log-maintenance" : "backup-restore"}${window.location.hash}`} />
        </Route>
      )}

      {hasPermission("audit.view") && (
        <Route path="/audit-logs">
          <Redirect to={`/settings?section=audit-logs${window.location.hash}`} />
        </Route>
      )}

      {(hasPermission("nav.settings") || hasPermission("audit.view") || hasPermission("nav.maintenance") ||
        hasPermission("maintenance.projectBackup") || hasPermission("maintenance.projectRestore") ||
        hasPermission("maintenance.systemBackup") || hasPermission("maintenance.systemRestore") ||
        hasPermission("maintenance.logManagement")) && (
        <Route path="/settings" component={Settings} />
      )}
      
      {role === "admin" && (
        <Route path="/documentation" component={Documentation} />
      )}
      
      {(role === "admin" || role === "user") && (
        <>
          {hasPermission("inventory.view") && <Route path="/projects/:projectId/inventory" component={ProjectInventory} />}
          <Route path="/projects/:projectId/work-orders" component={ProjectWorkOrders} />
          <Route path="/projects/:projectId/files" component={ProjectFiles} />
          <Route path="/projects/:projectId/ftp-files" component={ProjectFtpFiles} />
          <Route path="/projects/:projectId/work-orders/:workOrderId/files" component={WorkOrderFiles} />
          <Route path="/projects/:projectId/import" component={ProjectImport} />
          <Route path="/projects/:projectId/api-import"><ProjectApiImport /></Route>
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
    lastCheck: string | null;
    cachedRelease: {
      latestVersion: string;
      currentVersion: string;
      updateAvailable: boolean;
      releaseName: string;
    } | null;
  }

  const { data } = useQuery<WebUpdateConfig>({
    queryKey: ["/api/settings/web-updates/status"],
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

function HeaderContent() {
  const { headerContent } = usePageHeader();
  return <>{headerContent}</>;
}

function AuthenticatedLayout() {
  useGlobalEvents();
  
  // Sidebar resize functionality
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 400;
  const DEFAULT_WIDTH = 256; // 16rem = 256px
  
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;
    
    const delta = e.clientX - resizeRef.current.startX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeRef.current.startWidth + delta));
    setSidebarWidth(newWidth);
  }, [isResizing]);
  
  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      resizeRef.current = null;
      localStorage.setItem('sidebar-width', sidebarWidth.toString());
    }
  }, [isResizing, sidebarWidth]);
  
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);
  
  const style = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--sidebar-width-icon": "3rem",
  };

  return (
    <PageHeaderProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex min-h-screen w-full">
          <div className="relative">
            <AppSidebar />
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/30 z-50 transition-colors"
              onMouseDown={handleMouseDown}
              data-testid="sidebar-resize-handle"
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border sticky top-0 z-50 bg-background">
              <div className="flex items-center gap-3 flex-shrink-0">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
              </div>
              <div className="flex-1 min-w-0">
                <HeaderContent />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <PickupInboxButton />
                <VehicleStockButton />
                <UpdateNotification />
                <ThemeToggle />
              </div>
            </header>
            <HttpLoginRecoveryAlert />
            <main className="flex-1 overflow-auto">
              <AccessLockGate>
                <Suspense fallback={<div role="status" className="p-6"><Skeleton className="h-8 w-48" /><span className="sr-only">Loading page</span></div>}>
                  <AuthenticatedRouter />
                </Suspense>
              </AccessLockGate>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </PageHeaderProvider>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // A restored browser snapshot may contain the user who just logged out.
        // Reload before reusing any cached private queries or role state.
        queryClient.clear();
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Switch>
      <Route path="/login">{isAuthenticated ? <Redirect to="/" /> : <LoginPage />}</Route>
      <Route path="/auth"><Redirect to="/login" /></Route>
      <Route path="/api/login"><Redirect to="/login" /></Route>
      <Route path="/turnstile">{isAuthenticated ? <Redirect to="/" /> : <TurnstilePage />}</Route>
      <Route path="/features/meterflo-server" component={MeterFloServerFeatures} />
      <Route path="/features/meterflo-mobile" component={MeterFloMobileFeatures} />
      <Route>
        {isAuthenticated ? <AuthenticatedLayout /> : <Landing />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SystemRestoreBoundary>
      <RouteSessionCleanup />
      <TooltipProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Router />
        </Suspense>
        <Toaster />
      </TooltipProvider>
      </SystemRestoreBoundary>
    </QueryClientProvider>
  );
}

export default App;
