import { useState, useRef, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Link } from "wouter";
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
  ArrowLeft,
  Save,
  Loader2,
  User,
  MapPin,
  Gauge,
  Calendar,
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

interface WorkOrderDetailProps {
  workOrder: any;
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  onBack: () => void;
  isSubmitting: boolean;
  projectId: string | number;
  cameFromSearch?: boolean;
  serviceTypes: Array<{ id: number; code: string; label: string; color?: string | null }>;
  systemTypes: Array<{ id: number; productId: string; productLabel: string }>;
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
  operationalHours?: OperationalHoursConfig;
}

export function WorkOrderDetail({
  workOrder,
  form,
  onSubmit,
  onBack,
  isSubmitting,
  projectId,
  cameFromSearch,
  serviceTypes = [],
  systemTypes = [],
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
  operationalHours,
}: WorkOrderDetailProps) {
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [showSystemChangeoutWizard, setShowSystemChangeoutWizard] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const autoLaunchTriggered = useRef(false);
  
  // Watch form fields for header display - ensures UI updates immediately when form values change
  // Using useWatch hook for proper subscription to form updates
  const watchedAssignedUserId = useWatch({ control: form.control, name: 'assignedUserId' });
  const watchedAssignedGroupId = useWatch({ control: form.control, name: 'assignedGroupId' });
  const watchedScheduledAt = useWatch({ control: form.control, name: 'scheduledAt' });

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

  // Claim work order and open system changeout wizard
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

  // Auto-launch system changeout wizard if requested (with claim)
  useEffect(() => {
    if (autoLaunchSystemChangeout && canSystemChangeout && !autoLaunchTriggered.current) {
      autoLaunchTriggered.current = true;
      // Wrap in async IIFE to ensure claim completes before wizard opens
      void (async () => {
        await handleStartSystemChangeout();
      })();
    }
  }, [autoLaunchSystemChangeout, canSystemChangeout, handleStartSystemChangeout]);

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

  const getServiceTypeBadge = (serviceTypeCode: string | null | undefined) => {
    if (!serviceTypeCode) return null;
    const serviceType = serviceTypes.find(st => st.code === serviceTypeCode);
    if (!serviceType) return <Badge variant="outline">{serviceTypeCode}</Badge>;
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        {serviceType.label}
      </Badge>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Read-Only Banner */}
      {!canEdit && (
        <div className="flex items-center gap-2 p-3 bg-muted border rounded-md" data-testid="banner-read-only">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">You are viewing this work order in read-only mode.</span>
        </div>
      )}

      {/* Back Navigation */}
      <div className="mb-2">
        {cameFromSearch ? (
          <Link href="/search">
            <Button 
              variant="ghost" 
              size="sm"
              data-testid="button-back-to-search"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Search
            </Button>
          </Link>
        ) : (
          <Button 
            variant="ghost" 
            size="sm"
            onClick={onBack}
            data-testid="button-back-to-work-orders"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Work Orders
          </Button>
        )}
      </div>

      {/* Summary Header Card */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            {/* Left: Key Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl md:text-2xl font-bold" data-testid="text-work-order-title">
                  {workOrder.customerWoId || `WO #${workOrder.id}`}
                </h1>
                {getStatusBadge(workOrder.status)}
                {getServiceTypeBadge(workOrder.serviceType)}
              </div>
              
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {workOrder.customerName && (
                  <div className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    <span>{workOrder.customerName}</span>
                  </div>
                )}
                {workOrder.address && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    <span>{workOrder.address}{workOrder.city ? `, ${workOrder.city}` : ""}</span>
                  </div>
                )}
                {watchedScheduledAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    <span>Scheduled: {formatDateTime(watchedScheduledAt)}</span>
                  </div>
                )}
                {watchedAssignedUserId && (
                  <div className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    <span>Assigned: {(workOrder as any).assignedUserDisplay || getAssignedUserName(watchedAssignedUserId) || "-"}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Quick Actions */}
            <div className="flex gap-2 flex-wrap">
              {canSystemChangeout && workOrder.status !== 'Completed' && (
                <Button 
                  size="sm" 
                  onClick={handleStartSystemChangeout}
                  disabled={isClaiming}
                  data-testid="button-start-system-changeout"
                  className="bg-green-600 text-white dark:bg-green-600"
                >
                  {isClaiming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Claiming...
                    </>
                  ) : (
                    <>
                      <Wrench className="h-4 w-4 mr-1" />
                      Start System Changeout
                    </>
                  )}
                </Button>
              )}
              <Link href={`/projects/${projectId}/work-orders/${workOrder.id}/files?returnTo=detail`}>
                <Button variant="outline" size="sm" data-testid="button-quick-attachments">
                  <Paperclip className="h-4 w-4 mr-1" />
                  Attachments ({workOrderFiles.length})
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form with Collapsible Sections */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Accordion 
            type="multiple" 
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-3"
          >
            {/* Customer & Site Information */}
            <AccordionItem value="customer" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-customer">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span className="font-medium">Customer & Site Information</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">System ID</label>
                    <Input 
                      value={workOrder.id} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-system-wo-id"
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="customerWoId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Work Order ID *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="WO-001" disabled={!canEdit} data-testid="input-customer-wo-id" />
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
                        <FormLabel>Customer ID *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="CUST-001" disabled={!canEdit} data-testid="input-customer-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="John Doe" disabled={!canEdit} data-testid="input-customer-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Address *</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="123 Main Street" disabled={!canEdit} data-testid="input-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="City" disabled={!canEdit} data-testid="input-city" />
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
                          <Input {...field} value={field.value || ""} placeholder="State" disabled={!canEdit} data-testid="input-state" />
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
                          <Input {...field} value={field.value || ""} placeholder="12345" disabled={!canEdit} data-testid="input-zip" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="555-123-4567" disabled={!canEdit} data-testid="input-phone" />
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
                          <Input {...field} value={field.value || ""} placeholder="email@example.com" disabled={!canEdit} data-testid="input-email" />
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
                          <Input {...field} value={field.value || ""} placeholder="Route A" disabled={!canEdit} data-testid="input-route" />
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
                          <Input {...field} value={field.value || ""} placeholder="Zone 1" disabled={!canEdit} data-testid="input-zone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* System & Installation Details */}
            <AccordionItem value="system" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-system">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" />
                  <span className="font-medium">System & Installation Details</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
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
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
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
                      <FormField
                        control={form.control}
                        name="oldGps"
                        render={({ field }) => (
                          <FormItem className="md:col-span-3">
                            <FormLabel>GPS Coordinates</FormLabel>
                            <FormControl>
                              <GPSCapture 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="40.7128,-74.0060" 
                                disabled={!canEdit}
                                data-testid="input-old-gps" 
                              />
                            </FormControl>
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
                                onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
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
                      <FormField
                        control={form.control}
                        name="newGps"
                        render={({ field }) => (
                          <FormItem className="md:col-span-3">
                            <FormLabel>GPS Coordinates</FormLabel>
                            <FormControl>
                              <GPSCapture 
                                value={field.value || ""} 
                                onChange={field.onChange} 
                                placeholder="40.7128,-74.0060" 
                                disabled={!canEdit}
                                data-testid="input-new-gps" 
                              />
                            </FormControl>
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
              </AccordionContent>
            </AccordionItem>

            {/* Scheduling & Assignments */}
            <AccordionItem value="scheduling" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-scheduling">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="font-medium">Scheduling & Assignments</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
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
                        <FormLabel>Scheduled At</FormLabel>
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

                  {/* Customer Signature Display */}
                  {((workOrder as any)?.signatureData || (workOrder as any)?.signatureName) && (
                    <div className="md:col-span-2 border-t pt-4 mt-2">
                      <h4 className="text-sm font-medium mb-3">Customer Signature</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(workOrder as any)?.signatureData && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">Signature</p>
                            <div className="border rounded-md p-2 bg-white dark:bg-gray-900 inline-block">
                              <img 
                                src={(workOrder as any).signatureData} 
                                alt="Customer signature" 
                                className="max-h-24 object-contain"
                                data-testid="img-customer-signature"
                              />
                            </div>
                          </div>
                        )}
                        {(workOrder as any)?.signatureName && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2">Printed Name</p>
                            <p className="text-sm font-medium" data-testid="text-signature-name">
                              {(workOrder as any).signatureName}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
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
                          disabled={!canEdit}
                          data-testid="input-notes" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                  <span className="font-medium">Audit History</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Created By</label>
                    <Input 
                      value={workOrder.createdBy || "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-created-by"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Created At</label>
                    <Input 
                      value={workOrder.createdAt ? formatDateTime(workOrder.createdAt) : "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-created-at"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Updated By</label>
                    <Input 
                      value={workOrder.updatedBy || "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-updated-by"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Updated At</label>
                    <Input 
                      value={workOrder.updatedAt ? formatDateTime(workOrder.updatedAt) : "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-updated-at"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Scheduled By</label>
                    <Input 
                      value={(workOrder as any).scheduledByDisplay || getAssignedUserName((workOrder as any).scheduledBy) || "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-scheduled-by"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Scheduled At</label>
                    <Input 
                      value={(workOrder as any).scheduledAt ? formatDateTime((workOrder as any).scheduledAt) : "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-scheduled-at"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Completed By</label>
                    <Input 
                      value={(workOrder as any).completedByDisplay || getAssignedUserName((workOrder as any).completedBy) || "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-completed-by"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Completed At</label>
                    <Input 
                      value={workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "-"} 
                      disabled 
                      className="mt-1 bg-muted"
                      data-testid="text-completed-at"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Sticky Footer */}
          <div className="sticky bottom-0 bg-background border-t py-4 -mx-4 px-4 md:-mx-6 md:px-6">
            <div className="flex justify-between gap-3">
              <div>
                {canPrint && (
                  <WorkOrderPdf
                    workOrder={workOrder}
                    projectId={projectId}
                    workOrderFiles={workOrderFiles}
                    formatDateTime={formatDateTime}
                    getAssignedUserName={getAssignedUserName}
                    serviceTypes={serviceTypes}
                    troubleCodes={troubleCodes}
                  />
                )}
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={onBack} data-testid="button-cancel">
                  {canEdit ? "Cancel" : "Back"}
                </Button>
                {canEdit && (
                  <Button type="submit" disabled={isSubmitting} data-testid="button-save">
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
        status={workOrder.status}
        trouble={workOrder.trouble}
        notes={workOrder.notes}
        projectId={typeof projectId === 'string' ? parseInt(projectId) : projectId}
        troubleCodes={troubleCodes}
        existingOldReading={workOrder.oldSystemReading}
        existingNewReading={workOrder.newSystemReading}
        existingGps={workOrder.gps}
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
            newSystemId: data.newSystemId,
            newSystemReading: data.newSystemReading,
            gpsCoordinates: data.gpsCoordinates,
            completionNotes: data.completionNotes,
            signatureData: data.signatureData,
            signatureName: data.signatureName,
            photoTypes,
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
