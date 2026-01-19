import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Link } from "wouter";
import { usePageHeader } from "@/contexts/page-header-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScannerInput } from "@/components/scanner-input";
import { GPSCapture } from "@/components/gps-capture";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardCheck } from "lucide-react";
import {
  ArrowLeft,
  Save,
  Loader2,
  User,
  Users,
  MapPin,
  Gauge,
  Calendar,
  CalendarDays,
  FileText,
  Paperclip,
  Clock,
  Eye,
  Download,
  Upload,
  X,
  Plus,
  AlertTriangle,
  Wrench,
  Hash,
  Phone,
  Mail,
  Home,
  Pencil,
  Flag,
} from "lucide-react";
import { FileIcon } from "lucide-react";
import SignaturePad, { type SignaturePadRef } from "@/components/signature-pad";
import { SystemChangeoutWizard } from "@/components/system-changeout-wizard";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { WorkOrderPdf } from "@/components/work-order-pdf";

interface OperationalHoursConfig {
  enabled: boolean;
  start: string | null;
  end: string | null;
}

interface WizardConfig {
  wizardMode: "changeout" | "reading_only" | "user_choice";
  gpsMode?: "automatic" | "manual_step" | "disabled";
  showNotesStep: boolean;
  showGpsStep: boolean;
  showBeforePhotosStep: boolean;
  showAfterPhotosStep: boolean;
  showSignatureStep: boolean;
}

interface WorkOrderDetailProps {
  workOrder: any;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  onBack: () => void;
  isSubmitting: boolean;
  projectId: string | number;
  projectName?: string;
  cameFromSearch?: boolean;
  serviceTypes: Array<{ id: number; code: string; label: string; color?: string | null }>;
  systemTypes: Array<{ id: number; productId: string; productLabel: string }>;
  moduleTypes: Array<{ id: number; productId: string; productLabel: string }>;
  workOrderStatuses: Array<{ id: number; code: string; label: string }>;
  troubleCodes: Array<{ id: number; code: string; label: string }>;
  assigneesData: any;
  workOrderFiles: string[];
  filesLoading: boolean;
  formatDateTime: (date: string | Date) => string;
  getAssignedUserName: (userId: string | null | undefined) => string | null;
  signaturePadRef: React.RefObject<SignaturePadRef | null>;
  openCreateSystemTypeDialog: (field: "oldSystemType" | "newSystemType" | "editOldSystemType" | "editNewSystemType") => void;
  toast: any;
  canEdit?: boolean;
  canSystemChangeout?: boolean;
  canPrint?: boolean;
  onSystemChangeoutComplete?: () => void | Promise<void>;
  autoLaunchSystemChangeout?: boolean;
  autoLaunchChangeoutScope?: "system" | "module" | "both";
  operationalHours?: OperationalHoursConfig;
  onScheduleInCalendar?: () => void;
  canScheduleInCalendar?: boolean;
  wizardConfig?: WizardConfig;
  searchMethodSettings?: {
    searchShowBarcodeScan: boolean;
    searchShowQrCodeScan: boolean;
    searchShowManualEntry: boolean;
    searchShowHidScanner: boolean;
  };
}

