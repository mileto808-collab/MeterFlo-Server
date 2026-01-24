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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { Project, User, ServiceTypeRecord } from "@shared/schema";
import { ArrowLeft, Save, Loader2, Globe, Clock, Users, X, CalendarDays, Plus, Wand2, Zap, Check, Copy, Scan } from "lucide-react";
import type { ProjectHoliday } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

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
  customerEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(255).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  customerApiEnabled: z.boolean().optional().default(false),
  customerApiUrl: z.string().max(500).optional().or(z.literal("")),
  customerApiAuthType: z.enum(["none", "api_key", "bearer_token", "basic_auth"]).optional().default("none"),
  customerApiKeyHeader: z.string().max(100).optional().or(z.literal("")),
  customerApiSecretEnvVar: z.string().max(100).optional().or(z.literal("")),
  customerApiSendPhotos: z.boolean().optional().default(true),
  operationalHoursEnabled: z.boolean().optional().default(false),
  operationalHoursStart: z.string().max(10).optional().or(z.literal("")),
  operationalHoursEnd: z.string().max(10).optional().or(z.literal("")),
  operationalHoursDays: z.array(z.string()).optional().default([]),
  timezone: z.string().max(100).optional().or(z.literal("")),
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
}).refine((data) => {
  if (data.operationalHoursEnabled) {
    return data.operationalHoursStart && data.operationalHoursEnd;
  }
  return true;
}, {
  message: "Both start and end times are required when operational hours are enabled",
  path: ["operationalHoursStart"],
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

export default function ProjectForm() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/projects/:id/edit");
  const id = params?.id;
  const isEditing = !!id;

  const { toast } = useToast();

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    enabled: isEditing,
  });

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { 
      name: "", 
      description: "", 
      isActive: true,
      customerEmail: "", 
      phone: "", 
      address: "", 
      city: "", 
      state: "", 
      zip: "", 
      notes: "",
      customerApiEnabled: false,
      customerApiUrl: "",
      customerApiAuthType: "none",
      customerApiKeyHeader: "",
      customerApiSecretEnvVar: "",
      customerApiSendPhotos: true,
      operationalHoursEnabled: false,
      operationalHoursStart: "",
      operationalHoursEnd: "",
      operationalHoursDays: [],
      timezone: "",
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
    },
  });

  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description || "",
        isActive: project.isActive !== false,
        customerEmail: project.customerEmail || "",
        phone: project.phone || "",
        address: project.address || "",
        city: project.city || "",
        state: project.state || "",
        zip: project.zip || "",
        notes: project.notes || "",
        customerApiEnabled: project.customerApiEnabled || false,
        customerApiUrl: project.customerApiUrl || "",
        customerApiAuthType: (project.customerApiAuthType as "none" | "api_key" | "bearer_token" | "basic_auth") || "none",
        customerApiKeyHeader: project.customerApiKeyHeader || "",
        customerApiSecretEnvVar: project.customerApiSecretEnvVar || "",
        customerApiSendPhotos: project.customerApiSendPhotos !== false,
        operationalHoursEnabled: project.operationalHoursEnabled || false,
        operationalHoursStart: project.operationalHoursStart || "",
        operationalHoursEnd: project.operationalHoursEnd || "",
        operationalHoursDays: project.operationalHoursDays || [],
        timezone: project.timezone || "",
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
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
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
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to update project", variant: "destructive" });
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
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
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
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEditing && projectLoading) {
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
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/projects">
          <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-form-title">
            {isEditing ? "Edit Project" : "New Project"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isEditing ? "Update project details" : "Create a new project"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
          <CardDescription>Fill in the information below</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
              <div className="grid grid-cols-3 gap-4">
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

              <div className="border-t pt-6 mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Customer API Integration</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure outbound API calls to push work order data to the customer's backend system when system changeouts are completed.
                </p>

                <FormField
                  control={form.control}
                  name="customerApiEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4 mb-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Enable Customer API</FormLabel>
                        <FormDescription>
                          Send work order data to the customer's backend when completed
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-customer-api-enabled"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch("customerApiEnabled") && (
                  <div className="space-y-4 pl-4 border-l-2 border-muted">
                    <FormField
                      control={form.control}
                      name="customerApiUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Endpoint URL</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="https://api.customer.com/work-orders" 
                              {...field} 
                              data-testid="input-customer-api-url" 
                            />
                          </FormControl>
                          <FormDescription>The URL to POST work order data to</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="customerApiAuthType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Authentication Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-customer-api-auth-type">
                                <SelectValue placeholder="Select authentication type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No Authentication</SelectItem>
                              <SelectItem value="api_key">API Key (Header)</SelectItem>
                              <SelectItem value="bearer_token">Bearer Token</SelectItem>
                              <SelectItem value="basic_auth">Basic Authentication</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("customerApiAuthType") === "api_key" && (
                      <FormField
                        control={form.control}
                        name="customerApiKeyHeader"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>API Key Header Name</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="X-API-Key" 
                                {...field} 
                                data-testid="input-customer-api-key-header" 
                              />
                            </FormControl>
                            <FormDescription>The header name for the API key</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {form.watch("customerApiAuthType") !== "none" && (
                      <FormField
                        control={form.control}
                        name="customerApiSecretEnvVar"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Secret Environment Variable</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="PROJECT_1_API_SECRET" 
                                {...field} 
                                data-testid="input-customer-api-secret-env-var" 
                              />
                            </FormControl>
                            <FormDescription>
                              Name of the environment variable containing the API secret. 
                              Store the actual secret in your server's environment variables.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="customerApiSendPhotos"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Include Photos</FormLabel>
                            <FormDescription>
                              Send before/after photos and signature as base64 data
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-customer-api-send-photos"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="border-t pt-6 mt-6">
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

              <div className="border-t pt-6 mt-6">
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

              <div className="border-t pt-6 mt-6">
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
                    <div className="grid grid-cols-2 gap-4">
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

              <div className="flex items-center justify-end gap-4 pt-4">
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
                      <><Copy className="h-4 w-4 mr-2" />Copy Project</>
                    )}
                  </Button>
                )}
                <Button type="submit" disabled={isPending} data-testid="button-submit">
                  {isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />{isEditing ? "Updating..." : "Creating..."}</>) : (<><Save className="h-4 w-4 mr-2" />{isEditing ? "Update" : "Create"} Project</>)}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
