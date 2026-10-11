import type { Express } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import {
  customerPushFields, customerPushSchema, customerPushSettings, type CustomerPushSettings,
} from "../shared/customer-api-settings";

/** Expose availability, never credentials. This also supports standalone installs. */
export function customerCredentialStatus(settings: CustomerPushSettings, environment = process.env) {
  return settings.customerApiAuthType === "none" ? "not_required" :
    settings.customerApiSecretEnvVar && environment[settings.customerApiSecretEnvVar] ? "available" : "missing";
}

export function validateCustomerPush(settings: unknown, environment = process.env) {
  const parsed = customerPushSchema.safeParse(settings);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  if (parsed.data.customerApiEnabled && customerCredentialStatus(parsed.data, environment) === "missing") {
    return { errors: { customerApiSecretEnvVar: ["The server variable is not configured. Set its value in the server environment before enabling delivery."] } };
  }
  return { data: parsed.data };
}

/** Guard legacy project POST/PATCH too, without validating unchanged legacy settings. */
export function validateProjectCustomerPush(body: Record<string, any>, existing: Record<string, any> = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { errors: { _form: ["Expected a project settings object."] } };
  if (!customerPushFields.some(key => Object.hasOwn(body, key))) return { data: body };
  const supplied = Object.fromEntries(customerPushFields.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
  const result = validateCustomerPush({ ...customerPushSettings(existing), ...supplied });
  return result.data ? { data: { ...body, ...result.data } } : result;
}

export function registerCustomerApiSettings(app: Express) {
  const route = "/api/projects/:projectId/customer-api";
  const access = async (req: any, res: any, next: any) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isSafeInteger(projectId) || projectId < 1) return res.status(400).json({ message: "Invalid project ID" });
      const user = await storage.getUser(req.user?.claims?.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Unauthorized" });
      const canEdit = await storage.hasPermission(user, "projects.edit");
      const canView = canEdit || await storage.hasPermission(user, "settings.customerApiLogs");
      if (!canView) return res.status(403).json({ message: "Project-edit or delivery-log permission is required." });
      const admin = user.role === "admin" || await storage.isAdminUser(user);
      if (!admin && !await storage.isUserAssignedToProject(user.id, projectId)) return res.status(403).json({ message: "You are not assigned to this project." });
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (!admin && project.isActive === false && !await storage.hasPermission(user, "projects.viewInactive")) {
        return res.status(403).json({ message: "Access to this inactive project is unavailable." });
      }
      Object.assign(req, { pushProject: project, pushCanEdit: canEdit });
      next();
    } catch { res.status(500).json({ message: "Could not verify project access." }); }
  };
  app.get(route, isAuthenticated, access, (req: any, res) => {
    const settings = customerPushSettings(req.pushProject);
    res.json({ settings, credentialStatus: customerCredentialStatus(settings), canEdit: req.pushCanEdit });
  });
  app.put(route, isAuthenticated, access, async (req: any, res) => {
    if (!req.pushCanEdit) return res.status(403).json({ message: "Project-edit permission is required." });
    const result = validateCustomerPush(req.body);
    if (!result.data) return res.status(400).json({ message: "Check the push delivery settings.", errors: result.errors });
    try {
      const project = await storage.updateProject(req.pushProject.id, result.data);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const settings = customerPushSettings(project);
      res.json({ settings, credentialStatus: customerCredentialStatus(settings), canEdit: true });
    } catch { res.status(500).json({ message: "Could not save push delivery settings." }); }
  });
}
