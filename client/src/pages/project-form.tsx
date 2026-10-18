import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { Project, User, ServiceTypeRecord } from "@shared/schema";
import { ArrowLeft, Save, Loader2, Globe, Clock, Users, X, CalendarDays, Plus, Wand2, Zap, Copy, Scan, Settings2, ClipboardList, CalendarClock, Cable } from "lucide-react";
import type { ProjectHoliday } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { usePermissions } from "@/hooks/usePermissions";
import { AccessLockControl } from "@/components/access-locks/access-lock-control";
import { useIsMobile } from "@/hooks/use-mobile";
import { getReadingPrecision } from "@shared/reading-precision";
import { getProjectEquipmentVisibility } from "@shared/project-equipment-scope";
import { WorkOrderSubStatusManager } from "@/components/work-order-sub-statuses/work-order-sub-status-manager";

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Mon' },
  { value: 'tuesday', label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday', label: 'Thu' },
  { value: 'friday', label: 'Fri' },
  { value: 'saturday', label: 'Sat' },
  { value: 'sunday', label: 'Sun' },
] as const;

const projectFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  inventoryEnabled: z.boolean().optional().default(false),
  customerEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(255).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  operationalHoursEnabled: z.boolean().optional().default(false),
  operationalHoursStart: z.string().max(10).optional().or(z.literal("")),
  operationalHoursEnd: z.string().max(10).optional().or(z.literal("")),
  operationalHoursDays: z.array(z.string()).optional().default([]),
  timezone: z.string().max(100).optional().or(z.literal("")),
  defaultServiceMinutes: z.number().int().min(1).max(480).nullable().optional(),
  defaultAppointmentToleranceMinutes: z.number().int().min(0).max(240).nullable().optional(),
  wizardMode: z.enum(["changeout", "reading_only", "user_choice"]).optional().default("changeout"),
  wizardGpsMode: z.enum(["automatic", "manual_step", "disabled"]).optional().default("automatic"),
  wizardShowNotesStep: z.boolean().optional().default(true),
  wizardShowGpsStep: z.boolean().optional().default(true),
  wizardShowBeforePhotosStep: z.boolean().optional().default(true),
  wizardShowAfterPhotosStep: z.boolean().optional().default(true),
  wizardShowSignatureStep: z.boolean().optional().default(true),
  // Equipment type for changeout and reading modes
  changeoutEquipmentType: z.enum(["system", "module", "both", "user_choice"]).optional().default("both"),
  readingEquipmentType: z.enum(["system", "module", "both", "user_choice"]).optional().default("both"),
  // Search method visibility settings
  searchShowBarcodeScan: z.boolean().optional().default(true),
  searchShowQrCodeScan: z.boolean().optional().default(true),
  searchShowManualEntry: z.boolean().optional().default(true),
  searchShowHidScanner: z.boolean().optional().default(true),
  systemReadingDecimalPlaces: z.number().int().min(0).max(6).default(3),
  moduleReadingDecimalPlaces: z.number().int().min(0).max(6).default(3),
}).superRefine((data, context) => {
  if (!data.operationalHoursEnabled) return;
  if (!data.operationalHoursStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Both start and end times are required when operational hours are enabled",
      path: ["operationalHoursStart"],
    });
  }
  if (!data.operationalHoursEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Both start and end times are required when operational hours are enabled",
      path: ["operationalHoursEnd"],
    });
  }
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