export function WorkOrderDetail({
  workOrder,
  form,
  onSubmit,
  onBack,
  isSubmitting,
  projectId,
  projectName,
  cameFromSearch,
  serviceTypes = [],
  systemTypes = [],
  moduleTypes = [],
  workOrderStatuses = [],
  troubleCodes = [],
  assigneesData,
  workOrderFiles,
  filesLoading,
  formatDateTime,
  getAssignedUserName,
  signaturePadRef,
  openCreateSystemTypeDialog,
  toast,
  canEdit = true,
  canSystemChangeout = false,
  canPrint = true,
  onSystemChangeoutComplete,
  autoLaunchSystemChangeout = false,
  autoLaunchChangeoutScope,
  operationalHours,
  onScheduleInCalendar,
  canScheduleInCalendar = false,
  wizardConfig,
  searchMethodSettings,
}: WorkOrderDetailProps) {
  const { setHeaderContent } = usePageHeader();
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [showSystemChangeoutWizard, setShowSystemChangeoutWizard] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const autoLaunchTriggered = useRef(false);
  const [mobileCustomerEditMode, setMobileCustomerEditMode] = useState(false);
  const [mobileSystemEditMode, setMobileSystemEditMode] = useState(false);
  const [mobileSchedulingEditMode, setMobileSchedulingEditMode] = useState(false);
  const [mobileNotesEditMode, setMobileNotesEditMode] = useState(false);
  
  // Desktop edit mode states - mirrors mobile pattern for consistent UX
  const [desktopCustomerEditMode, setDesktopCustomerEditMode] = useState(false);
  const [desktopSystemEditMode, setDesktopSystemEditMode] = useState(false);
  const [desktopSchedulingEditMode, setDesktopSchedulingEditMode] = useState(false);
  const [desktopNotesEditMode, setDesktopNotesEditMode] = useState(false);
  
  // Auto-determine scope based on work order data
  const changeoutScope: "system" | "module" | "both" = (() => {
    const hasSystem = !!workOrder.oldSystemId;
    const hasModule = !!workOrder.oldModuleId;
    if (hasSystem && hasModule) return "both";
    if (hasModule) return "module";
    return "system";
  })();
  
  // Watch form fields for header display - ensures UI updates immediately when form values change
  // Using useWatch hook for proper subscription to form updates
  const watchedAssignedUserId = useWatch({ control: form.control, name: 'assignedUserId' });
  const watchedAssignedGroupId = useWatch({ control: form.control, name: 'assignedGroupId' });
  const watchedScheduledAt = useWatch({ control: form.control, name: 'scheduledAt' });
  
  // Watch customer/site fields for summary card - updates as user edits
  const watchedCustomerWoId = useWatch({ control: form.control, name: 'customerWoId' });
  const watchedCustomerId = useWatch({ control: form.control, name: 'customerId' });
  const watchedCustomerName = useWatch({ control: form.control, name: 'customerName' });
  const watchedAddress = useWatch({ control: form.control, name: 'address' });
  const watchedCity = useWatch({ control: form.control, name: 'city' });
  const watchedState = useWatch({ control: form.control, name: 'state' });
  const watchedZip = useWatch({ control: form.control, name: 'zip' });
  const watchedPhone = useWatch({ control: form.control, name: 'phone' });
  const watchedEmail = useWatch({ control: form.control, name: 'email' });
  const watchedRoute = useWatch({ control: form.control, name: 'route' });
  const watchedZone = useWatch({ control: form.control, name: 'zone' });

  // Fetch time tracking data for this work order
  const { data: timeTracking } = useQuery<{
    id: number;
    projectId: number;
    systemWorkOrderId: string;
    startTime: string;
    endTime: string;
    createdAt: string;
  } | null>({
    queryKey: ['/api/projects', projectId, 'work-orders', workOrder.id, 'time-tracking'],
    enabled: !!projectId && !!workOrder.id,
  });

  // Helper to format elapsed time
  const formatElapsedTime = (startTime: string, endTime: string): string => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end.getTime() - start.getTime();
    
    if (diffMs < 0) return "Invalid";
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // Helper to validate scheduled time against operational hours
  const getOperationalHoursWarning = (scheduledAt: string | null | undefined): string | null => {
    if (!scheduledAt || !operationalHours?.enabled) return null;
    if (!operationalHours.start || !operationalHours.end) return null;
    
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) return null;
    
    const scheduledHours = scheduledDate.getHours();
    const scheduledMinutes = scheduledDate.getMinutes();
    const scheduledTimeMinutes = scheduledHours * 60 + scheduledMinutes;
    
    const [startHour, startMin] = operationalHours.start.split(':').map(Number);
    const [endHour, endMin] = operationalHours.end.split(':').map(Number);
    
    if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) return null;
    
    const startTimeMinutes = startHour * 60 + startMin;
    const endTimeMinutes = endHour * 60 + endMin;
    
    if (scheduledTimeMinutes < startTimeMinutes || scheduledTimeMinutes > endTimeMinutes) {
      const formatTime = (h: number, m: number) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
      };
      return `Outside operational hours (${formatTime(startHour, startMin)} - ${formatTime(endHour, endMin)})`;
    }
    return null;
  };

  const scheduledAtWarning = getOperationalHoursWarning(watchedScheduledAt);

  // Start system changeout - claim and open wizard directly (scope is auto-determined)
  const handleStartSystemChangeout = useCallback(async () => {
    setIsClaiming(true);
    try {
      // Call claim endpoint - this will assign the work order to the current user
      // and remove existing group/user assignments
      await apiRequest("POST", `/api/projects/${projectId}/work-orders/${workOrder.id}/claim`);
      
      // Open the wizard after successful claim
      setShowSystemChangeoutWizard(true);
    } catch (error: any) {
      console.error("Error claiming work order:", error);
      
      // Check if this is a "already claimed by another user" conflict (409)
      const isAlreadyClaimed = error.message?.toLowerCase().includes("claimed");
      
      toast({
        title: isAlreadyClaimed ? "Work Order Unavailable" : "Error",
        description: error.message || "Failed to claim work order",
        variant: "destructive",
      });
    } finally {
      setIsClaiming(false);
    }
  }, [projectId, workOrder.id, toast]);

  // Scroll to top when component mounts (triggered by key prop change)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Auto-launch system changeout wizard if requested
  // When coming from scan workflow, work order is already claimed
  useEffect(() => {
    if (autoLaunchSystemChangeout && canSystemChangeout && !autoLaunchTriggered.current) {
      autoLaunchTriggered.current = true;
      // Scope is now auto-determined based on work order data
      // Since coming from scan, work order is already claimed, just open wizard
      setShowSystemChangeoutWizard(true);
    }
  }, [autoLaunchSystemChangeout, canSystemChangeout]);

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
      Open: { variant: "outline" },
      Scheduled: { variant: "secondary", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      "In Progress": { variant: "secondary", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
      Completed: { variant: "secondary", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
      Cancelled: { variant: "destructive" },
    };
    const config = statusConfig[status] || { variant: "outline" };
    return (
      <Badge variant={config.variant} className={config.className}>
        {status}
      </Badge>
    );
  };

  // Helper to convert named colors to hex
  const getColorHex = (color: string): string => {
    // If it's already a hex color, return it
    if (color.startsWith('#')) return color;
    
    const colorMap: Record<string, string> = {
      blue: "#3b82f6",
      green: "#22c55e",
      orange: "#f97316",
      red: "#ef4444",
      yellow: "#eab308",
      purple: "#a855f7",
      gray: "#6b7280",
    };
    return colorMap[color] || "#6b7280";
  };

  const getServiceTypeBadge = (serviceTypeCode: string | null | undefined) => {
    if (!serviceTypeCode) return null;
    const serviceType = serviceTypes.find(st => st.code === serviceTypeCode);
    if (!serviceType) return <Badge variant="outline">{serviceTypeCode}</Badge>;
    
    // Use the service type's color for text only (outline style badge)
    if (serviceType.color) {
      const hexColor = getColorHex(serviceType.color);
      return (
        <Badge 
          variant="outline"
          style={{ color: hexColor }}
        >
          {serviceType.label}
        </Badge>
      );
    }
    
    return (
      <Badge variant="outline">
        {serviceType.label}
      </Badge>
    );
  };

  // Set sticky header content with work order info
  useEffect(() => {
    const content = (
      <div className="flex items-center gap-2 flex-wrap w-full">
        {/* Back button */}
        {cameFromSearch ? (
          <Link href="/search">
            <Button variant="ghost" size="sm" data-testid="header-button-back-to-search">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Back to Search</span>
            </Button>
          </Link>
        ) : (
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="header-button-back-to-work-orders">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        
        <div className="h-4 w-px bg-border mx-1" />
        
        {/* WO ID and badges */}
        <span className="font-semibold text-sm" data-testid="header-work-order-title">
          {workOrder.customerWoId || `WO #${workOrder.id}`}
        </span>
        {getStatusBadge(workOrder.status)}
        {getServiceTypeBadge(workOrder.serviceType)}
        
        {/* Customer info - hidden on small screens */}
        <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground ml-2">
          {workOrder.customerName && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{workOrder.customerName}</span>
            </div>
          )}
          {workOrder.address && (
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              <span>{workOrder.address}{workOrder.city ? `, ${workOrder.city}` : ""}</span>
            </div>
          )}
          {watchedAssignedUserId && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>Assigned: {(workOrder as any).assignedUserDisplay || getAssignedUserName(watchedAssignedUserId) || "-"}</span>
            </div>
          )}
        </div>
        
        <div className="flex-1" />
        
        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {canSystemChangeout && workOrder.status !== 'Completed' && (
            <Button 
              size="sm" 
              onClick={handleStartSystemChangeout}
              disabled={isClaiming}
              data-testid="header-button-start-system-changeout"
              className="bg-green-600 text-white dark:bg-green-600"
            >
              {isClaiming ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  <span className="hidden sm:inline">Claiming...</span>
                </>
              ) : (
                <>
                  {wizardConfig?.wizardMode === "reading_only" ? (
                    <Gauge className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 mr-1" />
                  )}
                  <span>{wizardConfig?.wizardMode === "reading_only" ? "Start Reading Capture" : "Start Changeout"}</span>
                </>
              )}
            </Button>
          )}
          <Link href={`/projects/${projectId}/work-orders/${workOrder.id}/files?returnTo=detail`}>
            <Button variant="outline" size="sm" data-testid="header-button-quick-attachments">
              <Paperclip className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Attachments</span> ({workOrderFiles.length})
            </Button>
          </Link>
          {canPrint && (
            <WorkOrderPdf
              workOrder={workOrder}
              projectId={projectId}
              projectName={projectName}
              workOrderFiles={workOrderFiles}
              formatDateTime={formatDateTime}
              getAssignedUserName={getAssignedUserName}
              serviceTypes={serviceTypes}
              troubleCodes={troubleCodes}
              timeTracking={timeTracking}
              variant="outline"
              size="sm"
              testId="header-button-print-pdf"
            />
          )}
        </div>
      </div>
    );
    setHeaderContent(content);
    
    return () => setHeaderContent(null);
  }, [
    workOrder, cameFromSearch, onBack, canSystemChangeout, isClaiming, 
    wizardConfig, projectId, workOrderFiles, canPrint, formatDateTime, 
    getAssignedUserName, serviceTypes, troubleCodes, watchedAssignedUserId,
    setHeaderContent, handleStartSystemChangeout
  ]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Read-Only Banner */}
      {!canEdit && (
        <div className="flex items-center gap-2 p-3 bg-muted border rounded-md" data-testid="banner-read-only">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">You are viewing this work order in read-only mode.</span>
        </div>
      )}

      {/* Form with Collapsible Sections */}
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <Accordion 
            type="multiple" 
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-3"
          >
            {/* Customer & Site */}
            <AccordionItem value="customer" className="border rounded-lg border-l-4 border-l-primary px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-customer">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-primary" />
                  <span className="font-medium">Customer & Site</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {/* Mobile view - read-only when not editing */}
                {(!mobileCustomerEditMode || !canEdit) && (
                  <div className="md:hidden space-y-4">
                    {/* Edit button */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMobileCustomerEditMode(true)}
                          data-testid="button-mobile-customer-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}
                    
                    {/* Header with WO ID and badges */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-lg font-bold" data-testid="text-work-order-title">
                        {watchedCustomerWoId || `WO #${workOrder.id}`}
                      </h2>
                      {getStatusBadge(workOrder.status)}
                      {getServiceTypeBadge(workOrder.serviceType)}
                    </div>
                    
                    {/* Info grid - mobile optimized */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">System ID</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-system-id">{workOrder.id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Work Order ID</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-wo-id">{watchedCustomerWoId || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Customer ID</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-customer-id">{watchedCustomerId || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Customer Name</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-customer-name">{watchedCustomerName || "N/A"}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Address</p>
                        {(() => {
                          const fullAddress = [watchedAddress, watchedCity, watchedState, watchedZip].filter(Boolean).join(", ");
                          return fullAddress ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                              data-testid="mobile-summary-address-link"
                            >
                              {fullAddress}
                            </a>
                          ) : (
                            <p className="text-sm font-medium text-muted-foreground">N/A</p>
                          );
                        })()}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        {watchedPhone ? (
                          <a
                            href={`tel:${watchedPhone}`}
                            className="text-sm font-medium text-primary hover:underline"
                            data-testid="mobile-summary-phone-link"
                          >
                            {watchedPhone}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">N/A</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        {watchedEmail ? (
                          <a
                            href={`mailto:${watchedEmail}`}
                            className="text-sm font-medium text-primary hover:underline"
                            data-testid="mobile-summary-email-link"
                          >
                            {watchedEmail}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">N/A</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Route</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-route">{watchedRoute || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Zone</p>
                        <p className="text-sm font-medium" data-testid="mobile-summary-zone">{watchedZone || "N/A"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mobile edit mode */}
                {mobileCustomerEditMode && canEdit && (
                  <div className="md:hidden space-y-4">
                    <div className="flex justify-end mb-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileCustomerEditMode(false)}
                        data-testid="button-mobile-customer-done"
                      >
                        Done
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="customerWoId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Work Order ID</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="WO-001" data-testid="mobile-input-wo-id" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customerId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Customer ID</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="CUST-001" data-testid="mobile-input-customer-id" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="mobile-input-customer-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="123 Main Street" data-testid="mobile-input-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="City" data-testid="mobile-input-city" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="State" data-testid="mobile-input-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="12345" data-testid="mobile-input-zip" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="555-123-4567" data-testid="mobile-input-phone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="email@example.com" data-testid="mobile-input-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="route"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Route</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="Route A" data-testid="mobile-input-route" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="zone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zone</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="Zone 1" data-testid="mobile-input-zone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Desktop view - read-only when not editing */}
                {(!desktopCustomerEditMode || !canEdit) && (
                  <div className="hidden md:block space-y-4">
                    {/* Edit button */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDesktopCustomerEditMode(true)}
                          data-testid="button-desktop-customer-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}
                    
                    {/* Header with WO ID and badges */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-xl font-bold" data-testid="desktop-text-work-order-title">
                        {watchedCustomerWoId || `WO #${workOrder.id}`}
                      </h2>
                      {getStatusBadge(workOrder.status)}
                      {getServiceTypeBadge(workOrder.serviceType)}
                    </div>
                    
                    {/* Info grid - desktop layout */}
                    <div className="grid grid-cols-3 gap-x-8 gap-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">System ID</p>
                        <p className="text-sm font-medium" data-testid="summary-system-id">{workOrder.id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Work Order ID</p>
                        <p className="text-sm font-medium" data-testid="summary-wo-id">{watchedCustomerWoId || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Customer ID</p>
                        <p className="text-sm font-medium" data-testid="summary-customer-id">{watchedCustomerId || "N/A"}</p>
                      </div>
                      
                      <div>
                        <p className="text-xs text-muted-foreground">Customer Name</p>
                        <p className="text-sm font-medium" data-testid="summary-customer-name">{watchedCustomerName || "N/A"}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Address</p>
                        {(() => {
                          const fullAddress = [watchedAddress, watchedCity, watchedState, watchedZip].filter(Boolean).join(", ");
                          return fullAddress ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                              data-testid="summary-address-link"
                            >
                              {fullAddress}
                            </a>
                          ) : (
                            <p className="text-sm font-medium text-muted-foreground">N/A</p>
                          );
                        })()}
                      </div>
                      
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        {watchedPhone ? (
                          <a
                            href={`tel:${watchedPhone}`}
                            className="text-sm font-medium text-primary hover:underline"
                            data-testid="summary-phone-link"
                          >
                            {watchedPhone}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">N/A</p>
                        )}
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Email</p>
                        {watchedEmail ? (
                          <a
                            href={`mailto:${watchedEmail}`}
                            className="text-sm font-medium text-primary hover:underline"
                            data-testid="summary-email-link"
                          >
                            {watchedEmail}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">N/A</p>
                        )}
                      </div>
                      
                      <div>
                        <p className="text-xs text-muted-foreground">Route</p>
                        <p className="text-sm font-medium" data-testid="summary-route">{watchedRoute || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Zone</p>
                        <p className="text-sm font-medium" data-testid="summary-zone">{watchedZone || "N/A"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Desktop edit mode */}
                {desktopCustomerEditMode && canEdit && (
                  <div className="hidden md:block space-y-4">
                    <div className="flex justify-end mb-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDesktopCustomerEditMode(false)}
                        data-testid="button-desktop-customer-done"
                      >
                        Done
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="customerWoId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Work Order ID</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="WO-001" data-testid="desktop-input-wo-id" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customerId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Customer ID</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="CUST-001" data-testid="desktop-input-customer-id" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="desktop-input-customer-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="123 Main Street" data-testid="desktop-input-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="City" data-testid="desktop-input-city" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="State" data-testid="desktop-input-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP Code</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="12345" data-testid="desktop-input-zip" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="555-123-4567" data-testid="desktop-input-phone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="email@example.com" data-testid="desktop-input-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="route"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Route</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="Route A" data-testid="desktop-input-route" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="zone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zone</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value || ""} placeholder="Zone 1" data-testid="desktop-input-zone" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* System | Module Details */}
            <AccordionItem value="system" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-system">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" />
                  <span className="font-medium">System | Module Details</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {/* Mobile-optimized read-only display - shown on small screens when not editing */}
                {(!mobileSystemEditMode || !canEdit) && (
                  <div className="md:hidden space-y-4">
                    {/* Edit button for authorized users */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMobileSystemEditMode(true)}
                          data-testid="button-mobile-system-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}

                    {/* Old System - Green border - only show if has data */}
                    {(workOrder.oldSystemId || workOrder.oldSystemReading != null || workOrder.oldSystemType) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-green-500 mb-2">Old System</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {workOrder.oldSystemId && (
                            <div>
                              <p className="text-xs text-muted-foreground">System ID</p>
                              <p className="text-sm font-medium break-all" data-testid="mobile-old-system-id">
                                {workOrder.oldSystemId}
                              </p>
                            </div>
                          )}
                          {workOrder.oldSystemReading != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="mobile-old-system-reading">
                                {workOrder.oldSystemReading}
                              </p>
                            </div>
                          )}
                          {workOrder.oldSystemType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="mobile-old-system-type">
                                {workOrder.oldSystemType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Old Module - Green border - only show if has data */}
                    {(workOrder.oldModuleId || workOrder.oldModuleRead != null || workOrder.oldModuleType) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-muted-foreground mb-2">Old Module</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {workOrder.oldModuleId && (
                            <div>
                              <p className="text-xs text-muted-foreground">Module ID</p>
                              <p className="text-sm font-medium break-all" data-testid="mobile-old-module-id">
                                {workOrder.oldModuleId}
                              </p>
                            </div>
                          )}
                          {workOrder.oldModuleRead != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="mobile-old-module-reading">
                                {workOrder.oldModuleRead}
                              </p>
                            </div>
                          )}
                          {workOrder.oldModuleType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="mobile-old-module-type">
                                {workOrder.oldModuleType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* GPS Coordinates - Green border - only show if at least one GPS value exists */}
                    {(workOrder.oldGps || workOrder.newGps) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-muted-foreground mb-2">GPS Coordinates</h4>
                        <div className="space-y-2">
                          {workOrder.oldGps && (
                            <div>
                              <p className="text-xs text-muted-foreground">Old GPS</p>
                              <a
                                href={`https://www.google.com/maps?q=${workOrder.oldGps}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary hover:underline"
                                data-testid="mobile-old-gps-link"
                              >
                                {workOrder.oldGps}
                              </a>
                            </div>
                          )}
                          {workOrder.newGps && (
                            <div>
                              <p className="text-xs text-muted-foreground">New GPS</p>
                              <a
                                href={`https://www.google.com/maps?q=${workOrder.newGps}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary hover:underline"
                                data-testid="mobile-new-gps-link"
                              >
                                {workOrder.newGps}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* New System - Cyan border - only show if has data */}
                    {(workOrder.newSystemId || workOrder.newSystemReading != null || workOrder.newSystemType) && (
                      <div className="border-l-4 border-l-cyan-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-cyan-500 mb-2">New System</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {workOrder.newSystemId && (
                            <div>
                              <p className="text-xs text-muted-foreground">System ID</p>
                              <p className="text-sm font-medium break-all" data-testid="mobile-new-system-id">
                                {workOrder.newSystemId}
                              </p>
                            </div>
                          )}
                          {workOrder.newSystemReading != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="mobile-new-system-reading">
                                {workOrder.newSystemReading}
                              </p>
                            </div>
                          )}
                          {workOrder.newSystemType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="mobile-new-system-type">
                                {workOrder.newSystemType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* New Module - Cyan border - only show if has data */}
                    {(workOrder.newModuleId || workOrder.newModuleRead != null || workOrder.newModuleType) && (
                      <div className="border-l-4 border-l-cyan-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-cyan-500 mb-2">New Module</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {workOrder.newModuleId && (
                            <div>
                              <p className="text-xs text-muted-foreground">Module ID</p>
                              <p className="text-sm font-medium break-all" data-testid="mobile-new-module-id">
                                {workOrder.newModuleId}
                              </p>
                            </div>
                          )}
                          {workOrder.newModuleRead != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="mobile-new-module-reading">
                                {workOrder.newModuleRead}
                              </p>
                            </div>
                          )}
                          {workOrder.newModuleType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="mobile-new-module-type">
                                {workOrder.newModuleType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Time Tracking - Purple border - only show if time tracking data exists */}
                    {timeTracking && (
                      <div className="border-l-4 border-l-purple-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-purple-500 mb-2">Time Tracking</h4>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-xs text-muted-foreground">Start Time</p>
                            <p className="text-sm font-medium" data-testid="mobile-start-time">
                              {formatDateTime(timeTracking.startTime)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">End Time</p>
                            <p className="text-sm font-medium" data-testid="mobile-end-time">
                              {formatDateTime(timeTracking.endTime)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Duration</p>
                            <p className="text-sm font-medium text-purple-600 dark:text-purple-400" data-testid="mobile-duration">
                              {formatElapsedTime(timeTracking.startTime, timeTracking.endTime)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Mobile edit form - shown on small screens when editing */}
                {mobileSystemEditMode && canEdit && (
                  <div className="md:hidden space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing System | Module Details</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileSystemEditMode(false)}
                        data-testid="button-mobile-system-done"
                      >
                        Done
                      </Button>
                    </div>

                    {/* Service Type */}
                    <FormField
                      control={form.control}
                      name="serviceType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Service Type *</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-mobile-service-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {serviceTypes.map((type) => (
                                <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Old System Section */}
                    <div className="border-l-4 border-l-green-500 pl-3 py-2 space-y-3">
                      <h4 className="text-sm font-medium text-green-500">Old System</h4>
                      <FormField
                        control={form.control}
                        name="oldSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="OLD-12345" 
                                data-testid="input-mobile-old-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-mobile-old-system-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-old-system-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {systemTypes.map((type) => (
                                  <SelectItem key={type.id} value={type.productId}>{type.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Old Module Section */}
                    <div className="border-l-4 border-l-green-500 pl-3 py-2 space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Old Module</h4>
                      <FormField
                        control={form.control}
                        name="oldModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-12345" 
                                data-testid="input-mobile-old-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-mobile-old-module-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-old-module-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {moduleTypes.map((type) => (
                                  <SelectItem key={type.id} value={type.productId}>{type.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* New System Section */}
                    <div className="border-l-4 border-l-cyan-500 pl-3 py-2 space-y-3">
                      <h4 className="text-sm font-medium text-cyan-500">New System</h4>
                      <FormField
                        control={form.control}
                        name="newSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="NEW-12345" 
                                data-testid="input-mobile-new-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-mobile-new-system-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-new-system-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {systemTypes.map((type) => (
                                  <SelectItem key={type.id} value={type.productId}>{type.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* New Module Section */}
                    <div className="border-l-4 border-l-cyan-500 pl-3 py-2 space-y-3">
                      <h4 className="text-sm font-medium text-cyan-500">New Module</h4>
                      <FormField
                        control={form.control}
                        name="newModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-NEW-12345" 
                                data-testid="input-mobile-new-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : "")}
                                placeholder="12345" 
                                data-testid="input-mobile-new-module-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-new-module-type">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {moduleTypes.map((type) => (
                                  <SelectItem key={type.id} value={type.productId}>{type.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Desktop read-only view - shown when not editing */}
                {(!desktopSystemEditMode || !canEdit) && (
                  <div className="hidden md:block space-y-4">
                    {/* Edit button for authorized users */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDesktopSystemEditMode(true)}
                          data-testid="button-desktop-system-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}
                    
                    {/* Service Type - always show */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Service Type</p>
                        <p className="text-sm font-medium" data-testid="desktop-service-type">
                          {serviceTypes.find(st => st.code === workOrder.serviceType)?.label || workOrder.serviceType || "-"}
                        </p>
                      </div>
                    </div>

                    {/* Old System - Green border - only show if has data */}
                    {(workOrder.oldSystemId || workOrder.oldSystemReading != null || workOrder.oldSystemType) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-green-500 mb-2">Old System</h4>
                        <div className="grid grid-cols-3 gap-4">
                          {workOrder.oldSystemId && (
                            <div>
                              <p className="text-xs text-muted-foreground">System ID</p>
                              <p className="text-sm font-medium break-all" data-testid="desktop-old-system-id">
                                {workOrder.oldSystemId}
                              </p>
                            </div>
                          )}
                          {workOrder.oldSystemReading != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="desktop-old-system-reading">
                                {workOrder.oldSystemReading}
                              </p>
                            </div>
                          )}
                          {workOrder.oldSystemType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="desktop-old-system-type">
                                {workOrder.oldSystemType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Old Module - Green border - only show if has data */}
                    {(workOrder.oldModuleId || workOrder.oldModuleRead != null || workOrder.oldModuleType) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-muted-foreground mb-2">Old Module</h4>
                        <div className="grid grid-cols-3 gap-4">
                          {workOrder.oldModuleId && (
                            <div>
                              <p className="text-xs text-muted-foreground">Module ID</p>
                              <p className="text-sm font-medium break-all" data-testid="desktop-old-module-id">
                                {workOrder.oldModuleId}
                              </p>
                            </div>
                          )}
                          {workOrder.oldModuleRead != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="desktop-old-module-reading">
                                {workOrder.oldModuleRead}
                              </p>
                            </div>
                          )}
                          {workOrder.oldModuleType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="desktop-old-module-type">
                                {workOrder.oldModuleType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* GPS Coordinates - Green border - only show if at least one GPS value exists */}
                    {(workOrder.oldGps || workOrder.newGps) && (
                      <div className="border-l-4 border-l-green-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-muted-foreground mb-2">GPS Coordinates</h4>
                        <div className="grid grid-cols-2 gap-4">
                          {workOrder.oldGps && (
                            <div>
                              <p className="text-xs text-muted-foreground">Old GPS</p>
                              <a
                                href={`https://www.google.com/maps?q=${workOrder.oldGps}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary hover:underline"
                                data-testid="desktop-old-gps-link"
                              >
                                {workOrder.oldGps}
                              </a>
                            </div>
                          )}
                          {workOrder.newGps && (
                            <div>
                              <p className="text-xs text-muted-foreground">New GPS</p>
                              <a
                                href={`https://www.google.com/maps?q=${workOrder.newGps}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary hover:underline"
                                data-testid="desktop-new-gps-link"
                              >
                                {workOrder.newGps}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* New System - Cyan border - only show if has data */}
                    {(workOrder.newSystemId || workOrder.newSystemReading != null || workOrder.newSystemType) && (
                      <div className="border-l-4 border-l-cyan-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-cyan-500 mb-2">New System</h4>
                        <div className="grid grid-cols-3 gap-4">
                          {workOrder.newSystemId && (
                            <div>
                              <p className="text-xs text-muted-foreground">System ID</p>
                              <p className="text-sm font-medium break-all" data-testid="desktop-new-system-id">
                                {workOrder.newSystemId}
                              </p>
                            </div>
                          )}
                          {workOrder.newSystemReading != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="desktop-new-system-reading">
                                {workOrder.newSystemReading}
                              </p>
                            </div>
                          )}
                          {workOrder.newSystemType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="desktop-new-system-type">
                                {workOrder.newSystemType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* New Module - Cyan border - only show if has data */}
                    {(workOrder.newModuleId || workOrder.newModuleRead != null || workOrder.newModuleType) && (
                      <div className="border-l-4 border-l-cyan-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-cyan-500 mb-2">New Module</h4>
                        <div className="grid grid-cols-3 gap-4">
                          {workOrder.newModuleId && (
                            <div>
                              <p className="text-xs text-muted-foreground">Module ID</p>
                              <p className="text-sm font-medium break-all" data-testid="desktop-new-module-id">
                                {workOrder.newModuleId}
                              </p>
                            </div>
                          )}
                          {workOrder.newModuleRead != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Reading</p>
                              <p className="text-sm font-medium" data-testid="desktop-new-module-reading">
                                {workOrder.newModuleRead}
                              </p>
                            </div>
                          )}
                          {workOrder.newModuleType && (
                            <div>
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="text-sm font-medium" data-testid="desktop-new-module-type">
                                {workOrder.newModuleType}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Time Tracking - Purple border - only show if time tracking data exists */}
                    {timeTracking && (
                      <div className="border-l-4 border-l-purple-500 pl-3 py-2">
                        <h4 className="text-base font-semibold text-purple-500 mb-2">Time Tracking</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground">Start Time</p>
                            <p className="text-sm font-medium" data-testid="desktop-start-time">
                              {formatDateTime(timeTracking.startTime)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">End Time</p>
                            <p className="text-sm font-medium" data-testid="desktop-end-time">
                              {formatDateTime(timeTracking.endTime)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Duration</p>
                            <p className="text-sm font-medium text-purple-600 dark:text-purple-400" data-testid="desktop-duration">
                              {formatElapsedTime(timeTracking.startTime, timeTracking.endTime)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Signature - show if signature exists */}
                    {((workOrder as any)?.signatureData || (workOrder as any)?.signatureName) && (
                      <div className="border-t pt-4 mt-2">
                        <h4 className="text-sm font-medium mb-3 text-muted-foreground">Signature</h4>
                        <div className="space-y-2">
                          {(workOrder as any)?.signatureName && (
                            <div>
                              <p className="text-xs text-muted-foreground">Name</p>
                              <p className="text-sm font-medium" data-testid="desktop-signature-name">
                                {(workOrder as any).signatureName}
                              </p>
                            </div>
                          )}
                          {(workOrder as any)?.signatureData && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Signature</p>
                              <img 
                                src={(workOrder as any).signatureData} 
                                alt="Signature" 
                                className="max-h-24 border rounded bg-white"
                                data-testid="desktop-signature-image"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Desktop edit form - shown when editing */}
                {desktopSystemEditMode && canEdit && (
                  <div className="hidden md:block space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing System | Module Details</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDesktopSystemEditMode(false)}
                        data-testid="button-desktop-system-done"
                      >
                        Done
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="serviceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                          <FormControl>
                            <SelectTrigger data-testid="select-service-type" disabled={!canEdit}>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {serviceTypes.map((type) => (
                              <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Old System Section */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">Old System</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="oldSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="OLD-12345" 
                                disabled={!canEdit}
                                data-testid="input-old-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="12345" 
                                disabled={!canEdit}
                                data-testid="input-old-system-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <div className="flex gap-1">
                              <Select 
                                value={field.value || "__none__"} 
                                onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                                disabled={!canEdit}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-old-system-type" className="flex-1" disabled={!canEdit}>
                                    <SelectValue placeholder="Select type..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">None</SelectItem>
                                  {Array.isArray(systemTypes) && systemTypes.map((mt) => (
                                    <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {canEdit && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    openCreateSystemTypeDialog("editOldSystemType");
                                  }}
                                  data-testid="button-create-old-system-type"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Old Module Section */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">Old Module</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="oldModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-12345" 
                                disabled={!canEdit}
                                data-testid="input-old-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="12345" 
                                disabled={!canEdit}
                                data-testid="input-old-module-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="oldModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                              disabled={!canEdit}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-old-module-type" disabled={!canEdit}>
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {Array.isArray(moduleTypes) && moduleTypes.map((mt) => (
                                  <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* GPS Coordinates Section */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">GPS Coordinates</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="oldGps"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Old GPS</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <GPSCapture 
                                  value={field.value || ""} 
                                  onChange={field.onChange} 
                                  placeholder="40.7128,-74.0060" 
                                  disabled={!canEdit}
                                  data-testid="input-old-gps" 
                                />
                              </FormControl>
                              {field.value && (
                                <a
                                  href={`https://www.google.com/maps?q=${field.value}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1 text-sm whitespace-nowrap"
                                  data-testid="link-view-old-gps-map"
                                >
                                  <MapPin className="h-4 w-4" />
                                  View Map
                                </a>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newGps"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New GPS</FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <GPSCapture 
                                  value={field.value || ""} 
                                  onChange={field.onChange} 
                                  placeholder="40.7128,-74.0060" 
                                  disabled={!canEdit}
                                  data-testid="input-new-gps" 
                                />
                              </FormControl>
                              {field.value && (
                                <a
                                  href={`https://www.google.com/maps?q=${field.value}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1 text-sm whitespace-nowrap"
                                  data-testid="link-view-new-gps-map"
                                >
                                  <MapPin className="h-4 w-4" />
                                  View Map
                                </a>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* New System Section */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">New System</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="newSystemId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>System ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="NEW-67890" 
                                disabled={!canEdit}
                                data-testid="input-new-system-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newSystemReading"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="67890" 
                                disabled={!canEdit}
                                data-testid="input-new-system-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newSystemType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <div className="flex gap-1">
                              <Select 
                                value={field.value || "__none__"} 
                                onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                                disabled={!canEdit}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-new-system-type" className="flex-1" disabled={!canEdit}>
                                    <SelectValue placeholder="Select type..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">None</SelectItem>
                                  {Array.isArray(systemTypes) && systemTypes.map((mt) => (
                                    <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {canEdit && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    openCreateSystemTypeDialog("editNewSystemType");
                                  }}
                                  data-testid="button-create-new-system-type"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* New Module Section */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-3 text-muted-foreground">New Module</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="newModuleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Module ID</FormLabel>
                            <FormControl>
                              <ScannerInput 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="MOD-67890" 
                                disabled={!canEdit}
                                data-testid="input-new-module-id" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleRead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reading</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                value={field.value ?? ""} 
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : "")}
                                placeholder="67890" 
                                disabled={!canEdit}
                                data-testid="input-new-module-reading" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="newModuleType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select 
                              value={field.value || "__none__"} 
                              onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                              disabled={!canEdit}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-new-module-type" disabled={!canEdit}>
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {Array.isArray(moduleTypes) && moduleTypes.map((mt) => (
                                  <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Signature */}
                  <div className="md:col-span-2 border-t pt-4 mt-2">
                    <SignaturePad 
                      ref={signaturePadRef}
                      initialSignatureData={(workOrder as any)?.signatureData}
                      initialSignatureName={(workOrder as any)?.signatureName}
                      disabled={!canEdit}
                    />
                  </div>
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Scheduling & Assignments */}
            <AccordionItem value="scheduling" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-scheduling">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="font-medium">Scheduling & Assignment</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {/* Mobile read-only display */}
                {(!mobileSchedulingEditMode || !canEdit) && (
                  <div className="md:hidden space-y-3">
                    {/* Action buttons for authorized users */}
                    {(canEdit || (canScheduleInCalendar && onScheduleInCalendar && workOrder.status !== "Completed" && workOrder.status !== "Closed")) && (
                      <div className="flex justify-end gap-2 mb-2 flex-wrap">
                        {canScheduleInCalendar && onScheduleInCalendar && workOrder.status !== "Completed" && workOrder.status !== "Closed" && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={onScheduleInCalendar}
                            data-testid="button-mobile-schedule-in-calendar-readonly"
                            className="bg-blue-600 text-white dark:bg-blue-600"
                          >
                            <CalendarDays className="h-4 w-4 mr-1" />
                            Schedule in Calendar
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setMobileSchedulingEditMode(true)}
                            data-testid="button-mobile-scheduling-edit"
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Status - always show */}
                    {workOrder.status && (
                      <div className="flex items-start gap-3">
                        <Flag className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground">Status</p>
                          <p className="text-sm font-medium" data-testid="mobile-status">
                            {workOrder.status}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Assigned User - only show if has value */}
                    {workOrder.assignedUserId && getAssignedUserName(workOrder.assignedUserId) && (
                      <div className="flex items-start gap-3">
                        <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground">Assigned User</p>
                          <p className="text-sm font-medium" data-testid="mobile-assigned-user">
                            {getAssignedUserName(workOrder.assignedUserId)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Assigned Group - only show if has value */}
                    {workOrder.assignedGroupId && (
                      <div className="flex items-start gap-3">
                        <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground">Assigned Group</p>
                          <p className="text-sm font-medium" data-testid="mobile-assigned-group">
                            {workOrder.assignedGroupId}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Scheduled At - only show if has value */}
                    {(workOrder as any).scheduledAt && (
                      <div className="flex items-start gap-3">
                        <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground">Scheduled At</p>
                          <p className="text-sm font-medium" data-testid="mobile-scheduled-at">
                            {formatDateTime((workOrder as any).scheduledAt)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Trouble Code - only show if has value */}
                    {workOrder.trouble && (
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-xs text-muted-foreground">Trouble Code</p>
                          <p className="text-sm font-medium" data-testid="mobile-trouble-code">
                            {workOrder.trouble}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Mobile edit form */}
                {mobileSchedulingEditMode && canEdit && (
                  <div className="md:hidden space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing Scheduling & Assignment</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileSchedulingEditMode(false)}
                        data-testid="button-mobile-scheduling-done"
                      >
                        Done
                      </Button>
                    </div>

                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select 
                            value={field.value || workOrder.status} 
                            onValueChange={(newStatus) => {
                              field.onChange(newStatus);
                              const currentScheduledAt = form.getValues("scheduledAt");
                              if (currentScheduledAt && newStatus !== "Scheduled") {
                                toast({
                                  title: "Schedule will be cleared",
                                  description: "Changing status from Scheduled will clear the scheduled date/time.",
                                });
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-mobile-status">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {workOrderStatuses.map((s) => (
                                <SelectItem key={s.id} value={s.code}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="scheduledAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Scheduled At</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={field.value}
                              onChange={field.onChange}
                              data-testid="input-mobile-scheduled-at"
                              className={scheduledAtWarning ? "border-destructive" : ""}
                              placeholder="Select schedule date/time"
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground mt-1">Setting a date/time will auto-set status to "Scheduled"</p>
                          {scheduledAtWarning && (
                            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {scheduledAtWarning}
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="assignedUserId"
                      render={({ field }) => {
                        const displayValue = watchedAssignedUserId || "__none__";
                        return (
                          <FormItem>
                            <FormLabel>Assigned User</FormLabel>
                            <Select 
                              key={`mobile-assigned-user-${displayValue}`}
                              value={displayValue} 
                              onValueChange={(v) => {
                                const newValue = v === "__none__" ? undefined : v;
                                form.setValue('assignedUserId', newValue, { shouldDirty: true });
                              }}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-assigned-user">
                                  <SelectValue placeholder="Select user..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {assigneesData?.users?.map((user: { id: string; label: string }) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                    <FormField
                      control={form.control}
                      name="assignedGroupId"
                      render={({ field }) => {
                        const displayValue = watchedAssignedGroupId || "__none__";
                        return (
                          <FormItem>
                            <FormLabel>Assigned Group</FormLabel>
                            <Select 
                              key={`mobile-assigned-group-${displayValue}`}
                              value={displayValue} 
                              onValueChange={(v) => {
                                const newValue = v === "__none__" ? undefined : v;
                                form.setValue('assignedGroupId', newValue, { shouldDirty: true });
                              }}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-mobile-assigned-group">
                                  <SelectValue placeholder="Select group..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {assigneesData?.groups?.map((group: { id: number; key?: string; label: string }) => (
                                  <SelectItem key={group.id} value={group.key || group.label}>
                                    {group.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                    <FormField
                      control={form.control}
                      name="trouble"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Trouble Code</FormLabel>
                          <Select value={(field.value as string) || "__none__"} onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)}>
                            <FormControl>
                              <SelectTrigger data-testid="select-mobile-trouble">
                                <SelectValue placeholder="Select trouble code..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {troubleCodes.map((tc) => (
                                <SelectItem key={tc.id} value={tc.code}>
                                  {tc.code} - {tc.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Desktop read-only view - shown when not editing */}
                {(!desktopSchedulingEditMode || !canEdit) && (
                  <div className="hidden md:block space-y-4">
                    {/* Action buttons for authorized users */}
                    {(canEdit || (canScheduleInCalendar && onScheduleInCalendar && workOrder.status !== "Completed" && workOrder.status !== "Closed")) && (
                      <div className="flex justify-end gap-2 mb-2 flex-wrap">
                        {canScheduleInCalendar && onScheduleInCalendar && workOrder.status !== "Completed" && workOrder.status !== "Closed" && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={onScheduleInCalendar}
                            data-testid="button-desktop-schedule-in-calendar-readonly"
                            className="bg-blue-600 text-white dark:bg-blue-600"
                          >
                            <CalendarDays className="h-4 w-4 mr-1" />
                            Schedule in Calendar
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setDesktopSchedulingEditMode(true)}
                            data-testid="button-desktop-scheduling-edit"
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Status - always show */}
                      <div>
                        <p className="text-xs text-muted-foreground">Status</p>
                        <p className="text-sm font-medium" data-testid="desktop-status">{workOrder.status || "-"}</p>
                      </div>
                      
                      {/* Assigned User - show if has value */}
                      {workOrder.assignedUserId && getAssignedUserName(workOrder.assignedUserId) && (
                        <div>
                          <p className="text-xs text-muted-foreground">Assigned User</p>
                          <p className="text-sm font-medium" data-testid="desktop-assigned-user">
                            {(workOrder as any).assignedUserDisplay || getAssignedUserName(workOrder.assignedUserId)}
                          </p>
                        </div>
                      )}
                      
                      {/* Assigned Group - show if has value */}
                      {workOrder.assignedGroupId && (
                        <div>
                          <p className="text-xs text-muted-foreground">Assigned Group</p>
                          <p className="text-sm font-medium" data-testid="desktop-assigned-group">
                            {assigneesData?.groups?.find((g: { id: number; key?: string; label: string }) => 
                              g.key === workOrder.assignedGroupId || g.label === workOrder.assignedGroupId
                            )?.label || workOrder.assignedGroupId}
                          </p>
                        </div>
                      )}
                      
                      {/* Scheduled At - show if has value */}
                      {workOrder.scheduledAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Scheduled At</p>
                          <p className="text-sm font-medium" data-testid="desktop-scheduled-at">
                            {formatDateTime(workOrder.scheduledAt)}
                          </p>
                        </div>
                      )}
                      
                      {/* Trouble Code - show if has value */}
                      {workOrder.trouble && (
                        <div>
                          <p className="text-xs text-muted-foreground">Trouble Code</p>
                          <p className="text-sm font-medium" data-testid="desktop-trouble-code">
                            {troubleCodes.find(tc => tc.code === workOrder.trouble)?.label 
                              ? `${workOrder.trouble} - ${troubleCodes.find(tc => tc.code === workOrder.trouble)?.label}`
                              : workOrder.trouble}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Desktop edit form - shown when editing */}
                {desktopSchedulingEditMode && canEdit && (
                  <div className="hidden md:block space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing Scheduling & Assignment</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDesktopSchedulingEditMode(false)}
                        data-testid="button-desktop-scheduling-done"
                      >
                        Done
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select 
                          value={field.value || workOrder.status} 
                          onValueChange={(newStatus) => {
                            field.onChange(newStatus);
                            const currentScheduledAt = form.getValues("scheduledAt");
                            if (currentScheduledAt && newStatus !== "Scheduled") {
                              toast({
                                title: "Schedule will be cleared",
                                description: "Changing status from Scheduled will clear the scheduled date/time.",
                              });
                            }
                          }}
                          disabled={!canEdit}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-status" disabled={!canEdit}>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {workOrderStatuses.map((s) => (
                              <SelectItem key={s.id} value={s.code}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="scheduledAt"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-2">
                          <FormLabel>Scheduled At</FormLabel>
                          {canScheduleInCalendar && onScheduleInCalendar && workOrder.status !== "Completed" && workOrder.status !== "Closed" && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={onScheduleInCalendar}
                              data-testid="button-schedule-in-calendar"
                              className="bg-blue-600 text-white dark:bg-blue-600"
                            >
                              <CalendarDays className="h-4 w-4 mr-1" />
                              Schedule in Calendar
                            </Button>
                          )}
                        </div>
                        <FormControl>
                          <DateTimePicker
                            value={field.value}
                            onChange={field.onChange}
                            disabled={!canEdit}
                            data-testid="input-scheduled-at"
                            className={scheduledAtWarning ? "border-destructive" : ""}
                            placeholder="Select schedule date/time"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground mt-1">Setting a date/time will auto-set status to "Scheduled"</p>
                        {scheduledAtWarning && (
                          <p className="text-xs text-destructive mt-1 flex items-center gap-1" data-testid="text-operational-hours-warning">
                            <AlertTriangle className="h-3 w-3" />
                            {scheduledAtWarning}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="assignedUserId"
                    render={({ field }) => {
                      // Use watched value for display to ensure UI updates reactively
                      const displayValue = watchedAssignedUserId || "__none__";
                      return (
                        <FormItem>
                          <FormLabel>Assigned User</FormLabel>
                          <Select 
                            key={`assigned-user-${displayValue}`}
                            value={displayValue} 
                            onValueChange={(v) => {
                              // Use form.setValue for proper state updates, especially when clearing to undefined
                              const newValue = v === "__none__" ? undefined : v;
                              form.setValue('assignedUserId', newValue, { shouldDirty: true });
                            }} 
                            disabled={!canEdit}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-assigned-user" disabled={!canEdit}>
                                <SelectValue placeholder="Select user..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {assigneesData?.users?.map((user: { id: string; label: string }) => (
                                <SelectItem key={user.id} value={user.id}>
                                  {user.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="assignedGroupId"
                    render={({ field }) => {
                      const displayValue = watchedAssignedGroupId || "__none__";
                      return (
                        <FormItem>
                          <FormLabel>Assigned Group</FormLabel>
                          <Select 
                            key={`assigned-group-${displayValue}`}
                            value={displayValue} 
                            onValueChange={(v) => {
                              const newValue = v === "__none__" ? undefined : v;
                              form.setValue('assignedGroupId', newValue, { shouldDirty: true });
                            }} 
                            disabled={!canEdit}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-assigned-group" disabled={!canEdit}>
                                <SelectValue placeholder="Select group..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {assigneesData?.groups?.map((group: { id: number; key?: string; label: string }) => (
                                <SelectItem key={group.id} value={group.key || group.label}>
                                  {group.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="trouble"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trouble Code</FormLabel>
                        <Select value={(field.value as string) || "__none__"} onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)} disabled={!canEdit}>
                          <FormControl>
                            <SelectTrigger data-testid="select-trouble" disabled={!canEdit}>
                              <SelectValue placeholder="Select trouble code..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {troubleCodes.map((tc) => (
                              <SelectItem key={tc.id} value={tc.code}>
                                {tc.code} - {tc.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Notes */}
            <AccordionItem value="notes" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-notes">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">Notes</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {/* Mobile read-only display */}
                {(!mobileNotesEditMode || !canEdit) && (
                  <div className="md:hidden">
                    {/* Edit button for authorized users */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMobileNotesEditMode(true)}
                          data-testid="button-mobile-notes-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap" data-testid="mobile-notes-display">
                      {workOrder.notes || "No notes"}
                    </p>
                  </div>
                )}

                {/* Mobile edit form */}
                {mobileNotesEditMode && canEdit && (
                  <div className="md:hidden">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing Notes</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileNotesEditMode(false)}
                        data-testid="button-mobile-notes-done"
                      >
                        Done
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea 
                              {...field} 
                              value={field.value || ""} 
                              placeholder="Additional notes about this work order..." 
                              className="min-h-[120px]"
                              data-testid="input-mobile-notes" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Desktop read-only view - shown when not editing */}
                {(!desktopNotesEditMode || !canEdit) && (
                  <div className="hidden md:block">
                    {/* Edit button for authorized users */}
                    {canEdit && (
                      <div className="flex justify-end mb-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDesktopNotesEditMode(true)}
                          data-testid="button-desktop-notes-edit"
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap" data-testid="desktop-notes-display">
                      {workOrder.notes || "No notes"}
                    </p>
                  </div>
                )}

                {/* Desktop edit form - shown when editing */}
                {desktopNotesEditMode && canEdit && (
                  <div className="hidden md:block">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Editing Notes</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDesktopNotesEditMode(false)}
                        data-testid="button-desktop-notes-done"
                      >
                        Done
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea 
                              {...field} 
                              value={field.value || ""} 
                              placeholder="Additional notes about this work order..." 
                              className="min-h-[120px]"
                              data-testid="input-notes" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Attachments */}
            <AccordionItem value="attachments" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-attachments">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-primary" />
                  <span className="font-medium">Attachments</span>
                  <Badge variant="secondary" className="ml-2">{workOrderFiles.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {filesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading attachments...</p>
                ) : workOrderFiles.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 px-3 bg-muted rounded-md">
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">No attachments yet</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workOrderFiles.map((filename, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted"
                        data-testid={`attachment-${index}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate">{filename}</span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <a
                            href={`/api/projects/${projectId}/work-orders/${workOrder.id}/files/${encodeURIComponent(filename)}/download?mode=view`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button type="button" variant="ghost" size="icon" data-testid={`button-view-attachment-${index}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </a>
                          <a
                            href={`/api/projects/${projectId}/work-orders/${workOrder.id}/files/${encodeURIComponent(filename)}/download`}
                            download
                          >
                            <Button type="button" variant="ghost" size="icon" data-testid={`button-download-attachment-${index}`}>
                              <Download className="h-4 w-4" />
                            </Button>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <Link href={`/projects/${projectId}/work-orders/${workOrder.id}/files?returnTo=detail`}>
                    <Button type="button" variant="outline" size="sm" data-testid="button-manage-attachments">
                      <Upload className="h-4 w-4 mr-2" />
                      Manage Attachments
                    </Button>
                  </Link>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Audit History */}
            <AccordionItem value="audit" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-audit">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-medium">Audit Information</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {/* Mobile two-column layout */}
                <div className="md:hidden space-y-3">
                  {/* Created By / Created At - only show if has data */}
                  {(workOrder.createdBy || workOrder.createdAt) && (
                    <div className="grid grid-cols-2 gap-4">
                      {workOrder.createdBy && (
                        <div>
                          <p className="text-xs text-muted-foreground">Created By</p>
                          <p className="text-sm font-medium" data-testid="mobile-created-by">
                            {workOrder.createdBy}
                          </p>
                        </div>
                      )}
                      {workOrder.createdAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Created At</p>
                          <p className="text-sm font-medium" data-testid="mobile-created-at">
                            {formatDateTime(workOrder.createdAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Updated By / Updated At - only show if has data */}
                  {(workOrder.updatedBy || workOrder.updatedAt) && (
                    <div className="grid grid-cols-2 gap-4">
                      {workOrder.updatedBy && (
                        <div>
                          <p className="text-xs text-muted-foreground">Updated By</p>
                          <p className="text-sm font-medium" data-testid="mobile-updated-by">
                            {workOrder.updatedBy}
                          </p>
                        </div>
                      )}
                      {workOrder.updatedAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Updated At</p>
                          <p className="text-sm font-medium" data-testid="mobile-updated-at">
                            {formatDateTime(workOrder.updatedAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Scheduled By / Scheduled At - only show if has data */}
                  {((workOrder as any).scheduledBy || (workOrder as any).scheduledByDisplay || (workOrder as any).scheduledAt) && (
                    <div className="grid grid-cols-2 gap-4">
                      {((workOrder as any).scheduledBy || (workOrder as any).scheduledByDisplay) && (
                        <div>
                          <p className="text-xs text-muted-foreground">Scheduled By</p>
                          <p className="text-sm font-medium" data-testid="mobile-scheduled-by">
                            {(workOrder as any).scheduledByDisplay || getAssignedUserName((workOrder as any).scheduledBy)}
                          </p>
                        </div>
                      )}
                      {(workOrder as any).scheduledAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Scheduled At</p>
                          <p className="text-sm font-medium" data-testid="mobile-audit-scheduled-at">
                            {formatDateTime((workOrder as any).scheduledAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Completed By / Completed At - only show if has data */}
                  {((workOrder as any).completedBy || (workOrder as any).completedByDisplay || (workOrder as any).completedAt) && (
                    <div className="grid grid-cols-2 gap-4">
                      {((workOrder as any).completedBy || (workOrder as any).completedByDisplay) && (
                        <div>
                          <p className="text-xs text-muted-foreground">Completed By</p>
                          <p className="text-sm font-medium" data-testid="mobile-completed-by">
                            {(workOrder as any).completedByDisplay || getAssignedUserName((workOrder as any).completedBy)}
                          </p>
                        </div>
                      )}
                      {(workOrder as any).completedAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Completed At</p>
                          <p className="text-sm font-medium" data-testid="mobile-completed-at">
                            {formatDateTime((workOrder as any).completedAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Desktop read-only view - only show fields with values */}
                <div className="hidden md:block space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Created By / Created At - only show if has data */}
                    {workOrder.createdBy && (
                      <div>
                        <p className="text-xs text-muted-foreground">Created By</p>
                        <p className="text-sm font-medium" data-testid="desktop-created-by">{workOrder.createdBy}</p>
                      </div>
                    )}
                    {workOrder.createdAt && (
                      <div>
                        <p className="text-xs text-muted-foreground">Created At</p>
                        <p className="text-sm font-medium" data-testid="desktop-created-at">{formatDateTime(workOrder.createdAt)}</p>
                      </div>
                    )}
                    
                    {/* Updated By / Updated At - only show if has data */}
                    {workOrder.updatedBy && (
                      <div>
                        <p className="text-xs text-muted-foreground">Updated By</p>
                        <p className="text-sm font-medium" data-testid="desktop-updated-by">{workOrder.updatedBy}</p>
                      </div>
                    )}
                    {workOrder.updatedAt && (
                      <div>
                        <p className="text-xs text-muted-foreground">Updated At</p>
                        <p className="text-sm font-medium" data-testid="desktop-updated-at">{formatDateTime(workOrder.updatedAt)}</p>
                      </div>
                    )}
                    
                    {/* Scheduled By / Scheduled At - only show if has data */}
                    {((workOrder as any).scheduledBy || (workOrder as any).scheduledByDisplay) && (
                      <div>
                        <p className="text-xs text-muted-foreground">Scheduled By</p>
                        <p className="text-sm font-medium" data-testid="desktop-scheduled-by">
                          {(workOrder as any).scheduledByDisplay || getAssignedUserName((workOrder as any).scheduledBy)}
                        </p>
                      </div>
                    )}
                    {(workOrder as any).scheduledAt && (
                      <div>
                        <p className="text-xs text-muted-foreground">Scheduled At</p>
                        <p className="text-sm font-medium" data-testid="desktop-audit-scheduled-at">{formatDateTime((workOrder as any).scheduledAt)}</p>
                      </div>
                    )}
                    
                    {/* Completed By / Completed At - only show if has data */}
                    {((workOrder as any).completedBy || (workOrder as any).completedByDisplay) && (
                      <div>
                        <p className="text-xs text-muted-foreground">Completed By</p>
                        <p className="text-sm font-medium" data-testid="desktop-completed-by">
                          {(workOrder as any).completedByDisplay || getAssignedUserName((workOrder as any).completedBy)}
                        </p>
                      </div>
                    )}
                    {workOrder.completedAt && (
                      <div>
                        <p className="text-xs text-muted-foreground">Completed At</p>
                        <p className="text-sm font-medium" data-testid="desktop-completed-at">{formatDateTime(workOrder.completedAt)}</p>
                      </div>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Sticky Footer */}
          <div className="sticky bottom-0 bg-background border-t py-4 -mx-4 px-4 md:-mx-6 md:px-6">
            <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={onBack} data-testid="button-cancel">
                  {canEdit ? "Cancel" : "Back"}
                </Button>
                {canEdit && (
                  <Button 
                    type="button" 
                    disabled={isSubmitting} 
                    data-testid="button-save"
                    onClick={() => {
                      form.handleSubmit(
                        (data) => {
                          alert("handleSubmit success callback reached!");
                          onSubmit(data);
                        },
                        (errors) => {
                          alert("Form validation errors: " + JSON.stringify(errors, null, 2));
                        }
                      )();
                    }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                )}
            </div>
          </div>
        </form>
      </Form>

      {/* System Changeout Wizard */}
      <SystemChangeoutWizard
        isOpen={showSystemChangeoutWizard}
        onClose={() => setShowSystemChangeoutWizard(false)}
        workOrderId={workOrder.id}
        customerWoId={workOrder.customerWoId || `WO-${workOrder.id}`}
        address={workOrder.address}
        oldSystemId={workOrder.oldSystemId}
        oldSystemType={workOrder.oldSystemType}
        newSystemType={workOrder.newSystemType}
        oldModuleId={workOrder.oldModuleId}
        oldModuleType={workOrder.oldModuleType}
        newModuleType={workOrder.newModuleType}
        status={workOrder.status}
        trouble={workOrder.trouble}
        notes={workOrder.notes}
        projectId={typeof projectId === 'string' ? parseInt(projectId) : projectId}
        troubleCodes={troubleCodes}
        existingOldReading={workOrder.oldSystemReading != null ? String(workOrder.oldSystemReading) : null}
        existingNewReading={workOrder.newSystemReading != null ? String(workOrder.newSystemReading) : null}
        existingOldModuleReading={workOrder.oldModuleRead != null ? String(workOrder.oldModuleRead) : null}
        existingNewModuleReading={workOrder.newModuleRead != null ? String(workOrder.newModuleRead) : null}
        existingGps={workOrder.newGps}
        oldGps={workOrder.oldGps}
        wizardConfig={wizardConfig}
        searchMethodSettings={searchMethodSettings}
        onComplete={async (data) => {
          const formData = new FormData();
          
          const allPhotos: File[] = [];
          const photoTypes: string[] = [];
          
          if (data.canChange) {
            data.beforePhotos.forEach((p) => {
              allPhotos.push(p.file);
              photoTypes.push("before");
            });
            data.afterPhotos.forEach((p) => {
              allPhotos.push(p.file);
              photoTypes.push("after");
            });
          } else {
            data.troublePhotos.forEach((p) => {
              allPhotos.push(p.file);
              photoTypes.push("trouble");
            });
          }
          
          allPhotos.forEach((file) => {
            formData.append("photos", file);
          });
          
          formData.append("data", JSON.stringify({
            canChange: data.canChange,
            troubleCode: data.troubleCode,
            troubleNote: data.troubleNote,
            oldSystemReading: data.oldSystemReading,
            oldModuleReading: data.oldModuleReading,
            newSystemId: data.newSystemId,
            newSystemReading: data.newSystemReading,
            newModuleId: data.newModuleId,
            newModuleReading: data.newModuleReading,
            newSystemType: data.newSystemType,
            newModuleType: data.newModuleType,
            gpsCoordinates: data.gpsCoordinates,
            completionNotes: data.completionNotes,
            signatureData: data.signatureData,
            signatureName: data.signatureName,
            photoTypes,
            changeoutScope,
            isReadingOnly: data.isReadingOnly,
          }));
          
          const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrder.id}/system-changeout`, {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Failed to submit system changeout");
          }
          
          if (onSystemChangeoutComplete) {
            await onSystemChangeoutComplete();
          }
        }}
      />

    </div>
  );
}
