import type { Express, RequestHandler } from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import { z } from "zod";
import { insertSupportSubmissionSchema, type User, type Project } from "../shared/schema";
import { SUPPORT_ATTACHMENT_LIMITS, supportAttachmentName, supportAttachmentType, validateSupportAttachments } from "../shared/support-request";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { auditActorMiddleware } from "./auditRoutes";

const schema = insertSupportSubmissionSchema.omit({ userId: true, emailSent: true, emailError: true }).extend({
  message: z.string().trim().min(10).max(20000),
  subject: z.string().trim().min(1).max(500).refine(value => !/[\r\n]/.test(value)),
  projectId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: SUPPORT_ATTACHMENT_LIMITS.maxFiles, fileSize: SUPPORT_ATTACHMENT_LIMITS.maxFileBytes,
    fields: 8, fieldSize: 21000, parts: 13 },
  fileFilter: (_req, file, callback) => {
    if (!supportAttachmentType(file.originalname)) return callback(new Error("Unsupported attachment type."));
    callback(null, true);
  },
}).array("attachments", SUPPORT_ATTACHMENT_LIMITS.maxFiles);

export const supportAttachments: RequestHandler = (req, res, next) => {
  upload(req, res, error => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT", "LIMIT_PART_COUNT"].includes(error.code);
    res.status(tooLarge ? 413 : 400).json({ message: tooLarge
      ? "Attach up to 5 files, no larger than 5 MB each and 15 MB total."
      : "Invalid support attachments or form fields. Use a supported file type." });
  });
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));

export function supportMailContent(user: User, projects: Pick<Project, "id" | "name">[],
  currentProject: Pick<Project, "id" | "name"> | undefined, data: z.infer<typeof schema>,
  files: Express.Multer.File[], requestId: number, date = new Date()) {
  const priority = { low: "Low", medium: "Medium", high: "High" }[data.priority];
  const details: Array<[string, string]> = [
    ["Request", `#${requestId}`],
    ["MeterFlo account", user.username || "(no username)"],
    ["Account ID", user.id],
    ["Account name", [user.firstName, user.lastName].filter(Boolean).join(" ") || "Not set"],
    ["Registered account email", user.email || "Not set"],
    ["Project memberships", projects.length ? projects.map(project => `${project.name} (#${project.id})`).join("; ") : "No assigned projects"],
    ["Current project", currentProject ? `${currentProject.name} (#${currentProject.id})` : "Not a project-specific page"],
    ["Contact name", data.name], ["Reply email", data.email], ["Priority", priority],
    ["Subject", data.subject], ["Submitted (UTC)", date.toISOString()],
    ["Attachments", files.length ? files.map(file => `${supportAttachmentName(file.originalname)} (${file.size} bytes)`).join("; ") : "None"],
  ];
  return {
    subject: `[MeterFlo Support #${requestId} - ${priority}] ${(user.username || user.id).replace(/[\r\n]/g, " ")}: ${data.subject}`,
    text: `Support Request from MeterFlo\n\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nMessage:\n${data.message}`,
    html: `<h2>Support Request from MeterFlo</h2><table>${details.map(([label, value]) =>
      `<tr><th style="text-align:left;vertical-align:top;padding:4px 8px">${escapeHtml(label)}</th><td style="padding:4px 8px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join("")}</table><h3>Message</h3><p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>`,
    attachments: files.map(file => ({
      filename: supportAttachmentName(file.originalname), content: file.buffer,
      contentType: supportAttachmentType(file.originalname), contentDisposition: "attachment" as const,
    })),
  };
}

type Dependencies = {
  store: Pick<typeof storage, "getUser" | "getUserProjects" | "getProject" | "getSetting" | "createSupportSubmission" | "updateSupportSubmissionDelivery">;
  password: () => string | undefined;
  transport: typeof nodemailer.createTransport;
};
export function createSupportRequestHandler(dependencies?: Dependencies): RequestHandler {
  const { store, password, transport } = dependencies ?? {
    store: storage, password: () => process.env.SMTP_PASSWORD, transport: nodemailer.createTransport,
  };
  return async (req: any, res) => {
    try {
      const user = await store.getUser(req.user.claims.sub);
      if (!user) return void res.status(401).json({ message: "Unauthorized" });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ message: "Invalid support form data.", errors: parsed.error.flatten().fieldErrors });
      const data = parsed.data, files = (req.files || []) as Express.Multer.File[];
      const problem = validateSupportAttachments(files.map(file => ({ name: file.originalname, size: file.size })));
      if (problem) return void res.status(413).json({ message: problem });
      const projects = await store.getUserProjects(user.id);
      let currentProject: Project | undefined;
      if (data.projectId !== undefined) {
        if (user.role !== "admin" && !projects.some(project => project.id === data.projectId))
          return void res.status(403).json({ message: "You cannot associate a support request with that project." });
        currentProject = await store.getProject(data.projectId);
        if (!currentProject) return void res.status(404).json({ message: "Project not found." });
      }
      const submission = await store.createSupportSubmission({
        userId: user.id, name: data.name, email: data.email, subject: data.subject, priority: data.priority,
        message: data.message, emailSent: false, emailError: "Email delivery pending.",
      });
      const settings = await Promise.all(["support_form_email", "smtp_host", "smtp_port", "smtp_user", "smtp_from_email",
        "smtp_secure", "smtp_reject_unauthorized"].map(key => store.getSetting(key)));
      const [to, host, port, smtpUser, from, secure, rejectUnauthorized] = settings;
      const smtpPassword = password();
      let emailSent = false, emailError = "Support email or SMTP is not configured.";
      if (to && host && port && smtpUser && smtpPassword) {
        try {
          const sender = transport({
            host, port: Number(port), secure: secure === "true", auth: { user: smtpUser, pass: smtpPassword },
            tls: { rejectUnauthorized: rejectUnauthorized !== "false" },
            connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
            disableFileAccess: true, disableUrlAccess: true,
          });
          const result = await sender.sendMail({ from: from || smtpUser, to, replyTo: data.email,
            ...supportMailContent(user, projects, currentProject, data, files, submission.id) });
          // A fulfilled transport can still report all recipients rejected.
          if (result.rejected?.length && !result.accepted?.length) throw new Error("Recipients rejected.");
          emailSent = true;
        } catch {
          emailError = "SMTP delivery failed.";
          console.warn("[Support Request] Email delivery failed", { submissionId: submission.id });
        }
      }
      try { await store.updateSupportSubmissionDelivery(submission.id, emailSent, emailSent ? null : emailError); }
      catch { console.warn("[Support Request] Delivery-status recording failed", { submissionId: submission.id }); }
      if (!emailSent) return void res.status(502).json({
        message: "Your request was saved, but the support email could not be sent. Any attachments have not been delivered. Please retry or ask your administrator to check support email settings.",
        emailSent: false, submissionId: submission.id,
      });
      res.json({ message: "Support email sent successfully.", emailSent: true, submissionId: submission.id });
    } catch {
      console.error("[Support Request] Submission failed.");
      res.status(500).json({ message: "Failed to submit support request. Please try again." });
    }
  };
}
export function registerSupportRoutes(app: Express) {
  app.post("/api/support", isAuthenticated, supportAttachments, auditActorMiddleware, createSupportRequestHandler());
}