export default function ProjectForm() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/projects/:id/edit");
  const id = params?.id;
  const isEditing = !!id;

  const { toast } = useToast();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canConfigureReadingPrecision = hasPermission("projects.readingPrecision");
  const canManageSubStatuses = hasPermission("projects.manageSubStatuses");
  const isMobile = useIsMobile();
  type ProjectSection = "details" | "work-orders" | "schedule" | "people" | "integrations";
  type WorkOrderSection = "wizard" | "search" | "service-types" | "sub-statuses";
  const [activeSection, setActiveSection] = useState<ProjectSection>("details");
  const [activeWorkOrderSection, setActiveWorkOrderSection] = useState<WorkOrderSection>("wizard");
  const [focusAfterSectionChange, setFocusAfterSectionChange] = useState<keyof ProjectFormValues | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sections = [
    { id: "details" as const, label: "Details", icon: Settings2 },
    { id: "work-orders" as const, label: "Work Orders", icon: ClipboardList },
    { id: "schedule" as const, label: "Schedule", icon: CalendarClock },
    ...(isEditing ? [
      { id: "people" as const, label: "People", icon: Users },
      { id: "integrations" as const, label: "Integrations", icon: Cable },
    ] : []),
  ];
  const workOrderSections = [
    { id: "wizard" as const, label: "Wizard" },
    { id: "search" as const, label: "Search" },
    ...(isEditing ? [
      { id: "service-types" as const, label: "Service types" },
      { id: "sub-statuses" as const, label: "Sub-statuses" },
    ] : []),
  ];

  useEffect(() => {
    if (!sections.some(section => section.id === activeSection)) setActiveSection("details");
  }, [isEditing]);
  useEffect(() => {
    if (!workOrderSections.some(section => section.id === activeWorkOrderSection)) setActiveWorkOrderSection("wizard");
  }, [isEditing]);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    enabled: isEditing,
  });

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || permissionsLoading || (isEditing && projectLoading)) return;
    const host = workspace.closest("main");
    const previousHostStyle = host ? {
      height: host.style.height, overflow: host.style.overflow, flex: host.style.flex,
    } : null;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    // This screen owns its content scroller. The sidebar may be taller than a
    // short window, but must not make the document scroll our persistent title.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const fit = () => {
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      // Measure the layout origin, not a position shifted by an ancestor's
      // scroll. Otherwise resizing a previously scrolled page can grow the
      // workspace under the sticky app header and hide its title.
      const top = (host ?? workspace).getBoundingClientRect().top + window.scrollY - (viewport?.offsetTop ?? 0);
      const available = `${Math.max(0, height - Math.max(0, top))}px`;
      if (host) {
        host.style.height = available;
        host.style.flex = "none";
        host.style.overflow = "hidden";
        host.scrollTop = 0;
      }
      workspace.style.height = available;
    };
    const observer = new ResizeObserver(fit);
    if (workspace.parentElement) observer.observe(workspace.parentElement);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit);
    host?.addEventListener("scroll", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
      host?.removeEventListener("scroll", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      workspace.style.height = "";
      if (host && previousHostStyle) Object.assign(host.style, previousHostStyle);
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [permissionsLoading, projectLoading, isEditing]);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    shouldFocusError: false,
    defaultValues: { 
      name: "", 
      description: "", 
      isActive: true,
       inventoryEnabled: false,
      customerEmail: "", 
      phone: "", 
      address: "", 
      city: "", 
      state: "", 
      zip: "", 
      notes: "",
      operationalHoursEnabled: false,
      operationalHoursStart: "",
      operationalHoursEnd: "",
      operationalHoursDays: [],
      timezone: "",
      defaultServiceMinutes: 30,
      defaultAppointmentToleranceMinutes: 60,
      wizardMode: "changeout",
      wizardGpsMode: "automatic",
      wizardShowNotesStep: true,
      wizardShowGpsStep: true,
      wizardShowBeforePhotosStep: true,
      wizardShowAfterPhotosStep: true,
      wizardShowSignatureStep: true,
      searchShowBarcodeScan: true,
      searchShowQrCodeScan: true,
      searchShowManualEntry: true,
      searchShowHidScanner: true,
      systemReadingDecimalPlaces: 3,
      moduleReadingDecimalPlaces: 3,
    },
  });
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection, activeWorkOrderSection]);
  useEffect(() => {
    if (!focusAfterSectionChange) return;
    const frame = requestAnimationFrame(() => {
      form.setFocus(focusAfterSectionChange);
      setFocusAfterSectionChange(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSection, activeWorkOrderSection, focusAfterSectionChange, form]);

  const handleInvalid = (errors: Record<string, any>) => {
    const firstPath = (tree: Record<string, any>, prefix = ""): string | undefined => {
      for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && "message" in value) return path;
        if (value && typeof value === "object") {
          const nested = firstPath(value, path);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    const field = firstPath(errors) as keyof ProjectFormValues | undefined;
    if (!field) return;
    const section: ProjectSection = field === "operationalHoursEnabled" || field === "operationalHoursStart" ||
      field === "operationalHoursEnd" || field === "operationalHoursDays" || field === "timezone"
      ? "schedule"
      : field === "defaultServiceMinutes" || field === "defaultAppointmentToleranceMinutes"
        ? "schedule"
      : ["name", "description", "isActive", "inventoryEnabled", "customerEmail", "phone", "address", "city", "state", "zip", "notes"].includes(field)
        ? "details" : "work-orders";
    setFocusAfterSectionChange(field);
    setActiveSection(section);
  };
  const wizardMode = form.watch("wizardMode");
  const changeoutEquipmentType = form.watch("changeoutEquipmentType");
  const readingEquipmentType = form.watch("readingEquipmentType");
  const equipmentVisibility = getProjectEquipmentVisibility({
    wizardMode,
    changeoutEquipmentType,
    readingEquipmentType,
  });

  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description || "",
        isActive: project.isActive !== false,
        inventoryEnabled: (project as any).inventoryEnabled === true,
        customerEmail: project.customerEmail || "",
        phone: project.phone || "",
        address: project.address || "",
        city: project.city || "",
        state: project.state || "",
        zip: project.zip || "",
        notes: project.notes || "",
        operationalHoursEnabled: project.operationalHoursEnabled || false,
        operationalHoursStart: project.operationalHoursStart || "",
        operationalHoursEnd: project.operationalHoursEnd || "",
        operationalHoursDays: project.operationalHoursDays || [],
        timezone: project.timezone || "",
        defaultServiceMinutes: (project as any).defaultServiceMinutes ?? null,
        defaultAppointmentToleranceMinutes: (project as any).defaultAppointmentToleranceMinutes ?? null,
        wizardMode: (project.wizardMode as "changeout" | "reading_only" | "user_choice") || "changeout",
        wizardGpsMode: (project.wizardGpsMode as "automatic" | "manual_step" | "disabled") || "automatic",
        wizardShowNotesStep: project.wizardShowNotesStep !== false,
        wizardShowGpsStep: project.wizardShowGpsStep !== false,
        wizardShowBeforePhotosStep: project.wizardShowBeforePhotosStep !== false,
        wizardShowAfterPhotosStep: project.wizardShowAfterPhotosStep !== false,
        wizardShowSignatureStep: project.wizardShowSignatureStep !== false,
        changeoutEquipmentType: ((project as any).changeoutEquipmentType as "system" | "module" | "both" | "user_choice") || "both",
        readingEquipmentType: ((project as any).readingEquipmentType as "system" | "module" | "both" | "user_choice") || "both",
        searchShowBarcodeScan: (project as any).searchShowBarcodeScan !== false,
        searchShowQrCodeScan: (project as any).searchShowQrCodeScan !== false,
        searchShowManualEntry: (project as any).searchShowManualEntry !== false,
        searchShowHidScanner: (project as any).searchShowHidScanner !== false,
        systemReadingDecimalPlaces: project.systemReadingDecimalPlaces ?? 3,
        moduleReadingDecimalPlaces: project.moduleReadingDecimalPlaces ?? 3,
      });
    }
  }, [project, form]);

  const createMutation = useMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const response = await apiRequest("POST", "/api/projects", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Success", description: "Project created successfully" });
      setLocation("/projects");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to create project", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const response = await apiRequest("PATCH", `/api/projects/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ title: "Success", description: "Project updated successfully" });
      setLocation("/projects");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      let message = error.message || "Failed to update project";
      try { message = JSON.parse(message.replace(/^\d{3}:\s*/, "")).message || message; } catch { /* Keep the original non-JSON error. */ }
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${id}/copy`);
      return response.json();
    },
    onSuccess: (newProject: Project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Success", description: "Project copied successfully" });
      setLocation(`/projects/${newProject.id}/edit`);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to copy project", variant: "destructive" });
    },
  });

  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const { data: projectUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/projects", id, "users"],
    enabled: isEditing,
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isEditing,
  });

  const availableUsers = allUsers.filter(
    (u) => !projectUsers.some((pu) => pu.id === u.id)
  );

  const addUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/projects/${id}/users`, { userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "users"] });
      setSelectedUserId("");
      toast({ title: "Success", description: "User assigned to project" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to assign user", variant: "destructive" });
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/projects/${id}/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "users"] });
      toast({ title: "Success", description: "User removed from project" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove user", variant: "destructive" });
    },
  });

  // Holidays management
  const [newHolidayDate, setNewHolidayDate] = useState<string>("");
  const [newHolidayName, setNewHolidayName] = useState<string>("");

  const { data: holidays = [], isLoading: holidaysLoading } = useQuery<ProjectHoliday[]>({
    queryKey: ["/api/projects", id, "holidays"],
    enabled: isEditing && form.watch("operationalHoursEnabled"),
  });

  const addHolidayMutation = useMutation({
    mutationFn: async (data: { date: string; name: string }) => {
      await apiRequest("POST", `/api/projects/${id}/holidays`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "holidays"] });
      setNewHolidayDate("");
      setNewHolidayName("");
      toast({ title: "Success", description: "Holiday added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to add holiday", variant: "destructive" });
    },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (holidayId: number) => {
      await apiRequest("DELETE", `/api/projects/${id}/holidays/${holidayId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "holidays"] });
      toast({ title: "Success", description: "Holiday removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove holiday", variant: "destructive" });
    },
  });

  // Service Types management - which service types are available for this project
  const { data: allServiceTypes = [] } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/service-types"],
    enabled: isEditing,
  });

  const { data: projectServiceTypes = [], isLoading: serviceTypesLoading } = useQuery<ServiceTypeRecord[]>({
    queryKey: ["/api/projects", id, "service-types"],
    enabled: isEditing,
  });

  // Use query data directly as the source of truth - no local state needed
  const selectedServiceTypeIds = projectServiceTypes.map(st => st.id);

  const updateServiceTypesMutation = useMutation({
    mutationFn: async (serviceTypeIds: number[]) => {
      await apiRequest("PUT", `/api/projects/${id}/service-types`, { serviceTypeIds });
    },
    onSuccess: (_data, submittedIds) => {
      // Update the cache with the new selection to keep UI in sync
      const newServiceTypes = allServiceTypes.filter(st => submittedIds.includes(st.id));
      queryClient.setQueryData(["/api/projects", id, "service-types"], newServiceTypes);
      toast({ title: "Success", description: "Service types updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update service types", variant: "destructive" });
    },
  });

  const handleServiceTypeToggle = (serviceTypeId: number, event: React.MouseEvent) => {
    // Only process actual user clicks (not synthetic events during render)
    if (!event.isTrusted) return;
    
    // Don't mutate while another mutation is in progress
    if (updateServiceTypesMutation.isPending) return;
    
    const currentIds = projectServiceTypes.map(st => st.id);
    const newSelection = currentIds.includes(serviceTypeId)
      ? currentIds.filter(id => id !== serviceTypeId)
      : [...currentIds, serviceTypeId];
    
    // Don't mutate if selection hasn't changed
    const currentSorted = [...currentIds].sort().join(',');
    const newSorted = [...newSelection].sort().join(',');
    if (currentSorted === newSorted) return;
    
    updateServiceTypesMutation.mutate(newSelection);
  };

  const onSubmit = (data: ProjectFormValues) => {
    const { systemReadingDecimalPlaces, moduleReadingDecimalPlaces, ...projectData } = data;
    const payload = canConfigureReadingPrecision
      ? { ...projectData, systemReadingDecimalPlaces, moduleReadingDecimalPlaces }
      : projectData;
    if (isEditing) {
      updateMutation.mutate(payload as ProjectFormValues);
    } else {
      createMutation.mutate(payload as ProjectFormValues);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (permissionsLoading || (isEditing && projectLoading)) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <Card>
          <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
          <CardContent className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} data-testid="project-workspace" className="flex min-h-0 w-full flex-col overflow-hidden px-3 pb-3 pt-2 sm:px-5 sm:pb-4 [@media(max-height:450px)]:pb-2">
      <header data-testid="project-workspace-header" className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 pb-3 [@media(max-height:450px)]:mb-2 [@media(max-height:450px)]:pb-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/projects" className="inline-flex">
            <Button variant="ghost" size="icon" data-testid="button-back" aria-label="Back to projects"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground [@media(max-height:450px)]:hidden">Project configuration</p>
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl" data-testid="text-form-title">
              {isEditing ? "Edit Project" : "New Project"}
            </h1>
          </div>
        </div>
        <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
          {isEditing ? `Project ${id}` : "Set up a new field workspace"}
        </div>
      </header>

      <div className="mb-3 flex shrink-0 flex-col gap-2 [@media(max-height:450px)]:mb-2">
        {isMobile ? (
          <div className="flex items-center gap-2">
            <Select
              value={activeSection === "work-orders" ? `work-orders:${activeWorkOrderSection}` : activeSection}
              onValueChange={(value) => {
                if (value.startsWith("work-orders:")) {
                  setActiveSection("work-orders");
                  setActiveWorkOrderSection(value.slice("work-orders:".length) as WorkOrderSection);
                } else {
                  setActiveSection(value as ProjectSection);
                }
              }}>
            <SelectTrigger className="h-10 w-full" data-testid="project-mobile-menu" aria-label="Choose project section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Project</SelectLabel>
                  {sections.map(section => <SelectItem key={section.id} value={section.id} data-testid={`project-section-nav-${section.id}`}>{section.label}</SelectItem>)}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Work orders</SelectLabel>
                  {workOrderSections.map(section =>
                    <SelectItem key={section.id} value={`work-orders:${section.id}`} data-testid={`project-section-nav-${section.id}`}>
                      {section.label}
                    </SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <nav aria-label="Project settings sections" className="flex min-w-0 gap-1 overflow-x-auto" role="tablist"
            onKeyDown={event => {
              const index = sections.findIndex(section => section.id === activeSection);
              const next = event.key === "ArrowRight" ? (index + 1) % sections.length :
                event.key === "ArrowLeft" ? (index - 1 + sections.length) % sections.length :
                event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              setActiveSection(sections[next].id);
              document.getElementById(`project-section-${sections[next].id}`)?.focus();
            }}>
            {sections.map(section => {
              const Icon = section.icon;
              const selected = activeSection === section.id;
              return <Button key={section.id} id={`project-section-${section.id}`} type="button" role="tab"
                  aria-selected={selected} aria-controls={`project-panel-${section.id}`} tabIndex={selected ? 0 : -1}
                  variant={selected ? "secondary" : "ghost"} size="sm" className="h-9 gap-2 px-3"
                  onClick={() => setActiveSection(section.id)} data-testid={`project-tab-${section.id}`}>
                  <span data-testid={`project-section-nav-${section.id}`} className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" aria-hidden="true" />{section.label}
                  </span>
                </Button>;
            })}
          </nav>
        )}
        {!isMobile && activeSection === "work-orders" && (
          <nav aria-label="Work Orders sections" className="flex min-w-0 gap-1 overflow-x-auto border-t pt-2" role="tablist"
            onKeyDown={event => {
              const index = workOrderSections.findIndex(section => section.id === activeWorkOrderSection);
              const next = event.key === "ArrowRight" ? (index + 1) % workOrderSections.length :
                event.key === "ArrowLeft" ? (index - 1 + workOrderSections.length) % workOrderSections.length :
                event.key === "Home" ? 0 : event.key === "End" ? workOrderSections.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              setActiveWorkOrderSection(workOrderSections[next].id);
              document.getElementById(`project-section-nav-${workOrderSections[next].id}`)?.focus();
            }}>
            {workOrderSections.map(section => (
              <Button key={section.id} id={`project-section-nav-${section.id}`} type="button" role="tab" aria-selected={activeWorkOrderSection === section.id}
                aria-controls={`work-orders-panel-${section.id}`} tabIndex={activeWorkOrderSection === section.id ? 0 : -1}
                variant={activeWorkOrderSection === section.id ? "outline" : "ghost"} size="sm"
                className="h-8 shrink-0 px-2.5 text-xs"
                onClick={() => setActiveWorkOrderSection(section.id)}
                data-testid={`project-section-nav-${section.id}`}>
                {section.label}
              </Button>
            ))}
          </nav>
        )}
      </div>

      <Form {...form}>
        <form noValidate onSubmit={form.handleSubmit(onSubmit, handleInvalid)} className="flex min-h-0 flex-1 flex-col">
          <div ref={contentRef} data-testid="project-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div id="project-panel-details" data-project-section="details" role="tabpanel" aria-label="Details"
              hidden={activeSection !== "details"} className="space-y-5 pb-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input placeholder="Project name" {...field} data-testid="input-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Project description" className="min-h-[100px]" {...field} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {hasPermission("inventory.configure") && (
                <FormField
                  control={form.control}
                  name="inventoryEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-l-4 border-l-primary/60 p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Project inventory</FormLabel>
                        <FormDescription>
                          Enable project stock locations, meter serial tracking, receiving, transfers, and work-order reservations.
                        </FormDescription>
                        {isEditing && <FormDescription data-testid="inventory-toggle-preservation-note">
                          Turning Inventory off pauses tracking without deleting stock, serials, history, reservations, orders, counts or returns.
                          Work completed while it is off will not deduct inventory. Existing reservations remain reserved.
                          Before resuming tracking, review unfinished inventory work and reconcile physical stock; off-period usage is not deducted retroactively.
                        </FormDescription>}
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-label="Enable project inventory"
                          data-testid="switch-inventory-enabled"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
              {isEditing && (
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Project Status</FormLabel>
                        <FormDescription>
                          {field.value 
                            ? "This project is active and visible to all assigned users." 
                            : "This project is inactive and hidden from users without permission."}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Badge variant={field.value ? "default" : "secondary"} data-testid="badge-project-status">
                            {field.value ? "Active" : "Inactive"}
                          </Badge>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-project-active"
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
              
              <FormField
                control={form.control}
                name="customerEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Email</FormLabel>
                    <FormControl><Input type="email" placeholder="customer@example.com" {...field} data-testid="input-email" /></FormControl>
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
                    <FormControl><Input placeholder="(555) 123-4567" {...field} data-testid="input-phone" /></FormControl>
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
                    <FormControl><Input placeholder="123 Main Street" {...field} data-testid="input-address" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl><Input placeholder="City" {...field} data-testid="input-city" /></FormControl>
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
                      <FormControl><Input placeholder="State" {...field} data-testid="input-state" /></FormControl>
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
                      <FormControl><Input placeholder="12345" {...field} data-testid="input-zip" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Additional notes about this project..." className="min-h-[100px]" {...field} data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!isEditing && (
                <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-muted-foreground">Customer API connections can be configured from the Customer API hub immediately after this project is created.</p>
                </div>
              )}

            </div>

            {isEditing && <div id="project-panel-integrations" data-project-section="integrations" role="tabpanel" aria-label="Integrations"
              hidden={activeSection !== "integrations"} className="space-y-5 pb-5">
              <section className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Customer API</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Push delivery and inbound work-order imports are configured independently in the Customer API hub.
                </p>
                <Link href={`/projects/${id}/customer-api`} className="mt-3 inline-flex">
                  <Button type="button" variant="outline">Open Customer API setup</Button>
                </Link>
              </section>
            </div>}

            <div id="project-panel-work-orders" data-project-section="work-orders" role="tabpanel" aria-label="Work Orders"
              hidden={activeSection !== "work-orders"} className="space-y-5 pb-5">
              {isEditing && (
                <div id="work-orders-panel-sub-statuses" role="tabpanel" aria-label="Sub-statuses"
                  hidden={activeWorkOrderSection !== "sub-statuses"} className="border-t pt-6 mt-6">
                  <WorkOrderSubStatusManager projectId={Number(id)} canEdit={canManageSubStatuses} />
                </div>
              )}

              {isEditing && (
                <div id="work-orders-panel-service-types" role="tabpanel" aria-label="Service types"
                  hidden={activeWorkOrderSection !== "service-types"} className="border-t pt-6 mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-lg font-medium">Service Types</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select which service types are available for work orders in this project. If none are selected, all service types will be available.
                  </p>

                  {serviceTypesLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : allServiceTypes.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      No service types configured. Add service types in Settings to enable filtering.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {allServiceTypes.map((serviceType) => {
                        const isSelected = selectedServiceTypeIds.includes(serviceType.id);
                        return (
                          <div
                            key={serviceType.id}
                            className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                              isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                            }`}
                            onClick={(e) => handleServiceTypeToggle(serviceType.id, e)}
                            data-testid={`service-type-toggle-${serviceType.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={isSelected}
                                className="pointer-events-none"
                                data-testid={`checkbox-service-type-${serviceType.id}`}
                              />
                              <div>
                                <span className="font-medium">{serviceType.label}</span>
                                <span className="text-sm text-muted-foreground ml-2">({serviceType.code})</span>
                              </div>
                            </div>
                            {serviceType.color && (
                              <Badge 
                                variant="outline"
                                style={{ 
                                  backgroundColor: serviceType.color === 'blue' ? '#3b82f6' :
                                    serviceType.color === 'green' ? '#22c55e' :
                                    serviceType.color === 'yellow' ? '#eab308' :
                                    serviceType.color === 'orange' ? '#f97316' :
                                    serviceType.color === 'red' ? '#ef4444' :
                                    serviceType.color === 'purple' ? '#a855f7' :
                                    serviceType.color === 'pink' ? '#ec4899' :
                                    serviceType.color === 'gray' ? '#6b7280' : serviceType.color,
                                  color: ['yellow', 'orange'].includes(serviceType.color) ? '#000' : '#fff'
                                }}
                              >
                                {serviceType.label}
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                      {updateServiceTypesMutation.isPending && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div id="work-orders-panel-wizard" role="tabpanel" aria-label="Wizard"
                hidden={activeWorkOrderSection !== "wizard"} className="border-t pt-6 mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Wand2 className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Wizard Configuration</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure how the meter changeout wizard behaves for this project. You can set the workflow mode and customize which steps are shown.
                </p>

                <FormField
                  control={form.control}
                  name="wizardMode"
                  render={({ field }) => (
                    <FormItem className="mb-4">
                      <FormLabel>Wizard Mode</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-wizard-mode">
                            <SelectValue placeholder="Select wizard mode" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="changeout">Changeout Only</SelectItem>
                          <SelectItem value="reading_only">Reading Capture Only</SelectItem>
                          <SelectItem value="user_choice">User Choice (Select at Start)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === "changeout" && "Full meter changeout workflow - replace equipment and capture all readings"}
                        {field.value === "reading_only" && "Simplified workflow - capture readings only without equipment replacement"}
                        {field.value === "user_choice" && "Users choose between Changeout or Reading Capture at the start of each wizard session"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Equipment Type Configuration based on Wizard Mode */}
                {(form.watch("wizardMode") === "changeout" || form.watch("wizardMode") === "user_choice") && (
                  <FormField
                    control={form.control}
                    name="changeoutEquipmentType"
                    render={({ field }) => (
                      <FormItem className="mb-4 pl-4 border-l-2 border-muted">
                        <FormLabel>Changeout Equipment Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-changeout-equipment-type">
                              <SelectValue placeholder="Select equipment type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="system">System Only</SelectItem>
                            <SelectItem value="module">Module Only</SelectItem>
                            <SelectItem value="both">System and Module</SelectItem>
                            <SelectItem value="user_choice">User Choice (Select at Start)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {field.value === "system" && "Changeout workflow will only capture system data"}
                          {field.value === "module" && "Changeout workflow will only capture module data"}
                          {field.value === "both" && "Changeout workflow will capture both system and module data"}
                          {field.value === "user_choice" && "Users choose between System, Module, or Both at the start of each changeout"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {(form.watch("wizardMode") === "reading_only" || form.watch("wizardMode") === "user_choice") && (
                  <FormField
                    control={form.control}
                    name="readingEquipmentType"
                    render={({ field }) => (
                      <FormItem className="mb-4 pl-4 border-l-2 border-muted">
                        <FormLabel>Reading Capture Equipment Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-reading-equipment-type">
                              <SelectValue placeholder="Select equipment type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="system">System Only</SelectItem>
                            <SelectItem value="module">Module Only</SelectItem>
                            <SelectItem value="both">System and Module</SelectItem>
                            <SelectItem value="user_choice">User Choice (Select at Start)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {field.value === "system" && "Reading capture will only capture system readings"}
                          {field.value === "module" && "Reading capture will only capture module readings"}
                          {field.value === "both" && "Reading capture will capture both system and module readings"}
                          {field.value === "user_choice" && "Users choose between System, Module, or Both at the start of each reading capture"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="space-y-3 pl-4 border-l-2 border-muted mb-5">
                  <div>
                    <h4 className="text-sm font-medium">Reading precision</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Set the maximum fractional digits technicians may capture. Values are not rounded or padded.
                    </p>
                  </div>
                  <div className={`grid gap-4 ${equipmentVisibility.showSystem && equipmentVisibility.showModule ? "sm:grid-cols-2" : ""}`}>
                    {equipmentVisibility.showSystem && (canConfigureReadingPrecision ? (
                      <FormField control={form.control} name="systemReadingDecimalPlaces" render={({ field }) => (
                        <FormItem>
                          <FormLabel>System reading decimal places</FormLabel>
                          <Select value={String(field.value ?? 3)} onValueChange={(value) => field.onChange(Number(value))}>
                            <FormControl><SelectTrigger data-testid="select-systemReadingDecimalPlaces"><SelectValue>{field.value ?? 3}</SelectValue></SelectTrigger></FormControl>
                            <SelectContent>{Array.from({ length: 7 }, (_, places) => <SelectItem key={places} value={String(places)}>{places}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormDescription>Maximum fractional digits: {field.value ?? 3}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ) : (
                      <p className="text-sm">System readings: <span className="font-medium">{getReadingPrecision(project).systemReadingDecimalPlaces} decimal places max</span></p>
                    ))}
                    {equipmentVisibility.showModule && (canConfigureReadingPrecision ? (
                      <FormField control={form.control} name="moduleReadingDecimalPlaces" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Module reading decimal places</FormLabel>
                          <Select value={String(field.value ?? 3)} onValueChange={(value) => field.onChange(Number(value))}>
                            <FormControl><SelectTrigger data-testid="select-moduleReadingDecimalPlaces"><SelectValue>{field.value ?? 3}</SelectValue></SelectTrigger></FormControl>
                            <SelectContent>{Array.from({ length: 7 }, (_, places) => <SelectItem key={places} value={String(places)}>{places}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormDescription>Maximum fractional digits: {field.value ?? 3}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ) : (
                      <p className="text-sm">Module readings: <span className="font-medium">{getReadingPrecision(project).moduleReadingDecimalPlaces} decimal places max</span></p>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pl-4 border-l-2 border-muted">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Step Visibility</p>
                  
                  <FormField
                    control={form.control}
                    name="wizardShowBeforePhotosStep"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Before Photos Step</FormLabel>
                          <FormDescription className="text-xs">
                            Capture photos before the changeout
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-wizard-before-photos"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="wizardShowAfterPhotosStep"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">After Photos Step</FormLabel>
                          <FormDescription className="text-xs">
                            Capture photos after the changeout
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-wizard-after-photos"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="wizardGpsMode"
                    render={({ field }) => (
                      <FormItem className="rounded-lg border p-3">
                        <div className="flex items-center justify-between mb-2">
                          <FormLabel className="text-sm">GPS Capture Mode</FormLabel>
                        </div>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-wizard-gps-mode" className="h-8">
                              <SelectValue placeholder="Select GPS mode" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="automatic">Automatic (Background)</SelectItem>
                            <SelectItem value="manual_step">Manual Step</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs mt-2">
                          {field.value === "automatic" && "GPS is captured automatically in the background using priority: External GPS → Device GPS → Address Geocoding"}
                          {field.value === "manual_step" && "User manually captures or confirms GPS coordinates in a dedicated wizard step"}
                          {field.value === "disabled" && "GPS coordinates are not captured during the wizard"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="wizardShowNotesStep"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Notes Step</FormLabel>
                          <FormDescription className="text-xs">
                            Allow users to add completion notes
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-wizard-notes"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="wizardShowSignatureStep"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Signature Step</FormLabel>
                          <FormDescription className="text-xs">
                            Require signature capture for completion
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-wizard-signature"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div id="work-orders-panel-search" role="tabpanel" aria-label="Search"
                hidden={activeWorkOrderSection !== "search"} className="border-t pt-6 mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Scan className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Search Method Configuration</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure which search methods are available when starting a changeout or reading capture workflow.
                </p>
                
                <div className="grid gap-2 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="searchShowBarcodeScan"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Camera Barcode Scan</FormLabel>
                          <FormDescription className="text-xs">
                            Use camera to scan 1D barcodes
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-search-barcode"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="searchShowQrCodeScan"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Camera QR Code Scan</FormLabel>
                          <FormDescription className="text-xs">
                            Use camera to scan QR codes
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-search-qrcode"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="searchShowManualEntry"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Manual Entry</FormLabel>
                          <FormDescription className="text-xs">
                            Search by typing ID, address, or customer ID
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-search-manual"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="searchShowHidScanner"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Bluetooth HID Scanner</FormLabel>
                          <FormDescription className="text-xs">
                            Use Bluetooth barcode/QR scanner device
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-search-hid-scanner"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

            </div>

            <div id="project-panel-schedule" data-project-section="schedule" role="tabpanel" aria-label="Schedule"
              hidden={activeSection !== "schedule"} className="space-y-5 pb-5">
              {hasPermission("projects.edit") && (
                <section className="space-y-4 rounded-lg border border-l-4 border-l-primary/60 p-4" data-testid="project-planning-defaults">
                  <div>
                    <h2 className="font-semibold">Route planning defaults</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Defaults for planning only. They never reschedule customer appointments.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="defaultServiceMinutes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default service duration (minutes)</FormLabel>
                        <FormControl><Input ref={field.ref} onBlur={field.onBlur} type="number" min="1" max="480" step="1" value={field.value ?? ""} onChange={event => field.onChange(event.target.value === "" ? null : Number(event.target.value))} placeholder="No project default" data-testid="input-project-service-default" /></FormControl>
                        <FormDescription>Whole number from 1 to 480. Empty retains the legacy planner fallback.</FormDescription><FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="defaultAppointmentToleranceMinutes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default appointment tolerance (minutes)</FormLabel>
                        <FormControl><Input ref={field.ref} onBlur={field.onBlur} type="number" min="0" max="240" step="1" value={field.value ?? ""} onChange={event => field.onChange(event.target.value === "" ? null : Number(event.target.value))} placeholder="No project default" data-testid="input-project-tolerance-default" /></FormControl>
                        <FormDescription>Whole number from 0 to 240. Empty retains the legacy planner fallback.</FormDescription><FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </section>
              )}
              <div className="border-t pt-6 mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Operational Hours</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Set the daily operational hours for this project. Work orders can only be scheduled within these hours.
                </p>

                <FormField
                  control={form.control}
                  name="operationalHoursEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4 mb-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Enable Operational Hours</FormLabel>
                        <FormDescription>
                          Restrict work order scheduling to specific hours
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-operational-hours-enabled"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch("operationalHoursEnabled") && (
                  <div className="space-y-4 pl-4 border-l-2 border-muted">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="operationalHoursStart"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Time</FormLabel>
                            <FormControl>
                              <Input 
                                type="time" 
                                {...field} 
                                data-testid="input-operational-hours-start" 
                              />
                            </FormControl>
                            <FormDescription>When operations begin</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="operationalHoursEnd"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Time</FormLabel>
                            <FormControl>
                              <Input 
                                type="time" 
                                {...field} 
                                data-testid="input-operational-hours-end" 
                              />
                            </FormControl>
                            <FormDescription>When operations end</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="operationalHoursDays"
                      render={({ field }) => (
                        <FormItem className="mt-4">
                          <FormLabel>Operational Days</FormLabel>
                          <FormDescription className="mb-2">
                            Select which days work orders can be scheduled (leave empty for all days)
                          </FormDescription>
                          <div className="flex flex-wrap gap-2">
                            {DAYS_OF_WEEK.map((day) => {
                              const isChecked = field.value?.includes(day.value) || false;
                              return (
                                <button
                                  type="button"
                                  key={day.value}
                                  className={`px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                                    isChecked 
                                      ? 'bg-primary text-primary-foreground border-primary' 
                                      : 'bg-background hover:bg-muted border-input'
                                  }`}
                                  data-testid={`button-day-${day.value}`}
                                  onClick={() => {
                                    const current = field.value || [];
                                    if (isChecked) {
                                      field.onChange(current.filter(d => d !== day.value));
                                    } else {
                                      field.onChange([...current, day.value]);
                                    }
                                  }}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem className="mt-4">
                          <FormLabel>Timezone</FormLabel>
                          <FormDescription className="mb-2">
                            Timezone for operational hours validation (uses global setting if not set)
                          </FormDescription>
                          <Select
                            value={field.value || "__global__"}
                            onValueChange={(val) => field.onChange(val === "__global__" ? "" : val)}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-timezone">
                                <SelectValue placeholder="Use global timezone setting" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__global__">Use global timezone setting</SelectItem>
                              <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                              <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                              <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                              <SelectItem value="America/Phoenix">Arizona (MST - no DST)</SelectItem>
                              <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                              <SelectItem value="America/Anchorage">Alaska Time (AKT)</SelectItem>
                              <SelectItem value="Pacific/Honolulu">Hawaii Time (HST)</SelectItem>
                              <SelectItem value="UTC">UTC (Coordinated Universal Time)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {isEditing && (
                      <div className="mt-6 pt-4 border-t border-muted">
                        <div className="flex items-center gap-2 mb-2">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          <FormLabel className="mb-0">Holidays</FormLabel>
                        </div>
                        <FormDescription className="mb-3">
                          Add dates when scheduling should be blocked (holidays, closures)
                        </FormDescription>

                        <div className="flex flex-wrap items-center gap-2 mb-4">
                          <Input
                            type="date"
                            value={newHolidayDate}
                            onChange={(e) => setNewHolidayDate(e.target.value)}
                            className="w-auto"
                            data-testid="input-holiday-date"
                          />
                          <Input
                            type="text"
                            placeholder="Holiday name (optional)"
                            value={newHolidayName}
                            onChange={(e) => setNewHolidayName(e.target.value)}
                            className="flex-1 min-w-[150px]"
                            data-testid="input-holiday-name"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={!newHolidayDate || addHolidayMutation.isPending}
                            onClick={() => addHolidayMutation.mutate({ date: newHolidayDate, name: newHolidayName })}
                            data-testid="button-add-holiday"
                          >
                            {addHolidayMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </Button>
                        </div>

                        {holidaysLoading ? (
                          <Skeleton className="h-8 w-full" />
                        ) : holidays.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {holidays.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((holiday) => (
                              <Badge 
                                key={holiday.id} 
                                variant="secondary"
                                className="flex items-center gap-1 pr-1"
                              >
                                {new Date(holiday.date).toLocaleDateString()}
                                {holiday.name && ` - ${holiday.name}`}
                                <button
                                  type="button"
                                  className="ml-1 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                                  onClick={() => deleteHolidayMutation.mutate(holiday.id)}
                                  disabled={deleteHolidayMutation.isPending}
                                  data-testid={`button-remove-holiday-${holiday.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No holidays configured</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

            {isEditing && (
              <div id="project-panel-people" data-project-section="people" role="tabpanel" aria-label="People"
                hidden={activeSection !== "people"} className="space-y-5 pb-5">
              {isEditing && (
                <div className="border-t pt-6 mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-lg font-medium">Assigned Users</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Manage which users have access to this project.
                  </p>

                  {usersLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-6 w-32" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-4">
                        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                          <SelectTrigger className="flex-1" data-testid="select-add-user">
                            <SelectValue placeholder="Select a user to add..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableUsers.length === 0 ? (
                              <SelectItem value="none" disabled>No users available</SelectItem>
                            ) : (
                              availableUsers.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.firstName && u.lastName
                                    ? `${u.firstName} ${u.lastName}`
                                    : u.username || u.email || u.id}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!selectedUserId || selectedUserId === "none" || addUserMutation.isPending}
                          onClick={() => selectedUserId && addUserMutation.mutate(selectedUserId)}
                          data-testid="button-add-user"
                        >
                          {addUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                        </Button>
                      </div>

                      {projectUsers.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {projectUsers.map((u) => (
                            <Badge 
                              key={u.id} 
                              variant="secondary"
                              className="flex items-center gap-1 pr-1"
                            >
                              {u.firstName && u.lastName
                                ? `${u.firstName} ${u.lastName}`
                                : u.username || u.email || u.id}
                              <button
                                type="button"
                                className="ml-1 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                                onClick={() => removeUserMutation.mutate(u.id)}
                                disabled={removeUserMutation.isPending}
                                data-testid={`button-remove-user-${u.id}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No users assigned to this project</p>
                      )}
                    </>
                  )}
                </div>
              )}
              {isEditing && (hasPermission("projects.manageAccessLocks") || hasPermission("security.manageSiteAccessLocks")) && (
                <div className="mt-6 border-t pt-6">
                  <AccessLockControl key={`project-access-lock-${id}`} scope="project" projectId={Number(id)} />
                </div>
              )}
              </div>
            )}
          </div>

          <footer data-testid="project-workspace-actions" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background/95 pt-3 [@media(max-height:450px)]:pt-2">
            {!isMobile && <p className="text-xs text-muted-foreground">Project settings save on submit. Standalone managers save independently.</p>}
            <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
                <Link href="/projects">
                  <Button variant="outline" type="button" data-testid="button-cancel">Cancel</Button>
                </Link>
                {isEditing && (
                  <Button 
                    type="button" 
                    variant="secondary"
                    disabled={copyMutation.isPending}
                    onClick={() => copyMutation.mutate()}
                    data-testid="button-copy-project"
                  >
                    {copyMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Copying...</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-2" />{isMobile ? "Copy" : "Copy Project"}</>
                    )}
                  </Button>
                )}
                <Button type="submit" disabled={isPending} data-testid="button-submit">
                  {isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />{isEditing ? "Updating..." : "Creating..."}</>) : (<><Save className="h-4 w-4 mr-2" />{isEditing ? "Update" : "Create"}{!isMobile && " Project"}</>)}
                </Button>
            </div>
          </footer>
        </form>
      </Form>
    </div>
  );
}
