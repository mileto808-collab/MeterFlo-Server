import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  SUPPORT_ATTACHMENT_ACCEPT,
  SUPPORT_ATTACHMENT_LIMITS,
  validateSupportAttachments,
} from "@shared/support-request";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip, X } from "lucide-react";
import type { User } from "@shared/schema";

const supportFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  subject: z.string().min(1, "Subject is required"),
  priority: z.enum(["low", "medium", "high"]),
  message: z.string().min(10, "Please provide more details (at least 10 characters)"),
});

type SupportFormValues = z.infer<typeof supportFormSchema>;

interface SupportFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
}

function getDefaultValues(user?: User | null): SupportFormValues {
  return {
    name: user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username || "",
    email: user?.email || "",
    subject: "",
    priority: "medium",
    message: "",
  };
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function getResponseMessage(response: Response): Promise<string> {
  const fallback = response.statusText || `Request failed (${response.status})`;
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim()) return record.message;
      if (typeof record.error === "string" && record.error.trim()) return record.error;
    }
  } catch {
    // A plain-text response can still provide a useful server message.
  }
  return text.trim().slice(0, 500) || fallback;
}

export function SupportFormDialog({ open, onOpenChange, user }: SupportFormDialogProps) {
  const { toast } = useToast();
  const [location] = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const form = useForm<SupportFormValues>({
    resolver: zodResolver(supportFormSchema),
    defaultValues: getDefaultValues(user),
  });

  const submitMutation = useMutation({
    mutationFn: async (data: SupportFormValues) => {
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("email", data.email);
      formData.append("subject", data.subject);
      formData.append("priority", data.priority);
      formData.append("message", data.message);
      const projectMatch = location.match(/^\/projects\/([1-9]\d*)(?:\/|$)/);
      if (projectMatch) {
        let projectId = projectMatch[1];
        try {
          projectId = decodeURIComponent(projectId);
        } catch {
          // Keep the path segment as-is if it contains malformed escaping.
        }
        formData.append("projectId", projectId);
      }
      attachments.forEach((file) => formData.append("attachments", file));

      const response = await fetch("/api/support", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const message = await getResponseMessage(response);
        if (response.status === 502) {
          throw new Error(
            `${message} Your form and selected files are still here.`,
          );
        }
        throw new Error(message);
      }
      return response;
    },
    onSuccess: () => {
      setSubmitted(true);
      setAttachments([]);
      setAttachmentError(null);
      toast({
        title: "Support request submitted",
        description: "Your request was received. Our team will follow up soon.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Submission failed",
        description: error.message || "Could not submit your request. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isPending = submitMutation.isPending;

  const onSubmit = (data: SupportFormValues) => {
    const validationError = validateSupportAttachments(attachments);
    setAttachmentError(validationError);
    if (validationError) return;
    submitMutation.mutate(data);
  };

  const handleClose = (isOpen: boolean) => {
    if (isPending && !isOpen) return;
    if (!isOpen) {
      setSubmitted(false);
      setAttachments([]);
      setAttachmentError(null);
      submitMutation.reset();
      form.reset(getDefaultValues(user));
    }
    onOpenChange(isOpen);
  };

  const addAttachments = (selected: FileList | null) => {
    if (!selected?.length) return;
    const nextFiles = [...attachments, ...Array.from(selected)];
    const validationError = validateSupportAttachments(nextFiles);
    if (validationError) {
      setAttachmentError(`${validationError} The selected files were not added.`);
      return;
    }
    setAttachments(nextFiles);
    setAttachmentError(null);
  };

  const removeAttachment = (index: number) => {
    const nextFiles = attachments.filter((_, fileIndex) => fileIndex !== index);
    setAttachments(nextFiles);
    setAttachmentError(validateSupportAttachments(nextFiles));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain sm:max-w-[520px]"
        data-testid="dialog-support-form"
      >
        <DialogHeader>
          <DialogTitle>Support request</DialogTitle>
          <DialogDescription>
            Tell us what is happening and include any helpful files.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-5 text-center">
            <div className="mb-4 text-green-600 dark:text-green-400">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-medium">Request received</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Your support request was submitted. Our team will follow up soon.
            </p>
            <Button onClick={() => handleClose(false)} data-testid="button-support-close">
              Close
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Your signed-in account and project memberships are included automatically. You can
                change the contact name and email below.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Your name" {...field} disabled={isPending} data-testid="input-support-name" />
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
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="your@email.com" {...field} disabled={isPending} data-testid="input-support-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject *</FormLabel>
                      <FormControl>
                        <Input placeholder="Brief description" {...field} disabled={isPending} data-testid="input-support-subject" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isPending}>
                        <FormControl>
                          <SelectTrigger data-testid="select-support-priority">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Please describe your issue or question in detail..."
                        className="min-h-[110px] resize-y"
                        {...field}
                        disabled={isPending}
                        data-testid="textarea-support-message"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <section className="space-y-2" aria-label="Attachments">
                <div>
                  <FormLabel htmlFor="support-attachments">Attachments</FormLabel>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Up to {SUPPORT_ATTACHMENT_LIMITS.maxFiles} files, {formatFileSize(SUPPORT_ATTACHMENT_LIMITS.maxFileBytes)} each
                    {" "}and {formatFileSize(SUPPORT_ATTACHMENT_LIMITS.maxTotalBytes)} total. Screenshots, documents, logs, and archives.
                  </p>
                </div>
                <label
                  htmlFor="support-attachments"
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:bg-muted/40 ${isPending ? "pointer-events-none opacity-60" : ""}`}
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                  <span>Add files</span>
                  <input
                    id="support-attachments"
                    type="file"
                    multiple
                    accept={SUPPORT_ATTACHMENT_ACCEPT}
                    disabled={isPending}
                    className="sr-only"
                    data-testid="input-support-attachments"
                    onChange={(event) => {
                      addAttachments(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>

                {attachments.length > 0 && (
                  <ul className="divide-y rounded-md border" aria-label="Selected attachments">
                    {attachments.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center gap-3 px-3 py-2">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatFileSize(file.size)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={isPending}
                          aria-label={`Remove ${file.name}`}
                          data-testid={`button-remove-support-attachment-${index}`}
                          onClick={() => removeAttachment(index)}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {attachmentError && (
                  <p role="alert" className="text-sm text-destructive" data-testid="text-support-attachment-error">
                    {attachmentError}
                  </p>
                )}
              </section>

              {submitMutation.isError && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {submitMutation.error.message}
                </p>
              )}

              <div className="flex flex-col-reverse justify-end gap-2 pt-1 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleClose(false)}
                  data-testid="button-support-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  data-testid="button-support-submit"
                >
                  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isPending ? "Sending..." : "Submit request"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
