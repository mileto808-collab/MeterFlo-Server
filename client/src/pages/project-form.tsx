import { useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { Project } from "@shared/schema";
import { ArrowLeft, Save, Loader2, Globe, Clock } from "lucide-react";

const projectFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().optional(),
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
    },
  });

  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description || "",
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
                    <FormLabel>Name</FormLabel>
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
                  Configure outbound API calls to push work order data to the customer's backend system when meter changeouts are completed.
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
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-4 pt-4">
                <Link href="/projects">
                  <Button variant="outline" type="button" data-testid="button-cancel">Cancel</Button>
                </Link>
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
