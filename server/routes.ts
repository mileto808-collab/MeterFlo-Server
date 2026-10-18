import type { Express, RequestHandler } from "express";
import { registerRoutingRoutes } from "./routing/routes";
import { sanitizeGenericProjectSettings } from "../shared/project-settings-boundary";
const projectRoutingWriteBoundary: RequestHandler = (req, res, next) => {
  try { req.body = sanitizeGenericProjectSettings(req.body ?? {}); next(); }
  catch { res.status(400).json({message:"Routing configuration must be changed through the dedicated Maps & Routing settings."}); }
};
import { createServer, type Server } from "http";
import path from "path";
import os from "os";
import { promises as fs, existsSync, unlinkSync, readdirSync, statSync, mkdirSync, rmSync, createWriteStream } from "fs";
import { resetWorkOrderOptionsSchema, WorkOrderResetError } from "../shared/work-order-reset";
import { stageWorkOrderResetFiles } from "./fileStorage";
import archiver from "archiver";
import unzipper from "unzipper";
import { Readable } from "stream";
import { randomUUID, createHmac } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import { storage } from "./storage";
import { loginUserResponse, userResponse } from "./userResponse";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { initializeWorkOrderSubStatuses, registerWorkOrderSubStatusRoutes, listSubStatuses } from "./workOrderSubStatuses";
import { insertProjectWorkOrderSchema, insertProjectSchema, createUserSchema, updateUserSchema, resetPasswordSchema, changePasswordSchema, updateProfileSchema, permissionKeys, insertExternalDatabaseConfigSchema, updateExternalDatabaseConfigSchema, insertImportConfigSchema, updateImportConfigSchema, databaseTypeEnum, importScheduleFrequencyEnum, ADMINISTRATOR_SUBROLE_KEY, getSubroleLevel, insertSupportSubmissionSchema, type CustomerApiAuthType, type GpsMode, type WizardMode } from "@shared/schema";
import { z } from "zod";
import { importedVisitScheduling, mapSqlImportRow, schedulingDto, validateVisitScheduling, visitSchedulingKeys } from "../shared/visitScheduling";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createProjectSchema, deleteProjectSchema, getProjectWorkOrderStorage, sanitizeSchemaName, backupProjectDatabase, restoreProjectDatabase, getProjectDatabaseStats } from "./projectDb";
import { auditActorMiddleware, registerAuditRoutes } from "./auditRoutes";
import { auditedOperation } from "./auditService";
import { coreUpdatePreview, gitReader } from "./coreUpdatePreview";
import { runtimeCustomerRelease } from "./customerExtensions";
import { registerInventoryRoutes } from "./inventoryRoutes";
import { inventoryState } from "./inventoryService";
import { removalConfig } from "../shared/inventory-removal-policy";
import { getProjectEquipmentVisibility } from "../shared/project-equipment-scope";
import { InventoryError } from "../shared/inventory-engine";
import { warehouseAccessible } from "../shared/inventory-location-types";

function mobileInventoryUsage(req: any): unknown {
  try {
    const raw = req.body?.inventoryUsage ?? (typeof req.body?.data === "string" && req.body.data.includes('"inventoryUsage"')
      ? JSON.parse(req.body.data).inventoryUsage : undefined);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { throw new InventoryError("inventoryUsage must contain valid JSON."); }
}
import { pool } from "./db";
import { readingParameter, withExactReadings } from "../shared/exact-readings";
import {
  getReadingPrecision, hasReadingPrecisionSettings, readingPrecisionPatchSchema,
  readingPrecisionPermission, validateCapturedReadings, readingValidationResponse,
  type ReadingValidationError,
} from "@shared/reading-precision";
import { ensureProjectDirectory, renameProjectDirectory, saveWorkOrderFile, getWorkOrderFiles, deleteWorkOrderFile, deleteWorkOrderDirectory, getFilePath, getProjectFilesPath, setProjectFilesPath, deleteProjectDirectory, saveProjectFile, getProjectFiles, deleteProjectFile, getProjectFilePath, ensureProjectFtpDirectory, getProjectFtpFiles, deleteProjectFtpFile, getProjectFtpFilePath, saveProjectFtpFile, getProjectDirectoryName } from "./fileStorage";
import { ExternalDatabaseService } from "./externalDbService";
import { createBackupArchive, extractDatabaseBackupFromArchive, restoreFullSystem, restoreFilesFromArchive, SystemRestoreError } from "./systemBackup";
import { createPgBackupArchive, extractBackupFromArchive, restorePgBackup, restoreFilesFromPgArchive, restoreWebAppFilesFromArchive, BackupType } from "./pgBackup";
import { projectEventEmitter, emitWorkOrderCreated, emitWorkOrderUpdated, emitWorkOrderDeleted, emitFileAdded, emitFileDeleted, type ProjectEvent } from "./eventEmitter";
import { retryCustomerDelivery, retryLegacyCustomerLog } from "./customerApiService";
import { registerApiImportRoutes } from "./apiImportRoutes";
import { registerLogMaintenanceRoutes } from "./logMaintenanceRoutes";
import { registerMobileReleaseRoutes } from "./mobileReleaseRoutes";
import { MobileReleaseRepository } from "./mobileReleaseRepository";
import { MobileReleaseService } from "./mobileReleaseService";
import { registerCustomerApiSettings, validateProjectCustomerPush } from "./customerApiSettings";
import { customerPushFields, customerPushSettings } from "../shared/customer-api-settings";
import { toZonedTime, format as formatTz } from "date-fns-tz";
import nodemailer from "nodemailer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
// Large file upload (1GB limit) - actual limit enforced by database settings in route handlers
const largeFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
// Chunk upload (6MB limit to allow 5MB chunks + multipart overhead) - for chunked uploads to avoid proxy timeouts
const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

// In-memory storage for chunked uploads (keyed by upload ID)
interface ChunkedUploadSession {
  userId: string;
  fileName: string;
  totalChunks: number;
  receivedChunks: Map<number, Buffer>;
  clearExisting: boolean;
  createdAt: Date;
  targetUrl?: string;
}
const chunkedUploadSessions = new Map<string, ChunkedUploadSession>();

// Clean up old upload sessions (older than 1 hour)
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [uploadId, session] of chunkedUploadSessions) {
    if (session.createdAt < oneHourAgo) {
      chunkedUploadSessions.delete(uploadId);
      console.log(`[ChunkedUpload] Cleaned up stale session: ${uploadId}`);
    }
  }
}, 5 * 60 * 1000).unref(); // Run every 5 minutes without keeping maintenance-only processes alive

async function getTimezoneFormattedTimestamp(projectTimezone?: string | null): Promise<string> {
  const globalTimezone = await storage.getSetting("default_timezone") || "America/Denver";
  const timezone = projectTimezone || globalTimezone;
  return new Date().toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone
  });
}

interface OperationalHoursValidationResult {
  valid: boolean;
  message?: string;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

async function validateOperationalHours(
  scheduledAt: string | Date | null | undefined,
  project: { 
    id: number;
    operationalHoursEnabled?: boolean | null; 
    operationalHoursStart?: string | null; 
    operationalHoursEnd?: string | null;
    operationalHoursDays?: string[] | null;
    timezone?: string | null;
  }
): Promise<OperationalHoursValidationResult> {
  if (!scheduledAt || !project.operationalHoursEnabled) {
    return { valid: true };
  }
  
  const scheduledDate = typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt;
  if (isNaN(scheduledDate.getTime())) {
    return { valid: true };
  }
  
  // Get the configured timezone - project timezone takes precedence over global setting
  const globalTimezone = await storage.getSetting("default_timezone") || "America/Denver";
  const timezone = project.timezone || globalTimezone;
  
  // Convert UTC date to the configured timezone using date-fns-tz
  const zonedDate = toZonedTime(scheduledDate, timezone);
  
  // Get the local hours and minutes in the configured timezone
  const scheduledHours = zonedDate.getHours();
  const scheduledMinutes = zonedDate.getMinutes();
  const scheduledTimeMinutes = scheduledHours * 60 + scheduledMinutes;
  
  // Get day of week in the configured timezone (0 = Sunday, 6 = Saturday)
  const dayIndex = zonedDate.getDay();
  const dayOfWeek = DAY_NAMES[dayIndex];
  
  // Check day of week if days are configured
  if (project.operationalHoursDays && project.operationalHoursDays.length > 0) {
    if (!project.operationalHoursDays.includes(dayOfWeek)) {
      const allowedDays = project.operationalHoursDays
        .map(d => d.charAt(0).toUpperCase() + d.slice(1))
        .join(', ');
      return { 
        valid: false, 
        message: `Scheduling is only allowed on: ${allowedDays}.`
      };
    }
  }
  
  // Check if date falls on a holiday - format as YYYY-MM-DD in configured timezone
  const localDateStr = formatTz(zonedDate, 'yyyy-MM-dd', { timeZone: timezone });
  const holidays = await storage.getProjectHolidays(project.id);
  const holiday = holidays.find(h => h.date === localDateStr);
  if (holiday) {
    return { 
      valid: false, 
      message: `Cannot schedule on ${holiday.name || localDateStr} - this date is marked as a holiday.`
    };
  }
  
  // Check time of day if hours are configured
  if (!project.operationalHoursStart || !project.operationalHoursEnd) {
    return { valid: true };
  }
  
  const [startHour, startMin] = project.operationalHoursStart.split(':').map(Number);
  const [endHour, endMin] = project.operationalHoursEnd.split(':').map(Number);
  
  if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) {
    return { valid: true };
  }
  
  const startTimeMinutes = startHour * 60 + startMin;
  const endTimeMinutes = endHour * 60 + endMin;
  
  if (scheduledTimeMinutes < startTimeMinutes || scheduledTimeMinutes > endTimeMinutes) {
    const formatTime = (h: number, m: number) => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
    };
    return { 
      valid: false, 
      message: `Scheduled time is outside operational hours. Work orders can only be scheduled between ${formatTime(startHour, startMin)} and ${formatTime(endHour, endMin)}.`
    };
  }
  
  return { valid: true };
}

async function initializeAdminUser() {
  const existingAdmin = await storage.getUserByUsername("admin");
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("pa$$werd1", 10);
    await storage.createLocalUser("admin", passwordHash, "admin");
    console.log("Default admin user created; change the initial password before use.");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  app.use(auditActorMiddleware);
  registerAuditRoutes(app);
  await initializeAdminUser();
  await storage.seedDefaultWorkOrderStatuses();
  await initializeWorkOrderSubStatuses();
  registerWorkOrderSubStatusRoutes(app);
  registerRoutingRoutes(app);
  await storage.syncPermissionsFromRegistry();
  await storage.ensureDefaultSubroles();
  registerApiImportRoutes(app);
  registerLogMaintenanceRoutes(app);
  const mobileReleaseRepo = new MobileReleaseRepository(pool);
  await mobileReleaseRepo.initialize();
  const mobileReleaseService = new MobileReleaseService(mobileReleaseRepo);
  registerMobileReleaseRoutes(app, mobileReleaseService, {
    authenticated: isAuthenticated,
    userId: async (req: any) => {
      const user = await storage.getUser(req.user?.claims?.sub);
      return user && !user.isLocked ? user.id : null;
    },
    canManage: async id => {
      const user = await storage.getUser(id);
      return !!user && !user.isLocked && await storage.hasPermission(user, permissionKeys.SETTINGS_MOBILE_CONFIG);
    },
  });
  const cleanupMobileReleases = () => mobileReleaseService.cleanup().catch(() => {
    console.error("[MobileReleases] Cleanup is pending. Check database and release storage access.");
  });
  void cleanupMobileReleases();
  setInterval(cleanupMobileReleases, 5 * 60 * 1000).unref();
  registerCustomerApiSettings(app);
  registerInventoryRoutes(app);

  // Local authentication
  app.post("/api/auth/local/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      
      const user = await storage.getUserByUsername(username);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      if (user.isLocked) {
        return res.status(403).json({ 
          message: "Account is locked", 
          reason: user.lockedReason || "Contact administrator for assistance" 
        });
      }
      
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      await storage.updateLastLogin(user.id);
      
      const sessionUser = {
        claims: { sub: user.id },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      };
      (req as any).login(sessionUser, (err: any) => {
        if (err) {
          console.error("Login session creation failed");
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({ message: "Login successful", user: loginUserResponse(user) });
      });
    } catch (error) {
      console.error("Local login failed");
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json(null);
      }
      
      // Include subrole key if user has a subrole
      let subroleKey: string | null = null;
      if (user.subroleId) {
        const subrole = await storage.getSubrole(user.subroleId);
        subroleKey = subrole?.key || null;
      }
      
      res.json({ ...userResponse(user), subroleKey });
    } catch (error) {
      console.error("Error fetching user");
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get current user's group memberships
  app.get("/api/auth/user/groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const groups = await storage.getUserGroupMemberships(userId);
      res.json(groups);
    } catch (error) {
      console.error("Error fetching user groups:", error);
      res.status(500).json({ message: "Failed to fetch user groups" });
    }
  });

  // User management
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canViewUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_VIEW);
      if (!canViewUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view users" });
      }
      
      // Admin users can see all users; non-admin users only see users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      let users: any[];
      
      if (isAdmin) {
        users = await storage.getAllUsers();
      } else {
        // Non-admin users only see users who share at least one project with them
        users = await storage.getUsersInSameProjects(currentUser.id);
      }
      
      res.json(users.map(userResponse));
    } catch (error) {
      console.error("Error fetching users");
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id/role", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_EDIT);
      if (!canEditUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit users" });
      }
      
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only modify users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === targetUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      const { role } = req.body;
      if (!["admin", "user", "customer"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      
      // Prevent non-admin users from promoting users to admin role
      if (role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can promote users to admin" });
      }
      
      const user = await storage.updateUserRole(req.params.id, role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error updating user role");
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Create new user
  app.post("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canCreateUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_CREATE);
      if (!canCreateUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create users" });
      }
      
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data", errors: parsed.error.errors });
      }
      
      const { username, password, firstName, lastName, email, role, subroleId, projectIds, groupIds } = parsed.data;
      
      // Prevent non-admin users from creating admin accounts
      if (role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can create admin accounts" });
      }
      
      // Prevent non-admin users from assigning Administrator subrole to new users
      // Also prevent privilege escalation - users cannot assign subroles with higher privilege than their own
      if (subroleId && currentUser.role !== "admin") {
        const targetSubrole = await storage.getSubrole(subroleId);
        if (targetSubrole?.key === ADMINISTRATOR_SUBROLE_KEY) {
          return res.status(403).json({ message: "Forbidden: Only administrators can assign the Administrator role" });
        }
        
        // Get current user's subrole to compare privilege levels
        const currentUserSubrole = currentUser.subroleId ? await storage.getSubrole(currentUser.subroleId) : null;
        const currentUserLevel = getSubroleLevel(currentUserSubrole?.key);
        const targetSubroleLevel = getSubroleLevel(targetSubrole?.key);
        
        if (targetSubroleLevel > currentUserLevel) {
          return res.status(403).json({ message: "Forbidden: You cannot assign a role with higher privileges than your own" });
        }
      }
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      if (email) {
        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createLocalUser(username, passwordHash, role, firstName, lastName, email, subroleId);
      
      // Assign to projects if specified
      if (projectIds && projectIds.length > 0) {
        for (const projectId of projectIds) {
          await storage.assignUserToProject(user.id, projectId);
        }
      }
      
      // Assign to user groups if specified
      if (groupIds && groupIds.length > 0) {
        for (const groupId of groupIds) {
          await storage.addUserToGroup(groupId, user.id);
        }
      }
      
      res.status(201).json(userResponse(user));
    } catch (error) {
      console.error("Error creating user");
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user
  app.patch("/api/users/:id", isAuthenticated, async (req: any, res, next) => {
    // The dedicated self-service profile route is registered below this one.
    if (req.params.id === "profile") return next("route");
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_EDIT);
      if (!canEditUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit users" });
      }
      
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data", errors: parsed.error.errors });
      }
      
      const targetUserId = req.params.id;
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only modify users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === existingUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (existingUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      // Prevent non-admin users from promoting users to admin role
      if (parsed.data.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can promote users to admin" });
      }
      
      if (parsed.data.role && parsed.data.role !== "admin" && existingUser.role === "admin") {
        const adminCount = await storage.countActiveAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot demote the last admin. Create another admin first." });
        }
      }
      
      // Prevent non-admin users from assigning Administrator subrole
      // Also prevent privilege escalation - users cannot assign subroles with higher privilege than their own
      // Also prevent non-admin users from modifying users with higher privilege than themselves
      if (currentUser.role !== "admin") {
        // Get current user's subrole level
        const currentUserSubrole = currentUser.subroleId ? await storage.getSubrole(currentUser.subroleId) : null;
        const currentUserLevel = getSubroleLevel(currentUserSubrole?.key);
        
        // Check if the existing user has a higher privilege level
        const existingUserSubrole = existingUser.subroleId ? await storage.getSubrole(existingUser.subroleId) : null;
        const existingUserLevel = getSubroleLevel(existingUserSubrole?.key);
        
        if (existingUserLevel > currentUserLevel) {
          return res.status(403).json({ message: "Forbidden: You cannot modify users with higher privileges than your own" });
        }
        
        // Check the target subrole level if one is being assigned
        if (parsed.data.subroleId !== undefined) {
          if (parsed.data.subroleId) {
            const targetSubrole = await storage.getSubrole(parsed.data.subroleId);
            if (targetSubrole?.key === ADMINISTRATOR_SUBROLE_KEY) {
              return res.status(403).json({ message: "Forbidden: Only administrators can assign the Administrator role" });
            }
            const targetSubroleLevel = getSubroleLevel(targetSubrole?.key);
            if (targetSubroleLevel > currentUserLevel) {
              return res.status(403).json({ message: "Forbidden: You cannot assign a role with higher privileges than your own" });
            }
          }
          // Setting subroleId to null is allowed as long as existing user isn't higher privilege (already checked above)
        }
      }
      
      if (parsed.data.username && parsed.data.username !== existingUser.username) {
        const usernameExists = await storage.getUserByUsername(parsed.data.username);
        if (usernameExists) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }
      
      if (parsed.data.email && parsed.data.email !== existingUser.email) {
        const emailExists = await storage.getUserByEmail(parsed.data.email);
        if (emailExists) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      
      const user = await storage.updateUser(targetUserId, parsed.data);
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error updating user");
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Reset user password
  app.post("/api/users/:id/reset-password", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canResetPasswords = await storage.hasPermission(currentUser, permissionKeys.USERS_RESET_PASSWORD);
      if (!canResetPasswords) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to reset passwords" });
      }
      
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid password data", errors: parsed.error.errors });
      }
      
      const targetUserId = req.params.id;
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only reset passwords for users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === existingUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (existingUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can reset admin passwords" });
      }
      
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const user = await storage.updateUserPassword(targetUserId, passwordHash);
      
      res.json({ message: "Password reset successfully", user: userResponse(user) });
    } catch (error) {
      console.error("Error resetting password");
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Update own profile (self-service)
  app.patch("/api/users/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid profile data", errors: parsed.error.errors });
      }
      
      // Check if email is being changed and if it's already taken
      if (parsed.data.email && parsed.data.email !== currentUser.email) {
        const emailExists = await storage.getUserByEmail(parsed.data.email);
        if (emailExists) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      
      const user = await storage.updateUser(userId, parsed.data);
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error updating profile");
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Change own password (self-service)
  app.post("/api/users/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid password data", errors: parsed.error.errors });
      }
      
      // Verify current password
      if (!currentUser.passwordHash) {
        return res.status(400).json({ message: "Password change not available for this account type" });
      }
      
      const isValidPassword = await bcrypt.compare(parsed.data.currentPassword, currentUser.passwordHash);
      if (!isValidPassword) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      
      // Hash and save new password
      const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await storage.updateUserPassword(userId, newPasswordHash);
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password");
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Lock user
  app.post("/api/users/:id/lock", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canLockUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_LOCK);
      if (!canLockUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to lock users" });
      }
      
      const targetUserId = req.params.id;
      
      if (currentUser.id === targetUserId) {
        return res.status(400).json({ message: "Cannot lock your own account" });
      }
      
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only lock users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === existingUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (existingUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can lock admin accounts" });
      }
      
      if (existingUser.role === "admin") {
        const adminCount = await storage.countActiveAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot lock the last active admin. Create another admin first." });
        }
      }
      
      const { reason } = req.body;
      const user = await storage.lockUser(targetUserId, reason);
      
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error locking user");
      res.status(500).json({ message: "Failed to lock user" });
    }
  });

  // Unlock user
  app.post("/api/users/:id/unlock", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canLockUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_LOCK);
      if (!canLockUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to unlock users" });
      }
      
      const targetUserId = req.params.id;
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only unlock users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === existingUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (existingUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can unlock admin accounts" });
      }
      
      const user = await storage.unlockUser(targetUserId);
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error unlocking user");
      res.status(500).json({ message: "Failed to unlock user" });
    }
  });

  // Delete user
  app.delete("/api/users/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canDeleteUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_DELETE);
      if (!canDeleteUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to delete users" });
      }
      
      const targetUserId = req.params.id;
      
      if (currentUser.id === targetUserId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only delete users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === existingUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (existingUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can delete admin accounts" });
      }
      
      if (existingUser.role === "admin") {
        const adminCount = await storage.countActiveAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot delete the last admin. Create another admin first." });
        }
      }
      
      await storage.deleteUser(targetUserId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // User-Project assignment endpoints
  app.get("/api/users/:id/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      // Allow users with nav.users permission OR if viewing their own projects
      const hasNavUsers = currentUser ? await storage.hasPermission(currentUser, permissionKeys.NAV_USERS) : false;
      if (!hasNavUsers && currentUser?.id !== targetUserId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Non-admin users can only view projects for users in their accessible users
      let callerProjectIds: Set<number> | null = null;
      if (currentUser && currentUser.id !== targetUserId) {
        const isAdmin = await storage.isAdminUser(currentUser);
        if (!isAdmin) {
          const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
          const canAccessUser = accessibleUsers.some(u => u.id === targetUserId);
          if (!canAccessUser) {
            return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
          }
          // Track caller's projects for filtering response
          const callerProjects = await storage.getUserProjects(currentUser.id);
          callerProjectIds = new Set(callerProjects.map(p => p.id));
        }
      }
      
      let projects = await storage.getUserProjects(targetUserId);
      
      // Filter to only projects the caller has access to (prevents information disclosure)
      if (callerProjectIds) {
        projects = projects.filter(p => callerProjectIds!.has(p.id));
      }
      
      // Get mobile app configuration
      const mobileUpdateUrl = await storage.getSetting("mobileUpdateUrl");
      const iosUpdateSource = await storage.getSetting("iosUpdateSource");
      const iosAppStoreId = await storage.getSetting("iosAppStoreId");
      
      // Return response with projects and optional mobileConfig
      res.json({
        projects,
        mobileConfig: {
          updateUrl: mobileUpdateUrl || null,
          iosUpdateSource: iosUpdateSource || null,
          appStoreId: iosAppStoreId || null
        }
      });
    } catch (error) {
      console.error("Error fetching user projects:", error);
      res.status(500).json({ message: "Failed to fetch user projects" });
    }
  });

  app.post("/api/users/:id/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_EDIT);
      if (!canEditUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to assign projects" });
      }
      
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only modify users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === targetUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      const { projectId } = req.body;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }
      
      // Non-admin users can only assign projects they have access to
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const hasProjectAccess = userProjects.some(p => p.id === projectId);
        if (!hasProjectAccess) {
          return res.status(403).json({ message: "Forbidden: You can only assign projects you have access to" });
        }
      }
      
      const assignment = await storage.assignUserToProject(req.params.id, projectId);
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Error assigning user to project:", error);
      res.status(500).json({ message: "Failed to assign user to project" });
    }
  });

  app.delete("/api/users/:userId/projects/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditUsers = await storage.hasPermission(currentUser, permissionKeys.USERS_EDIT);
      if (!canEditUsers) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to remove projects" });
      }
      
      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Non-admin users can only modify users in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
        const canAccessUser = accessibleUsers.some(u => u.id === targetUser.id);
        if (!canAccessUser) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
        }
        // Also verify user has access to the project being removed
        const userProjects = await storage.getUserProjects(currentUser.id);
        const projectId = parseInt(req.params.projectId);
        const hasProjectAccess = userProjects.some(p => p.id === projectId);
        if (!hasProjectAccess) {
          return res.status(403).json({ message: "Forbidden: You can only remove projects you have access to" });
        }
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      await storage.removeUserFromProject(req.params.userId, parseInt(req.params.projectId));
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from project:", error);
      res.status(500).json({ message: "Failed to remove user from project" });
    }
  });

  // User-Group membership endpoints (get/add/remove group memberships for a specific user)
  app.get("/api/users/:id/groups", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      // Allow users with nav.users permission OR if viewing their own groups
      const hasNavUsers = currentUser ? await storage.hasPermission(currentUser, permissionKeys.NAV_USERS) : false;
      if (!hasNavUsers && currentUser?.id !== targetUserId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Non-admin users can only view groups for users in their accessible users
      let callerProjectIds: Set<number> | null = null;
      if (currentUser && currentUser.id !== targetUserId) {
        const isAdmin = await storage.isAdminUser(currentUser);
        if (!isAdmin) {
          const accessibleUsers = await storage.getUsersInSameProjects(currentUser.id);
          const canAccessUser = accessibleUsers.some(u => u.id === targetUserId);
          if (!canAccessUser) {
            return res.status(403).json({ message: "Forbidden: You don't have access to this user" });
          }
          // Track caller's projects for filtering response
          const callerProjects = await storage.getUserProjects(currentUser.id);
          callerProjectIds = new Set(callerProjects.map(p => p.id));
        }
      }
      
      let groups = await storage.getUserGroupMemberships(targetUserId);
      
      // Filter to only groups that overlap with caller's projects (prevents information disclosure)
      if (callerProjectIds) {
        // Need to fetch group project assignments to filter
        const filteredGroups: typeof groups = [];
        for (const group of groups) {
          const groupWithProjects = await storage.getUserGroupWithProjects(group.id);
          if (groupWithProjects?.projectIds?.some(pid => callerProjectIds!.has(pid))) {
            filteredGroups.push(group);
          }
        }
        groups = filteredGroups;
      }
      
      res.json(groups);
    } catch (error) {
      console.error("Error fetching user groups:", error);
      res.status(500).json({ message: "Failed to fetch user groups" });
    }
  });

  app.post("/api/users/:id/groups", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const { groupId } = req.body;
      if (!groupId) {
        return res.status(400).json({ message: "groupId is required" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const groupWithProjects = await storage.getUserGroupWithProjects(parseInt(groupId));
      if (!groupWithProjects) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      const groupProjectIds = new Set(groupWithProjects.projectIds || []);
      const targetUserProjects = await storage.getUserProjects(targetUser.id);
      const targetUserProjectIds = new Set(targetUserProjects.map(p => p.id));
      
      // Non-admin users can only add users to groups in their projects
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        
        // Non-admin requires: intersection of caller projects ∩ group projects ∩ target user projects must be non-empty
        const commonProjectIds = [...userProjectIds].filter(pid => 
          groupProjectIds.has(pid) && targetUserProjectIds.has(pid)
        );
        if (commonProjectIds.length === 0) {
          return res.status(403).json({ message: "Forbidden: You must share a common project with both the group and the user" });
        }
      }
      
      // Validate: target user must belong to at least one of the group's projects
      const userBelongsToGroupProjects = [...groupProjectIds].some(pid => targetUserProjectIds.has(pid));
      if (!userBelongsToGroupProjects) {
        return res.status(400).json({ message: "User must be assigned to at least one project that this group belongs to" });
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      await storage.addUserToGroup(parseInt(groupId), req.params.id);
      res.status(201).json({ message: "User added to group" });
    } catch (error) {
      console.error("Error adding user to group:", error);
      res.status(500).json({ message: "Failed to add user to group" });
    }
  });

  app.delete("/api/users/:userId/groups/:groupId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const groupId = parseInt(req.params.groupId);
      
      // Non-admin users can only remove users from groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const groupWithProjects = await storage.getUserGroupWithProjects(groupId);
        if (!groupWithProjects) {
          return res.status(404).json({ message: "Group not found" });
        }
        const groupProjectIds = new Set(groupWithProjects.projectIds || []);
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        const targetUserProjects = await storage.getUserProjects(targetUser.id);
        const targetUserProjectIds = new Set(targetUserProjects.map(p => p.id));
        
        // Non-admin requires: intersection of caller projects ∩ group projects ∩ target user projects must be non-empty
        const commonProjectIds = [...userProjectIds].filter(pid => 
          groupProjectIds.has(pid) && targetUserProjectIds.has(pid)
        );
        if (commonProjectIds.length === 0) {
          return res.status(403).json({ message: "Forbidden: You must share a common project with both the group and the user" });
        }
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      await storage.removeUserFromGroup(groupId, req.params.userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from group:", error);
      res.status(500).json({ message: "Failed to remove user from group" });
    }
  });

  // Subroles and Permissions endpoints
  app.get("/api/subroles", isAuthenticated, async (req: any, res) => {
    try {
      const subroles = await storage.getAllSubroles();
      res.json(subroles);
    } catch (error) {
      console.error("Error fetching subroles:", error);
      res.status(500).json({ message: "Failed to fetch subroles" });
    }
  });

  app.get("/api/subroles/:id/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const permissions = await storage.getSubrolePermissions(parseInt(req.params.id));
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching subrole permissions:", error);
      res.status(500).json({ message: "Failed to fetch subrole permissions" });
    }
  });

  app.post("/api/subroles", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can manage access levels" });
      }
      
      const { key, label, baseRole, description, permissions: permissionList } = req.body;
      
      if (!key || !label || !baseRole) {
        return res.status(400).json({ message: "key, label, and baseRole are required" });
      }
      
      const existing = await storage.getSubroleByKey(key);
      if (existing) {
        return res.status(409).json({ message: "Subrole with this key already exists" });
      }
      
      const subrole = await storage.createSubrole({ key, label, baseRole, description });
      
      if (permissionList && Array.isArray(permissionList)) {
        await storage.setSubrolePermissions(subrole.id, permissionList);
      }
      
      res.status(201).json(subrole);
    } catch (error) {
      console.error("Error creating subrole:", error);
      res.status(500).json({ message: "Failed to create subrole" });
    }
  });

  app.put("/api/subroles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can manage access levels" });
      }
      
      const id = parseInt(req.params.id);
      const { key, label, baseRole, description, permissions: permissionList } = req.body;
      
      const existing = await storage.getSubrole(id);
      if (!existing) {
        return res.status(404).json({ message: "Subrole not found" });
      }
      
      if (key && key !== existing.key) {
        const duplicate = await storage.getSubroleByKey(key);
        if (duplicate) {
          return res.status(409).json({ message: "Subrole with this key already exists" });
        }
      }
      
      const subrole = await storage.updateSubrole(id, { key, label, baseRole, description });
      
      if (permissionList && Array.isArray(permissionList)) {
        await storage.setSubrolePermissions(id, permissionList);
      }
      
      res.json(subrole);
    } catch (error) {
      console.error("Error updating subrole:", error);
      res.status(500).json({ message: "Failed to update subrole" });
    }
  });

  app.delete("/api/subroles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can manage access levels" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getSubrole(id);
      if (!existing) {
        return res.status(404).json({ message: "Subrole not found" });
      }
      
      await storage.deleteSubrole(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting subrole:", error);
      res.status(500).json({ message: "Failed to delete subrole" });
    }
  });

  app.post("/api/subroles/:id/copy", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can manage access levels" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getSubrole(id);
      if (!existing) {
        return res.status(404).json({ message: "Subrole not found" });
      }
      
      // Get the permissions of the original subrole (returns array of permission key strings)
      const originalPermissions = await storage.getSubrolePermissions(id);
      
      // Use provided label/key or generate defaults
      const { label: providedLabel, key: providedKey } = req.body;
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const copyKey = providedKey || `${existing.key.substring(0, 30)}_${randomSuffix}`;
      const copyLabel = providedLabel || `Copy of ${existing.label}`;
      
      // Create the new subrole
      const newSubrole = await storage.createSubrole({
        key: copyKey,
        label: copyLabel,
        baseRole: existing.baseRole,
        description: existing.description,
      });
      
      // Copy the permissions to the new subrole
      if (originalPermissions.length > 0) {
        await storage.setSubrolePermissions(newSubrole.id, originalPermissions);
      }
      
      res.status(201).json(newSubrole);
    } catch (error) {
      console.error("Error copying subrole:", error);
      res.status(500).json({ message: "Failed to copy subrole" });
    }
  });

  app.put("/api/subroles/:id/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can manage access levels" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getSubrole(id);
      if (!existing) {
        return res.status(404).json({ message: "Subrole not found" });
      }
      
      const { permissions: permissionList } = req.body;
      if (!Array.isArray(permissionList)) {
        return res.status(400).json({ message: "permissions must be an array" });
      }
      
      await storage.setSubrolePermissions(id, permissionList);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating subrole permissions:", error);
      res.status(500).json({ message: "Failed to update subrole permissions" });
    }
  });

  app.get("/api/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const permissions = await storage.getAllPermissions();
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get("/api/users/:id/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      // Allow users to get their own permissions, or admins to get any user's permissions
      if (currentUser?.role !== "admin" && currentUser?.id !== targetUserId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const permissions = await storage.getUserEffectivePermissions(targetUser);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });

  app.patch("/api/users/:id/subrole", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { subroleId } = req.body;
      const user = await storage.updateUserSubrole(req.params.id, subroleId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(userResponse(user));
    } catch (error) {
      console.error("Error updating user subrole");
      res.status(500).json({ message: "Failed to update user subrole" });
    }
  });

  // User column preferences endpoints
  app.get("/api/users/:id/column-preferences/:pageKey", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      if (currentUser?.id !== targetUserId && currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const prefs = await storage.getUserColumnPreferences(targetUserId, req.params.pageKey);
      if (!prefs) {
        return res.status(404).json({ message: "No column preferences found" });
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching column preferences:", error);
      res.status(500).json({ message: "Failed to fetch column preferences" });
    }
  });

  app.put("/api/users/:id/column-preferences/:pageKey", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      if (currentUser?.id !== targetUserId && currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { visibleColumns, stickyColumns } = req.body;
      if (!Array.isArray(visibleColumns)) {
        return res.status(400).json({ message: "visibleColumns must be an array" });
      }
      if (stickyColumns !== undefined && !Array.isArray(stickyColumns)) {
        return res.status(400).json({ message: "stickyColumns must be an array" });
      }
      
      const prefs = await storage.setUserColumnPreferences(targetUserId, req.params.pageKey, visibleColumns, stickyColumns);
      res.json(prefs);
    } catch (error) {
      console.error("Error saving column preferences:", error);
      res.status(500).json({ message: "Failed to save column preferences" });
    }
  });

  // User filter preferences endpoints
  app.get("/api/users/:id/filter-preferences/:pageKey", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      if (currentUser?.id !== targetUserId && currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const prefs = await storage.getUserFilterPreferences(targetUserId, req.params.pageKey);
      if (!prefs) {
        return res.status(404).json({ message: "No preferences found" });
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching filter preferences:", error);
      res.status(500).json({ message: "Failed to fetch filter preferences" });
    }
  });

  app.put("/api/users/:id/filter-preferences/:pageKey", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const targetUserId = req.params.id;
      
      // Allow users to edit their own filter preferences, or users with nav.users permission to edit others
      const hasNavUsers = currentUser ? await storage.hasPermission(currentUser, permissionKeys.NAV_USERS) : false;
      if (currentUser?.id !== targetUserId && !hasNavUsers) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { visibleFilters, knownFilters } = req.body;
      if (!Array.isArray(visibleFilters)) {
        return res.status(400).json({ message: "visibleFilters must be an array" });
      }
      
      const prefs = await storage.setUserFilterPreferences(targetUserId, req.params.pageKey, visibleFilters, knownFilters);
      res.json(prefs);
    } catch (error) {
      console.error("Error saving filter preferences:", error);
      res.status(500).json({ message: "Failed to save filter preferences" });
    }
  });

  // Project endpoints
  app.get("/api/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Return empty array until proper tenant mapping is configured
      // This ensures multi-tenant isolation by not exposing project metadata
      if (currentUser.role === "customer") {
        return res.json([]);
      }
      
      // Admin users can see all projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (isAdmin) {
        const projects = await storage.getProjects();
        res.json(projects);
      } else {
        // Non-admin users only see projects they are assigned to
        // The nav.projects permission controls navigation visibility, not data access
        const projects = await storage.getUserProjects(currentUser.id);
        res.json(projects);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.id);
      
      // Check if user has nav.projects permission (can see all projects) or is assigned to this project
      const hasNavProjects = await storage.hasPermission(currentUser, permissionKeys.NAV_PROJECTS);
      if (!hasNavProjects) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.get("/api/projects/:id/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const hasNavProjects = await storage.hasPermission(currentUser, permissionKeys.NAV_PROJECTS);
      if (!hasNavProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view project users" });
      }
      
      const users = await storage.getProjectUsers(parseInt(req.params.id));
      res.json(users.map(userResponse));
    } catch (error) {
      console.error("Error fetching project users");
      res.status(500).json({ message: "Failed to fetch project users" });
    }
  });

  // Add user to project
  app.post("/api/projects/:id/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to assign users to projects" });
      }
      
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      
      const targetUser = await storage.getUser(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      const assignment = await storage.assignUserToProject(userId, parseInt(req.params.id));
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Error assigning user to project:", error);
      res.status(500).json({ message: "Failed to assign user to project" });
    }
  });

  // Remove user from project
  app.delete("/api/projects/:projectId/users/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to remove users from projects" });
      }
      
      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (targetUser.role === "admin" && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Only administrators can modify admin accounts" });
      }
      
      await storage.removeUserFromProject(req.params.userId, parseInt(req.params.projectId));
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from project:", error);
      res.status(500).json({ message: "Failed to remove user from project" });
    }
  });

  // Get assignable users and groups for a project (for work order assignment dropdown)
  app.get("/api/projects/:id/assignees", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.id);
      
      // Check if user has access to this project (via nav.projects permission or direct assignment)
      const hasNavProjects = currentUser ? await storage.hasPermission(currentUser, permissionKeys.NAV_PROJECTS) : false;
      if (!hasNavProjects) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      // Get users assigned to this project
      const projectUsers = await storage.getProjectUsers(projectId);
      
      // Get user groups assigned to this project (not all groups)
      const allGroupsWithProjects = await storage.getAllUserGroupsWithProjects();
      const projectGroupsList = allGroupsWithProjects.filter(group => 
        group.projectIds.includes(projectId)
      );
      
      // Format users for dropdown
      const users = projectUsers.map(user => ({
        type: "user" as const,
        id: user.id,
        label: user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`
          : user.username || user.email || user.id,
        username: user.username,
      }));
      
      // Format user groups for dropdown (only groups assigned to this project)
      const groups = projectGroupsList.map(group => ({
        type: "group" as const,
        id: `group:${group.id}`,
        label: group.name,
        key: group.name,
      }));
      
      res.json({ users, groups });
    } catch (error) {
      console.error("Error fetching project assignees:", error);
      res.status(500).json({ message: "Failed to fetch assignees" });
    }
  });

  app.post("/api/projects", isAuthenticated, projectRoutingWriteBoundary, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canCreateProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_CREATE);
      if (!canCreateProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create projects" });
      }
      if (((Object.hasOwn(req.body, "defaultServiceMinutes") && req.body.defaultServiceMinutes !== 30) ||
          (Object.hasOwn(req.body, "defaultAppointmentToleranceMinutes") && req.body.defaultAppointmentToleranceMinutes !== 60)) &&
          !await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT))
        return res.status(403).json({ message: "Edit Projects permission is required to customize visit planning defaults." });
      if (req.body.inventoryEnabled === true &&
          (!await storage.isAdminUser(currentUser) || !await storage.hasPermission(currentUser, permissionKeys.INVENTORY_CONFIGURE))) {
        return res.status(403).json({ message: "Administrator and inventory configuration permission required." });
      }

      if (req.body && Object.keys(req.body).some(key => key.startsWith("customerApi")) &&
          !await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT)) {
        return res.status(403).json({ message: "Project-edit permission is required to configure push delivery." });
      }
      if (hasReadingPrecisionSettings(req.body) &&
          !await storage.hasPermission(currentUser, readingPrecisionPermission)) {
        return res.status(403).json({ message: "Configure reading precision permission is required." });
      }
      
      const pushValidation = validateProjectCustomerPush(req.body);
      if (!pushValidation.data) return res.status(400).json({ message: "Check the push delivery settings.", errors: pushValidation.errors });
      const parsed = insertProjectSchema.safeParse({
        ...pushValidation.data,
        // The project form sends an empty optional email when left blank.
        customerEmail: pushValidation.data.customerEmail === "" ? null : pushValidation.data.customerEmail,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid project data", errors: parsed.error.errors });
      }
      
      const project = customerPushFields.some(key => Object.hasOwn(req.body, key))
        ? await storage.createProjectWithFullData({
            name: parsed.data.name, description: parsed.data.description, customerEmail: parsed.data.customerEmail,
            inventoryEnabled: parsed.data.inventoryEnabled ?? false,
            defaultServiceMinutes: parsed.data.defaultServiceMinutes,
            defaultAppointmentToleranceMinutes: parsed.data.defaultAppointmentToleranceMinutes,
            ...getReadingPrecision(parsed.data),
            ...customerPushSettings(parsed.data),
          })
        : await storage.createProject(parsed.data);
      
      const schemaName = await createProjectSchema(project.name, project.id);
      await storage.updateProjectDatabaseName(project.id, schemaName);
      
      await ensureProjectDirectory(project.name, project.id);
      
      const updatedProject = await storage.getProject(project.id);
      res.status(201).json(updatedProject);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  // Copy project endpoint - creates a new project with same settings
  app.post("/api/projects/:id/copy", isAuthenticated, projectRoutingWriteBoundary, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canCreateProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_CREATE);
      if (!canCreateProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create projects" });
      }
      
      const sourceProjectId = parseInt(req.params.id);
      const sourceProject = await storage.getProject(sourceProjectId);
      if (!sourceProject) {
        return res.status(404).json({ message: "Source project not found" });
      }
      
      // Create new project with copied settings (convert nulls to undefined for proper typing)
      const sourceAuthType = sourceProject.customerApiAuthType;
      const customerApiAuthType: CustomerApiAuthType =
        sourceAuthType === "api_key" ||
        sourceAuthType === "bearer_token" ||
        sourceAuthType === "basic_auth"
          ? sourceAuthType
          : "none";
      const wizardMode: WizardMode =
        sourceProject.wizardMode === "reading_only" || sourceProject.wizardMode === "user_choice"
          ? sourceProject.wizardMode
          : "changeout";
      const wizardGpsMode: GpsMode =
        sourceProject.wizardGpsMode === "manual_step" || sourceProject.wizardGpsMode === "disabled"
          ? sourceProject.wizardGpsMode
          : "automatic";
      const newProjectData = {
        name: `Copy of ${sourceProject.name}`,
        description: sourceProject.description ?? undefined,
        customerEmail: sourceProject.customerEmail ?? undefined,
        phone: sourceProject.phone ?? undefined,
        address: sourceProject.address ?? undefined,
        city: sourceProject.city ?? undefined,
        state: sourceProject.state ?? undefined,
        zip: sourceProject.zip ?? undefined,
        notes: sourceProject.notes ?? undefined,
        isActive: sourceProject.isActive ?? true,
        webhookUrl: sourceProject.webhookUrl ?? undefined,
        webhookEnabled: sourceProject.webhookEnabled ?? false,
        customerApiEnabled: sourceProject.customerApiEnabled ?? false,
        customerApiUrl: sourceProject.customerApiUrl ?? undefined,
        customerApiAuthType,
        customerApiKeyHeader: sourceProject.customerApiKeyHeader ?? undefined,
        customerApiSecretEnvVar: sourceProject.customerApiSecretEnvVar ?? undefined,
        customerApiSendPhotos: sourceProject.customerApiSendPhotos ?? true,
        operationalHoursEnabled: sourceProject.operationalHoursEnabled ?? false,
        operationalHoursStart: sourceProject.operationalHoursStart ?? undefined,
        operationalHoursEnd: sourceProject.operationalHoursEnd ?? undefined,
        operationalHoursDays: sourceProject.operationalHoursDays ?? undefined,
        timezone: sourceProject.timezone ?? undefined,
        wizardMode,
        wizardGpsMode,
        ...getReadingPrecision(sourceProject),
        wizardShowNotesStep: sourceProject.wizardShowNotesStep ?? true,
        wizardShowGpsStep: sourceProject.wizardShowGpsStep ?? true,
        wizardShowBeforePhotosStep: sourceProject.wizardShowBeforePhotosStep ?? true,
        wizardShowAfterPhotosStep: sourceProject.wizardShowAfterPhotosStep ?? true,
        wizardShowSignatureStep: sourceProject.wizardShowSignatureStep ?? true,
      };
      
      const newProject = await storage.createProjectWithFullData(newProjectData);
      
      // Create database schema for new project
      const schemaName = await createProjectSchema(newProject.name, newProject.id);
      await storage.updateProjectDatabaseName(newProject.id, schemaName);
      
      // Create project directory
      await ensureProjectDirectory(newProject.name, newProject.id);
      
      // Copy project holidays
      const holidays = await storage.getProjectHolidays(sourceProjectId);
      for (const holiday of holidays) {
        await storage.createProjectHoliday({
          projectId: newProject.id,
          date: holiday.date,
          name: holiday.name,
        });
      }
      
      const updatedProject = await storage.getProject(newProject.id);
      res.status(201).json(updatedProject);
    } catch (error) {
      console.error("Error copying project:", error);
      res.status(500).json({ message: "Failed to copy project" });
    }
  });

  app.patch("/api/projects/:id", isAuthenticated, projectRoutingWriteBoundary, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit projects" });
      }
      
      const projectId = parseInt(req.params.id);
      
      // Get the current project to check if name is changing
      const existingProject = await storage.getProject(projectId);
      if (!existingProject) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (Object.hasOwn(req.body, "inventoryEnabled")) {
        if (req.body.inventoryEnabled !== !!existingProject.inventoryEnabled &&
            (!await storage.isAdminUser(currentUser) || !await storage.hasPermission(currentUser, permissionKeys.INVENTORY_CONFIGURE)))
          return res.status(403).json({ message: "Administrator and inventory configuration permission required." });
        if (typeof req.body.inventoryEnabled !== "boolean") return res.status(400).json({ message: "Inventory enablement must be true or false." });
        // Disabling pauses tracking; unfinished records and physical-stock
        // evidence remain intact rather than blocking or cancelling the project.
      }

      if (hasReadingPrecisionSettings(req.body)) {
        if (!await storage.hasPermission(currentUser, readingPrecisionPermission)) {
          return res.status(403).json({ message: "Configure reading precision permission is required." });
        }
        if (!await storage.isAdminUser(currentUser) &&
            !await storage.isUserAssignedToProject(currentUser.id, projectId)) {
          return res.status(403).json({ message: "You are not assigned to this project." });
        }
        if (existingProject.isActive === false &&
            !await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW_INACTIVE)) {
          return res.status(403).json({ message: "Access to this inactive project is unavailable." });
        }
        const precisionValidation = readingPrecisionPatchSchema.safeParse(req.body);
        if (!precisionValidation.success) {
          return res.status(400).json({ message: "Reading decimal places must be integers from 0 to 6.", errors: precisionValidation.error.errors });
        }
      }

      if (Object.keys(req.body).some(key => key.startsWith("customerApi")) &&
          !await storage.isAdminUser(currentUser) &&
          !await storage.isUserAssignedToProject(currentUser.id, projectId)) {
        return res.status(403).json({ message: "You are not assigned to this project." });
      }
      if (Object.keys(req.body).some(key => key.startsWith("customerApi")) &&
          existingProject.isActive === false && !await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW_INACTIVE)) {
        return res.status(403).json({ message: "Access to this inactive project is unavailable." });
      }
      const pushValidation = validateProjectCustomerPush(req.body, existingProject);
      if (!pushValidation.data) return res.status(400).json({ message: "Check the push delivery settings.", errors: pushValidation.errors });
      
      // If name is changing, rename the project directory
      if (req.body.name && req.body.name !== existingProject.name) {
        await renameProjectDirectory(existingProject.name, req.body.name, projectId);
      }
      
      const project = await storage.updateProject(projectId, pushValidation.data);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error updating project:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canDeleteProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_DELETE);
      if (!canDeleteProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to delete projects" });
      }
      
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      if (project.databaseName) {
        await deleteProjectSchema(project.databaseName);
      }
      
      await deleteProjectDirectory(project.name, project.id);
      
      await storage.deleteProject(parseInt(req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // Project Holidays endpoints
  app.get("/api/projects/:projectId/holidays", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canViewProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW);
      if (!canViewProjects && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const holidays = await storage.getProjectHolidays(projectId);
      res.json(holidays);
    } catch (error) {
      console.error("Error fetching project holidays:", error);
      res.status(500).json({ message: "Failed to fetch holidays" });
    }
  });

  app.post("/api/projects/:projectId/holidays", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const holiday = await storage.createProjectHoliday({
        projectId,
        date: req.body.date,
        name: req.body.name || null,
      });
      res.status(201).json(holiday);
    } catch (error) {
      console.error("Error creating project holiday:", error);
      res.status(500).json({ message: "Failed to create holiday" });
    }
  });

  app.delete("/api/projects/:projectId/holidays/:holidayId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const holidayId = parseInt(req.params.holidayId);
      await storage.deleteProjectHoliday(holidayId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project holiday:", error);
      res.status(500).json({ message: "Failed to delete holiday" });
    }
  });

  // Project Service Types endpoints - manage which service types are assigned to a project
  app.get("/api/projects/:projectId/service-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canViewProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW);
      if (!canViewProjects && currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const serviceTypes = await storage.getProjectServiceTypes(projectId);
      res.json(serviceTypes);
    } catch (error) {
      console.error("Error fetching project service types:", error);
      res.status(500).json({ message: "Failed to fetch service types" });
    }
  });

  app.put("/api/projects/:projectId/service-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canEditProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_EDIT);
      if (!canEditProjects) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const { serviceTypeIds } = req.body;
      
      if (!Array.isArray(serviceTypeIds)) {
        return res.status(400).json({ message: "serviceTypeIds must be an array" });
      }
      
      await storage.setProjectServiceTypes(projectId, serviceTypeIds);
      const serviceTypes = await storage.getProjectServiceTypes(projectId);
      res.json(serviceTypes);
    } catch (error) {
      console.error("Error updating project service types:", error);
      res.status(500).json({ message: "Failed to update service types" });
    }
  });

  // SSE endpoint for project-scoped real-time events
  app.get("/api/projects/:projectId/events", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      // Check project access
      const canViewProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW);
      if (!canViewProjects && currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      
      res.write(`data: ${JSON.stringify({ type: "connected", projectId })}\n\n`);
      
      const sendEvent = (event: ProjectEvent) => {
        if (event.userId !== currentUser.id) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };
      
      const unsubscribe = projectEventEmitter.subscribeToProject(projectId, sendEvent);
      
      const heartbeatInterval = setInterval(() => {
        res.write(`:heartbeat\n\n`);
      }, 20000);
      
      req.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });
    } catch (error) {
      console.error("SSE connection error:", error);
      res.status(500).json({ message: "SSE connection failed" });
    }
  });

  // Global SSE endpoint for dashboard updates
  app.get("/api/events", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      
      const sendEvent = async (event: ProjectEvent) => {
        if (event.userId !== currentUser.id) {
          if (currentUser.role === "admin") {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } else {
            const isAssigned = await storage.isUserAssignedToProject(currentUser.id, event.projectId);
            if (isAssigned) {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          }
        }
      };
      
      const unsubscribe = projectEventEmitter.subscribeGlobal(sendEvent);
      
      const heartbeatInterval = setInterval(() => {
        res.write(`:heartbeat\n\n`);
      }, 20000);
      
      req.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });
    } catch (error) {
      console.error("Global SSE connection error:", error);
      res.status(500).json({ message: "SSE connection failed" });
    }
  });

  // Global work orders endpoint (for customers and cross-project views)
  app.get("/api/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Return empty array until proper tenant mapping is configured
      // This ensures multi-tenant isolation by not exposing any cross-tenant data
      if (currentUser.role === "customer") {
        // TODO: Implement proper customer-work order tenant mapping
        // When configured, filter by customerTenantKey matching work_orders.customerId
        return res.json([]);
      }
      
      // For internal users (admin/user), aggregate work orders from assigned projects
      let projects: any[] = [];
      if (currentUser.role === "admin") {
        projects = await storage.getProjects();
      } else {
        projects = await storage.getUserProjects(currentUser.id);
      }
      
      const allWorkOrders: any[] = [];
      const fieldTechnician = currentUser.subroleId && !await storage.isAdminUser(currentUser) &&
        (await storage.getSubrole(currentUser.subroleId))?.key === "field_technician";
      
      for (const project of projects) {
        if (!project.databaseName) continue;
        
        try {
          const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
          let workOrders = await workOrderStorage.getWorkOrders({});
          if (fieldTechnician) workOrders = workOrders.filter(wo =>
            wo.status === "Scheduled" && wo.assignedUserId === currentUser.id);
          
          // Add project info to each work order
          workOrders = workOrders.map((wo: any) => ({
            ...wo,
            projectId: project.id,
            projectName: project.name
          }));
          
          allWorkOrders.push(...workOrders);
        } catch (err) {
          console.error(`Error fetching work orders for project ${project.id}:`, err);
        }
      }
      
      res.json(allWorkOrders);
    } catch (error) {
      console.error("Error fetching global work orders:", error);
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });
  
  // Get single work order by ID (for detail view)
  app.get("/api/work-orders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Return 404 until proper tenant mapping is configured
      // This ensures multi-tenant isolation by not exposing any cross-tenant data
      if (currentUser.role === "customer") {
        // TODO: Implement proper customer-work order tenant mapping
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const workOrderId = parseInt(req.params.id);
      
      // For internal users, get projects they have access to
      let projects: any[] = [];
      if (currentUser.role === "admin") {
        projects = await storage.getProjects();
      } else {
        projects = await storage.getUserProjects(currentUser.id);
      }
      
      // Search for the work order across all accessible projects
      for (const project of projects) {
        if (!project.databaseName) continue;
        
        try {
          const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
          const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
          
          if (workOrder) {
            return res.json({
              ...workOrder,
              projectId: project.id,
              projectName: project.name
            });
          }
        } catch (err) {
          // Work order not in this project, continue searching
        }
      }
      
      res.status(404).json({ message: "Work order not found" });
    } catch (error) {
      console.error("Error fetching work order:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  // Project-scoped work orders
  app.get("/api/projects/:projectId/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      // Check if user has permission to view work orders
      const canViewWorkOrders = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_VIEW);
      if (!canViewWorkOrders) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view work orders" });
      }
      
      // Check project access - either has projects.view (can see all) or is assigned
      const canViewProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW);
      if (!canViewProjects) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or not initialized" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const filters: { status?: string; subStatusId?: string; assignedTo?: string } = {};
      
      if (req.query.status) filters.status = req.query.status;
      if (req.query.subStatusId) {
        if (!z.string().uuid().safeParse(req.query.subStatusId).success) return res.status(400).json({ message: "Invalid sub-status." });
        filters.subStatusId = req.query.subStatusId;
      }
      if (req.query.assignedTo) filters.assignedTo = req.query.assignedTo;
      
      let workOrders = await workOrderStorage.getWorkOrders(filters);
      
      // Technician dispatch lists contain only their personally assigned Scheduled work.
      if (currentUser?.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician" && !await storage.isAdminUser(currentUser)) {
          workOrders = workOrders.filter(wo => wo.status === "Scheduled" && wo.assignedUserId === currentUser.id);
        }
      }
      
      res.json(workOrders);
    } catch (error) {
      console.error("Error fetching work orders:", error);
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });

  app.get("/api/projects/:projectId/work-orders/stats", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // For field technicians, compute stats from their filtered work orders
      // IMPORTANT: Work orders claimed by other users should NOT be counted
      if (currentUser?.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician" && !await storage.isAdminUser(currentUser)) {
          const allWorkOrders = await workOrderStorage.getWorkOrders({});
          const filteredWorkOrders = allWorkOrders.filter(wo => wo.status === "Scheduled" && wo.assignedUserId === currentUser.id);
          
          // Compute stats from filtered work orders
          const statusCounts: Record<string, number> = {};
          for (const wo of filteredWorkOrders) {
            statusCounts[wo.status] = (statusCounts[wo.status] || 0) + 1;
          }
          
          return res.json({
            total: filteredWorkOrders.length,
            statusCounts
          });
        }
      }
      
      const stats = await workOrderStorage.getWorkOrderStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching work order stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Search work order by meter ID using query parameter (for mobile app compatibility)
  // Must be defined BEFORE /:workOrderId route to avoid "search" being matched as workOrderId
  // Searches both old_meter_id and new_meter_id fields
  app.get("/api/projects/:projectId/work-orders/search", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const meterId = req.query.meterId as string;
      
      if (!meterId) {
        return res.status(400).json({ message: "meterId query parameter is required" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Query directly with JOINs to get snake_case format matching mobile sync endpoint
      // Searches old_system_id, new_system_id, old_module_id, and new_module_id fields
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT w.*, 
                 sb.username as scheduled_by_username,
                 cb.username as completed_by_username,
                 au.username as assigned_user_username,
                 COALESCE(au.first_name || ' ' || au.last_name, au.username) as assigned_user_display_name
          FROM "${project.databaseName}".work_orders w
          LEFT JOIN public.users sb ON w.scheduled_by = sb.id
          LEFT JOIN public.users cb ON w.completed_by = cb.id
          LEFT JOIN public.users au ON w.assigned_user_id = au.id
          WHERE w.old_system_id = $1 OR w.new_system_id = $1 OR w.old_module_id = $1 OR w.new_module_id = $1
        `, [meterId]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Work order not found with meter ID: " + meterId });
        }
        
        // Filter for customer role - only show completed work orders
        let workOrders = result.rows;
        if (currentUser?.role === "customer") {
          workOrders = workOrders.filter((wo: any) => wo.status === "completed");
          if (workOrders.length === 0) {
            return res.status(403).json({ message: "Forbidden: Customers can only view completed work orders" });
          }
        }
        
        // Return array format for mobile app compatibility (expects .map() on response)
        res.json(workOrders);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error searching work order by meter ID:", error);
      res.status(500).json({ message: "Failed to search work order" });
    }
  });

  app.get("/api/projects/:projectId/work-orders/:workOrderId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Query directly with JOINs to get snake_case format matching mobile sync endpoint
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT w.*, 
                 sb.username as scheduled_by_username,
                 cb.username as completed_by_username,
                 au.username as assigned_user_username,
                 COALESCE(au.first_name || ' ' || au.last_name, au.username) as assigned_user_display_name
          FROM "${project.databaseName}".work_orders w
          LEFT JOIN public.users sb ON w.scheduled_by = sb.id
          LEFT JOIN public.users cb ON w.completed_by = cb.id
          LEFT JOIN public.users au ON w.assigned_user_id = au.id
          WHERE w.id = $1
        `, [workOrderId]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Work order not found" });
        }
        
        const workOrder = result.rows[0];
        
        if (currentUser?.role === "customer" && workOrder.status !== "completed") {
          return res.status(403).json({ message: "Forbidden: Customers can only view completed work orders" });
        }
        
        res.json({ ...workOrder, ...schedulingDto(workOrder) });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error fetching work order:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  // Look up work order by system ID, address, customer ID, or work order ID
  // Used by system changeout wizard and mobile app to find work orders
  // Note: /by-meter route kept for backward compatibility with mobile apps
  app.get(["/api/projects/:projectId/work-orders/by-system/:systemId", "/api/projects/:projectId/work-orders/by-meter/:systemId"], isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const searchTerm = decodeURIComponent(req.params.systemId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Query directly with JOINs to get snake_case format matching mobile sync endpoint
      // Searches: system IDs (old/new), module IDs (old/new), customer_id, work order IDs (customer_wo_id, system id), and address (partial/case-insensitive)
      const client = await pool.connect();
      try {
        // Try to parse as numeric ID for system work order ID matching
        const numericId = parseInt(searchTerm, 10);
        const isNumeric = !isNaN(numericId) && numericId > 0;
        
        const result = await client.query(`
          SELECT w.*, 
                 sb.username as scheduled_by_username,
                 cb.username as completed_by_username,
                 au.username as assigned_user_username,
                 COALESCE(au.first_name || ' ' || au.last_name, au.username) as assigned_user_display_name
          FROM "${project.databaseName}".work_orders w
          LEFT JOIN public.users sb ON w.scheduled_by = sb.id
          LEFT JOIN public.users cb ON w.completed_by = cb.id
          LEFT JOIN public.users au ON w.assigned_user_id = au.id
          WHERE w.old_system_id = $1 
             OR w.new_system_id = $1
             OR w.old_module_id = $1
             OR w.new_module_id = $1
             OR w.customer_id = $1
             OR w.customer_wo_id = $1
             OR ($3 AND w.id = $4)
             OR w.address ILIKE $2
        `, [searchTerm, `%${searchTerm}%`, isNumeric, isNumeric ? numericId : null]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: "No work order found matching: " + searchTerm });
        }
        
        const workOrder = result.rows[0];
        
        if (currentUser?.role === "customer" && workOrder.status !== "completed") {
          return res.status(403).json({ message: "Forbidden: Customers can only view completed work orders" });
        }
        
        res.json(workOrder);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error fetching work order by system ID:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  // Claim a work order - auto-assign to current user when starting system changeout
  // Uses atomic claim operation to prevent race conditions
  app.post("/api/projects/:projectId/work-orders/:workOrderId/claim", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // First check if work order exists
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Skip claim if already assigned to this user AND no group assignment
      if (workOrder.assignedUserId === currentUser.id && !workOrder.assignedGroupId) {
        return res.json({ message: "Already assigned to you", workOrder, claimed: false });
      }
      
      // Use atomic claim operation - this prevents race conditions where two users
      // try to claim the same work order simultaneously
      const updatedByUsername = currentUser.username || currentUser.id;
      const claimedWorkOrder = await workOrderStorage.claimWorkOrder(
        workOrderId, 
        currentUser.id,
        updatedByUsername
      );
      
      // If claimWorkOrder returns null, someone else claimed it first
      if (!claimedWorkOrder) {
        return res.status(409).json({ 
          message: "This work order has already been claimed by another user", 
          claimed: false,
          alreadyClaimed: true 
        });
      }
      
      // Emit SSE event to notify other users
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({ message: "Work order assigned to you", workOrder: claimedWorkOrder, claimed: true });
    } catch (error) {
      console.error("Error claiming work order:", error);
      res.status(500).json({ message: "Failed to claim work order" });
    }
  });

  app.post("/api/projects/:projectId/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check workOrders.create permission
      const canCreate = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_CREATE);
      if (!canCreate) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create work orders" });
      }
      if (visitSchedulingKeys.some(key => req.body[key] != null) &&
          !await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_EDIT))
        return res.status(403).json({ message: "Edit Work Orders permission is required to set visit scheduling." });
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Block work order creation on inactive projects
      if (project.isActive === false) {
        return res.status(403).json({ message: "Cannot create work orders on inactive projects" });
      }
      const readingErrors = validateCapturedReadings(req.body, project);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));
      
      // Validate operational hours if scheduledAt is provided
      if (req.body.scheduledAt) {
        const hoursValidation = await validateOperationalHours(req.body.scheduledAt, project);
        if (!hoursValidation.valid) {
          return res.status(400).json({ message: hoursValidation.message });
        }
      }
      
      // Foreign keys store account references; display names are resolved when
      // reading the work order and are not unique account identifiers.
      const createdByName = currentUser?.username || currentUser?.id;
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.createWorkOrder({
        ...req.body,
        createdBy: createdByName,
      });
      
      emitWorkOrderCreated(projectId, workOrder.id, currentUser?.id);
      res.status(201).json(workOrder);
    } catch (error) {
      console.error("Error creating work order:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid visit scheduling fields.", errors: error.issues });
      if (["23514","23503","22P02"].includes((error as any)?.code))
        return res.status(400).json({ message: (error as any).message?.startsWith("Sub-status") ? (error as any).message : "Invalid work-order reference or sub-status." });
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: "Failed to create work order" });
    }
  });

  app.post("/api/projects/:projectId/work-orders/:workOrderId/reset", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = Number(req.params.projectId);
      const workOrderId = Number(req.params.workOrderId);
      if (!Number.isSafeInteger(projectId) || projectId < 1 || !Number.isSafeInteger(workOrderId) || workOrderId < 1) {
        return res.status(400).json({ message: "Invalid project or work order" });
      }
      if (!currentUser || currentUser.role === "customer" ||
          !await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_EDIT)) {
        return res.status(403).json({ message: "You do not have permission to reset work orders" });
      }
      if (currentUser.role !== "admin" && !await storage.isUserAssignedToProject(currentUser.id, projectId)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const project = await storage.getProject(projectId);
      if (!project?.databaseName) return res.status(404).json({ message: "Project not found" });
      if (project.isActive === false) return res.status(403).json({ message: "Cannot reset work orders on inactive projects" });
      const parsed = resetWorkOrderOptionsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      const options = parsed.data;
      if (options.assignment !== "keep") {
        if (!await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_ASSIGN)) {
          return res.status(403).json({ message: "You do not have permission to change assignments" });
        }
        if (options.assignment === "user") {
          const users = await storage.getProjectUsers(projectId);
          if (!users.some(user => user.id === options.assignedUserId)) {
            return res.status(400).json({ message: "Select a technician assigned to this project" });
          }
        } else if (options.assignment === "group") {
          const groups = await storage.getAllUserGroupsWithProjects();
          if (!groups.some(group => group.name === options.assignedGroupId && group.projectIds.includes(projectId))) {
            return res.status(400).json({ message: "Select a group assigned to this project" });
          }
        }
      }
      const workOrder = await getProjectWorkOrderStorage(project.databaseName).resetCompletedWorkOrder(
        workOrderId, projectId, options, currentUser.username || currentUser.id,
        current => stageWorkOrderResetFiles(
          project.name, projectId, current.customerWoId || String(current.id), current.id, options.attachments === "delete",
        ),
      );
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      res.json(workOrder);
    } catch (error) {
      if (error instanceof WorkOrderResetError) return res.status(error.status).json({ message: error.message });
      console.error("Error resetting work order:", error);
      res.status(500).json({ message: "Failed to reset work order" });
    }
  });

  app.patch("/api/projects/:projectId/work-orders/:workOrderId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot edit work orders" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Block work order editing on inactive projects
      if (project.isActive === false) {
        return res.status(403).json({ message: "Cannot edit work orders on inactive projects" });
      }
      
      // Validate operational hours if scheduledAt is being updated
      if (req.body.scheduledAt) {
        const hoursValidation = await validateOperationalHours(req.body.scheduledAt, project);
        if (!hoursValidation.valid) {
          return res.status(400).json({ message: hoursValidation.message });
        }
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Get existing work order to merge with updates for validation
      const existingWorkOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!existingWorkOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      const readingErrors = validateCapturedReadings(req.body, project, existingWorkOrder);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));
      if (visitSchedulingKeys.some(key => Object.hasOwn(req.body, key)) &&
          !await storage.hasPermission(currentUser!, permissionKeys.WORK_ORDERS_EDIT))
        return res.status(403).json({ message: "Edit Work Orders permission is required to edit visit scheduling." });
      validateVisitScheduling({ ...existingWorkOrder, ...req.body });
      
      // Check if status is being set to "Completed" and validate required fields
      const finalStatus = req.body.status || existingWorkOrder.status;
      if (existingWorkOrder.status === "Completed" && finalStatus === "Open") {
        return res.status(409).json({ message: "Confirm the reset using the work order reset dialog before reopening this work order" });
      }
      if (finalStatus === "Completed") {
        const mergedData = { ...existingWorkOrder, ...req.body };
        const missingFields: string[] = [];
        
        // Determine if this work order has system data or module data
        const inventoryScope = project.inventoryEnabled ? getProjectEquipmentVisibility(project) : { showSystem: true, showModule: true };
        const hasSystemData = inventoryScope.showSystem && (mergedData.oldSystemId || mergedData.newSystemId);
        const hasModuleData = inventoryScope.showModule && (mergedData.oldModuleId || mergedData.newModuleId);
        
        // Validate system data if present
        const systemMissingFields: string[] = [];
        if (hasSystemData) {
          if (!mergedData.oldSystemId) systemMissingFields.push("Old System ID");
          if (mergedData.oldSystemReading === null || mergedData.oldSystemReading === undefined) systemMissingFields.push("Old System Reading");
          if (!mergedData.newSystemId) systemMissingFields.push("New System ID");
          if (mergedData.newSystemReading === null || mergedData.newSystemReading === undefined) systemMissingFields.push("New System Reading");
        }
        
        // Validate module data if present
        const moduleMissingFields: string[] = [];
        if (hasModuleData) {
          if (!mergedData.oldModuleId) moduleMissingFields.push("Old Module ID");
          if (mergedData.oldModuleRead === null || mergedData.oldModuleRead === undefined) moduleMissingFields.push("Old Module Reading");
          if (!mergedData.newModuleId) moduleMissingFields.push("New Module ID");
          if (mergedData.newModuleRead === null || mergedData.newModuleRead === undefined) moduleMissingFields.push("New Module Reading");
        }
        
        // Must have at least one complete set (system or module)
        if (!hasSystemData && !hasModuleData) {
          missingFields.push("System or Module data (at least one required)");
        } else {
          // Add missing fields from whichever data type is present
          missingFields.push(...systemMissingFields, ...moduleMissingFields);
        }
        
        // Conditionally required fields based on project wizard configuration
        // GPS is only required if wizardShowGpsStep is enabled (defaults to true)
        const requireGps = project.wizardShowGpsStep !== false;
        if (requireGps && !mergedData.newGps) missingFields.push("New GPS");
        
        // Signature is only required if wizardShowSignatureStep is enabled (defaults to true)
        const requireSignature = project.wizardShowSignatureStep !== false;
        if (requireSignature) {
          if (!mergedData.signatureData && !req.body.signatureData) missingFields.push("Signature");
          if (!mergedData.signatureName && !req.body.signatureName) missingFields.push("Signature Name");
        }
        
        if (missingFields.length > 0) {
          return res.status(400).json({ 
            message: `Cannot set status to Completed. Missing required fields: ${missingFields.join(", ")}` 
          });
        }
      }
      
      // Check if status is being set to "Scheduled" and validate required fields
      if (finalStatus === "Scheduled") {
        const mergedData = { ...existingWorkOrder, ...req.body };
        const missingFields: string[] = [];
        
        // Require an assigned user
        if (!mergedData.assignedUserId) {
          missingFields.push("Assigned User");
        }
        
        // Require a scheduled date/time
        if (!mergedData.scheduledAt) {
          missingFields.push("Scheduled Date/Time");
        }
        
        if (missingFields.length > 0) {
          return res.status(400).json({ 
            message: `Cannot set status to Scheduled. Missing required fields: ${missingFields.join(", ")}` 
          });
        }
      }
      
      // Use username for updated_by since it has a foreign key constraint to users table
      const updatedByUsername = currentUser?.username || currentUser?.id;
      
      // Clear scheduledAt when status changes away from "Scheduled"
      // This ensures scheduled work orders have their schedule cleared when marked as another status
      const isStatusChangingAwayFromScheduled = 
        existingWorkOrder.status === "Scheduled" && 
        req.body.status && 
        req.body.status !== "Scheduled";
      
      // Handle appendNotes: add new note text to existing notes
      const updateData = { ...req.body };
      
      // If status is changing away from Scheduled, clear the scheduledAt field
      if (isStatusChangingAwayFromScheduled) {
        updateData.scheduledAt = null;
      }
      if (updateData.appendNotes) {
        const currentNotes = existingWorkOrder.notes || "";
        const separator = currentNotes.trim() ? "\n" : "";
        updateData.notes = currentNotes + separator + updateData.appendNotes;
        delete updateData.appendNotes;
      }
      
      // Clear assignedGroupId when assignedUserId is set (work order should only show for assigned user)
      if (updateData.assignedUserId) {
        updateData.assignedGroupId = null;
      }
      
      const workOrder = await workOrderStorage.updateWorkOrder(workOrderId, updateData, updatedByUsername);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Save signature file if signatureData was provided and is a valid base64 image
      if (req.body.signatureData && req.body.signatureData.startsWith("data:image")) {
        const folderName = workOrder.customerWoId || String(workOrder.id);
        const base64Data = req.body.signatureData.split(",")[1];
        const signatureBuffer = Buffer.from(base64Data, "base64");
        const signatureFilename = `${folderName}-signature.png`;
        await saveWorkOrderFile(
          project.name,
          project.id,
          folderName,
          signatureFilename,
          signatureBuffer,
          workOrder.id
        );
      }
      
      // Customer delivery is recorded transactionally by updateWorkOrder.
      
      emitWorkOrderUpdated(projectId, workOrderId, currentUser?.id);
      res.json(workOrder);
    } catch (error) {
      console.error("Error updating work order:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid visit scheduling fields.", errors: error.issues });
      if ((error as any)?.code === "23514" || (error as any)?.code === "23503" || (error as any)?.code === "22P02")
        return res.status(400).json({ message: (error as any).message?.startsWith("Sub-status") ? (error as any).message : "Invalid work-order reference or sub-status." });
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: "Failed to update work order" });
    }
  });

  app.delete("/api/projects/:projectId/work-orders/:workOrderId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Get work order first to get customerWoId for file cleanup
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Commit stock/custody checks before deleting attachments. A rejected
      // removal must leave both the work order and its physical evidence intact.
      const folderName = workOrder.customerWoId || String(workOrder.id);
      await workOrderStorage.deleteWorkOrder(workOrderId);
      await deleteWorkOrderDirectory(project.name, project.id, folderName, workOrder.id);
      
      emitWorkOrderDeleted(projectId, workOrderId, currentUser?.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: "Failed to delete work order" });
    }
  });

  // Bulk delete work orders
  app.post("/api/projects/:projectId/work-orders/bulk-delete", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canDelete = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_DELETE);
      if (!canDelete) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to delete work orders" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "Work order IDs are required" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      let deletedCount = 0;
      const errors: string[] = [];
      
      for (const workOrderId of workOrderIds) {
        try {
          const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
          if (!workOrder) {
            errors.push(`Work order ${workOrderId} not found`);
            continue;
          }
          
          // Delete work order files/directory
          const folderName = workOrder.customerWoId || String(workOrder.id);
          await deleteWorkOrderDirectory(project.name, project.id, folderName, workOrder.id);
          
          // Delete work order from database
          await workOrderStorage.deleteWorkOrder(workOrderId);
          deletedCount++;
          
          emitWorkOrderDeleted(projectId, workOrderId, currentUser?.id);
        } catch (err) {
          errors.push(`Failed to delete work order ${workOrderId}`);
        }
      }
      
      res.json({
        deletedCount,
        totalRequested: workOrderIds.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error bulk deleting work orders:", error);
      res.status(500).json({ message: "Failed to bulk delete work orders" });
    }
  });

  // Bulk assign work orders
  app.post("/api/projects/:projectId/work-orders/bulk-assign", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canAssign = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_ASSIGN);
      if (!canAssign) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to assign work orders" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds, assigneeType, assigneeId, action } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "Work order IDs are required" });
      }
      
      if (!action || !["assign", "unassign"].includes(action)) {
        return res.status(400).json({ message: "Action must be 'assign' or 'unassign'" });
      }
      
      if (action === "assign") {
        if (!assigneeType || !["user", "group"].includes(assigneeType)) {
          return res.status(400).json({ message: "Assignee type must be 'user' or 'group'" });
        }
        if (!assigneeId) {
          return res.status(400).json({ message: "Assignee ID is required for assignment" });
        }
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Use username for updated_by since it has a foreign key constraint to users table
      const updatedByUsername = currentUser?.username || currentUser?.id;
      
      let assigned = 0;
      let skipped = 0;
      const skippedReasons: { id: number; reason: string }[] = [];
      
      for (const woId of workOrderIds) {
        const workOrder = await workOrderStorage.getWorkOrder(woId);
        if (!workOrder) {
          skipped++;
          skippedReasons.push({ id: woId, reason: "Work order not found" });
          continue;
        }
        
        // Skip work orders that are Completed, Closed, or Scheduled - they should not be reassigned
        if (workOrder.status === "Completed" || workOrder.status === "Closed" || workOrder.status === "Scheduled") {
          skipped++;
          skippedReasons.push({ id: woId, reason: `Cannot assign work order with status: ${workOrder.status}` });
          continue;
        }
        
        if (action === "assign") {
          let updates: { assignedUserId?: string | null; assignedGroupId?: string | null };
          if (assigneeType === "user") {
            updates = { assignedUserId: assigneeId, assignedGroupId: null };
          } else {
            const groupIdMatch = assigneeId.match(/^group:(\d+)$/);
            const numericGroupId = groupIdMatch ? groupIdMatch[1] : assigneeId;
            updates = { assignedGroupId: numericGroupId, assignedUserId: null };
          }
          
          await workOrderStorage.updateWorkOrder(woId, updates, updatedByUsername);
        } else {
          await workOrderStorage.updateWorkOrder(woId, { assignedUserId: null, assignedGroupId: null }, updatedByUsername);
        }
        
        // Emit SSE event to notify other connected clients
        emitWorkOrderUpdated(projectId, woId, currentUser?.id);
        
        assigned++;
      }
      
      res.json({ 
        success: true, 
        assigned, 
        skipped, 
        skippedReasons: skippedReasons.slice(0, 10),
        message: `${action === "assign" ? "Assigned" : "Unassigned"} ${assigned} work order(s)${skipped > 0 ? `, ${skipped} skipped` : ""}`
      });
    } catch (error) {
      console.error("Error bulk assigning work orders:", error);
      res.status(500).json({ message: "Failed to bulk assign work orders" });
    }
  });

  // Check work order assignments (for pre-validation before bulk assign)
  app.post("/api/projects/:projectId/work-orders/check-assignments", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canAssign = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_ASSIGN);
      if (!canAssign) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to assign work orders" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "Work order IDs are required" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      let assignableCount = 0;
      let existingAssignments = 0;
      let completedCount = 0;
      let closedCount = 0;
      let scheduledCount = 0;
      
      for (const woId of workOrderIds) {
        const workOrder = await workOrderStorage.getWorkOrder(woId);
        if (!workOrder) continue;
        
        // Skip work orders that are Completed, Closed, or Scheduled - they should not be reassigned
        if (workOrder.status === "Completed") {
          completedCount++;
          continue;
        }
        
        if (workOrder.status === "Closed") {
          closedCount++;
          continue;
        }
        
        if (workOrder.status === "Scheduled") {
          scheduledCount++;
          continue;
        }
        
        assignableCount++;
        if (workOrder.assignedUserId || workOrder.assignedGroupId) {
          existingAssignments++;
        }
      }
      
      res.json({
        total: workOrderIds.length,
        assignableCount,
        existingAssignments,
        completedCount,
        closedCount,
        scheduledCount
      });
    } catch (error) {
      console.error("Error checking work order assignments:", error);
      res.status(500).json({ message: "Failed to check work order assignments" });
    }
  });

  // Check bulk status eligibility (for pre-validation before bulk status update)
  app.post("/api/projects/:projectId/work-orders/check-bulk-status", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canEdit = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_EDIT);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit work orders" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "Work order IDs are required" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Check if user has permission to close work orders
      const canClose = await storage.hasPermission(currentUser, "workOrders.close");
      
      let eligibleCount = 0;
      let scheduledCount = 0;
      let completedCount = 0;
      let troubleCount = 0;
      
      for (const woId of workOrderIds) {
        const workOrder = await workOrderStorage.getWorkOrder(woId);
        if (!workOrder) continue;
        
        // Scheduled is always skipped
        if (workOrder.status === "Scheduled") {
          scheduledCount++;
          continue;
        }
        
        // Track Completed count (may be eligible if closing)
        if (workOrder.status === "Completed") {
          completedCount++;
          continue;
        }
        
        // Track Trouble count (may be eligible if closing)
        if (workOrder.status === "Trouble") {
          troubleCount++;
          continue;
        }
        
        eligibleCount++;
      }
      
      res.json({
        total: workOrderIds.length,
        eligibleCount,
        scheduledCount,
        completedCount,
        troubleCount,
        canClose  // User has permission to close work orders
      });
    } catch (error) {
      console.error("Error checking bulk status eligibility:", error);
      res.status(500).json({ message: "Failed to check bulk status eligibility" });
    }
  });

  // Bulk update work order status
  app.post("/api/projects/:projectId/work-orders/bulk-status", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const canEdit = await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_EDIT);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit work orders" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds, status } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "Work order IDs are required" });
      }
      
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
      
      // If setting status to Closed, require the Close Work Orders permission
      const isClosingToStatus = status.toLowerCase() === "closed";
      let canClose = false;
      
      if (isClosingToStatus) {
        canClose = await storage.hasPermission(currentUser, "workOrders.close");
        if (!canClose) {
          return res.status(403).json({ message: "Forbidden: You don't have permission to close work orders" });
        }
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const updatedByUsername = currentUser.firstName && currentUser.lastName 
        ? `${currentUser.firstName} ${currentUser.lastName}` 
        : currentUser.username;
      
      let updatedCount = 0;
      let skipped = 0;
      const skippedReasons: string[] = [];
      
      for (const woId of workOrderIds) {
        const workOrder = await workOrderStorage.getWorkOrder(woId);
        if (!workOrder) {
          skipped++;
          continue;
        }
        
        // Scheduled is always skipped
        if (workOrder.status === "Scheduled") {
          skipped++;
          if (skippedReasons.length < 10) {
            skippedReasons.push(`${workOrder.customerWoId || woId}: Scheduled status`);
          }
          continue;
        }
        
        // Completed and Trouble can only be updated if closing AND user has permission
        if (workOrder.status === "Completed" || workOrder.status === "Trouble") {
          if (isClosingToStatus && canClose) {
            // Allow updating to Closed
          } else {
            skipped++;
            if (skippedReasons.length < 10) {
              skippedReasons.push(`${workOrder.customerWoId || woId}: ${workOrder.status} status`);
            }
            continue;
          }
        }
        
        await workOrderStorage.updateWorkOrder(woId, { status }, updatedByUsername || undefined);
        
        // Emit SSE event to notify other connected clients
        emitWorkOrderUpdated(projectId, woId, currentUser?.id);
        
        updatedCount++;
      }
      
      res.json({ 
        success: true, 
        updatedCount, 
        skipped, 
        skippedReasons: skippedReasons.slice(0, 10),
        message: `Updated ${updatedCount} work order(s) to ${status}${skipped > 0 ? `, ${skipped} skipped` : ""}`
      });
    } catch (error) {
      console.error("Error bulk updating work order status:", error);
      res.status(500).json({ message: "Failed to bulk update work order status" });
    }
  });

  // Import work orders for a project
  app.post("/api/projects/:projectId/import", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot import work orders" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrders: workOrdersData, fileName, importSource } = req.body;
      if (!Array.isArray(workOrdersData)) {
        return res.status(400).json({ message: "workOrders must be an array" });
      }
      
      // Get the user's display name for createdBy
      const createdByName = currentUser?.firstName 
        ? `${currentUser.firstName}${currentUser.lastName ? ' ' + currentUser.lastName : ''}`
        : currentUser?.username || currentUser?.id;
      
      // Get work order storage to calculate next auto-generated WO ID
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      let nextAutoId = BigInt(await workOrderStorage.getNextCustomerWoId());
      
      // Get project's configured service types for default assignment
      const projectServiceTypes = await storage.getProjectServiceTypes(projectId);
      const allowedServiceTypeCodes = new Set(projectServiceTypes.map(st => st.code));
      const defaultServiceType = projectServiceTypes.length === 1 ? projectServiceTypes[0].code : null;
      const hasMultipleServiceTypes = projectServiceTypes.length > 1;
      
      // Error if no service type is configured for the project
      if (projectServiceTypes.length === 0) {
        return res.status(400).json({ 
          message: "No service types configured for this project. Please configure at least one service type in Project Settings before importing work orders." 
        });
      }
      
      // Create import history entry
      const historyEntry = await storage.createFileImportHistoryEntry(
        null,
        fileName || "manual_import",
        "running",
        projectId,
        importSource || "manual_file",
        createdByName
      );
      
      // Pass through ALL fields from the mapped work order data
      // Auto-generate customerWoId if not provided, use project's default service type
      const toImport: any[] = [];
      const importErrors: string[] = [];
      
      for (const wo of workOrdersData) {
        // Auto-generate customerWoId if not provided
        let customerWoId = wo.customerWoId || wo.title || null;
        if (!customerWoId) {
          customerWoId = String(nextAutoId);
          nextAutoId++;
        }
        
        // Handle serviceType: use project default if not provided
        let serviceType = wo.serviceType ? String(wo.serviceType).trim() : "";
        if (!serviceType) {
          if (hasMultipleServiceTypes) {
            importErrors.push(`Row missing serviceType and project has multiple service types configured (${Array.from(allowedServiceTypeCodes).join(", ")}) - cannot determine which to use. Customer: ${wo.customerName || 'unknown'}`);
            continue;
          }
          if (defaultServiceType) {
            serviceType = defaultServiceType;
          }
        } else {
          // Normalize case: capitalize first letter
          serviceType = serviceType.charAt(0).toUpperCase() + serviceType.slice(1).toLowerCase();
          
          // Validate against project's configured service types
          if (allowedServiceTypeCodes.size > 0 && !allowedServiceTypeCodes.has(serviceType)) {
            importErrors.push(`Row has invalid serviceType "${wo.serviceType}" - project only allows: ${Array.from(allowedServiceTypeCodes).join(", ")}. Customer: ${wo.customerName || 'unknown'}`);
            continue;
          }
        }
        
        toImport.push({
          customerWoId,
          customerId: wo.customerId || null,
          customerName: wo.customerName || null,
          address: wo.address || null,
          city: wo.city || null,
          state: wo.state || null,
          zip: wo.zip || null,
          phone: wo.phone || null,
          email: wo.email || null,
          route: wo.route || null,
          zone: wo.zone || null,
          serviceType,
          oldSystemId: wo.oldSystemId || wo.old_system_id || null,
          oldSystemReading: readingParameter(wo.oldSystemReadingText ?? wo.old_system_reading_text ?? wo.oldSystemReading ?? wo.old_system_reading),
          newSystemId: wo.newSystemId || wo.new_system_id || null,
          newSystemReading: readingParameter(wo.newSystemReadingText ?? wo.new_system_reading_text ?? wo.newSystemReading ?? wo.new_system_reading),
          oldGps: wo.oldGps || wo.old_gps || null,
          newGps: wo.newGps || wo.new_gps || null,
          status: wo.status || "Open",
          scheduledAt: wo.scheduledAt || wo.scheduledDate || wo.scheduled_date || wo.scheduled_at || null,
          ...importedVisitScheduling(wo),
          assignedUserId: wo.assignedUserId || wo.assigned_user_id || null,
          assignedGroupId: wo.assignedGroupId || wo.assigned_group_id || null,
          createdBy: currentUser?.username || null,
          trouble: wo.trouble || null,
          notes: wo.notes || null,
          attachments: wo.attachments || null,
          oldSystemType: wo.oldSystemType || wo.old_system_type || null,
          newSystemType: wo.newSystemType || wo.new_system_type || null,
          oldModuleId: wo.oldModuleId || wo.old_module_id || null,
          newModuleId: wo.newModuleId || wo.new_module_id || null,
          oldModuleRead: readingParameter(wo.oldModuleReadText ?? wo.old_module_read_text ?? wo.oldModuleRead ?? wo.old_module_read),
          newModuleRead: readingParameter(wo.newModuleReadText ?? wo.new_module_read_text ?? wo.newModuleRead ?? wo.new_module_read),
          oldModuleType: wo.oldModuleType || wo.old_module_type || null,
          newModuleType: wo.newModuleType || wo.new_module_type || null,
          ...(Object.hasOwn(wo, "inventoryItems") ? { inventoryItems: wo.inventoryItems } : {}),
        });
      }
      
      // Work-order creator/updater foreign keys reference usernames; the import
      // history above retains the human-readable display name.
      const result = await workOrderStorage.importWorkOrders(toImport, currentUser?.username || undefined);
      
      // Combine pre-import validation errors with import errors
      const allErrors = [...importErrors, ...(result.errors || [])];
      const totalFailed = importErrors.length + (result.errors?.length || 0);
      
      // Update history entry with results
      const status = allErrors.length > 0 
        ? (result.imported > 0 ? "partial" : "failed") 
        : "success";
      await storage.updateFileImportHistoryEntry(
        historyEntry.id,
        status,
        result.imported || 0,
        totalFailed,
        allErrors.slice(0, 10).join("\n") || null
      );
      
      res.json({
        ...result,
        errors: allErrors,
        skipped: importErrors.length,
      });
    } catch (error: any) {
      console.error("Error importing work orders:", error);
      res.status(500).json({ message: "Failed to import work orders" });
    }
  });

  // File upload for work orders
  app.post("/api/projects/:projectId/work-orders/:workOrderId/files", isAuthenticated, largeFileUpload.single("file"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot upload files" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      // Check file size against settings
      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const maxFileSizeMB = maxFileSizeValue ? parseInt(maxFileSizeValue) : 100;
      const maxFileSize = maxFileSizeMB * 1024 * 1024;
      
      if (req.file.size > maxFileSize) {
        return res.status(400).json({ message: `File exceeds maximum size of ${maxFileSizeMB} MB` });
      }
      
      // Fetch the work order to get customer_wo_id for folder naming
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Use customerWoId if available, otherwise fall back to legacy numeric ID
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      const filePath = await saveWorkOrderFile(
        project.name,
        project.id,
        folderName,
        req.file.originalname,
        req.file.buffer,
        workOrder.id // Legacy ID for backward compatibility
      );
      
      res.status(201).json({ message: "File uploaded", path: filePath });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  app.get("/api/projects/:projectId/work-orders/:workOrderId/files", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Fetch the work order to get customer_wo_id for folder naming
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Use customerWoId if available, otherwise fall back to legacy numeric ID
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      const files = await getWorkOrderFiles(project.name, project.id, folderName, workOrder.id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching files:", error);
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.delete("/api/projects/:projectId/work-orders/:workOrderId/files/:filename", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Fetch the work order to get customer_wo_id for folder naming
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(parseInt(req.params.workOrderId));
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Use customerWoId if available, otherwise fall back to legacy numeric ID
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      await deleteWorkOrderFile(
        project.name,
        project.id,
        folderName,
        req.params.filename,
        workOrder.id // Legacy ID for backward compatibility
      );
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  app.get("/api/projects/:projectId/work-orders/:workOrderId/files/:filename/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      const filePath = await getFilePath(
        project.name,
        project.id,
        folderName,
        req.params.filename,
        workOrder.id
      );
      
      if (!filePath) {
        return res.status(404).json({ message: "File not found" });
      }
      
      const mode = req.query.mode;
      if (mode === "view") {
        const ext = req.params.filename.toLowerCase().split(".").pop() || "";
        const mimeTypes: Record<string, string> = {
          "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
          "webp": "image/webp", "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff",
          "pdf": "application/pdf", "txt": "text/plain", "html": "text/html", "htm": "text/html",
          "json": "application/json", "xml": "application/xml", "csv": "text/csv"
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${req.params.filename}"`);
        return res.sendFile(path.resolve(filePath));
      }
      
      res.download(filePath, req.params.filename);
    } catch (error) {
      console.error("Error downloading work order file:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Work order time tracking endpoints
  app.get("/api/projects/:projectId/work-orders/:workOrderId/time-tracking", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Non-admin users must be assigned to the project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Get the work order to find systemWorkOrderId
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Use the customerWoId from the work order as the identifier
      const systemWorkOrderId = workOrder.customerWoId || String(workOrder.id);
      const timeTracking = await storage.getWorkOrderTimeTracking(projectId, systemWorkOrderId);
      
      res.json(timeTracking || null);
    } catch (error) {
      console.error("Error fetching work order time tracking:", error);
      res.status(500).json({ message: "Failed to fetch time tracking" });
    }
  });

  app.post("/api/projects/:projectId/work-orders/:workOrderId/time-tracking", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Non-admin users must be assigned to the project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Get the work order to find systemWorkOrderId
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const { startTime, endTime } = req.body;
      
      if (!startTime || !endTime) {
        return res.status(400).json({ message: "Start time and end time are required" });
      }
      if (!Number.isFinite(new Date(startTime).getTime()) || !Number.isFinite(new Date(endTime).getTime()) ||
          new Date(endTime).getTime() < new Date(startTime).getTime()) {
        return res.status(400).json({ message: "Time tracking requires valid dates with end time at or after start time" });
      }
      
      // Use the customerWoId from the work order as the identifier
      const systemWorkOrderId = workOrder.customerWoId || String(workOrder.id);
      
      const timeTracking = await storage.saveWorkOrderTimeTracking({
        projectId,
        systemWorkOrderId,
        startTime,
        endTime,
      });
      
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json(timeTracking);
    } catch (error) {
      console.error("Error saving work order time tracking:", error);
      res.status(500).json({ message: "Failed to save time tracking" });
    }
  });

  // System changeout workflow endpoint
  app.post("/api/projects/:projectId/work-orders/:workOrderId/system-changeout", isAuthenticated, upload.array("photos", 20), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Customers cannot perform system changeouts" });
      }
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Parse the changeout data
      const changeoutData = JSON.parse(req.body.data || "{}");
      const {
        canChange,
        troubleCode,
        troubleNote,
        oldSystemReading,
        oldModuleReading,
        newSystemId,
        newSystemReading,
        newModuleId,
        newModuleReading,
        gpsCoordinates,
        completionNotes,
        signatureData,
        signatureName,
        photoTypes, // Array of types matching the files array: ["before", "before", "after", "after", "trouble"]
        changeoutScope, // "system", "module", or "both"
        newSystemType,
        newModuleType,
        isReadingOnly, // true if reading-only mode, false/undefined for changeout mode
      } = changeoutData;
      
      const files = req.files as Express.Multer.File[];
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      // ========== VALIDATION FIRST - Before saving any files ==========
      
      // Validate photo types match files
      if (files && files.length > 0 && Array.isArray(photoTypes)) {
        if (photoTypes.length !== files.length) {
          return res.status(400).json({ 
            message: `Photo types count (${photoTypes.length}) does not match files count (${files.length})` 
          });
        }
        
        const validTypes = ["trouble", "before", "after"];
        for (let i = 0; i < photoTypes.length; i++) {
          if (!validTypes.includes(photoTypes[i])) {
            return res.status(400).json({ 
              message: `Invalid photo type at index ${i}: "${photoTypes[i]}"` 
            });
          }
        }
      }
      
      // Validate system reading format (numeric - integers or decimals, 0 is valid)
      const isValidSystemReading = (reading: string | number | null | undefined): boolean => {
        if (reading === null || reading === undefined) return false;
        const str = String(reading).trim();
        if (str.length === 0) return false;
        return /^\d+(\.\d+)?$/.test(str);
      };
      
      // Helper to check if a reading value is present (null/undefined/empty string = not present, 0 = present)
      const hasReadingValue = (value: any): boolean => {
        return value !== null && value !== undefined && value !== "";
      };
      
      // Validate GPS format (lat,lng with valid ranges)
      const isValidGps = (gps: string): boolean => {
        if (!gps || !gps.trim()) return false;
        const match = gps.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (!match) return false;
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      };
      
      // Use username for updated_by since it has a foreign key constraint to users table
      const updatedByUsername = currentUser.username || currentUser.id;
      const updateData: any = {};
      
      if (canChange) {
        // Success path - system was changed
        // Determine what needs to be validated based on changeout scope
        // If changeoutScope is provided, use it; otherwise fall back to work order data
        const woAny = workOrder as any;
        const hasSystemData = !!workOrder.oldSystemId || !!woAny.old_system_id;
        const hasModuleData = !!workOrder.oldModuleId || !!woAny.old_module_id;
        const needsSystem = changeoutScope 
          ? (changeoutScope === "system" || changeoutScope === "both")
          : hasSystemData;
        const needsModule = changeoutScope 
          ? (changeoutScope === "module" || changeoutScope === "both")
          : hasModuleData;
        
        // Validate required fields based on scope (use hasReadingValue for readings to allow 0)
        // In Reading Only mode: old readings come from DB, new IDs are copied from old IDs
        // Only new readings are required from the mobile request
        if (isReadingOnly) {
          // Reading Only mode: only new reading is required from mobile
          if (needsSystem && !hasReadingValue(newSystemReading)) {
            return res.status(400).json({ 
              message: "Missing required system field: new reading is required" 
            });
          }
          if (needsModule && !hasReadingValue(newModuleReading)) {
            return res.status(400).json({ 
              message: "Missing required module field: new reading is required" 
            });
          }
        } else {
          // Changeout mode: old reading, new ID, and new reading are all required from mobile
          if (needsSystem && (!hasReadingValue(oldSystemReading) || !newSystemId || !hasReadingValue(newSystemReading))) {
            return res.status(400).json({ 
              message: "Missing required system fields: old reading, new system ID, and new reading are required" 
            });
          }
          if (needsModule && (!hasReadingValue(oldModuleReading) || !newModuleId || !hasReadingValue(newModuleReading))) {
            return res.status(400).json({ 
              message: "Missing required module fields: old reading, new module ID, and new reading are required" 
            });
          }
        }
        if (!gpsCoordinates || !signatureName) {
          return res.status(400).json({ 
            message: "GPS coordinates and signature name are required" 
          });
        }
        
        // Validate system readings are numeric (integers or decimals)
        // In Reading Only mode, old readings come from DB - only validate new readings
        if (needsSystem) {
          if (!isReadingOnly && !isValidSystemReading(oldSystemReading)) {
            return res.status(400).json({ 
              message: "Old system reading must be a valid number" 
            });
          }
          if (!isValidSystemReading(newSystemReading)) {
            return res.status(400).json({ 
              message: "New system reading must be a valid number" 
            });
          }
        }
        
        // Validate module readings are numeric (integers or decimals)
        // In Reading Only mode, old readings come from DB - only validate new readings
        if (needsModule) {
          if (!isReadingOnly && !isValidSystemReading(oldModuleReading)) {
            return res.status(400).json({ 
              message: "Old module reading must be a valid number" 
            });
          }
          if (!isValidSystemReading(newModuleReading)) {
            return res.status(400).json({ 
              message: "New module reading must be a valid number" 
            });
          }
        }
        
        // Validate GPS format
        if (!isValidGps(gpsCoordinates)) {
          return res.status(400).json({ 
            message: "Invalid GPS format. Use: latitude,longitude (e.g., 37.7749,-122.4194)" 
          });
        }
        
        // Set system fields if applicable
        if (needsSystem) {
          if (isReadingOnly) {
            // Reading Only mode: copy IDs and types from old, only update new reading
            // Old reading stays in DB - don't overwrite
            updateData.newSystemId = workOrder.oldSystemId || woAny.old_system_id;
            updateData.newSystemReading = newSystemReading;
            // Copy type from old to new
            const existingOldType = workOrder.oldSystemType || woAny.old_system_type;
            if (existingOldType) {
              updateData.newSystemType = existingOldType;
            }
          } else {
            // Changeout mode: use values from mobile request
            updateData.oldSystemReading = oldSystemReading;
            updateData.newSystemId = newSystemId;
            updateData.newSystemReading = newSystemReading;
            // For changeout, copy type from request if provided
            if (newSystemType) {
              updateData.newSystemType = newSystemType;
            }
          }
        }
        
        // Set module fields if applicable
        if (needsModule) {
          if (isReadingOnly) {
            // Reading Only mode: copy IDs and types from old, only update new reading
            // Old reading stays in DB - don't overwrite
            updateData.newModuleId = workOrder.oldModuleId || woAny.old_module_id;
            updateData.newModuleRead = newModuleReading;
            // Copy type from old to new
            const existingOldModuleType = workOrder.oldModuleType || woAny.old_module_type;
            if (existingOldModuleType) {
              updateData.newModuleType = existingOldModuleType;
            }
          } else {
            // Changeout mode: use values from mobile request
            updateData.oldModuleRead = oldModuleReading;
            updateData.newModuleId = newModuleId;
            updateData.newModuleRead = newModuleReading;
            // For changeout, copy type from request if provided
            if (newModuleType) {
              updateData.newModuleType = newModuleType;
            }
          }
        }
        
        updateData.newGps = gpsCoordinates;
        updateData.signatureData = signatureData || null;
        updateData.signatureName = signatureName || null;
        updateData.completedAt = new Date().toISOString();
        updateData.completedBy = currentUser.id;
        
        // Always add completion report header (similar to Trouble Report format)
        const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
        const reportType = isReadingOnly ? "Reading Report" : "Changeout Report";
        const noteEntry = completionNotes && completionNotes.trim()
          ? `[${reportType} - ${timestamp}]\n${completionNotes.trim()}`
          : `[${reportType} - ${timestamp}]`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
        
        // Get the "Completed" status from system
        const statuses = await storage.getWorkOrderStatuses();
        const completedStatus = statuses.find((s: any) => s.code.toLowerCase() === "completed" || s.label.toLowerCase() === "completed");
        if (completedStatus) {
          updateData.status = completedStatus.code;
        }
      } else {
        // Trouble path - system could not be changed
        // Validate required fields for trouble path (GPS and signature NOT required)
        if (!troubleCode) {
          return res.status(400).json({ message: "Trouble code is required when system cannot be changed" });
        }
        
        // Look up trouble code details for the note
        const allTroubleCodes = await storage.getTroubleCodes();
        const troubleCodeDetails = allTroubleCodes.find(tc => tc.code === troubleCode);
        const troubleCodeLabel = troubleCodeDetails?.label || troubleCode;
        
        updateData.trouble = troubleCode;
        const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
        const troubleCodeLine = `Trouble Code: ${troubleCode} - ${troubleCodeLabel} - ${timestamp} by ${updatedByUsername}`;
        const noteEntry = troubleNote && troubleNote.trim()
          ? `[Trouble Report - ${timestamp} by ${updatedByUsername}]\n${troubleCodeLine}\n${troubleNote.trim()}`
          : `[Trouble Report - ${timestamp} by ${updatedByUsername}]\n${troubleCodeLine}`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
        
        // Get the "Unable to Complete" or similar status
        const statuses = await storage.getWorkOrderStatuses();
        const troubleStatus = statuses.find((s: any) => 
          s.code.toLowerCase().includes("unable") || 
          s.label.toLowerCase().includes("unable") ||
          s.code.toLowerCase().includes("trouble") ||
          s.label.toLowerCase().includes("trouble")
        );
        if (troubleStatus) {
          updateData.status = troubleStatus.code;
        }
      }
      
      // ========== ALL VALIDATION PASSED - Now save files ==========
      const readingErrors = validateCapturedReadings(updateData, project, workOrder);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));
      
      // Get existing files to determine next sequence numbers
      const existingFiles = await getWorkOrderFiles(project.name, project.id, folderName, workOrder.id);
      
      // Count existing files by type
      const countByType: Record<string, number> = { trouble: 0, before: 0, after: 0 };
      existingFiles.forEach((file: string) => {
        const match = file.match(/^.*-(trouble|before|after)-(\d+)\./);
        if (match) {
          const type = match[1] as "trouble" | "before" | "after";
          const num = parseInt(match[2]);
          if (num > countByType[type]) {
            countByType[type] = num;
          }
        }
      });
      
      // Upload photos with proper naming convention
      const uploadedPhotos: string[] = [];
      if (files && files.length > 0 && Array.isArray(photoTypes)) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const type = photoTypes[i] as "trouble" | "before" | "after";
          
          // Increment the sequence number for this type
          countByType[type] = (countByType[type] || 0) + 1;
          const sequence = countByType[type];
          
          // Determine file extension
          const ext = path.extname(file.originalname) || ".jpg";
          
          // Create filename: customerWoId-type-sequence.ext
          const filename = `${folderName}-${type}-${sequence}${ext}`;
          
          await saveWorkOrderFile(
            project.name,
            project.id,
            folderName,
            filename,
            file.buffer,
            workOrder.id
          );
          
          uploadedPhotos.push(filename);
        }
      }
      
      // Save signature image if provided
      if (signatureData && signatureData.startsWith("data:image")) {
        const base64Data = signatureData.split(",")[1];
        const signatureBuffer = Buffer.from(base64Data, "base64");
        const signatureFilename = `${folderName}-signature.png`;
        await saveWorkOrderFile(
          project.name,
          project.id,
          folderName,
          signatureFilename,
          signatureBuffer,
          workOrder.id
        );
        uploadedPhotos.push(signatureFilename);
      }
      
      // Update the work order - pass username as third parameter (FK references public.users(username))
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(workOrderId, updateData, updatedByUsername);
      
      if (!updatedWorkOrder) {
        console.error("System changeout: updateWorkOrder returned undefined for work order", workOrderId);
        return res.status(500).json({ message: "Failed to update work order" });
      }
      
      console.log("System changeout updated work order:", { 
        id: updatedWorkOrder.id, 
        status: updatedWorkOrder.status, 
        trouble: updatedWorkOrder.trouble 
      });
      
      // Emit SSE event to notify other connected clients
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({ 
        success: true, 
        message: canChange ? "System changeout completed successfully" : "Trouble report submitted successfully",
        uploadedPhotos 
      });
    } catch (error: any) {
      console.error("Error processing system changeout:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: error.message || "Failed to process system changeout" });
    }
  });

  // Project-level files (separate from work order files)
  app.get("/api/projects/:projectId/files", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const files = await getProjectFiles(project.name, project.id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching project files:", error);
      res.status(500).json({ message: "Failed to fetch project files" });
    }
  });

  app.post("/api/projects/:projectId/files", isAuthenticated, largeFileUpload.single("file"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot upload files" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      // Check file size against settings
      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const maxFileSizeMB = maxFileSizeValue ? parseInt(maxFileSizeValue) : 100;
      const maxFileSize = maxFileSizeMB * 1024 * 1024;
      
      if (req.file.size > maxFileSize) {
        return res.status(400).json({ message: `File exceeds maximum size of ${maxFileSizeMB} MB` });
      }
      
      // Check file extension against settings
      const allowedExtensionsValue = await storage.getSetting("allowed_extensions");
      if (allowedExtensionsValue && allowedExtensionsValue.trim()) {
        const allowedExts = allowedExtensionsValue.split(",").map(e => e.trim().toLowerCase());
        const fileExt = "." + req.file.originalname.split(".").pop()?.toLowerCase();
        if (!allowedExts.includes(fileExt)) {
          return res.status(400).json({ message: `File type ${fileExt} is not allowed. Allowed types: ${allowedExtensionsValue}` });
        }
      }
      
      const filePath = await saveProjectFile(
        project.name,
        project.id,
        req.file.originalname,
        req.file.buffer
      );
      
      // Emit SSE event for real-time updates
      emitFileAdded(projectId, undefined, currentUser?.id);
      
      res.status(201).json({ message: "File uploaded", path: filePath });
    } catch (error) {
      console.error("Error uploading project file:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  app.delete("/api/projects/:projectId/files/:filename", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      await deleteProjectFile(project.name, project.id, req.params.filename);
      
      // Emit SSE event for real-time updates
      emitFileDeleted(projectId, undefined, currentUser?.id);
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  app.get("/api/projects/:projectId/files/:filename/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const filePath = await getProjectFilePath(project.name, project.id, req.params.filename);
      
      if (!filePath) {
        return res.status(404).json({ message: "File not found" });
      }
      
      const mode = req.query.mode;
      if (mode === "view") {
        const ext = req.params.filename.toLowerCase().split(".").pop() || "";
        const mimeTypes: Record<string, string> = {
          "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
          "webp": "image/webp", "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff",
          "pdf": "application/pdf", "txt": "text/plain", "html": "text/html", "htm": "text/html",
          "json": "application/json", "xml": "application/xml", "csv": "text/csv"
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${req.params.filename}"`);
        return res.sendFile(path.resolve(filePath));
      }
      
      res.download(filePath, req.params.filename);
    } catch (error) {
      console.error("Error downloading project file:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // === PROJECT FTP FILES ROUTES ===
  
  // Get FTP files for a project
  app.get("/api/projects/:projectId/ftp-files", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Ensure FTP directory exists
      await ensureProjectFtpDirectory(project.name, project.id);
      
      const files = await getProjectFtpFiles(project.name, project.id);
      res.json(files);
    } catch (error) {
      console.error("Error getting FTP files:", error);
      res.status(500).json({ message: "Failed to get FTP files" });
    }
  });

  // Upload file to project FTP directory
  app.post("/api/projects/:projectId/ftp-files", isAuthenticated, largeFileUpload.single("file"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot upload files" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }
      
      // Check file size against settings
      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const maxFileSizeMB = maxFileSizeValue ? parseInt(maxFileSizeValue) : 100;
      const maxFileSize = maxFileSizeMB * 1024 * 1024;
      
      if (req.file.size > maxFileSize) {
        return res.status(400).json({ message: `File exceeds maximum size of ${maxFileSizeMB} MB` });
      }
      
      // Get allowed extensions from settings
      const allowedExtensionsSetting = await storage.getSetting("allowed_extensions");
      const allowedExtensions = allowedExtensionsSetting ? allowedExtensionsSetting.split(",").map(e => e.trim().toLowerCase()) : [".csv", ".xlsx", ".xls", ".txt"];
      const fileExtension = "." + req.file.originalname.split(".").pop()?.toLowerCase();
      
      if (!allowedExtensions.includes(fileExtension)) {
        return res.status(400).json({ message: `File type ${fileExtension} not allowed. Allowed: ${allowedExtensions.join(", ")}` });
      }
      
      const savedPath = await saveProjectFtpFile(
        project.name,
        project.id,
        req.file.originalname,
        req.file.buffer
      );
      
      // Emit SSE event for real-time updates
      emitFileAdded(projectId, undefined, currentUser?.id);
      
      res.json({ success: true, path: savedPath });
    } catch (error) {
      console.error("Error uploading FTP file:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Delete file from project FTP directory
  app.delete("/api/projects/:projectId/ftp-files/:filename", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const success = await deleteProjectFtpFile(project.name, project.id, req.params.filename);
      if (!success) {
        return res.status(404).json({ message: "File not found" });
      }
      
      // Clear lastProcessedFile flag for any import configs that reference this deleted file
      // This allows re-uploading a file with the same name to be processed again
      const clearedCount = await storage.clearLastProcessedFileByFilename(projectId, req.params.filename);
      if (clearedCount > 0) {
        console.log(`[FTP Delete] Cleared lastProcessedFile for ${clearedCount} import config(s) referencing "${req.params.filename}"`);
      }
      
      // Emit SSE event for real-time updates
      emitFileDeleted(projectId, undefined, currentUser?.id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting FTP file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // Download file from project FTP directory
  app.get("/api/projects/:projectId/ftp-files/:filename/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const filePath = await getProjectFtpFilePath(project.name, project.id, req.params.filename);
      
      if (!filePath) {
        return res.status(404).json({ message: "File not found" });
      }
      
      res.download(filePath, req.params.filename);
    } catch (error) {
      console.error("Error downloading FTP file:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // === FILE IMPORT CONFIG ROUTES ===

  // Get file import configs for a project
  app.get("/api/projects/:projectId/file-import-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const configs = await storage.getFileImportConfigs(projectId);
      res.json(configs);
    } catch (error) {
      console.error("Error getting file import configs:", error);
      res.status(500).json({ message: "Failed to get file import configs" });
    }
  });

  // Get single file import config
  app.get("/api/file-import-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, config.projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      res.json(config);
    } catch (error) {
      console.error("Error getting file import config:", error);
      res.status(500).json({ message: "Failed to get file import config" });
    }
  });

  // Create file import config
  app.post("/api/projects/:projectId/file-import-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const config = await storage.createFileImportConfig({
        ...req.body,
        projectId,
      });
      
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating file import config:", error);
      res.status(500).json({ message: "Failed to create file import config" });
    }
  });

  // Update file import config
  app.patch("/api/file-import-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, config.projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const updated = await storage.updateFileImportConfig(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating file import config:", error);
      res.status(500).json({ message: "Failed to update file import config" });
    }
  });

  // Delete file import config
  app.delete("/api/file-import-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      await storage.deleteFileImportConfig(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting file import config:", error);
      res.status(500).json({ message: "Failed to delete file import config" });
    }
  });

  // Get file import history
  app.get("/api/file-import-configs/:id/history", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, config.projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const history = await storage.getFileImportHistory(parseInt(req.params.id));
      res.json(history);
    } catch (error) {
      console.error("Error getting file import history:", error);
      res.status(500).json({ message: "Failed to get file import history" });
    }
  });

  // Run file import manually
  app.post("/api/file-import-configs/:id/run", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, config.projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      const { fileImportScheduler } = await import("./fileImportScheduler");
      const result = await fileImportScheduler.runImport(parseInt(req.params.id));
      res.json(result);
    } catch (error) {
      console.error("Error running file import:", error);
      res.status(500).json({ message: "Failed to run file import" });
    }
  });

  // Reset file import config to allow reprocessing
  app.post("/api/file-import-configs/:id/reset", isAuthenticated, async (req: any, res) => {
    try {
      const config = await storage.getFileImportConfig(parseInt(req.params.id));
      if (!config) {
        return res.status(404).json({ message: "Config not found" });
      }
      
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, config.projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      
      // Clear the lastProcessedFile to allow reprocessing
      await storage.updateFileImportConfig(parseInt(req.params.id), {
        lastProcessedFile: null,
        lastRunStatus: null,
        lastRunMessage: null,
        lastRunRecordCount: null,
        lastRunAt: null,
      });
      
      res.json({ success: true, message: "Import schedule reset. The file can now be reprocessed." });
    } catch (error) {
      console.error("Error resetting file import config:", error);
      res.status(500).json({ message: "Failed to reset file import config" });
    }
  });

  // Global Work Order Search (across all accessible projects)
  app.get("/api/search/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get projects user has access to
      let accessibleProjects;
      if (currentUser.role === "admin") {
        accessibleProjects = await storage.getProjects();
      } else {
        accessibleProjects = await storage.getUserProjects(currentUser.id);
      }
      
      // Parse search filters from query
      const {
        query,
        projectId,
        status,
        serviceType,
        oldSystemType,
        dateFrom,
        dateTo,
        assignedTo,
      } = req.query;
      
      // Filter projects if specific project requested
      let projectsToSearch = accessibleProjects;
      if (projectId) {
        projectsToSearch = accessibleProjects.filter((p: { id: number }) => p.id === parseInt(projectId));
      }
      
      const results: Array<{
        projectId: number;
        projectName: string;
        workOrder: any;
      }> = [];
      
      // Search across all accessible projects
      for (const project of projectsToSearch) {
        if (!project.databaseName) continue;
        
        try {
          const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
          const filters: { status?: string; assignedTo?: string } = {};
          
          // Handle comma-separated status values
          const statusArray = status ? String(status).split(",").map((s: string) => s.trim()) : [];
          // Handle comma-separated serviceType values
          const serviceTypeArray = serviceType ? String(serviceType).split(",").map((s: string) => s.trim()) : [];
          
          if (statusArray.length === 1) filters.status = statusArray[0];
          if (assignedTo) filters.assignedTo = assignedTo;
          
          // Customers can only see completed work orders
          if (currentUser.role === "customer") {
            filters.status = "completed";
          }
          
          const workOrders = await workOrderStorage.getWorkOrders(filters);
          
          // Apply additional filters
          const filteredOrders = workOrders.filter(wo => {
            // Text search in customerWoId, customerName, address, notes, oldSystemId, newSystemId
            if (query) {
              const searchQuery = query.toLowerCase();
              const matchesWoId = wo.customerWoId?.toLowerCase().includes(searchQuery);
              const matchesName = wo.customerName?.toLowerCase().includes(searchQuery);
              const matchesAddress = wo.address?.toLowerCase().includes(searchQuery);
              const matchesNotes = wo.notes?.toLowerCase().includes(searchQuery);
              const matchesOldSystem = wo.oldSystemId?.toLowerCase().includes(searchQuery);
              const matchesNewSystem = wo.newSystemId?.toLowerCase().includes(searchQuery);
              const matchesRoute = wo.route?.toLowerCase().includes(searchQuery);
              const matchesZone = wo.zone?.toLowerCase().includes(searchQuery);
              if (!matchesWoId && !matchesName && !matchesAddress && !matchesNotes && 
                  !matchesOldSystem && !matchesNewSystem && !matchesRoute && !matchesZone) return false;
            }
            
            // Status filter (multi-select support)
            if (statusArray.length > 1 && !statusArray.includes(wo.status)) return false;
            
            // Service type filter (multi-select support, matches both code and label)
            if (serviceTypeArray.length > 0 && wo.serviceType) {
              if (!serviceTypeArray.includes(wo.serviceType)) return false;
            } else if (serviceTypeArray.length > 0 && !wo.serviceType) {
              return false;
            }
            
            // Old system type filter
            if (oldSystemType && (wo as any).oldSystemType !== oldSystemType) return false;
            
            // Date range filter
            if (dateFrom) {
              const fromDate = new Date(dateFrom);
              const woDate = wo.createdAt ? new Date(wo.createdAt) : null;
              if (!woDate || woDate < fromDate) return false;
            }
            if (dateTo) {
              const toDate = new Date(dateTo);
              toDate.setHours(23, 59, 59, 999);
              const woDate = wo.createdAt ? new Date(wo.createdAt) : null;
              if (!woDate || woDate > toDate) return false;
            }
            
            return true;
          });
          
          filteredOrders.forEach(wo => {
            results.push({
              projectId: project.id,
              projectName: project.name,
              workOrder: wo,
            });
          });
        } catch (err) {
          console.error(`Error searching project ${project.id}:`, err);
        }
      }
      
      // Sort by created date (newest first)
      results.sort((a, b) => {
        const dateA = a.workOrder.createdAt ? new Date(a.workOrder.createdAt).getTime() : 0;
        const dateB = b.workOrder.createdAt ? new Date(b.workOrder.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      res.json({
        results,
        total: results.length,
        projectsSearched: projectsToSearch.length,
      });
    } catch (error) {
      console.error("Error searching work orders:", error);
      res.status(500).json({ message: "Failed to search work orders" });
    }
  });

  // Documentation (Admin only)
  app.get("/api/documentation/:docType", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { docType } = req.params;
      let filePath: string;
      const coreRoot=process.env.NODE_ENV==="production" ? path.resolve(__dirname,"..") : process.cwd();
      
      switch (docType) {
        case "inventory":
          filePath = path.join(coreRoot, "INVENTORY.md");
          break;
        case "core-updates":
          filePath = path.join(coreRoot, "CUSTOMER_CORE_UPDATES.md");
          break;
        case "audit":
          filePath = path.join(coreRoot, "AUDIT_LOGS.md");
          break;
        case "system-overview":
          filePath = path.join(coreRoot, "replit.md");
          break;
        case "system-admin":
          filePath = path.join(coreRoot, "SYSTEM_ADMIN_GUIDE.md");
          break;
        case "windows-deployment":
          filePath = path.join(coreRoot, "deploy", "WINDOWS_DEPLOYMENT.md");
          break;
        case "mobile-api":
          filePath = path.join(coreRoot, "MOBILE_API.md");
          break;
        case "mobile-sync":
          filePath = path.join(coreRoot, "mobile-app-sync-instructions.md");
          break;
        case "customer-api":
          filePath = path.join(coreRoot, "CUSTOMER_API_INTEGRATION.md");
          break;
        default:
          return res.status(404).json({ message: "Documentation not found" });
      }
      
      if (!existsSync(filePath)) {
        return res.status(404).json({ message: "Documentation file not found" });
      }
      
      const content = await fs.readFile(filePath, "utf-8");
      res.json(content);
    } catch (error) {
      console.error("Error fetching documentation:", error);
      res.status(500).json({ message: "Failed to fetch documentation" });
    }
  });

  // System settings (Admin only)
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const settings = await storage.getAllSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.get("/api/settings/project-files-path", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const path = await getProjectFilesPath();
      res.json({ path });
    } catch (error) {
      console.error("Error fetching project files path:", error);
      res.status(500).json({ message: "Failed to fetch project files path" });
    }
  });

  app.put("/api/settings/project-files-path", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { path } = req.body;
      if (!path || typeof path !== "string") {
        return res.status(400).json({ message: "Invalid path" });
      }
      
      await setProjectFilesPath(path);
      res.json({ message: "Project files path updated", path });
    } catch (error) {
      console.error("Error updating project files path:", error);
      res.status(500).json({ message: "Failed to update project files path" });
    }
  });

  // File settings endpoints
  app.get("/api/settings/file-settings", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const allowedExtensionsValue = await storage.getSetting("allowed_extensions");
      
      res.json({
        maxFileSizeMB: maxFileSizeValue ? parseInt(maxFileSizeValue) : 100,
        allowedExtensions: allowedExtensionsValue || "",
      });
    } catch (error) {
      console.error("Error fetching file settings:", error);
      res.status(500).json({ message: "Failed to fetch file settings" });
    }
  });

  app.put("/api/settings/file-settings", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { maxFileSizeMB, allowedExtensions } = req.body;
      
      if (typeof maxFileSizeMB !== "number" || maxFileSizeMB < 1 || maxFileSizeMB > 1024) {
        return res.status(400).json({ message: "Invalid max file size. Must be between 1 and 1024 MB." });
      }
      
      await storage.setSetting("max_file_size_mb", String(maxFileSizeMB), "Maximum file upload size in MB");
      await storage.setSetting("allowed_extensions", allowedExtensions || "", "Comma-separated list of allowed file extensions");
      
      res.json({ message: "File settings updated" });
    } catch (error) {
      console.error("Error updating file settings:", error);
      res.status(500).json({ message: "Failed to update file settings" });
    }
  });

  // Timezone settings (Admin only)
  const validTimezones = [
    "America/New_York",      // Eastern
    "America/Chicago",       // Central
    "America/Denver",        // Mountain
    "America/Phoenix",       // Arizona (no DST)
    "America/Los_Angeles",   // Pacific
    "America/Anchorage",     // Alaska
    "America/Honolulu",      // Hawaii
    "UTC"
  ];

  app.get("/api/settings/timezone", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const timezone = await storage.getSetting("default_timezone");
      const timezoneEnabled = await storage.getSetting("timezone_enabled");
      res.json({ 
        timezone: timezone || "America/Denver",
        isEnabled: timezoneEnabled !== "false"
      });
    } catch (error) {
      console.error("Error fetching timezone:", error);
      res.status(500).json({ message: "Failed to fetch timezone setting" });
    }
  });

  app.put("/api/settings/timezone", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { timezone, isEnabled } = req.body;
      
      if (!timezone || !validTimezones.includes(timezone)) {
        return res.status(400).json({ message: "Invalid timezone. Must be a valid IANA timezone." });
      }
      
      await storage.setSetting("default_timezone", timezone, "Default timezone for timestamps");
      
      if (typeof isEnabled === "boolean") {
        await storage.setSetting("timezone_enabled", String(isEnabled), "Whether timezone conversion is enabled");
      }
      
      const timezoneEnabled = await storage.getSetting("timezone_enabled");
      res.json({ 
        message: "Timezone updated", 
        timezone,
        isEnabled: timezoneEnabled !== "false"
      });
    } catch (error) {
      console.error("Error updating timezone:", error);
      res.status(500).json({ message: "Failed to update timezone" });
    }
  });

  // Mobile App Configuration endpoints
  app.get("/api/settings/mobile-config", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasMobileConfigPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_MOBILE_CONFIG);
      if (!hasMobileConfigPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view mobile configuration" });
      }
      
      const mobileUpdateUrl = await storage.getSetting("mobileUpdateUrl");
      const iosUpdateSource = await storage.getSetting("iosUpdateSource");
      const iosAppStoreId = await storage.getSetting("iosAppStoreId");
      res.json({ 
        mobileUpdateUrl: mobileUpdateUrl || null,
        iosUpdateSource: iosUpdateSource || null,
        iosAppStoreId: iosAppStoreId || null
      });
    } catch (error) {
      console.error("Error fetching mobile config:", error);
      res.status(500).json({ message: "Failed to fetch mobile configuration" });
    }
  });

  app.put("/api/settings/mobile-config", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasMobileConfigPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_MOBILE_CONFIG);
      if (!hasMobileConfigPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to update mobile configuration" });
      }
      
      const { mobileUpdateUrl, iosUpdateSource, iosAppStoreId } = req.body;
      
      // Validate GitHub API URL format if provided
      if (mobileUpdateUrl && mobileUpdateUrl.trim() !== "") {
        const pattern = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/releases\/(latest|\d+)$/;
        if (!pattern.test(mobileUpdateUrl.trim())) {
          return res.status(400).json({ 
            message: "Invalid GitHub releases API URL format. Must be: https://api.github.com/repos/ORG/REPO/releases/latest" 
          });
        }
        await storage.setSetting("mobileUpdateUrl", mobileUpdateUrl.trim(), "GitHub releases API URL for mobile app updates");
      } else {
        // Empty URL - disable update checks
        await storage.setSetting("mobileUpdateUrl", "", "GitHub releases API URL for mobile app updates");
      }
      
      // Save iOS update settings
      if (iosUpdateSource) {
        if (!["appstore", "eas"].includes(iosUpdateSource)) {
          return res.status(400).json({ message: "Invalid iOS update source. Must be 'appstore' or 'eas'" });
        }
        // Require App Store ID when source is appstore
        if (iosUpdateSource === "appstore") {
          if (!iosAppStoreId || iosAppStoreId.trim() === "") {
            return res.status(400).json({ message: "App Store ID is required when using App Store as update source." });
          }
          if (!/^\d+$/.test(iosAppStoreId.trim())) {
            return res.status(400).json({ message: "Invalid App Store ID. Must be a numeric value." });
          }
        }
        await storage.setSetting("iosUpdateSource", iosUpdateSource, "iOS update source (appstore or eas)");
      } else {
        await storage.setSetting("iosUpdateSource", "", "iOS update source (appstore or eas)");
      }
      
      // Save App Store ID if provided
      if (iosAppStoreId && iosAppStoreId.trim() !== "") {
        // Validate App Store ID format (numeric string)
        if (!/^\d+$/.test(iosAppStoreId.trim())) {
          return res.status(400).json({ message: "Invalid App Store ID. Must be a numeric value." });
        }
        await storage.setSetting("iosAppStoreId", iosAppStoreId.trim(), "iOS App Store ID for update checks");
      } else {
        await storage.setSetting("iosAppStoreId", "", "iOS App Store ID for update checks");
      }
      
      res.json({ message: "Mobile configuration updated" });
    } catch (error) {
      console.error("Error updating mobile config:", error);
      res.status(500).json({ message: "Failed to update mobile configuration" });
    }
  });

  // Web Application Update endpoints
  app.get("/api/system/version", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // A staged production script can run with the original protected instance cwd.
      const version = runtimeCustomerRelease().version;
      
      res.json({ version });
    } catch (error) {
      console.error("Error fetching version:", error);
      res.status(500).json({ message: "Failed to fetch version" });
    }
  });

  app.get("/api/settings/web-update-config", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasWebUpdatePermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_WEB_UPDATE);
      if (!hasWebUpdatePermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view web update configuration" });
      }
      
      const webUpdateUrl = await storage.getSetting("webUpdateUrl");
      const webUpdateLastCheck = await storage.getSetting("webUpdateLastCheck");
      const webUpdateCachedRelease = await storage.getSetting("webUpdateCachedRelease");
      
      res.json({ 
        webUpdateUrl: webUpdateUrl || null,
        lastCheck: webUpdateLastCheck || null,
        cachedRelease: webUpdateCachedRelease ? JSON.parse(webUpdateCachedRelease) : null
      });
    } catch (error) {
      console.error("Error fetching web update config:", error);
      res.status(500).json({ message: "Failed to fetch web update configuration" });
    }
  });

  app.put("/api/settings/web-update-config", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasWebUpdatePermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_WEB_UPDATE);
      if (!hasWebUpdatePermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to update web update configuration" });
      }
      
      const { webUpdateUrl } = req.body;
      
      // Validate GitHub API URL format if provided
      if (webUpdateUrl && webUpdateUrl.trim() !== "") {
        const pattern = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/releases\/(latest|\d+)$/;
        if (!pattern.test(webUpdateUrl.trim())) {
          return res.status(400).json({ 
            message: "Invalid GitHub releases API URL format. Must be: https://api.github.com/repos/ORG/REPO/releases/latest" 
          });
        }
        await storage.setSetting("webUpdateUrl", webUpdateUrl.trim(), "GitHub releases API URL for web app updates");
      } else {
        await storage.setSetting("webUpdateUrl", "", "GitHub releases API URL for web app updates");
      }
      
      res.json({ message: "Web update configuration saved" });
    } catch (error) {
      console.error("Error updating web update config:", error);
      res.status(500).json({ message: "Failed to update web update configuration" });
    }
  });

  // Security Settings - Cloudflare Turnstile (Admin only)
  app.get("/api/settings/security", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasSecurityPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_SECURITY);
      if (!hasSecurityPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view security settings" });
      }
      
      const turnstileEnabled = await storage.getSetting("turnstile_enabled");
      const turnstileSiteKey = await storage.getSetting("turnstile_site_key");
      const turnstileSecretKey = await storage.getSetting("turnstile_secret_key");
      const turnstileChallengePoint = await storage.getSetting("turnstile_challenge_point");
      
      res.json({
        turnstileEnabled: turnstileEnabled === "true",
        turnstileSiteKey: turnstileSiteKey || "",
        turnstileSecretKey: turnstileSecretKey ? "***configured***" : "", // Don't expose secret
        turnstileChallengePoint: turnstileChallengePoint || "turnstile", // "turnstile" or "login"
      });
    } catch (error) {
      console.error("Error fetching security settings:", error);
      res.status(500).json({ message: "Failed to fetch security settings" });
    }
  });

  app.put("/api/settings/security", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasSecurityPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_SECURITY);
      if (!hasSecurityPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to update security settings" });
      }
      
      const { turnstileEnabled, turnstileSiteKey, turnstileSecretKey, turnstileChallengePoint } = req.body;
      
      // Validate challenge point
      if (turnstileChallengePoint && !["turnstile", "login"].includes(turnstileChallengePoint)) {
        return res.status(400).json({ message: "Invalid challenge point. Must be 'turnstile' or 'login'" });
      }
      
      // Validate keys are provided when enabling Turnstile
      if (turnstileEnabled) {
        if (!turnstileSiteKey || turnstileSiteKey.trim() === "") {
          return res.status(400).json({ message: "Site key is required when enabling Turnstile" });
        }
        
        // Check if secret key is provided or already configured
        const existingSecretKey = await storage.getSetting("turnstile_secret_key");
        const isNewSecretProvided = turnstileSecretKey && turnstileSecretKey !== "***configured***" && turnstileSecretKey.trim() !== "";
        
        if (!existingSecretKey && !isNewSecretProvided) {
          return res.status(400).json({ message: "Secret key is required when enabling Turnstile" });
        }
      }
      
      await storage.setSetting("turnstile_enabled", turnstileEnabled ? "true" : "false", "Enable Cloudflare Turnstile verification");
      await storage.setSetting("turnstile_site_key", turnstileSiteKey || "", "Cloudflare Turnstile site key");
      
      // Only update secret key if it's provided (not the masked value)
      if (turnstileSecretKey && turnstileSecretKey !== "***configured***" && turnstileSecretKey.trim() !== "") {
        await storage.setSetting("turnstile_secret_key", turnstileSecretKey, "Cloudflare Turnstile secret key");
      }
      
      await storage.setSetting("turnstile_challenge_point", turnstileChallengePoint || "turnstile", "Where to show the Turnstile challenge");
      
      res.json({ message: "Security settings saved" });
    } catch (error) {
      console.error("Error updating security settings:", error);
      res.status(500).json({ message: "Failed to update security settings" });
    }
  });

  // Contact form submission endpoint (for unauthenticated users on landing page)
  app.post("/api/contact", async (req: any, res) => {
    try {
      const contactFormSchema = z.object({
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Valid email is required"),
        subject: z.string().min(1, "Subject is required"),
        message: z.string().min(10, "Message must be at least 10 characters"),
      });
      
      const validationResult = contactFormSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validationResult.error.errors 
        });
      }
      
      const { name, email, subject, message } = validationResult.data;
      
      const contactFormEmail = await storage.getSetting("contact_form_email");
      const smtpHost = await storage.getSetting("smtp_host");
      const smtpPort = await storage.getSetting("smtp_port");
      const smtpUser = await storage.getSetting("smtp_user");
      const smtpPass = process.env.SMTP_PASSWORD;
      const smtpFrom = await storage.getSetting("smtp_from_email");
      const smtpSecure = await storage.getSetting("smtp_secure");
      const smtpRejectUnauthorized = await storage.getSetting("smtp_reject_unauthorized");
      
      let emailSent = false;
      let emailError: string | null = null;
      
      // Attempt to send email if SMTP is configured and contact email is set
      if (contactFormEmail && smtpHost && smtpPort && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort, 10),
            secure: smtpSecure === "true",
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
            tls: {
              rejectUnauthorized: smtpRejectUnauthorized !== "false",
            },
          });
          
          await transporter.sendMail({
            from: smtpFrom || smtpUser,
            to: contactFormEmail,
            replyTo: email,
            subject: `[Contact Form] ${subject}`,
            text: `Contact Form Submission from MeterFlo\n\n` +
              `From: ${name}\n` +
              `Email: ${email}\n` +
              `Subject: ${subject}\n\n` +
              `Message:\n${message}\n\n` +
              `---\nSubmitted at: ${new Date().toLocaleString()}`,
            html: `
              <h2>Contact Form Submission from MeterFlo</h2>
              <table style="border-collapse: collapse; margin-bottom: 16px;">
                <tr><td style="padding: 4px 8px; font-weight: bold;">From:</td><td style="padding: 4px 8px;">${name}</td></tr>
                <tr><td style="padding: 4px 8px; font-weight: bold;">Email:</td><td style="padding: 4px 8px;"><a href="mailto:${email}">${email}</a></td></tr>
                <tr><td style="padding: 4px 8px; font-weight: bold;">Subject:</td><td style="padding: 4px 8px;">${subject}</td></tr>
              </table>
              <h3>Message:</h3>
              <p style="white-space: pre-wrap;">${message}</p>
              <hr>
              <p style="color: #666; font-size: 12px;">Submitted at: ${new Date().toLocaleString()}</p>
            `,
          });
          
          emailSent = true;
          console.log(`[Contact Form] Email sent to ${contactFormEmail}`);
        } catch (error: any) {
          emailError = error.message || "Failed to send email";
          console.error("[Contact Form] Email sending failed:", error);
        }
      } else {
        emailError = "SMTP not configured or contact email not set";
        console.warn("[Contact Form] SMTP not configured or contact email not set");
      }
      
      res.json({ 
        success: true, 
        emailSent,
        message: emailSent 
          ? "Message sent successfully" 
          : "Message received but email notification could not be sent",
        emailError: emailError || undefined
      });
    } catch (error) {
      console.error("Error processing contact form:", error);
      res.status(500).json({ message: "Failed to process contact form" });
    }
  });

  // Support form submission endpoint
  app.post("/api/support", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Validate with Zod schema
      const validationResult = insertSupportSubmissionSchema.safeParse({
        ...req.body,
        userId: currentUser.id,
      });
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid form data", 
          errors: validationResult.error.flatten().fieldErrors 
        });
      }
      
      const { name, email, subject, priority, message } = validationResult.data;
      
      // Get configured support email and SMTP settings
      const supportFormEmail = await storage.getSetting("support_form_email");
      const smtpHost = await storage.getSetting("smtp_host");
      const smtpPort = await storage.getSetting("smtp_port");
      const smtpUser = await storage.getSetting("smtp_user");
      const smtpPass = process.env.SMTP_PASSWORD;
      const smtpFrom = await storage.getSetting("smtp_from_email");
      const smtpSecure = await storage.getSetting("smtp_secure");
      const smtpRejectUnauthorized = await storage.getSetting("smtp_reject_unauthorized");
      
      let emailSent = false;
      let emailError: string | null = null;
      
      // Attempt to send email if SMTP is configured and support email is set
      if (supportFormEmail && smtpHost && smtpPort && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort, 10),
            secure: smtpSecure === "true",
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
            tls: {
              rejectUnauthorized: smtpRejectUnauthorized !== "false",
            },
          });
          
          const priorityLabels: Record<string, string> = {
            low: "Low",
            medium: "Medium",
            high: "High"
          };
          
          await transporter.sendMail({
            from: smtpFrom || smtpUser,
            to: supportFormEmail,
            replyTo: email,
            subject: `[Support Request - ${priorityLabels[priority] || "Medium"}] ${subject}`,
            text: (() => {
              const displayName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ");
              const userDisplay = displayName ? `${currentUser.username || "(unknown)"} - ${displayName}` : (currentUser.username || "(unknown)");
              return `Support Request from MeterFlo\n\n` +
                `From: ${name}\n` +
                `Email: ${email}\n` +
                `Priority: ${priorityLabels[priority] || "Medium"}\n` +
                `Subject: ${subject}\n\n` +
                `Message:\n${message}\n\n` +
                `---\nSubmitted at: ${new Date().toLocaleString()}\n` +
                `User: ${userDisplay}`;
            })(),
            html: (() => {
              const displayName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ");
              const userDisplay = displayName ? `${currentUser.username || "(unknown)"} - ${displayName}` : (currentUser.username || "(unknown)");
              return `
              <h2>Support Request from MeterFlo</h2>
              <table style="border-collapse: collapse; margin-bottom: 16px;">
                <tr><td style="padding: 4px 8px; font-weight: bold;">From:</td><td style="padding: 4px 8px;">${name}</td></tr>
                <tr><td style="padding: 4px 8px; font-weight: bold;">Email:</td><td style="padding: 4px 8px;"><a href="mailto:${email}">${email}</a></td></tr>
                <tr><td style="padding: 4px 8px; font-weight: bold;">Priority:</td><td style="padding: 4px 8px;">${priorityLabels[priority] || "Medium"}</td></tr>
                <tr><td style="padding: 4px 8px; font-weight: bold;">Subject:</td><td style="padding: 4px 8px;">${subject}</td></tr>
              </table>
              <h3>Message:</h3>
              <p style="white-space: pre-wrap;">${message}</p>
              <hr>
              <p style="color: #666; font-size: 12px;">Submitted at: ${new Date().toLocaleString()}<br>User: ${userDisplay}</p>
            `;
            })(),
          });
          
          emailSent = true;
          console.log(`[Support Request] Email sent to ${supportFormEmail}`);
        } catch (err: any) {
          emailError = err.message || "Unknown email error";
          console.error("[Support Request] Failed to send email:", err);
        }
      } else if (supportFormEmail && (!smtpHost || !smtpPort || !smtpUser || !smtpPass)) {
        emailError = "SMTP not configured";
        console.warn("[Support Request] Support email configured but SMTP settings incomplete");
      } else if (!supportFormEmail) {
        emailError = "No support email configured";
        console.warn("[Support Request] No support email configured in settings");
      }
      
      // Always persist the submission to database
      await storage.createSupportSubmission({
        userId: currentUser.id,
        name,
        email,
        subject,
        priority,
        message,
        emailSent,
        emailError,
      });
      
      console.log(`[Support Request] Saved submission from: ${name} <${email}>, Subject: ${subject}, Priority: ${priority}`);
      
      res.json({ 
        message: "Support request submitted successfully",
        emailSent,
        supportEmailConfigured: !!supportFormEmail,
      });
    } catch (error) {
      console.error("Error submitting support request:", error);
      res.status(500).json({ message: "Failed to submit support request" });
    }
  });

  // Contact & Support Forms Settings endpoints
  app.get("/api/settings/contact-support", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasContactSupportPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_CONTACT_SUPPORT);
      if (!hasContactSupportPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view contact & support settings" });
      }
      
      const contactFormEmail = await storage.getSetting("contact_form_email");
      const supportFormEmail = await storage.getSetting("support_form_email");
      const smtpHost = await storage.getSetting("smtp_host");
      const smtpPort = await storage.getSetting("smtp_port");
      const smtpUser = await storage.getSetting("smtp_user");
      const smtpFromEmail = await storage.getSetting("smtp_from_email");
      const smtpSecure = await storage.getSetting("smtp_secure");
      const smtpRejectUnauthorized = await storage.getSetting("smtp_reject_unauthorized");
      
      res.json({
        contactFormEmail: contactFormEmail || "",
        supportFormEmail: supportFormEmail || "",
        smtpHost: smtpHost || "",
        smtpPort: smtpPort || "",
        smtpUser: smtpUser || "",
        smtpFromEmail: smtpFromEmail || "",
        smtpSecure: smtpSecure === "true",
        smtpRejectUnauthorized: smtpRejectUnauthorized !== "false",
      });
    } catch (error) {
      console.error("Error fetching contact & support settings:", error);
      res.status(500).json({ message: "Failed to fetch contact & support settings" });
    }
  });

  app.put("/api/settings/contact-support", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasContactSupportPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_CONTACT_SUPPORT);
      if (!hasContactSupportPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to update contact & support settings" });
      }
      
      const { contactFormEmail, supportFormEmail, smtpHost, smtpPort, smtpUser, smtpFromEmail, smtpSecure, smtpRejectUnauthorized } = req.body;
      
      await storage.setSetting("contact_form_email", contactFormEmail || "", "Email address for Contact Us form submissions");
      await storage.setSetting("support_form_email", supportFormEmail || "", "Email address for Support form submissions");
      await storage.setSetting("smtp_host", smtpHost || "", "SMTP server host");
      await storage.setSetting("smtp_port", smtpPort || "", "SMTP server port");
      await storage.setSetting("smtp_user", smtpUser || "", "SMTP username");
      await storage.setSetting("smtp_from_email", smtpFromEmail || "", "Email address to send from");
      await storage.setSetting("smtp_secure", smtpSecure ? "true" : "false", "Use SSL/TLS for SMTP connection");
      await storage.setSetting("smtp_reject_unauthorized", smtpRejectUnauthorized ? "true" : "false", "Reject invalid TLS certificates");
      
      res.json({ message: "Contact & support settings saved" });
    } catch (error) {
      console.error("Error updating contact & support settings:", error);
      res.status(500).json({ message: "Failed to update contact & support settings" });
    }
  });

  // Public endpoint to get Turnstile config (for the challenge page)
  app.get("/api/security/turnstile-config", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      // Emergency bypass via environment variable
      if (process.env.TURNSTILE_EMERGENCY_BYPASS === "true") {
        return res.json({ enabled: false, siteKey: "", challengePoint: "turnstile", bypassed: true });
      }
      
      const turnstileEnabled = await storage.getSetting("turnstile_enabled");
      const turnstileSiteKey = await storage.getSetting("turnstile_site_key");
      
      res.json({
        enabled: turnstileEnabled === "true",
        siteKey: turnstileSiteKey || "",
        // Legacy saved "login" values also use the separate pre-login page.
        challengePoint: "turnstile",
      });
    } catch (error) {
      console.error("Error fetching turnstile config:", error);
      res.status(500).json({ message: "Failed to fetch turnstile configuration" });
    }
  });

  // Verify Turnstile token (called from the challenge page)
  app.post("/api/security/turnstile/verify", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ success: false, message: "Missing Turnstile token" });
      }
      
      const turnstileEnabled = await storage.getSetting("turnstile_enabled");
      if (turnstileEnabled !== "true") {
        // Turnstile not enabled, just pass through
        return res.json({ success: true, message: "Turnstile not enabled" });
      }
      
      const secretKey = await storage.getSetting("turnstile_secret_key");
      if (!secretKey) {
        return res.status(500).json({ success: false, message: "Turnstile not configured" });
      }
      
      // Verify with Cloudflare
      const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: secretKey,
          response: token,
          remoteip: req.ip || "",
        }),
      });
      
      const result = await verifyResponse.json() as { success: boolean; "error-codes"?: string[] };
      
      if (result.success) {
        // Store verification timestamp in a separate signed cookie
        // This bypasses session store issues with reverse proxies
        const verifiedAt = new Date().toISOString();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        // Create HMAC signature (does not expose SESSION_SECRET)
        const signature = createHmac('sha256', process.env.SESSION_SECRET || '')
          .update(verifiedAt)
          .digest('hex');
        
        // Set a separate Turnstile verification cookie
        res.cookie('turnstile_verified', `${verifiedAt}|${signature}`, {
          httpOnly: true,
          secure: process.env.COOKIE_SECURE === 'true',
          sameSite: 'lax',
          maxAge: twentyFourHours,
          path: '/',
        });
        
        // Also store in session as backup
        if (req.session) {
          (req.session as any).turnstileVerified = true;
          (req.session as any).turnstileVerifiedAt = verifiedAt;
          req.session.save(() => {}); // Fire and forget
        }
        
        return res.json({ success: true, message: "Verification successful" });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: "Verification failed",
          errors: result["error-codes"] || []
        });
      }
    } catch (error) {
      console.error("Error verifying Turnstile token:", error);
      res.status(500).json({ success: false, message: "Verification failed" });
    }
  });

  // Check if current session has passed Turnstile
  app.get("/api/security/turnstile/status", async (req, res) => {
    // Prevent browser caching - this endpoint must always return fresh session state
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    
    try {
      // Emergency bypass via environment variable - allows admin access when locked out
      if (process.env.TURNSTILE_EMERGENCY_BYPASS === "true") {
        return res.json({ required: false, verified: true, bypassed: true });
      }
      
      const turnstileEnabled = await storage.getSetting("turnstile_enabled");
      
      if (turnstileEnabled !== "true") {
        return res.json({ required: false, verified: true });
      }
      
      // Check cookie first (more reliable across session store issues with reverse proxies)
      const turnstileCookie = req.cookies?.turnstile_verified;
      let isValid = false;
      
      if (turnstileCookie) {
        try {
          const [cookieTimestamp, cookieSignature] = turnstileCookie.split('|');
          
          // Verify HMAC signature
          const expectedSignature = createHmac('sha256', process.env.SESSION_SECRET || '')
            .update(cookieTimestamp)
            .digest('hex');
          
          if (cookieSignature === expectedSignature) {
            // Signature valid, check expiry
            const verifiedTime = new Date(cookieTimestamp).getTime();
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            isValid = (now - verifiedTime) < twentyFourHours;
          }
        } catch (e) {
          // Cookie parse error, fall through to session check
        }
      }
      
      // Fall back to session check if cookie not valid
      if (!isValid) {
        const verified = (req.session as any)?.turnstileVerified === true;
        const verifiedAt = (req.session as any)?.turnstileVerifiedAt;
        
        if (verified && verifiedAt) {
          const verifiedTime = new Date(verifiedAt).getTime();
          const now = Date.now();
          const twentyFourHours = 24 * 60 * 60 * 1000;
          isValid = (now - verifiedTime) < twentyFourHours;
        }
      }
      
      res.json({ required: true, verified: isValid });
    } catch (error) {
      console.error("Error checking turnstile status:", error);
      res.status(500).json({ required: true, verified: false });
    }
  });

  // Check for updates from GitHub (version + git commits)
  app.post("/api/system/update-check", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasWebUpdatePermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_WEB_UPDATE);
      if (!hasWebUpdatePermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to check for updates" });
      }
      
      const preview=await coreUpdatePreview(runtimeCustomerRelease(),gitReader(process.cwd()));
      const result = {
        isGitRepo:preview.isGitRepo,commitsBehind:preview.commitsBehind,remoteBranch:preview.remoteBranch,
        hasGitUpdates:false,updateAvailable:preview.updateAvailable,currentVersion:preview.installed.version,
        latestVersion:preview.candidateVersion,releaseName:preview.candidateVersion ? `MeterFlo core ${preview.candidateVersion}` : "Unverified core source",
        blockers:preview.blockers,coreSource:preview.installed.coreSource,message:preview.message,
      };
      
      // Cache the result
      await storage.setSetting("webUpdateLastCheck", new Date().toISOString(), "Last web update check timestamp");
      await storage.setSetting("webUpdateCachedRelease", JSON.stringify(result), "Cached release info");
      
      res.json(result);
    } catch (error) {
      console.error("Error checking for updates:", error);
      res.status(500).json({ message: "Failed to check for updates" });
    }
  });

  // Preview changes (git fetch + diff)
  app.post("/api/system/update-preview", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasWebUpdatePermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_WEB_UPDATE);
      if (!hasWebUpdatePermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to preview updates" });
      }
      res.json(await coreUpdatePreview(runtimeCustomerRelease(),gitReader(process.cwd())));
      
    } catch (error: any) {
      res.status(500).json({ message: "Update preview could not complete; verify release configuration and source access in the workspace" });
    }
  });

  // Helper function to compare semantic versions
  function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  }

  const customerApiRow = (row: any) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase()), value]));

  app.get("/api/customer-api-deliveries", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || !await storage.hasPermission(user, permissionKeys.SETTINGS_CUSTOMER_API_LOGS)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const admin = user.role === "admin" || await storage.isAdminUser(user);
      const ids = admin ? null : (await storage.getUserProjects(user.id)).map(p => p.id);
      const projectId = req.query.projectId ? Number(req.query.projectId) : null;
      const status = req.query.status ? String(req.query.status) : null;
      if ((projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1)) ||
          (status && !["pending","processing","retrying","delivered","failed","paused"].includes(status))) {
        return res.status(400).json({ message: "Invalid delivery filter" });
      }
      if (ids && projectId && !ids.includes(projectId)) return res.status(403).json({ message: "Forbidden" });
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) return res.status(400).json({ message: "Invalid pagination" });
      const where = `($1::int IS NULL OR d.project_id=$1) AND ($2::text IS NULL OR d.status=$2)
        AND ($3::int[] IS NULL OR d.project_id=ANY($3))`;
      const { rows } = await pool.query(
        `SELECT d.id,d.project_id,d.work_order_id,d.customer_wo_id,d.status,d.attempt_count,d.cycle_attempts,
          d.next_attempt_at,d.last_error,d.last_response_status,d.delivered_at,d.created_at,d.updated_at,
          p.name AS project_name
         FROM public.customer_api_deliveries d JOIN public.projects p ON p.id=d.project_id
         WHERE ${where} ORDER BY d.created_at DESC LIMIT $4 OFFSET $5`, [projectId,status,ids,limit,offset]);
      const { rows: [count] } = await pool.query(
        `SELECT count(*) FROM public.customer_api_deliveries d WHERE ${where}`, [projectId,status,ids]);
      res.json({ deliveries: rows.map(customerApiRow), total: Number(count.count), limit, offset });
    } catch (error) {
      console.error("[CustomerAPI] Listing deliveries failed:", error);
      res.status(500).json({ message: "Failed to load customer API deliveries" });
    }
  });

  app.get("/api/customer-api-deliveries/:deliveryId/attempts", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || !await storage.hasPermission(user, permissionKeys.SETTINGS_CUSTOMER_API_LOGS)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { rows: [delivery] } = await pool.query(`SELECT project_id FROM public.customer_api_deliveries WHERE id=$1`, [req.params.deliveryId]);
      if (!delivery) return res.status(404).json({ message: "Delivery not found" });
      if (user.role !== "admin" && !await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, delivery.project_id)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { rows } = await pool.query(`SELECT * FROM public.customer_api_logs WHERE delivery_id=$1 ORDER BY attempt_number DESC`, [req.params.deliveryId]);
      res.json(rows.map(customerApiRow));
    } catch (error) {
      console.error("[CustomerAPI] Loading attempts failed:", error);
      res.status(500).json({ message: "Failed to load delivery attempts" });
    }
  });

  app.post("/api/customer-api-deliveries/:deliveryId/retry", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || (user.role !== "admin" && !await storage.isAdminUser(user))) return res.status(403).json({ message: "Admin access required" });
      const { rows: [delivery] } = await pool.query(`SELECT id FROM public.customer_api_deliveries WHERE id=$1`, [req.params.deliveryId]);
      if (!delivery) return res.status(404).json({ message: "Delivery not found" });
      const queued = await retryCustomerDelivery(delivery.id, user.id);
      if (!queued) return res.status(409).json({ message: "Enable the project's Customer API and retry a failed, scheduled, or paused delivery. Queued, running, and delivered requests cannot be retried." });
      res.status(202).json({ message: "Delivery queued for retry", deliveryId: queued.id, status: queued.status });
    } catch (error) {
      console.error("[CustomerAPI] Manual retry failed:", error);
      res.status(500).json({ message: "Failed to queue delivery retry" });
    }
  });

  app.post("/api/customer-api-logs/:logId/retry", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || (user.role !== "admin" && !await storage.isAdminUser(user))) return res.status(403).json({ message: "Admin access required" });
      const id = Number(req.params.logId);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid log ID" });
      const deliveryId = await retryLegacyCustomerLog(id, user.id);
      res.status(202).json({ deliveryId, status: "pending", message: "Historical delivery queued for retry" });
    } catch (error: any) {
      const expected = ["Log entry not found", "Only failed legacy log entries can be replayed",
        "Enable this project's Customer API before retrying", "This log has no saved payload to replay",
        "Saved payload is not a JSON object"];
      if (error instanceof SyntaxError) return res.status(409).json({ message: "Saved payload is not valid JSON" });
      if (expected.includes(error.message)) return res.status(409).json({ message: error.message });
      console.error("[CustomerAPI] Historical retry failed:", error);
      res.status(500).json({ message: "Failed to queue historical delivery" });
    }
  });

  // Customer API Logs endpoint
  app.get("/api/customer-api-logs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const hasLogsPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_CUSTOMER_API_LOGS);
      if (!hasLogsPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view customer API logs" });
      }
      
      const isAdmin = currentUser.role === "admin" || await storage.isAdminUser(currentUser);
      const userProjects = isAdmin ? null : await storage.getUserProjects(currentUser.id);
      const userProjectIds = userProjects ? userProjects.map(p => p.id) : null;
      
      let projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      
      // Non-admin users can only see logs from their assigned projects
      if (!isAdmin && projectId) {
        if (!userProjectIds?.includes(projectId)) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this project's logs" });
        }
      }
      
      const success = req.query.success === "true" ? true : req.query.success === "false" ? false : undefined;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
      
      let logs = await storage.getCustomerApiLogs({ projectId, projectIds: userProjectIds ?? undefined, success, limit });
      
      // Filter to user's projects if non-admin and no specific project requested
      if (!isAdmin && !projectId && userProjectIds) {
        logs = logs.filter(log => log.projectId && userProjectIds.includes(log.projectId));
      }
      
      // Enrich with project names
      const enrichedLogs = await Promise.all(logs.map(async (log) => {
        let projectName = null;
        if (log.projectId) {
          const project = await storage.getProject(log.projectId);
          projectName = project?.name || null;
        }
        return { ...log, projectName };
      }));
      
      res.json(enrichedLogs);
    } catch (error) {
      console.error("Error fetching customer API logs:", error);
      res.status(500).json({ message: "Failed to fetch customer API logs" });
    }
  });

  // File Import History endpoints
  app.get("/api/file-import-history", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check for file import history permission
      const hasPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_IMPORT_HISTORY);
      if (!hasPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view file import history" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const userProjects = isAdmin ? null : await storage.getUserProjects(currentUser.id);
      const userProjectIds = userProjects ? userProjects.map(p => p.id) : null;
      
      const limit = parseInt(req.query.limit as string) || 500;
      let history = await storage.getAllFileImportHistory(limit);
      
      // Filter to user's projects if non-admin
      if (!isAdmin && userProjectIds) {
        history = history.filter(entry => entry.projectId && userProjectIds.includes(entry.projectId));
      }
      
      // Enrich with project names and timezones
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let projectName = null;
        let projectTimezone = null;
        if (entry.projectId) {
          const project = await storage.getProject(entry.projectId);
          projectName = project?.name || null;
          projectTimezone = project?.timezone || null;
        }
        return { ...entry, projectName, projectTimezone };
      }));
      
      res.json(enrichedHistory);
    } catch (error) {
      console.error("Error fetching file import history:", error);
      res.status(500).json({ message: "Failed to fetch file import history" });
    }
  });

  app.get("/api/file-import-history/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check for file import history permission
      const hasPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_IMPORT_HISTORY);
      if (!hasPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view file import history" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const userProjects = isAdmin ? null : await storage.getUserProjects(currentUser.id);
      const userProjectIds = userProjects ? userProjects.map(p => p.id) : null;
      
      let history = await storage.getAllFileImportHistory(10000);
      
      // Filter to user's projects if non-admin
      if (!isAdmin && userProjectIds) {
        history = history.filter(entry => entry.projectId && userProjectIds.includes(entry.projectId));
      }
      
      // Enrich with project names
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let projectName = "";
        if (entry.projectId) {
          const project = await storage.getProject(entry.projectId);
          projectName = project?.name || "";
        }
        return { ...entry, projectName };
      }));
      
      // Create CSV content
      const csvHeaders = ["ID", "Date", "Source", "File Name", "Project", "User", "Status", "Records Imported", "Records Failed", "Error Details"];
      const csvRows = enrichedHistory.map(entry => [
        entry.id,
        entry.startedAt ? new Date(entry.startedAt).toISOString() : "",
        entry.importSource || "scheduled",
        entry.fileName || "",
        entry.projectName || "",
        entry.userName || "",
        entry.status || "",
        entry.recordsImported || 0,
        entry.recordsFailed || 0,
        (entry.errorDetails || "").replace(/"/g, '""').replace(/\n/g, " ")
      ]);
      
      const csvContent = [
        csvHeaders.join(","),
        ...csvRows.map(row => row.map(cell => `"${cell}"`).join(","))
      ].join("\n");
      
      const filename = `file_import_history_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Error downloading file import history:", error);
      res.status(500).json({ message: "Failed to download file import history" });
    }
  });

  // External Database Import History endpoints
  app.get("/api/import-history", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check for external database import history permission
      const hasPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_DB_IMPORT_HISTORY);
      if (!hasPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view external database import history" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const userProjects = isAdmin ? null : await storage.getUserProjects(currentUser.id);
      const userProjectIds = userProjects ? userProjects.map(p => p.id) : null;
      
      const limit = parseInt(req.query.limit as string) || 500;
      const history = await storage.getAllImportHistory(limit);
      
      // Enrich with config name, database name, and project name, and track projectId for filtering
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let configName = null;
        let databaseName = null;
        let projectName = null;
        let projectId = null;
        
        if (entry.importConfigId) {
          const importConfig = await storage.getImportConfig(entry.importConfigId);
          if (importConfig) {
            configName = importConfig.name;
            
            const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
            if (dbConfig) {
              databaseName = dbConfig.name;
              projectId = dbConfig.projectId;
              
              const project = await storage.getProject(dbConfig.projectId);
              projectName = project?.name || null;
            }
          }
        }
        
        return { ...entry, configName, databaseName, projectName, projectId };
      }));
      
      // Filter to user's projects if non-admin
      let filteredHistory = enrichedHistory;
      if (!isAdmin && userProjectIds) {
        filteredHistory = enrichedHistory.filter(entry => entry.projectId && userProjectIds.includes(entry.projectId));
      }
      
      res.json(filteredHistory);
    } catch (error) {
      console.error("Error fetching import history:", error);
      res.status(500).json({ message: "Failed to fetch import history" });
    }
  });

  app.get("/api/import-history/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check for external database import history permission
      const hasPermission = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_DB_IMPORT_HISTORY);
      if (!hasPermission) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view external database import history" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const userProjects = isAdmin ? null : await storage.getUserProjects(currentUser.id);
      const userProjectIds = userProjects ? userProjects.map(p => p.id) : null;
      
      const history = await storage.getAllImportHistory(10000);
      
      // Enrich with config name, database name, and project name, and track projectId for filtering
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let configName = "";
        let databaseName = "";
        let projectName = "";
        let projectId: number | null = null;
        
        if (entry.importConfigId) {
          const importConfig = await storage.getImportConfig(entry.importConfigId);
          if (importConfig) {
            configName = importConfig.name;
            
            const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
            if (dbConfig) {
              databaseName = dbConfig.name;
              projectId = dbConfig.projectId;
              
              const project = await storage.getProject(dbConfig.projectId);
              projectName = project?.name || "";
            }
          }
        }
        
        return { ...entry, configName, databaseName, projectName, projectId };
      }));
      
      // Filter to user's projects if non-admin
      let filteredHistory = enrichedHistory;
      if (!isAdmin && userProjectIds) {
        filteredHistory = enrichedHistory.filter(entry => entry.projectId && userProjectIds.includes(entry.projectId));
      }
      
      // Create CSV content
      const csvHeaders = ["ID", "Date", "Project", "Database", "Import Config", "Status", "Records Imported", "Records Failed", "Completed At", "Error Details"];
      const csvRows = filteredHistory.map(entry => [
        entry.id,
        entry.startedAt ? new Date(entry.startedAt).toISOString() : "",
        entry.projectName || "",
        entry.databaseName || "",
        entry.configName || "",
        entry.status || "",
        entry.recordsImported || 0,
        entry.recordsFailed || 0,
        entry.completedAt ? new Date(entry.completedAt).toISOString() : "",
        (entry.errorDetails || "").replace(/"/g, '""').replace(/\n/g, " ")
      ]);
      
      const csvContent = [
        csvHeaders.join(","),
        ...csvRows.map(row => row.map(cell => `"${cell}"`).join(","))
      ].join("\n");
      
      const filename = `external_db_import_history_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Error downloading import history:", error);
      res.status(500).json({ message: "Failed to download import history" });
    }
  });

  // Database backup/restore endpoints
  
  // Get database stats for a project
  app.get("/api/projects/:projectId/database/stats", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Need project backup permission to view stats
      const canBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_BACKUP);
      if (!canBackup) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view database stats" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or has no database" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const stats = await getProjectDatabaseStats(project.databaseName);
      res.json(stats);
    } catch (error) {
      console.error("Error getting database stats:", error);
      res.status(500).json({ message: "Failed to get database statistics" });
    }
  });

  // Create database backup for a project
  app.get("/api/projects/:projectId/database/backup", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_BACKUP);
      if (!canBackup) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to backup projects" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or has no database" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const backup = await backupProjectDatabase(project.databaseName);
      
      // Return as downloadable JSON file
      const filename = `backup_${project.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/json");
      res.json({
        ...backup,
        projectId: project.id,
        projectName: project.name,
      });
    } catch (error) {
      console.error("Error creating backup:", error);
      res.status(500).json({ message: "Failed to create database backup" });
    }
  });

  // Restore database from backup
  app.post("/api/projects/:projectId/database/restore", isAuthenticated, largeFileUpload.single("backup"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_RESTORE);
      if (!canRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to restore projects" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or has no database" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const clearExisting = req.body.clearExisting === "true";
      
      if (!req.file) {
        return res.status(400).json({ message: "No backup file provided" });
      }
      
      let backup;
      try {
        backup = JSON.parse(req.file.buffer.toString());
      } catch (e) {
        return res.status(400).json({ message: "Invalid backup file format" });
      }
      
      if (!backup.workOrders || !Array.isArray(backup.workOrders)) {
        return res.status(400).json({ message: "Invalid backup file: missing workOrders array" });
      }
      
      const result = await restoreProjectDatabase(project.databaseName, backup, { clearExisting });
      
      res.json({
        message: "Database restored successfully",
        restored: result.restored,
        errors: result.errors,
      });
    } catch (error) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ message: "Failed to restore database backup" });
    }
  });

  // Create project files backup (ZIP archive)
  app.get("/api/projects/:projectId/files/backup", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_BACKUP);
      if (!canBackup) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to backup projects" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const projectFilesPath = await getProjectFilesPath();
      const projectDirName = getProjectDirectoryName(project.name, project.id);
      const projectDir = path.join(projectFilesPath, projectDirName);
      
      // Check if project directory exists
      if (!existsSync(projectDir)) {
        return res.status(404).json({ message: "No project files found to backup" });
      }
      
      await auditedOperation("projectFilesBackup","files",async()=>{
      // Create ZIP archive
      const archive = archiver("zip", { zlib: { level: 9 } });
      
      const filename = `files_backup_${project.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.zip`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/zip");
      
      archive.on("error", (err: Error) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Failed to create files backup" });
        }
      });
      
      archive.pipe(res);
      archive.directory(projectDir, false);
      await archive.finalize();
      },project.id,project.name);
      
    } catch (error) {
      console.error("Error creating files backup:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to create files backup" });
      }
    }
  });

  // Get project files stats for backup info
  app.get("/api/projects/:projectId/files/stats", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_BACKUP);
      if (!canBackup) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view project files stats" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const projectFilesPath = await getProjectFilesPath();
      const projectDirName = getProjectDirectoryName(project.name, project.id);
      const projectDir = path.join(projectFilesPath, projectDirName);
      
      // Calculate directory size and file count
      let totalSize = 0;
      let fileCount = 0;
      let folderCount = 0;
      
      const calculateDirStats = (dirPath: string) => {
        if (!existsSync(dirPath)) return;
        
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            folderCount++;
            calculateDirStats(fullPath);
          } else {
            fileCount++;
            try {
              const stats = statSync(fullPath);
              totalSize += stats.size;
            } catch (e) {
              // Ignore files that can't be accessed
            }
          }
        }
      };
      
      calculateDirStats(projectDir);
      
      res.json({
        exists: existsSync(projectDir),
        totalSize,
        fileCount,
        folderCount,
        sizeFormatted: totalSize > 1024 * 1024 
          ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
          : totalSize > 1024 
            ? `${(totalSize / 1024).toFixed(2)} KB`
            : `${totalSize} bytes`,
      });
    } catch (error) {
      console.error("Error getting files stats:", error);
      res.status(500).json({ message: "Failed to get files statistics" });
    }
  });

  // Restore project files from backup (ZIP archive)
  app.post("/api/projects/:projectId/files/restore", isAuthenticated, upload.single("backup"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_RESTORE);
      if (!canRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to restore projects" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No backup file provided" });
      }
      
      const clearExisting = req.body.clearExisting === "true";
      
      const projectFilesPath = await getProjectFilesPath();
      const projectDirName = getProjectDirectoryName(project.name, project.id);
      const projectDir = path.join(projectFilesPath, projectDirName);
      
      const restoreResult=await auditedOperation("projectFilesRestore","files",async()=>{
      // Clear existing files if requested
      if (clearExisting && existsSync(projectDir)) {
        rmSync(projectDir, { recursive: true, force: true });
      }
      
      // Ensure project directory exists
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true });
      }
      
      // Extract ZIP file
      let filesRestored = 0;
      const errors: string[] = [];
      
      await new Promise<void>((resolve, reject) => {
        const bufferStream = Readable.from(req.file.buffer);
        
        bufferStream
          .pipe(unzipper.Parse())
          .on("entry", async (entry: any) => {
            const fileName = entry.path;
            const type = entry.type;
            const targetPath = path.join(projectDir, fileName);
            
            // Security check - prevent path traversal
            if (!targetPath.startsWith(projectDir)) {
              errors.push(`Skipped unsafe path: ${fileName}`);
              entry.autodrain();
              return;
            }
            
            if (type === "Directory") {
              if (!existsSync(targetPath)) {
                mkdirSync(targetPath, { recursive: true });
              }
              entry.autodrain();
            } else {
              // Ensure parent directory exists
              const parentDir = path.dirname(targetPath);
              if (!existsSync(parentDir)) {
                mkdirSync(parentDir, { recursive: true });
              }
              
              entry.pipe(createWriteStream(targetPath))
                .on("finish", () => {
                  filesRestored++;
                })
                .on("error", (err: Error) => {
                  errors.push(`Failed to write ${fileName}: ${err.message}`);
                });
            }
          })
          .on("close", resolve)
          .on("error", reject);
      });
      
      return {filesRestored,errors};
      },project.id,project.name);
      res.json({
        message: "Files restored successfully",
        ...restoreResult,
      });
    } catch (error) {
      console.error("Error restoring files backup:", error);
      res.status(500).json({ message: "Failed to restore files backup" });
    }
  });

  // Get all projects with database stats for maintenance page
  app.get("/api/maintenance/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Need either project backup or restore permission to see the maintenance page
      const canBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_BACKUP);
      const canRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_PROJECT_RESTORE);
      if (!canBackup && !canRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to access maintenance" });
      }
      
      const isAdmin = await storage.isAdminUser(currentUser);
      const projects = isAdmin 
        ? await storage.getProjects() 
        : await storage.getUserProjects(currentUser.id);
      const projectsWithStats = await Promise.all(
        projects.map(async (project) => {
          if (!project.databaseName) {
            return {
              ...project,
              stats: null,
            };
          }
          
          try {
            const stats = await getProjectDatabaseStats(project.databaseName);
            return {
              ...project,
              stats,
            };
          } catch (e) {
            return {
              ...project,
              stats: null,
            };
          }
        })
      );
      
      res.json(projectsWithStats);
    } catch (error) {
      console.error("Error fetching maintenance projects:", error);
      res.status(500).json({ message: "Failed to fetch projects for maintenance" });
    }
  });

  // ===============================
  // External Database Import Routes
  // ===============================

  // Get database type options
  app.get("/api/database-import/types", isAuthenticated, async (req, res) => {
    res.json({
      databaseTypes: databaseTypeEnum,
      scheduleFrequencies: importScheduleFrequencyEnum.map(freq => ({
        value: freq,
        label: freq === "manual" ? "Manual Only" : 
               freq.replace(/_/g, " ").replace(/^every /, "Every ").replace(/^(\w)/, (c) => c.toUpperCase()),
      })),
      workOrderFields: ExternalDatabaseService.getWorkOrderFieldMappings(),
    });
  });

  // Get external database configurations for a project
  app.get("/api/projects/:projectId/database-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const configs = await storage.getExternalDatabaseConfigs(projectId);
      
      const safeConfigs = configs.map(c => ({
        ...c,
        password: "********",
      }));
      
      res.json(safeConfigs);
    } catch (error) {
      console.error("Error fetching database configs:", error);
      res.status(500).json({ message: "Failed to fetch database configurations" });
    }
  });

  // Get single external database configuration
  app.get("/api/database-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const config = await storage.getExternalDatabaseConfig(configId);
      
      if (!config) {
        return res.status(404).json({ message: "Configuration not found" });
      }
      
      res.json({
        ...config,
        password: "********",
      });
    } catch (error) {
      console.error("Error fetching database config:", error);
      res.status(500).json({ message: "Failed to fetch database configuration" });
    }
  });

  // Create external database configuration
  app.post("/api/projects/:projectId/database-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const validatedData = insertExternalDatabaseConfigSchema.parse({
        ...req.body,
        projectId,
      });
      
      const config = await storage.createExternalDatabaseConfig(validatedData);
      
      res.json({
        ...config,
        password: "********",
      });
    } catch (error) {
      console.error("Error creating database config:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create database configuration" });
    }
  });

  // Update external database configuration
  app.patch("/api/database-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const existing = await storage.getExternalDatabaseConfig(configId);
      if (!existing) {
        return res.status(404).json({ message: "Configuration not found" });
      }
      
      const updateData = { ...req.body };
      if (updateData.password === "********" || !updateData.password) {
        delete updateData.password;
      }
      
      const validatedData = updateExternalDatabaseConfigSchema.parse(updateData);
      const config = await storage.updateExternalDatabaseConfig(configId, validatedData);
      
      res.json({
        ...config,
        password: "********",
      });
    } catch (error) {
      console.error("Error updating database config:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update database configuration" });
    }
  });

  // Delete external database configuration
  app.delete("/api/database-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      await storage.deleteExternalDatabaseConfig(configId);
      res.json({ message: "Configuration deleted" });
    } catch (error) {
      console.error("Error deleting database config:", error);
      res.status(500).json({ message: "Failed to delete database configuration" });
    }
  });

  // Test database connection
  app.post("/api/database-configs/test-connection", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { configId, ...connectionParams } = req.body;
      
      let testConfig: any;
      
      if (configId) {
        const existing = await storage.getExternalDatabaseConfig(configId);
        if (!existing) {
          return res.status(404).json({ message: "Configuration not found" });
        }
        testConfig = {
          ...existing,
          ...connectionParams,
          password: connectionParams.password === "********" ? existing.password : connectionParams.password,
        };
      } else {
        testConfig = connectionParams;
      }
      
      const result = await ExternalDatabaseService.testConnection(testConfig);
      
      if (configId) {
        await storage.updateExternalDatabaseConfigTestResult(configId, result.success);
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error testing connection:", error);
      res.status(500).json({ success: false, message: "Failed to test connection" });
    }
  });

  // Preview SQL query results
  app.post("/api/database-configs/:id/preview-query", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const config = await storage.getExternalDatabaseConfig(configId);
      if (!config) {
        return res.status(404).json({ message: "Configuration not found" });
      }
      
      const { sqlQuery, limit = 10 } = req.body;
      if (!sqlQuery) {
        return res.status(400).json({ message: "SQL query is required" });
      }
      
      const result = await ExternalDatabaseService.executeQuery(config, sqlQuery, limit);
      res.json(result);
    } catch (error) {
      console.error("Error previewing query:", error);
      res.status(500).json({ success: false, error: "Failed to execute query" });
    }
  });

  // ===============================
  // Import Configuration Routes
  // ===============================

  // Get import configurations for a database config
  app.get("/api/database-configs/:dbConfigId/import-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const dbConfigId = parseInt(req.params.dbConfigId);
      const configs = await storage.getImportConfigs(dbConfigId);
      res.json(configs);
    } catch (error) {
      console.error("Error fetching import configs:", error);
      res.status(500).json({ message: "Failed to fetch import configurations" });
    }
  });

  // Get import configurations for a project
  app.get("/api/projects/:projectId/import-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      const configs = await storage.getImportConfigsByProject(projectId);
      res.json(configs);
    } catch (error) {
      console.error("Error fetching project import configs:", error);
      res.status(500).json({ message: "Failed to fetch import configurations" });
    }
  });

  // Create import configuration
  app.post("/api/database-configs/:dbConfigId/import-configs", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const dbConfigId = parseInt(req.params.dbConfigId);
      const dbConfig = await storage.getExternalDatabaseConfig(dbConfigId);
      if (!dbConfig) {
        return res.status(404).json({ message: "Database configuration not found" });
      }
      
      const validatedData = insertImportConfigSchema.parse({
        ...req.body,
        externalDbConfigId: dbConfigId,
      });
      
      const config = await storage.createImportConfig(validatedData);
      res.json(config);
    } catch (error) {
      console.error("Error creating import config:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create import configuration" });
    }
  });

  // Update import configuration
  app.patch("/api/import-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const existing = await storage.getImportConfig(configId);
      if (!existing) {
        return res.status(404).json({ message: "Import configuration not found" });
      }
      
      const validatedData = updateImportConfigSchema.parse(req.body);
      const config = await storage.updateImportConfig(configId, validatedData);
      res.json(config);
    } catch (error) {
      console.error("Error updating import config:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update import configuration" });
    }
  });

  // Delete import configuration
  app.delete("/api/import-configs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      await storage.deleteImportConfig(configId);
      res.json({ message: "Import configuration deleted" });
    } catch (error) {
      console.error("Error deleting import config:", error);
      res.status(500).json({ message: "Failed to delete import configuration" });
    }
  });

  // Run import manually
  app.post("/api/import-configs/:id/run", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const importConfig = await storage.getImportConfig(configId);
      if (!importConfig) {
        return res.status(404).json({ message: "Import configuration not found" });
      }
      
      const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
      if (!dbConfig) {
        return res.status(404).json({ message: "Database configuration not found" });
      }
      
      const project = await storage.getProject(dbConfig.projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or has no database" });
      }
      
      const historyEntry = await storage.createImportHistoryEntry(configId, "running");
      
      try {
        const queryResult = await ExternalDatabaseService.executeQuery(dbConfig, importConfig.sqlQuery);
        
        if (!queryResult.success || !queryResult.data) {
          await storage.updateImportHistoryEntry(historyEntry.id, "failed", 0, 0, queryResult.error);
          await storage.updateImportConfigLastRun(configId, "failed", queryResult.error || "Query failed", 0, null);
          return res.json({ success: false, error: queryResult.error, historyId: historyEntry.id });
        }
        
        const workOrderStorage = await getProjectWorkOrderStorage(project.databaseName);
        const columnMapping = (importConfig.columnMapping as Record<string, string>) || {};
        
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];
        
        for (const row of queryResult.data) {
          try {
            const mappedData = mapSqlImportRow(row, columnMapping);
            
            if (!mappedData.customerWoId || !mappedData.customerId || !mappedData.customerName || !mappedData.address || !mappedData.serviceType) {
              failed++;
              errors.push(`Row missing required fields: ${JSON.stringify(row).slice(0, 100)}`);
              continue;
            }
            
            const serviceType = String(mappedData.serviceType);
            if (!["Water", "Electric", "Gas"].includes(serviceType)) {
              mappedData.serviceType = "Water";
            }
            
            if (mappedData.oldSystemReading !== undefined && mappedData.oldSystemReading !== null && mappedData.oldSystemReading !== "") {
              mappedData.oldSystemReading = readingParameter(mappedData.oldSystemReading);
            }
            if (mappedData.newSystemReading !== undefined && mappedData.newSystemReading !== null && mappedData.newSystemReading !== "") {
              mappedData.newSystemReading = readingParameter(mappedData.newSystemReading);
            }
            
            mappedData.status = String(mappedData.status || "pending");
            mappedData.createdBy = currentUser.username;
            
            const existingWo = await workOrderStorage.getWorkOrderByCustomerWoId(mappedData.customerWoId);
            if (existingWo) {
              await workOrderStorage.updateWorkOrder(existingWo.id, mappedData as any, undefined, true);
            } else {
              const validated = insertProjectWorkOrderSchema.parse(mappedData);
              await workOrderStorage.createWorkOrder(validated as any, undefined, true);
            }
            imported++;
          } catch (rowError: any) {
            failed++;
            errors.push(`Row error: ${rowError.message?.slice(0, 100) || "Unknown error"}`);
          }
        }
        
        const status = failed === 0 ? "success" : (imported > 0 ? "partial" : "failed");
        const message = `Imported ${imported} records, ${failed} failed`;
        
        await storage.updateImportHistoryEntry(historyEntry.id, status, imported, failed, errors.length > 0 ? errors.slice(0, 10).join("\n") : null);
        await storage.updateImportConfigLastRun(configId, status, message, imported, null);
        
        res.json({
          success: true,
          imported,
          failed,
          total: queryResult.data.length,
          historyId: historyEntry.id,
          errors: errors.slice(0, 10),
        });
      } catch (importError: any) {
        await storage.updateImportHistoryEntry(historyEntry.id, "failed", 0, 0, importError.message);
        await storage.updateImportConfigLastRun(configId, "failed", importError.message, 0, null);
        res.json({ success: false, error: importError.message, historyId: historyEntry.id });
      }
    } catch (error) {
      console.error("Error running import:", error);
      res.status(500).json({ message: "Failed to run import" });
    }
  });

  // Get import history
  app.get("/api/import-configs/:id/history", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const configId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await storage.getImportHistory(configId, limit);
      res.json(history);
    } catch (error) {
      console.error("Error fetching import history:", error);
      res.status(500).json({ message: "Failed to fetch import history" });
    }
  });

  // Work order status routes
  app.get("/api/work-order-statuses", isAuthenticated, async (req: any, res) => {
    try {
      const statuses = await storage.getWorkOrderStatuses();
      res.json(statuses);
    } catch (error) {
      console.error("Error fetching work order statuses:", error);
      res.status(500).json({ message: "Failed to fetch work order statuses" });
    }
  });

  app.post("/api/work-order-statuses", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const status = await storage.createWorkOrderStatus(req.body);
      res.status(201).json(status);
    } catch (error: any) {
      console.error("Error creating work order status:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Status code already exists" });
      }
      res.status(500).json({ message: "Failed to create work order status" });
    }
  });

  // Core statuses that cannot be deleted or have their code changed
  const CORE_STATUS_CODES = ["Open", "Closed", "Completed", "Scheduled", "Trouble"];
  
  // Case-insensitive check for core status codes
  function isCoreStatus(code: string): boolean {
    return CORE_STATUS_CODES.some(c => c.toLowerCase() === code.toLowerCase());
  }

  app.patch("/api/work-order-statuses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const existingStatus = await storage.getWorkOrderStatus(id);
      
      if (!existingStatus) {
        return res.status(404).json({ message: "Status not found" });
      }
      
      // If this is a core status, prevent changing the code
      if (isCoreStatus(existingStatus.code) && req.body.code && req.body.code !== existingStatus.code) {
        return res.status(400).json({ message: "Cannot change the code of a core status" });
      }
      
      const status = await storage.updateWorkOrderStatus(id, req.body);
      res.json(status);
    } catch (error: any) {
      console.error("Error updating work order status:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Status code already exists" });
      }
      res.status(500).json({ message: "Failed to update work order status" });
    }
  });

  app.delete("/api/work-order-statuses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const status = await storage.getWorkOrderStatus(id);
      
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }
      
      // Prevent deletion of core statuses
      if (isCoreStatus(status.code)) {
        return res.status(400).json({ message: "Cannot delete a core status. Core statuses are required for system functionality." });
      }
      
      await storage.deleteWorkOrderStatus(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order status:", error);
      res.status(500).json({ message: "Failed to delete work order status" });
    }
  });

  // Trouble Codes API Routes
  app.get("/api/trouble-codes", isAuthenticated, async (req: any, res) => {
    try {
      const codes = await storage.getTroubleCodes();
      res.json(codes);
    } catch (error) {
      console.error("Error fetching trouble codes:", error);
      res.status(500).json({ message: "Failed to fetch trouble codes" });
    }
  });

  app.post("/api/trouble-codes", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const code = await storage.createTroubleCode(req.body);
      res.status(201).json(code);
    } catch (error: any) {
      console.error("Error creating trouble code:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Trouble code already exists" });
      }
      res.status(500).json({ message: "Failed to create trouble code" });
    }
  });

  app.patch("/api/trouble-codes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const code = await storage.updateTroubleCode(id, req.body);
      
      if (!code) {
        return res.status(404).json({ message: "Trouble code not found" });
      }
      
      res.json(code);
    } catch (error: any) {
      console.error("Error updating trouble code:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Trouble code already exists" });
      }
      res.status(500).json({ message: "Failed to update trouble code" });
    }
  });

  app.delete("/api/trouble-codes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const code = await storage.getTroubleCode(id);
      
      if (!code) {
        return res.status(404).json({ message: "Trouble code not found" });
      }
      
      await storage.deleteTroubleCode(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting trouble code:", error);
      res.status(500).json({ message: "Failed to delete trouble code" });
    }
  });

  // Service Types API Routes
  app.get("/api/service-types", isAuthenticated, async (req: any, res) => {
    try {
      const serviceTypes = await storage.getServiceTypes();
      res.json(serviceTypes);
    } catch (error) {
      console.error("Error fetching service types:", error);
      res.status(500).json({ message: "Failed to fetch service types" });
    }
  });

  app.post("/api/service-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const serviceType = await storage.createServiceType(req.body);
      res.status(201).json(serviceType);
    } catch (error: any) {
      console.error("Error creating service type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Service type already exists" });
      }
      res.status(500).json({ message: "Failed to create service type" });
    }
  });

  app.patch("/api/service-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const serviceType = await storage.updateServiceType(id, req.body);
      
      if (!serviceType) {
        return res.status(404).json({ message: "Service type not found" });
      }
      
      res.json(serviceType);
    } catch (error: any) {
      console.error("Error updating service type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Service type already exists" });
      }
      res.status(500).json({ message: "Failed to update service type" });
    }
  });

  app.delete("/api/service-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const serviceType = await storage.getServiceType(id);
      
      if (!serviceType) {
        return res.status(404).json({ message: "Service type not found" });
      }
      
      await storage.deleteServiceType(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting service type:", error);
      res.status(500).json({ message: "Failed to delete service type" });
    }
  });

  // System Types API Routes
  app.get("/api/system-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const projectId = req.query.projectId ? parseInt(req.query.projectId) : undefined;
      let systemTypes = await storage.getSystemTypes(projectId);
      
      // Non-admin users can only see system types from their assigned projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = userProjects.map(p => p.id);
        
        // Filter system types to only include those with at least one project the user has access to
        systemTypes = systemTypes.filter(st => {
          if (!st.projectIds || st.projectIds.length === 0) return false;
          return st.projectIds.some(pid => userProjectIds.includes(pid));
        });
      }
      
      res.json(systemTypes);
    } catch (error) {
      console.error("Error fetching system types:", error);
      res.status(500).json({ message: "Failed to fetch system types" });
    }
  });

  app.get("/api/system-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const systemType = await storage.getSystemType(id);
      
      if (!systemType) {
        return res.status(404).json({ message: "System type not found" });
      }
      
      res.json(systemType);
    } catch (error) {
      console.error("Error fetching system type:", error);
      res.status(500).json({ message: "Failed to fetch system type" });
    }
  });

  app.post("/api/system-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const systemType = await storage.createSystemType(req.body);
      res.status(201).json(systemType);
    } catch (error: any) {
      console.error("Error creating system type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "System type already exists" });
      }
      res.status(500).json({ message: "Failed to create system type" });
    }
  });

  app.patch("/api/system-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const systemType = await storage.updateSystemType(id, req.body);
      
      if (!systemType) {
        return res.status(404).json({ message: "System type not found" });
      }
      
      res.json(systemType);
    } catch (error: any) {
      console.error("Error updating system type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "System type already exists" });
      }
      res.status(500).json({ message: "Failed to update system type" });
    }
  });

  app.delete("/api/system-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const systemType = await storage.getSystemType(id);
      
      if (!systemType) {
        return res.status(404).json({ message: "System type not found" });
      }
      
      await storage.deleteSystemType(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting system type:", error);
      res.status(500).json({ message: "Failed to delete system type" });
    }
  });

  app.post("/api/system-types/:id/copy", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getSystemType(id);
      
      if (!existing) {
        return res.status(404).json({ message: "System type not found" });
      }
      
      const { targetProjectIds } = req.body;
      const projectIds = targetProjectIds || existing.projectIds;
      
      // Generate a unique productId by appending " - Copy" or " - Copy N"
      const allSystemTypes = await storage.getSystemTypes();
      const baseProductId = existing.productId;
      let newProductId = `${baseProductId} - Copy`;
      let copyNumber = 1;
      
      // Check if the productId already exists
      while (allSystemTypes.some(mt => mt.productId === newProductId)) {
        copyNumber++;
        newProductId = `${baseProductId} - Copy ${copyNumber}`;
      }
      
      const newSystemType = await storage.createSystemType({
        productId: newProductId,
        productLabel: `Copy of ${existing.productLabel}`,
        productDescription: existing.productDescription,
        projectIds: projectIds,
      });
      
      res.status(201).json(newSystemType);
    } catch (error) {
      console.error("Error copying system type:", error);
      res.status(500).json({ message: "Failed to copy system type" });
    }
  });

  // Module Types API Routes
  app.get("/api/module-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const projectId = req.query.projectId ? parseInt(req.query.projectId) : undefined;
      let moduleTypes = await storage.getModuleTypes(projectId);
      
      // Non-admin users can only see module types from their assigned projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = userProjects.map(p => p.id);
        
        // Filter module types to only include those with at least one project the user has access to
        moduleTypes = moduleTypes.filter(mt => {
          if (!mt.projectIds || mt.projectIds.length === 0) return false;
          return mt.projectIds.some(pid => userProjectIds.includes(pid));
        });
      }
      
      res.json(moduleTypes);
    } catch (error) {
      console.error("Error fetching module types:", error);
      res.status(500).json({ message: "Failed to fetch module types" });
    }
  });

  app.get("/api/module-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const moduleType = await storage.getModuleType(id);
      
      if (!moduleType) {
        return res.status(404).json({ message: "Module type not found" });
      }
      
      res.json(moduleType);
    } catch (error) {
      console.error("Error fetching module type:", error);
      res.status(500).json({ message: "Failed to fetch module type" });
    }
  });

  app.post("/api/module-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const moduleType = await storage.createModuleType(req.body);
      res.status(201).json(moduleType);
    } catch (error: any) {
      console.error("Error creating module type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Module type already exists" });
      }
      res.status(500).json({ message: "Failed to create module type" });
    }
  });

  app.patch("/api/module-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const moduleType = await storage.updateModuleType(id, req.body);
      
      if (!moduleType) {
        return res.status(404).json({ message: "Module type not found" });
      }
      
      res.json(moduleType);
    } catch (error: any) {
      console.error("Error updating module type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Module type already exists" });
      }
      res.status(500).json({ message: "Failed to update module type" });
    }
  });

  app.delete("/api/module-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const moduleType = await storage.getModuleType(id);
      
      if (!moduleType) {
        return res.status(404).json({ message: "Module type not found" });
      }
      
      await storage.deleteModuleType(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting module type:", error);
      res.status(500).json({ message: "Failed to delete module type" });
    }
  });

  app.post("/api/module-types/:id/copy", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getModuleType(id);
      
      if (!existing) {
        return res.status(404).json({ message: "Module type not found" });
      }
      
      const { targetProjectIds } = req.body;
      const projectIds = targetProjectIds || existing.projectIds;
      
      // Generate a unique productId by appending " - Copy" or " - Copy N"
      const allModuleTypes = await storage.getModuleTypes();
      const baseProductId = existing.productId;
      let newProductId = `${baseProductId} - Copy`;
      let copyNumber = 1;
      
      // Check if the productId already exists
      while (allModuleTypes.some(mt => mt.productId === newProductId)) {
        copyNumber++;
        newProductId = `${baseProductId} - Copy ${copyNumber}`;
      }
      
      const newModuleType = await storage.createModuleType({
        productId: newProductId,
        productLabel: `Copy of ${existing.productLabel}`,
        productDescription: existing.productDescription,
        projectIds: projectIds,
      });
      
      res.status(201).json(newModuleType);
    } catch (error) {
      console.error("Error copying module type:", error);
      res.status(500).json({ message: "Failed to copy module type" });
    }
  });

  // User Groups API Routes
  app.get("/api/user-groups", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      let groups = await storage.getAllUserGroupsWithProjects();
      
      // Non-admin users only see groups that are assigned to projects they have access to
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        // Filter groups to only those with at least one project the user can access
        groups = groups.filter(group => 
          group.projectIds?.some(pid => userProjectIds.has(pid))
        );
      }
      
      res.json(groups);
    } catch (error) {
      console.error("Error fetching user groups:", error);
      res.status(500).json({ message: "Failed to fetch user groups" });
    }
  });

  app.get("/api/user-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const id = parseInt(req.params.id);
      const group = await storage.getUserGroupWithProjects(id);
      
      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      // Non-admin users can only access groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        const hasAccess = group.projectIds?.some(pid => userProjectIds.has(pid));
        if (!hasAccess) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this group" });
        }
      }
      
      res.json(group);
    } catch (error) {
      console.error("Error fetching user group:", error);
      res.status(500).json({ message: "Failed to fetch user group" });
    }
  });

  app.post("/api/user-groups", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const { name, description, projectIds } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Group name is required" });
      }
      
      if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
        return res.status(400).json({ message: "At least one project must be assigned" });
      }
      
      // Non-admin users can only create groups for projects they have access to
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        const allProjectsAccessible = projectIds.every((pid: number) => userProjectIds.has(pid));
        if (!allProjectsAccessible) {
          return res.status(403).json({ message: "Forbidden: You can only create groups for projects you have access to" });
        }
      }
      
      const group = await storage.createUserGroup({ name: name.trim(), description }, projectIds);
      res.status(201).json(group);
    } catch (error: any) {
      console.error("Error creating user group:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Group name already exists" });
      }
      res.status(500).json({ message: "Failed to create user group" });
    }
  });

  app.patch("/api/user-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const id = parseInt(req.params.id);
      const { name, description, projectIds } = req.body;
      
      // Validate projectIds if provided
      if (projectIds !== undefined && (!Array.isArray(projectIds) || projectIds.length === 0)) {
        return res.status(400).json({ message: "At least one project must be assigned" });
      }
      
      // Non-admin users can only update groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const existingGroup = await storage.getUserGroupWithProjects(id);
        if (!existingGroup) {
          return res.status(404).json({ message: "Group not found" });
        }
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        // Check access to existing group
        const hasAccess = existingGroup.projectIds?.some(pid => userProjectIds.has(pid));
        if (!hasAccess) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this group" });
        }
        // Check access to new projectIds if provided
        if (projectIds !== undefined) {
          const allProjectsAccessible = projectIds.every((pid: number) => userProjectIds.has(pid));
          if (!allProjectsAccessible) {
            return res.status(403).json({ message: "Forbidden: You can only assign groups to projects you have access to" });
          }
        }
      }
      
      const group = await storage.updateUserGroup(id, { 
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
      }, projectIds);
      
      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      res.json(group);
    } catch (error: any) {
      console.error("Error updating user group:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Group name already exists" });
      }
      res.status(500).json({ message: "Failed to update user group" });
    }
  });

  app.delete("/api/user-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const id = parseInt(req.params.id);
      
      // Non-admin users can only delete groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const groupWithProjects = await storage.getUserGroupWithProjects(id);
        if (!groupWithProjects) {
          return res.status(404).json({ message: "Group not found" });
        }
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        const hasAccess = groupWithProjects.projectIds?.some(pid => userProjectIds.has(pid));
        if (!hasAccess) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this group" });
        }
      }
      
      const group = await storage.getUserGroup(id);
      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      await storage.deleteUserGroup(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user group:", error);
      res.status(500).json({ message: "Failed to delete user group" });
    }
  });

  // User Group Members API Routes
  app.get("/api/user-groups/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const groupId = parseInt(req.params.id);
      
      // Non-admin users can only access members of groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      let callerProjectIds: Set<number> | null = null;
      let groupProjectIds: Set<number> | null = null;
      
      if (!isAdmin) {
        const groupWithProjects = await storage.getUserGroupWithProjects(groupId);
        if (!groupWithProjects) {
          return res.status(404).json({ message: "Group not found" });
        }
        groupProjectIds = new Set(groupWithProjects.projectIds || []);
        const userProjects = await storage.getUserProjects(currentUser.id);
        callerProjectIds = new Set(userProjects.map(p => p.id));
        const hasAccess = [...groupProjectIds].some(pid => callerProjectIds!.has(pid));
        if (!hasAccess) {
          return res.status(403).json({ message: "Forbidden: You don't have access to this group" });
        }
      }
      
      let members = await storage.getGroupMembers(groupId);
      
      // Filter members to only those who share a common project with caller AND group (prevents cross-project enumeration)
      if (callerProjectIds && groupProjectIds) {
        const filteredMembers: typeof members = [];
        for (const member of members) {
          const memberProjects = await storage.getUserProjects(member.id);
          const memberProjectIds = new Set(memberProjects.map(p => p.id));
          // Three-way intersection: caller ∩ group ∩ member must be non-empty
          const commonProjectIds = [...callerProjectIds].filter(pid => 
            groupProjectIds!.has(pid) && memberProjectIds.has(pid)
          );
          if (commonProjectIds.length > 0) {
            filteredMembers.push(member);
          }
        }
        members = filteredMembers;
      }
      
      res.json(members.map(userResponse));
    } catch (error) {
      console.error("Error fetching group members");
      res.status(500).json({ message: "Failed to fetch group members" });
    }
  });

  app.post("/api/user-groups/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const groupId = parseInt(req.params.id);
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }
      
      // Non-admin users can only add members to groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      const groupWithProjects = await storage.getUserGroupWithProjects(groupId);
      if (!groupWithProjects) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      const groupProjectIds = new Set(groupWithProjects.projectIds || []);
      const targetUserProjects = await storage.getUserProjects(userId);
      const targetUserProjectIds = new Set(targetUserProjects.map(p => p.id));
      
      if (!isAdmin) {
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        
        // Non-admin requires: intersection of caller projects ∩ group projects ∩ target user projects must be non-empty
        // This prevents cross-project privilege escalation through multi-project groups
        const commonProjectIds = [...userProjectIds].filter(pid => 
          groupProjectIds.has(pid) && targetUserProjectIds.has(pid)
        );
        if (commonProjectIds.length === 0) {
          return res.status(403).json({ message: "Forbidden: You must share a common project with both the group and the user" });
        }
      }
      
      // Validate: target user must belong to at least one of the group's projects
      const userBelongsToGroupProjects = [...groupProjectIds].some(pid => targetUserProjectIds.has(pid));
      if (!userBelongsToGroupProjects) {
        return res.status(400).json({ message: "User must be assigned to at least one project that this group belongs to" });
      }
      
      const member = await storage.addUserToGroup(groupId, userId);
      res.status(201).json(member);
    } catch (error: any) {
      console.error("Error adding user to group:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "User is already a member of this group" });
      }
      res.status(500).json({ message: "Failed to add user to group" });
    }
  });

  app.delete("/api/user-groups/:groupId/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canManageUserGroups = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_USER_GROUPS);
      if (!canManageUserGroups) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage user groups" });
      }
      
      const groupId = parseInt(req.params.groupId);
      const userId = req.params.userId;
      
      // Non-admin users can only remove members from groups in their projects
      const isAdmin = await storage.isAdminUser(currentUser);
      if (!isAdmin) {
        const groupWithProjects = await storage.getUserGroupWithProjects(groupId);
        if (!groupWithProjects) {
          return res.status(404).json({ message: "Group not found" });
        }
        const groupProjectIds = new Set(groupWithProjects.projectIds || []);
        const userProjects = await storage.getUserProjects(currentUser.id);
        const userProjectIds = new Set(userProjects.map(p => p.id));
        const targetUserProjects = await storage.getUserProjects(userId);
        const targetUserProjectIds = new Set(targetUserProjects.map(p => p.id));
        
        // Non-admin requires: intersection of caller projects ∩ group projects ∩ target user projects must be non-empty
        const commonProjectIds = [...userProjectIds].filter(pid => 
          groupProjectIds.has(pid) && targetUserProjectIds.has(pid)
        );
        if (commonProjectIds.length === 0) {
          return res.status(403).json({ message: "Forbidden: You must share a common project with both the group and the user" });
        }
      }
      
      await storage.removeUserFromGroup(groupId, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from group:", error);
      res.status(500).json({ message: "Failed to remove user from group" });
    }
  });

  // Full System Backup/Restore API Routes
  // Uses pg_dump for SQL-format backup that handles foreign key constraints properly
  // Supports four backup types: database, full (database+webapp+project files), files (webapp only), project (project files only)
  app.get("/api/system/backup", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canSystemBackup = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_SYSTEM_BACKUP);
      if (!canSystemBackup) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create system backups" });
      }
      
      // Get backup type from query parameter, default to 'database' for full database backup
      const backupType = (req.query.type as BackupType) || "database";
      if (!["database", "clean", "files", "project"].includes(backupType)) {
        return res.status(400).json({ message: "Invalid backup type. Must be 'database', 'clean', 'files', or 'project'" });
      }
      
      await createPgBackupArchive(res, backupType);
    } catch (error) {
      console.error("Error creating system backup:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to create system backup" });
      }
    }
  });

  const largeUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 1024 * 1024 * 1024 } 
  });

  // Supports both new SQL format (pg_dump) and legacy JSON format for backward compatibility
  app.post("/api/system/restore", isAuthenticated, largeUpload.single("backup"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canSystemRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_SYSTEM_RESTORE);
      if (!canSystemRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to restore system backups" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No backup file provided" });
      }
      
      const restoreFiles = req.body.restoreFiles !== "false";
      const fileName = req.file.originalname || "";
      const isPlainSql = fileName.toLowerCase().endsWith(".sql");
      
      // Handle plain .sql file upload (like pgAdmin exports)
      if (isPlainSql) {
        console.log(`[Restore] Detected plain SQL file: ${fileName}`);
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const sqlPath = path.join(tempDir, `restore_${timestamp}.sql`);
        
        // Write the SQL content to a temp file
        await fs.writeFile(sqlPath, req.file.buffer);
        
        try {
          const dbResult = await restorePgBackup(sqlPath, { disableForeignKeys: true });
          
          if (!dbResult.success) {
            return res.status(500).json({
              message: "Database restore failed",
              error: dbResult.error,
              warnings: dbResult.warnings,
              filesRestored: 0,
            });
          }
          
          // Build response - note that plain SQL files cannot contain project files
          const responseWarnings = [...(dbResult.warnings || [])];
          if (restoreFiles) {
            responseWarnings.push("File restoration was requested but plain .sql files do not contain project files. Use a .zip backup for file restoration.");
          }
          
          return res.json({
            message: "SQL restore completed successfully",
            format: "plain_sql",
            backupDate: new Date().toISOString(),
            filesRestored: 0,
            warnings: responseWarnings,
            errors: [],
          });
        } finally {
          // Clean up temp file
          if (existsSync(sqlPath)) {
            unlinkSync(sqlPath);
          }
        }
      }
      
      // Extract and detect backup format (SQL or legacy JSON or files-only) from archive
      const { sqlFile, metadata, legacyJson, foundFiles } = await extractBackupFromArchive(req.file.buffer);
      
      // Handle webapp-files-only backup (source code only, no project data)
      if (metadata?.format === "files_only" || metadata?.format === "webapp_files_only" || metadata?.backupType === "files") {
        console.log(`Restoring webapp-files-only backup from ${metadata.backupDate}`);
        
        if (!restoreFiles) {
          return res.json({
            message: "Webapp files-only backup detected but file restoration is disabled",
            format: "webapp_files_only",
            backupDate: metadata.backupDate,
            filesRestored: 0,
            errors: [],
          });
        }
        
        // Webapp files are restored to the app directory (cwd), not project files path
        const appDir = process.cwd();
        const filesResult = await restoreWebAppFilesFromArchive(req.file.buffer, appDir);
        
        return res.json({
          message: "Webapp files-only restore completed",
          format: "webapp_files_only",
          backupDate: metadata.backupDate,
          filesRestored: filesResult.filesRestored,
          errors: filesResult.errors,
        });
      }
      
      // Handle project-files-only backup (project data only, no source code or database)
      if (metadata?.format === "project_files_only" || metadata?.backupType === "project") {
        console.log(`Restoring project-files-only backup from ${metadata.backupDate}`);
        
        if (!restoreFiles) {
          return res.json({
            message: "Project files-only backup detected but file restoration is disabled",
            format: "project_files_only",
            backupDate: metadata.backupDate,
            filesRestored: 0,
            errors: [],
          });
        }
        
        const filesPath = await getProjectFilesPath();
        const filesResult = await restoreFilesFromPgArchive(req.file.buffer, filesPath);
        
        return res.json({
          message: "Project files-only restore completed",
          format: "project_files_only",
          backupDate: metadata.backupDate,
          filesRestored: filesResult.filesRestored,
          errors: filesResult.errors,
        });
      }
      
      if (sqlFile && (metadata?.format === "pg_dump_sql" || metadata?.format === "pg_dump_full" || metadata?.format === "pg_dump_clean" || metadata?.format === "full_system")) {
        // New SQL format - use psql to restore with FK constraint handling
        const isCleanBackup = metadata?.format === "pg_dump_clean";
        const clearExisting = req.body.clearExisting === "true";
        console.log(`Restoring SQL backup from ${metadata.backupDate}${isCleanBackup ? " (clean backup)" : ""}${clearExisting ? " (clearing existing data)" : ""}, schemas: ${metadata.schemas?.join(", ") || "none"}`);
        
        let filesResult = { filesRestored: 0, errors: [] as string[] };
        
        try {
          const dbResult = await restorePgBackup(sqlFile, { disableForeignKeys: true, isCleanBackup, clearExisting });

          if (!dbResult.success) {
            return res.status(500).json({
              message: "Database restore failed",
              success: false,
              error: dbResult.error,
              warnings: dbResult.warnings,
              filesRestored: 0,
            });
          }

          // File failures cannot undo a successful SQL restore. Preserve that
          // distinction even when path resolution or the file helper throws.
          if (restoreFiles) {
            try {
              const filesPath = await getProjectFilesPath();
              filesResult = await restoreFilesFromPgArchive(req.file.buffer, filesPath);
            } catch (error) {
              console.error("File restore failed after SQL database restore:", error);
              filesResult.errors.push("File restoration failed after the database was restored. Review the server logs before retrying.");
            }
          }

          return res.json({
            message: filesResult.errors.length ? "Database restored; file restore incomplete" : isCleanBackup ? "Clean database restore completed" : "Full system restore completed (SQL format)",
            success: filesResult.errors.length === 0,
            databaseCommitted: true,
            format: metadata.format,
            backupDate: metadata.backupDate,
            schemas: metadata.schemas,
            filesRestored: filesResult.filesRestored,
            warnings: dbResult.warnings,
            errors: filesResult.errors,
          });
        } finally {
          // Always clean up temp SQL file
          if (existsSync(sqlFile)) {
            unlinkSync(sqlFile);
          }
        }
      } else if (legacyJson) {
        // Legacy JSON format - use old restore method for backward compatibility
        console.log("Restoring legacy JSON backup");
        const clearExisting = req.body.clearExisting === "true";
        
        const dbResult = await restoreFullSystem(legacyJson, { clearExisting });
        
        let filesResult = { filesRestored: 0, errors: [] as string[] };
        if (restoreFiles) {
          const filesPath = await getProjectFilesPath();
          filesResult = await restoreFilesFromArchive(req.file.buffer, filesPath);
        }
        
        res.json({
          message: filesResult.errors.length ? "Database restored; file restore incomplete" : "Full system restore completed (legacy JSON format)",
          success: dbResult.success && filesResult.errors.length === 0,
          databaseCommitted: dbResult.databaseCommitted,
          format: "legacy_json",
          mainTablesRestored: dbResult.mainTablesRestored,
          projectsRestored: dbResult.projectsRestored,
          filesRestored: filesResult.filesRestored,
          errors: [...dbResult.errors, ...dbResult.projectErrors, ...filesResult.errors],
          warnings: dbResult.warnings,
        });
      } else {
        const filesPreview = foundFiles.slice(0, 10).join(', ');
        const moreFiles = foundFiles.length > 10 ? ` (and ${foundFiles.length - 10} more)` : '';
        return res.status(400).json({ 
          message: `Invalid backup archive: could not find database_backup.sql or database_backup.json. Found files: ${filesPreview}${moreFiles}` 
        });
      }
    } catch (error) {
      console.error("Error restoring full system backup:", error);
      if (error instanceof SystemRestoreError) return res.status(500).json({
        message: error.databaseCommitted ? "Database restored, but audit verification failed. Restore incomplete; contact your administrator before resuming work." : "System database restore failed. No restored database rows were committed; review the server logs before retrying.",
        success: false, databaseCommitted: error.databaseCommitted,
      });
      res.status(500).json({ message: "Failed to restore full system backup" });
    }
  });

  // ============================================================================
  // GENERIC CHUNKED FILE UPLOAD ENDPOINTS
  // These endpoints allow large files (project files, work order files, FTP files)
  // to be uploaded in chunks to avoid reverse proxy body size limits in production
  // ============================================================================

  app.post("/api/files/chunked/init", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Customers cannot upload files" });
      }

      const { fileName, totalChunks: rawTotalChunks, targetUrl } = req.body;

      if (!fileName || rawTotalChunks === undefined || !targetUrl) {
        return res.status(400).json({ message: "Missing required fields: fileName, totalChunks, targetUrl" });
      }

      const totalChunks = parseInt(rawTotalChunks);
      if (isNaN(totalChunks) || totalChunks < 1 || totalChunks > 200) {
        return res.status(400).json({ message: "totalChunks must be a number between 1 and 200" });
      }

      const projectFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/files$/);
      const woFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/work-orders\/(\d+)\/files$/);
      const ftpFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/ftp-files$/);

      if (!projectFileMatch && !woFileMatch && !ftpFileMatch) {
        return res.status(400).json({ message: "Invalid target URL" });
      }

      const projectId = parseInt((projectFileMatch || woFileMatch || ftpFileMatch)![1]);
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      let activeSessionsForUser = 0;
      for (const session of chunkedUploadSessions.values()) {
        if (session.userId === currentUser.id && session.targetUrl) {
          activeSessionsForUser++;
        }
      }
      if (activeSessionsForUser >= 3) {
        return res.status(429).json({ message: "Too many concurrent upload sessions. Please wait for existing uploads to complete." });
      }

      const uploadId = randomUUID();

      chunkedUploadSessions.set(uploadId, {
        userId: currentUser.id,
        fileName,
        totalChunks,
        receivedChunks: new Map(),
        clearExisting: false,
        createdAt: new Date(),
        targetUrl,
      });

      console.log(`[ChunkedFileUpload] Initialized session ${uploadId} for ${fileName} (${totalChunks} chunks) -> ${targetUrl}`);

      res.json({
        uploadId,
        message: "Upload session initialized",
        chunkSize: 5 * 1024 * 1024,
      });
    } catch (error) {
      console.error("Error initializing chunked file upload:", error);
      res.status(500).json({ message: "Failed to initialize upload" });
    }
  });

  app.post("/api/files/chunked/chunk", isAuthenticated, chunkUpload.single("chunk"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { uploadId, chunkIndex } = req.body;

      if (!uploadId || chunkIndex === undefined) {
        return res.status(400).json({ message: "Missing required fields: uploadId, chunkIndex" });
      }

      const session = chunkedUploadSessions.get(uploadId);
      if (!session || !session.targetUrl) {
        return res.status(404).json({ message: "Upload session not found or expired" });
      }

      if (session.userId !== currentUser.id) {
        return res.status(403).json({ message: "Forbidden: This upload session belongs to another user" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No chunk data provided" });
      }

      const index = parseInt(chunkIndex);
      if (isNaN(index) || index < 0 || index >= session.totalChunks) {
        return res.status(400).json({ message: `Invalid chunk index: ${chunkIndex}` });
      }

      let currentBytes = req.file.buffer.length;
      for (const buf of session.receivedChunks.values()) {
        currentBytes += buf.length;
      }
      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const maxFileSizeMB = maxFileSizeValue ? parseInt(maxFileSizeValue) : 100;
      if (currentBytes > maxFileSizeMB * 1024 * 1024) {
        chunkedUploadSessions.delete(uploadId);
        return res.status(400).json({ message: `File exceeds maximum size of ${maxFileSizeMB} MB` });
      }

      session.receivedChunks.set(index, req.file.buffer);

      const receivedCount = session.receivedChunks.size;
      const progress = Math.round((receivedCount / session.totalChunks) * 100);

      console.log(`[ChunkedFileUpload] Session ${uploadId}: received chunk ${index + 1}/${session.totalChunks} (${progress}%)`);

      res.json({
        message: "Chunk received",
        chunkIndex: index,
        receivedChunks: receivedCount,
        totalChunks: session.totalChunks,
        progress,
        complete: receivedCount === session.totalChunks,
      });
    } catch (error) {
      console.error("Error uploading file chunk:", error);
      res.status(500).json({ message: "Failed to upload chunk" });
    }
  });

  app.post("/api/files/chunked/finalize", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { uploadId } = req.body;

      if (!uploadId) {
        return res.status(400).json({ message: "Missing required field: uploadId" });
      }

      const session = chunkedUploadSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ message: "Upload session not found or expired" });
      }

      if (session.userId !== currentUser.id) {
        return res.status(403).json({ message: "Forbidden: This upload session belongs to another user" });
      }

      if (session.receivedChunks.size !== session.totalChunks) {
        return res.status(400).json({
          message: `Incomplete upload: received ${session.receivedChunks.size} of ${session.totalChunks} chunks`
        });
      }

      console.log(`[ChunkedFileUpload] Finalizing session ${uploadId}: assembling ${session.totalChunks} chunks`);

      const chunks: Buffer[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        const chunk = session.receivedChunks.get(i);
        if (!chunk) {
          chunkedUploadSessions.delete(uploadId);
          return res.status(400).json({ message: `Missing chunk at index ${i}` });
        }
        chunks.push(chunk);
      }

      const fileBuffer = Buffer.concat(chunks);
      console.log(`[ChunkedFileUpload] Assembled file: ${fileBuffer.length} bytes from ${chunks.length} chunks`);

      chunkedUploadSessions.delete(uploadId);

      const targetUrl = session.targetUrl!;

      const maxFileSizeValue = await storage.getSetting("max_file_size_mb");
      const maxFileSizeMB = maxFileSizeValue ? parseInt(maxFileSizeValue) : 100;
      const maxFileSize = maxFileSizeMB * 1024 * 1024;

      if (fileBuffer.length > maxFileSize) {
        return res.status(400).json({ message: `File exceeds maximum size of ${maxFileSizeMB} MB` });
      }

      const projectFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/files$/);
      const woFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/work-orders\/(\d+)\/files$/);
      const ftpFileMatch = targetUrl.match(/^\/api\/projects\/(\d+)\/ftp-files$/);

      if (projectFileMatch) {
        const projectId = parseInt(projectFileMatch[1]);

        if (currentUser.role === "customer") {
          return res.status(403).json({ message: "Customers cannot upload files" });
        }
        if (currentUser.role !== "admin") {
          const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
          if (!isAssigned) {
            return res.status(403).json({ message: "Forbidden" });
          }
        }

        const project = await storage.getProject(projectId);
        if (!project) {
          return res.status(404).json({ message: "Project not found" });
        }

        const allowedExtensionsValue = await storage.getSetting("allowed_extensions");
        if (allowedExtensionsValue && allowedExtensionsValue.trim()) {
          const allowedExts = allowedExtensionsValue.split(",").map(e => e.trim().toLowerCase());
          const fileExt = "." + session.fileName.split(".").pop()?.toLowerCase();
          if (!allowedExts.includes(fileExt)) {
            return res.status(400).json({ message: `File type ${fileExt} is not allowed. Allowed types: ${allowedExtensionsValue}` });
          }
        }

        const filePath = await saveProjectFile(project.name, project.id, session.fileName, fileBuffer);
        emitFileAdded(projectId, undefined, currentUser?.id);
        return res.status(201).json({ message: "File uploaded", path: filePath });

      } else if (woFileMatch) {
        const projectId = parseInt(woFileMatch[1]);
        const workOrderId = parseInt(woFileMatch[2]);

        if (currentUser.role === "customer") {
          return res.status(403).json({ message: "Customers cannot upload files" });
        }
        if (currentUser.role !== "admin") {
          const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
          if (!isAssigned) {
            return res.status(403).json({ message: "Forbidden" });
          }
        }

        const project = await storage.getProject(projectId);
        if (!project || !project.databaseName) {
          return res.status(404).json({ message: "Project not found" });
        }

        const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
        const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
        if (!workOrder) {
          return res.status(404).json({ message: "Work order not found" });
        }

        const folderName = workOrder.customerWoId || String(workOrder.id);
        const filePath = await saveWorkOrderFile(
          project.name, project.id, folderName,
          session.fileName, fileBuffer, workOrder.id
        );
        return res.status(201).json({ message: "File uploaded", path: filePath });

      } else if (ftpFileMatch) {
        const projectId = parseInt(ftpFileMatch[1]);

        if (currentUser.role === "customer") {
          return res.status(403).json({ message: "Customers cannot upload files" });
        }
        if (currentUser.role !== "admin") {
          const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
          if (!isAssigned) {
            return res.status(403).json({ message: "Forbidden" });
          }
        }

        const project = await storage.getProject(projectId);
        if (!project) {
          return res.status(404).json({ message: "Project not found" });
        }

        const allowedExtensionsSetting = await storage.getSetting("allowed_extensions");
        const allowedExtensions = allowedExtensionsSetting ? allowedExtensionsSetting.split(",").map(e => e.trim().toLowerCase()) : [".csv", ".xlsx", ".xls", ".txt"];
        const fileExtension = "." + session.fileName.split(".").pop()?.toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
          return res.status(400).json({ message: `File type ${fileExtension} not allowed. Allowed: ${allowedExtensions.join(", ")}` });
        }

        const savedPath = await saveProjectFtpFile(project.name, project.id, session.fileName, fileBuffer);
        emitFileAdded(projectId, undefined, currentUser?.id);
        return res.status(201).json({ message: "File uploaded", path: savedPath });

      } else {
        return res.status(400).json({ message: "Unsupported target URL" });
      }
    } catch (error) {
      console.error("Error finalizing chunked file upload:", error);
      res.status(500).json({ message: "Failed to finalize upload" });
    }
  });

  // ============================================================================
  // CHUNKED UPLOAD ENDPOINTS FOR SYSTEM RESTORE
  // These endpoints allow large files to be uploaded in chunks to avoid proxy timeouts
  // ============================================================================

  // Initialize a chunked upload session
  app.post("/api/system/restore/init", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canSystemRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_SYSTEM_RESTORE);
      if (!canSystemRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to restore system backups" });
      }

      const { fileName, totalChunks, clearExisting } = req.body;
      
      if (!fileName || !totalChunks || totalChunks < 1) {
        return res.status(400).json({ message: "Missing required fields: fileName, totalChunks" });
      }

      const uploadId = randomUUID();
      
      chunkedUploadSessions.set(uploadId, {
        userId: currentUser.id,
        fileName,
        totalChunks: parseInt(totalChunks),
        receivedChunks: new Map(),
        clearExisting: clearExisting === true || clearExisting === "true",
        createdAt: new Date(),
      });

      console.log(`[ChunkedUpload] Initialized session ${uploadId} for ${fileName} with ${totalChunks} chunks`);
      
      res.json({ 
        uploadId,
        message: "Upload session initialized",
        chunkSize: 5 * 1024 * 1024, // 5MB chunks
      });
    } catch (error) {
      console.error("Error initializing chunked upload:", error);
      res.status(500).json({ message: "Failed to initialize upload" });
    }
  });

  // Upload a single chunk
  app.post("/api/system/restore/chunk", isAuthenticated, chunkUpload.single("chunk"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { uploadId, chunkIndex } = req.body;
      
      if (!uploadId || chunkIndex === undefined) {
        return res.status(400).json({ message: "Missing required fields: uploadId, chunkIndex" });
      }

      const session = chunkedUploadSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ message: "Upload session not found or expired" });
      }

      if (session.userId !== currentUser.id) {
        return res.status(403).json({ message: "Forbidden: This upload session belongs to another user" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No chunk data provided" });
      }

      const index = parseInt(chunkIndex);
      if (isNaN(index) || index < 0 || index >= session.totalChunks) {
        return res.status(400).json({ message: `Invalid chunk index: ${chunkIndex}` });
      }

      session.receivedChunks.set(index, req.file.buffer);
      
      const receivedCount = session.receivedChunks.size;
      const progress = Math.round((receivedCount / session.totalChunks) * 100);
      
      console.log(`[ChunkedUpload] Session ${uploadId}: received chunk ${index + 1}/${session.totalChunks} (${progress}%)`);

      res.json({
        message: "Chunk received",
        chunkIndex: index,
        receivedChunks: receivedCount,
        totalChunks: session.totalChunks,
        progress,
        complete: receivedCount === session.totalChunks,
      });
    } catch (error) {
      console.error("Error uploading chunk:", error);
      res.status(500).json({ message: "Failed to upload chunk" });
    }
  });

  // Finalize the chunked upload and process the restore
  app.post("/api/system/restore/finalize", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canSystemRestore = await storage.hasPermission(currentUser, permissionKeys.MAINTENANCE_SYSTEM_RESTORE);
      if (!canSystemRestore) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to restore system backups" });
      }

      const { uploadId } = req.body;
      
      if (!uploadId) {
        return res.status(400).json({ message: "Missing required field: uploadId" });
      }

      const session = chunkedUploadSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ message: "Upload session not found or expired" });
      }

      if (session.userId !== currentUser.id) {
        return res.status(403).json({ message: "Forbidden: This upload session belongs to another user" });
      }

      if (session.receivedChunks.size !== session.totalChunks) {
        return res.status(400).json({ 
          message: `Incomplete upload: received ${session.receivedChunks.size} of ${session.totalChunks} chunks` 
        });
      }

      console.log(`[ChunkedUpload] Finalizing session ${uploadId}: assembling ${session.totalChunks} chunks`);

      // Assemble all chunks in order
      const chunks: Buffer[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        const chunk = session.receivedChunks.get(i);
        if (!chunk) {
          chunkedUploadSessions.delete(uploadId);
          return res.status(400).json({ message: `Missing chunk at index ${i}` });
        }
        chunks.push(chunk);
      }
      
      const fileBuffer = Buffer.concat(chunks);
      console.log(`[ChunkedUpload] Assembled file: ${fileBuffer.length} bytes from ${chunks.length} chunks`);
      
      // Clean up session
      chunkedUploadSessions.delete(uploadId);

      // Now process the restore (same logic as the regular restore endpoint)
      const fileName = session.fileName.toLowerCase();
      const isPlainSql = fileName.endsWith(".sql");
      
      // Handle plain .sql file upload
      if (isPlainSql) {
        console.log(`[Restore] Detected plain SQL file: ${session.fileName}`);
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const sqlPath = path.join(tempDir, `restore_${timestamp}.sql`);
        
        await fs.writeFile(sqlPath, fileBuffer);
        
        try {
          const dbResult = await restorePgBackup(sqlPath, { disableForeignKeys: true });
          
          if (!dbResult.success) {
            return res.status(500).json({
              message: "Database restore failed",
              error: dbResult.error,
              warnings: dbResult.warnings,
              filesRestored: 0,
            });
          }
          
          return res.json({
            message: "SQL restore completed successfully",
            format: "plain_sql",
            backupDate: new Date().toISOString(),
            filesRestored: 0,
            warnings: dbResult.warnings || [],
            errors: [],
          });
        } finally {
          if (existsSync(sqlPath)) {
            unlinkSync(sqlPath);
          }
        }
      }

      // Extract and detect backup format from archive
      const { sqlFile, metadata, legacyJson, foundFiles } = await extractBackupFromArchive(fileBuffer);
      
      // Handle webapp-files-only backup
      if (metadata?.format === "files_only" || metadata?.format === "webapp_files_only" || metadata?.backupType === "files") {
        console.log(`Restoring webapp-files-only backup from ${metadata.backupDate}`);
        const appDir = process.cwd();
        const filesResult = await restoreWebAppFilesFromArchive(fileBuffer, appDir);
        
        return res.json({
          message: "Webapp files-only restore completed",
          format: "webapp_files_only",
          backupDate: metadata.backupDate,
          filesRestored: filesResult.filesRestored,
          errors: filesResult.errors,
        });
      }
      
      // Handle project-files-only backup
      if (metadata?.format === "project_files_only" || metadata?.backupType === "project") {
        console.log(`Restoring project-files-only backup from ${metadata.backupDate}`);
        const filesPath = await getProjectFilesPath();
        const filesResult = await restoreFilesFromPgArchive(fileBuffer, filesPath);
        
        return res.json({
          message: "Project files-only restore completed",
          format: "project_files_only",
          backupDate: metadata.backupDate,
          filesRestored: filesResult.filesRestored,
          errors: filesResult.errors,
        });
      }
      
      // Handle SQL format backups
      if (sqlFile && (metadata?.format === "pg_dump_sql" || metadata?.format === "pg_dump_full" || metadata?.format === "pg_dump_clean" || metadata?.format === "full_system")) {
        const isCleanBackup = metadata?.format === "pg_dump_clean";
        const clearExisting = session.clearExisting;
        console.log(`Restoring SQL backup from ${metadata.backupDate}${isCleanBackup ? " (clean backup)" : ""}${clearExisting ? " (clearing existing data)" : ""}`);
        
        let filesResult = { filesRestored: 0, errors: [] as string[] };
        
        try {
          const dbResult = await restorePgBackup(sqlFile, { disableForeignKeys: true, isCleanBackup, clearExisting });

          if (!dbResult.success) {
            return res.status(500).json({
              message: "Database restore failed",
              success: false,
              error: dbResult.error,
              warnings: dbResult.warnings,
              filesRestored: 0,
            });
          }

          try {
            const filesPath = await getProjectFilesPath();
            filesResult = await restoreFilesFromPgArchive(fileBuffer, filesPath);
          } catch (error) {
            console.error("File restore failed after SQL database restore:", error);
            filesResult.errors.push("File restoration failed after the database was restored. Review the server logs before retrying.");
          }

          return res.json({
            message: filesResult.errors.length ? "Database restored; file restore incomplete" : isCleanBackup ? "Clean database restore completed" : "Full system restore completed (SQL format)",
            success: filesResult.errors.length === 0,
            databaseCommitted: true,
            format: metadata.format,
            backupDate: metadata.backupDate,
            schemas: metadata.schemas,
            filesRestored: filesResult.filesRestored,
            warnings: dbResult.warnings,
            errors: filesResult.errors,
          });
        } finally {
          if (sqlFile && existsSync(sqlFile)) {
            unlinkSync(sqlFile);
          }
        }
      }
      
      // Handle legacy JSON format
      if (legacyJson) {
        console.log(`Restoring legacy JSON backup from ${legacyJson.backupDate || "unknown date"}`);
        const filesPath = await getProjectFilesPath();
        
        const result = await restoreFullSystem(legacyJson, { clearExisting: session.clearExisting });
        const filesResult = await restoreFilesFromArchive(fileBuffer, filesPath);
        
        return res.json({
          message: filesResult.errors.length ? "Database restored; file restore incomplete" : "System restore completed (legacy format)",
          success: result.success && filesResult.errors.length === 0,
          databaseCommitted: result.databaseCommitted,
          format: "legacy_json",
          backupDate: legacyJson.backupDate,
          mainTablesRestored: result.mainTablesRestored,
          projectsRestored: result.projectsRestored,
          filesRestored: filesResult.filesRestored,
          errors: [...result.errors, ...result.projectErrors, ...filesResult.errors],
          warnings: result.warnings,
        });
      }
      
      // Unknown format
      const filesPreview = foundFiles.slice(0, 10).join(", ");
      const moreFiles = foundFiles.length > 10 ? ` and ${foundFiles.length - 10} more` : "";
      return res.status(400).json({ 
        message: `Invalid backup archive: could not find database_backup.sql or database_backup.json. Found files: ${filesPreview}${moreFiles}` 
      });
    } catch (error) {
      console.error("Error finalizing chunked upload:", error);
      if (error instanceof SystemRestoreError) return res.status(500).json({
        message: error.databaseCommitted ? "Database restored, but audit verification failed. Restore incomplete; contact your administrator before resuming work." : "System database restore failed. No restored database rows were committed; review the server logs before retrying.",
        success: false, databaseCommitted: error.databaseCommitted,
      });
      res.status(500).json({ message: "Failed to finalize restore" });
    }
  });

  // Get upload session status
  app.get("/api/system/restore/status/:uploadId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const session = chunkedUploadSessions.get(req.params.uploadId);
      if (!session) {
        return res.status(404).json({ message: "Upload session not found or expired" });
      }

      if (session.userId !== currentUser.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      res.json({
        fileName: session.fileName,
        totalChunks: session.totalChunks,
        receivedChunks: session.receivedChunks.size,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100),
        complete: session.receivedChunks.size === session.totalChunks,
      });
    } catch (error) {
      console.error("Error getting upload status:", error);
      res.status(500).json({ message: "Failed to get upload status" });
    }
  });

  // ============================================================================
  // MOBILE SYNC API ENDPOINTS
  // These endpoints support mobile apps with offline capability
  // ============================================================================

  // Mobile sync download - bulk fetch work orders for offline cache
  // Supports filters and last-sync timestamp for incremental sync
  app.get("/api/projects/:projectId/mobile/sync/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // For customer role: Block access until proper tenant mapping is configured
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Forbidden: Customer portal configuration required" });
      }
      
      const projectId = parseInt(req.params.projectId);
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Field dispatch is restricted to the technician's personally assigned Scheduled work.
      let isFieldTechnician = false;
      if (currentUser.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician" && !await storage.isAdminUser(currentUser)) {
          isFieldTechnician = true;
        }
      }
      
      // Parse query parameters for filtering
      // Note: includeCompleted is intentionally NOT supported - mobile users must NEVER receive Closed or Completed work orders
      const {
        lastSyncTimestamp,
        assignedUserId,
        assignedGroupId,
        status,
        limit,
        offset
      } = req.query;
      
      // Build query with filters
      const client = await pool.connect();
      try {
        let query = `
          SELECT w.*, 
                 sb.username as scheduled_by_username,
                 cb.username as completed_by_username,
                 au.username as assigned_user_username,
                 COALESCE(au.first_name || ' ' || au.last_name, au.username) as assigned_user_display_name
          FROM "${project.databaseName}".work_orders w
          LEFT JOIN public.users sb ON w.scheduled_by = sb.id
          LEFT JOIN public.users cb ON w.completed_by = cb.id
          LEFT JOIN public.users au ON w.assigned_user_id = au.id
        `;
        const conditions: string[] = [];
        const values: any[] = [];
        let paramCount = 1;
        
        // Keep mobile dispatch in the same personally assigned Scheduled scope as the grid.
        if (isFieldTechnician) {
          conditions.push(`w.assigned_user_id = $${paramCount++}`);
          values.push(currentUser.id);
          conditions.push(`w.status = 'Scheduled'`);
        }
        
        // Filter by last sync timestamp (incremental sync)
        if (lastSyncTimestamp) {
          conditions.push(`w.updated_at > $${paramCount++}`);
          values.push(new Date(lastSyncTimestamp as string));
        }
        
        // Filter by assigned user (only applies if not overridden by field tech filter)
        if (assignedUserId && !isFieldTechnician) {
          conditions.push(`w.assigned_user_id = $${paramCount++}`);
          values.push(assignedUserId);
        }
        
        // Filter by assigned group (only applies if not overridden by field tech filter)
        if (assignedGroupId && !isFieldTechnician) {
          conditions.push(`w.assigned_group_id = $${paramCount++}`);
          values.push(assignedGroupId);
        }
        
        // Filter by status
        if (status) {
          conditions.push(`w.status = $${paramCount++}`);
          values.push(status);
        }
        
        // CRITICAL: Mobile users must NEVER receive Closed or Completed work orders
        // This filter is always applied - there is no option to override it
        conditions.push(`LOWER(w.status) NOT IN ('completed', 'closed')`);
        
        if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(" AND ")}`;
        }
        
        query += " ORDER BY w.updated_at DESC";
        
        // Apply pagination
        if (limit) {
          query += ` LIMIT $${paramCount++}`;
          values.push(parseInt(limit as string));
        }
        if (offset) {
          query += ` OFFSET $${paramCount++}`;
          values.push(parseInt(offset as string));
        }
        
        const result = await client.query(query, values);
        
        // Get server timestamp for client to use in next sync
        const serverTimestamp = new Date().toISOString();
        
        // Get reference data for offline use (including assignees)
        const [workOrderStatuses, troubleCodes, systemTypes, moduleTypes, serviceTypes, projectUsers, allGroupsWithProjects] = await Promise.all([
          storage.getWorkOrderStatuses(),
          storage.getTroubleCodes(),
          storage.getSystemTypes(),
          storage.getModuleTypes(),
          storage.getServiceTypes(),
          storage.getProjectUsers(projectId),
          storage.getAllUserGroupsWithProjects()
        ]);
        
        // Format assignees for offline use
        const users = projectUsers.map(user => ({
          type: "user" as const,
          id: user.id,
          label: user.firstName && user.lastName 
            ? `${user.firstName} ${user.lastName}`
            : user.username || user.email || user.id,
          username: user.username,
        }));
        
        const projectGroupsList = allGroupsWithProjects.filter(group => 
          group.projectIds.includes(projectId)
        );
        
        const groups = projectGroupsList.map(group => ({
          type: "group" as const,
          id: `group:${group.id}`,
          label: group.name,
          key: group.name,
        }));
        if (project.inventoryEnabled && !await storage.hasPermission(currentUser, "inventory.view"))
          return res.status(403).json({ message: "Inventory view permission is required to sync inventory-enabled projects." });
        const inventoryAdmin = project.inventoryEnabled && await storage.isAdminUser(currentUser);
        if (project.inventoryEnabled && !inventoryAdmin && !await storage.isUserAssignedToProject(currentUser.id, projectId))
          return res.status(403).json({ message: "You are not assigned to this inventory project." });
        const inv = project.inventoryEnabled ? await inventoryState(projectId) : null;
        
        res.json({
          success: true,
          serverTimestamp,
          workOrders: withExactReadings(result.rows).map((wo: any) => ({ ...wo,
            ...schedulingDto(wo),
            subStatusId: wo.sub_status_id ?? null,
            ...(inv ? { inventoryAllocation: inv.allocations.find(a => a.workOrderId === wo.id) || null } : {}) })),
          inventory: { contractVersion: 1, enabled: !!inv, items: inv?.items || [],
            locationTypes: inv?.locationTypes || [],
            ...(inv ? { removalContractVersion: 1, removalRules: removalConfig(inv).rules,
              removalPolicies: [removalConfig(inv).policy],
              workflow: { wizardMode: project.wizardMode ?? "changeout", equipment: project.changeoutEquipmentType ?? "both", readingEquipment: project.readingEquipmentType ?? "both" } } : {}),
            warehouses: inv?.warehouses.filter(w => warehouseAccessible(inv, w, currentUser.id, inventoryAdmin)) || [] },
          referenceData: {
            workOrderStatuses,
            workOrderSubStatuses: await listSubStatuses(projectId),
            troubleCodes,
            systemTypes,
            moduleTypes,
            serviceTypes,
            assignees: { users, groups }
          },
          meta: {
            count: result.rows.length,
            projectId,
            projectName: project.name,
            visitSchedulingContractVersion: 1,
            timezone: project.timezone || await storage.getSetting("default_timezone") || "America/Denver",
            defaultServiceMinutes: project.defaultServiceMinutes ?? null,
            defaultAppointmentToleranceMinutes: project.defaultAppointmentToleranceMinutes ?? null
          }
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error in mobile sync download:", error);
      res.status(500).json({ message: "Failed to download work orders for sync" });
    }
  });

  // Mobile sync upload - batch submit completed work orders with conflict detection
  app.post("/api/projects/:projectId/mobile/sync/upload", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrders, clientSyncTimestamp } = req.body;
      
      if (!Array.isArray(workOrders)) {
        return res.status(400).json({ message: "workOrders must be an array" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      const results: { id: number; status: string; conflict?: boolean; message?: string; serverUpdatedAt?: Date | null; code?: string; errors?: ReadingValidationError[] }[] = [];
      
      for (const woUpdate of workOrders) {
        try {
          const { id, clientUpdatedAt, forceOverwrite, ...updateData } = woUpdate;
          for (const [camel, snake] of [["serviceDurationMinutes","service_duration_minutes"],
            ["appointmentWindowStart","appointment_window_start"],["appointmentWindowEnd","appointment_window_end"]]) {
            if (Object.hasOwn(updateData, snake)) {
              if (updateData[camel] !== undefined && updateData[camel] !== updateData[snake]) throw new Error("Conflicting visit scheduling values.");
              updateData[camel] = updateData[snake];
              delete updateData[snake];
            }
          }
          if (visitSchedulingKeys.some(key => Object.hasOwn(updateData, key)) &&
              !await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_EDIT))
            throw new Error("Edit Work Orders permission is required to edit visit scheduling.");
          if (Object.prototype.hasOwnProperty.call(updateData, "sub_status_id")) {
            if (updateData.subStatusId !== undefined && updateData.subStatusId !== updateData.sub_status_id)
              throw new Error("Conflicting sub-status identifiers.");
            updateData.subStatusId = updateData.sub_status_id;
            delete updateData.sub_status_id;
          }
          
          // Get current server version
          const serverWorkOrder = await workOrderStorage.getWorkOrder(id);
          
          if (!serverWorkOrder) {
            results.push({ id, status: "error", message: "Work order not found" });
            continue;
          }
          const readingErrors = validateCapturedReadings(updateData, project, serverWorkOrder);
          if (readingErrors.length) {
            results.push({ id, status: "error", ...readingValidationResponse(readingErrors) });
            continue;
          }
          
          // Check for conflicts - if server version is newer than client's last known version
          const serverUpdatedAt = serverWorkOrder.updatedAt ? new Date(serverWorkOrder.updatedAt).getTime() : 0;
          const clientLastKnown = clientUpdatedAt ? new Date(clientUpdatedAt).getTime() : 0;
          
          if (clientLastKnown > 0 && serverUpdatedAt > clientLastKnown && !forceOverwrite) {
            // Conflict detected - server has newer data, reject the update
            results.push({ 
              id, 
              status: "conflict", 
              conflict: true,
              message: "Server has newer data - please sync and retry. Use forceOverwrite:true to override.",
              serverUpdatedAt: serverWorkOrder.updatedAt
            });
            continue; // Skip this update - don't overwrite server data
          }
          
          // Apply the update
          await workOrderStorage.updateWorkOrder(
            id,
            updateData,
            updatedByUsername
          );
          
          // Emit SSE event to notify other connected clients
          emitWorkOrderUpdated(projectId, id, currentUser.id);
          
          results.push({ id, status: "success" });
        } catch (error) {
          console.error(`Error updating work order ${woUpdate.id}:`, error);
          results.push({ id: woUpdate.id, status: "error",
            ...(error instanceof InventoryError ? { code: "INVENTORY_CONFLICT" } : {}),
            message: error instanceof InventoryError ? error.message : String(error) });
        }
      }
      
      // Get updated server timestamp
      const serverTimestamp = new Date().toISOString();
      
      res.json({
        success: true,
        serverTimestamp,
        results,
        summary: {
          total: workOrders.length,
          successful: results.filter(r => r.status === "success").length,
          conflicts: results.filter(r => r.status === "conflict").length,
          errors: results.filter(r => r.status === "error").length
        }
      });
    } catch (error) {
      console.error("Error in mobile sync upload:", error);
      res.status(500).json({ message: "Failed to upload work order changes" });
    }
  });

  // Mobile photo upload - upload photos for work orders (supports offline queue)
  app.post("/api/projects/:projectId/mobile/work-orders/:workOrderId/photos", isAuthenticated, upload.array("photos", 20), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const files = req.files as Express.Multer.File[];
      const photoTypes = JSON.parse(req.body.photoTypes || "[]");
      
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No photos provided" });
      }
      
      // Validate photo types
      const validTypes = ["trouble", "before", "after", "signature"];
      for (const pType of photoTypes) {
        if (!validTypes.includes(pType)) {
          return res.status(400).json({ message: `Invalid photo type: ${pType}` });
        }
      }
      
      // Get work order folder
      const folderName = workOrder.customerWoId || String(workOrder.id);
      const projectFilesPath = await getProjectFilesPath();
      const projectDirName = getProjectDirectoryName(project.name, project.id);
      const workOrderFolder = path.join(
        projectFilesPath,
        projectDirName,
        "Work Orders",
        folderName
      );
      
      // Create folders for each photo type
      const savedPhotos: { filename: string; type: string; path: string }[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const photoType = photoTypes[i] || "photo";
        const typeFolder = path.join(workOrderFolder, photoType);
        
        await fs.mkdir(typeFolder, { recursive: true });
        
        // Generate unique filename
        const timestamp = Date.now();
        const ext = path.extname(file.originalname) || ".jpg";
        const filename = `${photoType}_${timestamp}_${i}${ext}`;
        const filePath = path.join(typeFolder, filename);
        
        await fs.writeFile(filePath, file.buffer);
        
        savedPhotos.push({
          filename,
          type: photoType,
          path: `${photoType}/${filename}`
        });
      }
      
      res.json({
        success: true,
        uploadedPhotos: savedPhotos,
        workOrderId,
        message: `${files.length} photo(s) uploaded successfully`
      });
    } catch (error) {
      console.error("Error uploading mobile photos:", error);
      res.status(500).json({ message: "Failed to upload photos" });
    }
  });

  // Mobile signature upload - upload signature image for work order
  app.post("/api/projects/:projectId/mobile/work-orders/:workOrderId/signature", isAuthenticated, upload.single("signature"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const { signatureName, signatureData } = req.body;
      
      // Handle either file upload or base64 data
      let signatureImageData: string | null = null;
      
      if (req.file) {
        // Convert file to base64
        signatureImageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      } else if (signatureData) {
        signatureImageData = signatureData;
      }
      
      if (!signatureImageData && !signatureName) {
        return res.status(400).json({ message: "Signature data or signature name required" });
      }
      
      // Update work order with signature
      const updatedByUsername = currentUser.username || currentUser.id;
      const updateData: any = {};
      
      if (signatureImageData) {
        updateData.signatureData = signatureImageData;
      }
      if (signatureName) {
        updateData.signatureName = signatureName;
      }
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      res.json({
        success: true,
        workOrderId,
        signatureName: updatedWorkOrder?.signatureName || signatureName,
        message: "Signature saved successfully"
      });
    } catch (error) {
      console.error("Error uploading mobile signature:", error);
      res.status(500).json({ message: "Failed to upload signature" });
    }
  });

  // Mobile system changeout - complete a system changeout from mobile device
  app.post("/api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout", isAuthenticated, upload.array("photos", 20), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Parse changeout data from request
      const changeoutData = JSON.parse(req.body.data || "{}");
      const {
        canChange,
        troubleCode,
        troubleNote,
        oldSystemReading,
        newSystemId,
        newSystemReading,
        gpsCoordinates,
        signatureData,
        signatureName,
        photoTypes,
        completedAt: clientCompletedAt,
        isReadingOnly,
        changeoutScope
      } = changeoutData;
      
      // Determine scope from explicit changeoutScope or fall back to work order data
      const woAny = workOrder as any;
      const hasSystemData = !!workOrder.oldSystemId || !!woAny.old_system_id;
      const hasModuleData = !!workOrder.oldModuleId || !!woAny.old_module_id;
      const needsSystem = changeoutScope ? (changeoutScope === "system" || changeoutScope === "both") : hasSystemData;
      const needsModule = changeoutScope ? (changeoutScope === "module" || changeoutScope === "both") : hasModuleData;
      
      const files = req.files as Express.Multer.File[];
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      // Validation (numeric - integers or decimals, 0 is valid)
      const isValidSystemReading = (reading: string | number | null | undefined): boolean => {
        if (reading === null || reading === undefined) return false;
        const str = String(reading).trim();
        if (str.length === 0) return false;
        return /^\d+(\.\d+)?$/.test(str);
      };
      
      // Helper to check if a reading value is present (null/undefined/empty string = not present, 0 = present)
      const hasReadingValue = (value: any): boolean => {
        return value !== null && value !== undefined && value !== "";
      };
      
      const isValidGps = (gps: string): boolean => {
        if (!gps || !gps.trim()) return false;
        const match = gps.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (!match) return false;
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      };
      
      const updatedByUsername = currentUser.username || currentUser.id;
      const updateData: any = {
        updatedAt: new Date().toISOString(),
      };
      if (canChange) {
        const readingErrors = validateCapturedReadings({ oldSystemReading, newSystemReading }, project, workOrder);
        if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));
      }
      
      // Save photos if provided
      if (files && files.length > 0) {
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const photoType = (photoTypes && photoTypes[i]) || "photo";
          const typeFolder = path.join(workOrderFolder, photoType);
          
          await fs.mkdir(typeFolder, { recursive: true });
          
          const timestamp = Date.now();
          const ext = path.extname(file.originalname) || ".jpg";
          const filename = `${photoType}_${timestamp}_${i}${ext}`;
          const filePath = path.join(typeFolder, filename);
          
          await fs.writeFile(filePath, file.buffer);
        }
      }
      
      if (canChange) {
        // Success path - system was changed (use hasReadingValue for readings to allow 0)
        if (!hasReadingValue(oldSystemReading) || !newSystemId || !hasReadingValue(newSystemReading) || !gpsCoordinates || !signatureName) {
          return res.status(400).json({ 
            message: "Missing required fields for system changeout" 
          });
        }
        
        if (!isValidSystemReading(oldSystemReading)) {
          return res.status(400).json({ message: "Old system reading must be a valid number" });
        }
        if (!isValidSystemReading(newSystemReading)) {
          return res.status(400).json({ message: "New system reading must be a valid number" });
        }
        if (!isValidGps(gpsCoordinates)) {
          return res.status(400).json({ message: "Invalid GPS coordinates format" });
        }
        
        updateData.status = "Completed";
        updateData.oldSystemReading = String(oldSystemReading).trim();
        updateData.newSystemId = newSystemId;
        updateData.newSystemReading = String(newSystemReading).trim();
        updateData.newGps = gpsCoordinates;
        updateData.signatureName = signatureName;
        updateData.completedAt = clientCompletedAt || new Date().toISOString();
        updateData.completedBy = currentUser.id;
        updateData.trouble = null;
        // Always add completion report header (similar to Trouble Report format)
        const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
        const reportType = isReadingOnly ? "Reading Report" : "Changeout Report";
        const noteEntry = troubleNote && troubleNote.trim()
          ? `[${reportType} - ${timestamp}]\n${troubleNote.trim()}`
          : `[${reportType} - ${timestamp}]`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
        
        if (signatureData) {
          updateData.signatureData = signatureData;
        }
      } else {
        // Trouble path - could not change system
        if (!troubleCode) {
          return res.status(400).json({ message: "Trouble code is required" });
        }
        
        // Look up trouble code details for the note
        const allTroubleCodes = await storage.getTroubleCodes();
        const troubleCodeDetails = allTroubleCodes.find(tc => tc.code === troubleCode);
        const troubleCodeLabel = troubleCodeDetails?.label || troubleCode;
        
        updateData.status = "Trouble";
        updateData.trouble = troubleCode;
        // Append trouble notes to existing notes (mobile pattern)
        const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
        const troubleCodeLine = `Trouble Code: ${troubleCode} - ${troubleCodeLabel} - ${timestamp} by ${currentUser.username || currentUser.id}`;
        const noteEntry = troubleNote && troubleNote.trim()
          ? `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}\n${troubleNote.trim()}`
          : `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
      }
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.completed", updatedWorkOrder, currentUser);
      
      // Customer delivery is recorded transactionally by updateWorkOrder.
      
      // Emit SSE event to notify other connected clients
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: canChange ? "System changeout completed successfully" : "Trouble reported successfully"
      });
    } catch (error) {
      console.error("Error completing mobile system changeout:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: "Failed to complete system changeout" });
    }
  });

  // ========== NEW MOBILE ENDPOINTS (JSON with base64 photos) ==========
  // These endpoints match what the mobile app expects: /api/mobile/workorders/:id/trouble and /api/mobile/workorders/:id/complete
  
  // Mobile trouble endpoint - accepts JSON with base64 photos
  app.post("/api/mobile/workorders/:workOrderId/trouble", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { projectId, troubleCode, notes, oldSystemReading, photos } = req.body;
      
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }
      
      if (!troubleCode) {
        return res.status(400).json({ message: "troubleCode is required" });
      }
      
      // Validate trouble code exists
      const troubleCodes = await storage.getTroubleCodes();
      const validTroubleCode = troubleCodes.find(tc => tc.code === troubleCode);
      if (!validTroubleCode) {
        return res.status(400).json({ message: `Invalid trouble code: ${troubleCode}` });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      // Must be assigned to project (unless admin)
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const folderName = workOrder.customerWoId || String(workOrder.id);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      // Save photos if provided (base64 encoded) - always rename to standard format
      const readingErrors = validateCapturedReadings({ oldSystemReading }, project, workOrder);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));

      if (photos && Array.isArray(photos) && photos.length > 0) {
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        // Generate date string in YYYYMMDD format
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0');
        
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          if (photo.base64) {
            // Remove data URL prefix if present
            let base64Data = photo.base64;
            if (base64Data.includes(",")) {
              base64Data = base64Data.split(",")[1];
            }
            
            const buffer = Buffer.from(base64Data, "base64");
            // Use randomUUID() for guaranteed unique collision-proof naming
            const uniqueId = randomUUID();
            // Use standardized filename: {customerWoId}-trouble-{YYYYMMDD}-{uniqueId}.jpg
            const filename = `${folderName}-trouble-${dateStr}-${uniqueId}.jpg`;
            const filePath = path.join(workOrderFolder, filename);
            await fs.writeFile(filePath, buffer);
          }
        }
      }
      
      // Build update data - troubleCode triggers auto-generated trouble note in updateWorkOrder
      const updateData: any = {
        status: "Trouble",
        trouble: troubleCode,
        updatedAt: new Date().toISOString(),
      };
      
      // Append user notes to existing notes (mobile pattern) - don't replace
      // Use project timezone if set, otherwise UTC
      const projectTimezone = project.timezone || 'UTC';
      const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: projectTimezone
      });
      
      // Build trouble note entry with header, trouble code line, then user notes
      const troubleCodeLine = `Trouble Code: ${validTroubleCode.code} - ${validTroubleCode.label} - ${timestamp} by ${currentUser.username || currentUser.id}`;
      const noteEntry = notes && notes.trim()
        ? `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}\n${notes.trim()}`
        : `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}`;
      updateData.notes = workOrder.notes 
        ? `${workOrder.notes}\n\n${noteEntry}`
        : noteEntry;
      
      if (oldSystemReading !== undefined && oldSystemReading !== null && oldSystemReading !== "") {
        updateData.oldSystemReading = String(oldSystemReading).trim();
      }
      
      // The trouble code is included in updateData.trouble, which triggers auto-generated trouble note in updateWorkOrder
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.trouble", updatedWorkOrder, currentUser);
      
      // Emit SSE event to notify dashboard users
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: "Trouble reported successfully"
      });
    } catch (error: any) {
      console.error("Error in mobile trouble endpoint:", error);
      res.status(500).json({ message: error.message || "Failed to report trouble" });
    }
  });

  // Mobile complete endpoint - accepts JSON with base64 photos
  app.post("/api/mobile/workorders/:workOrderId/complete", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const {
        projectId,
        oldSystemReading,
        newSystemReading,
        newSystemId,
        newSystemType,
        oldModuleReading,
        oldModuleRead, // Alternative field name from mobile
        newModuleReading,
        newModuleRead, // Alternative field name from mobile
        newModuleId,
        oldModuleType,
        newModuleType,
        gpsCoordinates,
        signatureData,
        signatureName,
        completedAt,
        notes,
        beforePhotos,
        afterPhotos,
        isReadingOnly, // true if reading-only mode
        changeoutScope, // "system", "module", or "both" - explicit scope from request
      } = req.body;
      
      // Normalize module reading field names (mobile may send oldModuleRead/newModuleRead instead of oldModuleReading/newModuleReading)
      const effectiveOldModuleReading = oldModuleReading ?? oldModuleRead;
      const effectiveNewModuleReading = newModuleReading ?? newModuleRead;
      
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      // Must be assigned to project (unless admin)
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const folderName = workOrder.customerWoId || String(workOrder.id);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      // Helper to save base64 photos - always rename to standard format with date and timestamp
      const readingErrors = validateCapturedReadings({
        newSystemReading, newModuleReading: effectiveNewModuleReading,
        ...(!isReadingOnly ? { oldSystemReading, oldModuleReading: effectiveOldModuleReading } : {}),
      }, project, workOrder);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));

      const saveBase64Photos = async (photos: any[], photoType: string) => {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return;
        
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        // Generate date string in YYYYMMDD format
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0');
        
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          if (photo.base64) {
            // Remove data URL prefix if present
            let base64Data = photo.base64;
            if (base64Data.includes(",")) {
              base64Data = base64Data.split(",")[1];
            }
            
            const buffer = Buffer.from(base64Data, "base64");
            // Use randomUUID() for guaranteed unique collision-proof naming
            const uniqueId = randomUUID();
            // Use standardized filename: {customerWoId}-{type}-{YYYYMMDD}-{uniqueId}.jpg
            const filename = `${folderName}-${photoType}-${dateStr}-${uniqueId}.jpg`;
            const filePath = path.join(workOrderFolder, filename);
            await fs.writeFile(filePath, buffer);
          }
        }
      };
      
      // Save before photos
      await saveBase64Photos(beforePhotos, "before");
      
      // Save after photos
      await saveBase64Photos(afterPhotos, "after");
      
      // Save signature if provided
      if (signatureData) {
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        let sigBase64 = signatureData;
        if (sigBase64.includes(",")) {
          sigBase64 = sigBase64.split(",")[1];
        }
        
        const sigBuffer = Buffer.from(sigBase64, "base64");
        const sigFilename = `${folderName}-signature.png`;
        const sigFilePath = path.join(workOrderFolder, sigFilename);
        await fs.writeFile(sigFilePath, sigBuffer);
      }
      
      // Validation for system changeout completion (numeric - integers or decimals)
      const isValidSystemReading = (reading: any): boolean => {
        if (reading === undefined || reading === null) return false;
        const str = String(reading).trim();
        return str.length > 0 && /^\d+(\.\d+)?$/.test(str);
      };
      
      const isValidGps = (gps: string): boolean => {
        if (!gps || !gps.trim()) return false;
        const match = gps.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (!match) return false;
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      };
      
      // Determine changeout scope from explicit changeoutScope or fall back to work order data
      // Use type assertion for snake_case fallbacks (legacy imports may use snake_case)
      const woAny = workOrder as any;
      const hasSystemData = !!workOrder.oldSystemId || !!woAny.old_system_id;
      const hasModuleData = !!workOrder.oldModuleId || !!woAny.old_module_id;
      // For validation, use work order data; for notes prefix, honor explicit scope if provided
      const needsSystem = changeoutScope ? (changeoutScope === "system" || changeoutScope === "both") : hasSystemData;
      const needsModule = changeoutScope ? (changeoutScope === "module" || changeoutScope === "both") : hasModuleData;
      
      // Validate required fields for completion based on scope
      if (needsSystem) {
        if (!isValidSystemReading(oldSystemReading)) {
          return res.status(400).json({ message: "oldSystemReading is required and must be numeric" });
        }
        if (!newSystemId) {
          return res.status(400).json({ message: "newSystemId is required for completion" });
        }
        if (!isValidSystemReading(newSystemReading)) {
          return res.status(400).json({ message: "newSystemReading is required and must be numeric" });
        }
      }
      
      if (needsModule) {
        if (!isValidSystemReading(effectiveOldModuleReading)) {
          return res.status(400).json({ message: "oldModuleReading is required and must be numeric" });
        }
        if (!newModuleId) {
          return res.status(400).json({ message: "newModuleId is required for module changeout" });
        }
        if (!isValidSystemReading(effectiveNewModuleReading)) {
          return res.status(400).json({ message: "newModuleReading is required and must be numeric" });
        }
      }
      
      if (gpsCoordinates && !isValidGps(gpsCoordinates)) {
        return res.status(400).json({ message: "Invalid GPS coordinates format. Use 'lat,lng' format" });
      }
      
      // Build update data - clear scheduledAt since status is changing to Completed
      const updateData: any = {
        status: "Completed",
        trouble: null,
        updatedAt: new Date().toISOString(),
        completedAt: completedAt || new Date().toISOString(),
        completedBy: currentUser.id,
        scheduledAt: null,
      };
      
      // System fields - only set if this is a system or both changeout
      if (needsSystem) {
        if (oldSystemReading !== undefined && oldSystemReading !== null) {
          updateData.oldSystemReading = String(oldSystemReading).trim();
        }
        if (newSystemReading !== undefined && newSystemReading !== null) {
          updateData.newSystemReading = String(newSystemReading).trim();
        }
        if (newSystemId) {
          updateData.newSystemId = newSystemId;
        }
        if (newSystemType) {
          updateData.newSystemType = newSystemType;
        } else if (isReadingOnly) {
          // In Reading Only mode, copy old system type to new system type if mobile doesn't provide it
          const existingOldType = (workOrder as any).oldSystemType || (workOrder as any).old_system_type;
          if (existingOldType) {
            updateData.newSystemType = existingOldType;
          }
        }
      }
      
      // Module fields - only set if this is a module or both changeout
      if (needsModule) {
        if (effectiveOldModuleReading !== undefined && effectiveOldModuleReading !== null) {
          updateData.oldModuleRead = String(effectiveOldModuleReading).trim();
        }
        if (effectiveNewModuleReading !== undefined && effectiveNewModuleReading !== null) {
          updateData.newModuleRead = String(effectiveNewModuleReading).trim();
        }
        if (newModuleId) {
          updateData.newModuleId = newModuleId;
        }
        if (oldModuleType) {
          updateData.oldModuleType = oldModuleType;
        }
        if (newModuleType) {
          updateData.newModuleType = newModuleType;
        } else if (isReadingOnly) {
          // In Reading Only mode, copy old module type to new module type if mobile doesn't provide it
          const existingOldModType = (workOrder as any).oldModuleType || (workOrder as any).old_module_type;
          if (existingOldModType) {
            updateData.newModuleType = existingOldModType;
          }
        }
      }
      
      if (gpsCoordinates) {
        updateData.newGps = gpsCoordinates;
      }
      if (signatureName) {
        updateData.signatureName = signatureName;
      }
      if (signatureData) {
        updateData.signatureData = signatureData;
      }
      // Always add completion report header (similar to Trouble Report format)
      const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
      const reportType = isReadingOnly ? "Reading Report" : "Changeout Report";
      const noteEntry = notes && notes.trim()
        ? `[${reportType} - ${timestamp}]\n${notes.trim()}`
        : `[${reportType} - ${timestamp}]`;
      updateData.notes = workOrder.notes 
        ? `${workOrder.notes}\n\n${noteEntry}`
        : noteEntry;
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.completed", updatedWorkOrder, currentUser);
      
      // Customer delivery is recorded transactionally by updateWorkOrder.
      
      // Emit SSE event to notify dashboard users
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: "System changeout completed successfully"
      });
    } catch (error: any) {
      console.error("Error in mobile complete endpoint:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: error.message || "Failed to complete system changeout" });
    }
  });

  // Project-scoped mobile trouble endpoint - accepts both camelCase and snake_case field names
  // This endpoint uses projectId in URL for per-project integrity
  app.post("/api/mobile/projects/:projectId/work-orders/:workOrderId/trouble", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Normalize field names - accept both camelCase and snake_case
      const body = req.body;
      const troubleCode = body.troubleCode ?? body.trouble_code;
      const notes = body.notes;
      const oldSystemReading = body.oldSystemReading ?? body.old_system_reading;
      const photos = body.photos ?? [];
      
      if (!troubleCode) {
        return res.status(400).json({ message: "troubleCode is required" });
      }
      
      // Validate trouble code exists
      const troubleCodes = await storage.getTroubleCodes();
      const validTroubleCode = troubleCodes.find(tc => tc.code === troubleCode);
      if (!validTroubleCode) {
        return res.status(400).json({ message: `Invalid trouble code: ${troubleCode}` });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      // Must be assigned to project (unless admin)
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const folderName = workOrder.customerWoId || String(workOrder.id);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      // Save photos if provided (base64 encoded)
      const readingErrors = validateCapturedReadings(
        workOrder.oldSystemId || (workOrder as any).old_system_id ? { oldSystemReading } : {},
        project, workOrder,
      );
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));

      if (photos && Array.isArray(photos) && photos.length > 0) {
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0');
        
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          if (photo.base64) {
            let base64Data = photo.base64;
            if (base64Data.includes(",")) {
              base64Data = base64Data.split(",")[1];
            }
            
            const buffer = Buffer.from(base64Data, "base64");
            const uniqueId = randomUUID();
            const filename = `${folderName}-trouble-${dateStr}-${uniqueId}.jpg`;
            const filePath = path.join(workOrderFolder, filename);
            await fs.writeFile(filePath, buffer);
          }
        }
      }
      
      // Build update data - clear scheduledAt since status is changing to Trouble
      const updateData: any = {
        status: "Trouble",
        trouble: troubleCode,
        updatedAt: new Date().toISOString(),
        scheduledAt: null,
      };
      
      // Append user notes to existing notes
      const projectTimezone = project.timezone || 'UTC';
      const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: projectTimezone
      });
      
      // Build trouble note entry with header, trouble code line, then user notes
      const troubleCodeLine = `Trouble Code: ${validTroubleCode.code} - ${validTroubleCode.label} - ${timestamp} by ${currentUser.username || currentUser.id}`;
      const noteEntry = notes && notes.trim()
        ? `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}\n${notes.trim()}`
        : `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleCodeLine}`;
      updateData.notes = workOrder.notes 
        ? `${workOrder.notes}\n\n${noteEntry}`
        : noteEntry;
      
      // Only set system reading if this work order has system data (not module-only)
      const woAny = workOrder as any;
      const needsSystem = !!workOrder.oldSystemId || !!woAny.old_system_id;
      if (needsSystem && oldSystemReading !== undefined && oldSystemReading !== null && oldSystemReading !== "") {
        updateData.oldSystemReading = String(oldSystemReading).trim();
      }
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.trouble", updatedWorkOrder, currentUser);
      
      // Emit SSE event to notify dashboard users
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: "Trouble reported successfully"
      });
    } catch (error: any) {
      console.error("Error in project-scoped mobile trouble endpoint:", error);
      res.status(500).json({ message: error.message || "Failed to report trouble" });
    }
  });

  // Project-scoped mobile complete endpoint - accepts both camelCase and snake_case field names
  // This endpoint uses projectId in URL for per-project integrity
  app.post("/api/mobile/projects/:projectId/work-orders/:workOrderId/complete", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Normalize field names - accept both camelCase and snake_case
      const body = req.body;
      const oldSystemReading = body.oldSystemReading ?? body.old_system_reading;
      const newSystemReading = body.newSystemReading ?? body.new_system_reading;
      const newSystemId = body.newSystemId ?? body.new_system_id;
      const newSystemType = body.newSystemType ?? body.new_system_type;
      const oldModuleReading = body.oldModuleReading ?? body.oldModuleRead ?? body.old_module_reading ?? body.old_module_read;
      const newModuleReading = body.newModuleReading ?? body.newModuleRead ?? body.new_module_reading ?? body.new_module_read;
      const newModuleId = body.newModuleId ?? body.new_module_id;
      const oldModuleType = body.oldModuleType ?? body.old_module_type;
      const newModuleType = body.newModuleType ?? body.new_module_type;
      const gpsCoordinates = body.gpsCoordinates ?? body.new_gps ?? body.old_gps;
      const signatureData = body.signatureData ?? body.signature_data;
      const signatureName = body.signatureName ?? body.signature_name;
      const completedAt = body.completedAt ?? body.completed_at;
      const notes = body.notes;
      const beforePhotos = body.beforePhotos ?? body.before_photos ?? [];
      const afterPhotos = body.afterPhotos ?? body.after_photos ?? [];
      const changeoutScope = body.changeoutScope ?? body.changeout_scope;
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform system changeouts" });
      }
      
      // Must be assigned to project (unless admin)
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const folderName = workOrder.customerWoId || String(workOrder.id);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      // Determine isReadingOnly from request or infer from project configuration
      // Project wizardMode: "changeout", "reading_only", or "user_choice"
      const requestIsReadingOnly = body.isReadingOnly ?? body.is_reading_only;
      const projectWizardMode = (project as any).wizardMode || (project as any).wizard_mode;
      const isReadingOnly = requestIsReadingOnly !== undefined 
        ? requestIsReadingOnly 
        : (projectWizardMode === "reading_only");
      const readingErrors = validateCapturedReadings({
        newSystemReading, newModuleReading,
        ...(!isReadingOnly ? { oldSystemReading, oldModuleReading } : {}),
      }, project, workOrder);
      if (readingErrors.length) return res.status(400).json(readingValidationResponse(readingErrors));
      
      // Helper to save base64 photos
      const saveBase64Photos = async (photos: any[], photoType: string) => {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return;
        
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0');
        
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          if (photo.base64) {
            let base64Data = photo.base64;
            if (base64Data.includes(",")) {
              base64Data = base64Data.split(",")[1];
            }
            
            const buffer = Buffer.from(base64Data, "base64");
            const uniqueId = randomUUID();
            const filename = `${folderName}-${photoType}-${dateStr}-${uniqueId}.jpg`;
            const filePath = path.join(workOrderFolder, filename);
            await fs.writeFile(filePath, buffer);
          }
        }
      };
      
      // Save photos
      await saveBase64Photos(beforePhotos, "before");
      await saveBase64Photos(afterPhotos, "after");
      
      // Save signature if provided
      if (signatureData) {
        const projectFilesPath = await getProjectFilesPath();
        const projectDirName = getProjectDirectoryName(project.name, project.id);
        const workOrderFolder = path.join(
          projectFilesPath,
          projectDirName,
          "Work Orders",
          folderName
        );
        
        await fs.mkdir(workOrderFolder, { recursive: true });
        
        let sigBase64 = signatureData;
        if (sigBase64.includes(",")) {
          sigBase64 = sigBase64.split(",")[1];
        }
        
        const sigBuffer = Buffer.from(sigBase64, "base64");
        const sigFilename = `${folderName}-signature.png`;
        const sigFilePath = path.join(workOrderFolder, sigFilename);
        await fs.writeFile(sigFilePath, sigBuffer);
      }
      
      // Validation helpers (numeric - integers or decimals)
      const isValidSystemReading = (reading: any): boolean => {
        if (reading === undefined || reading === null) return false;
        const str = String(reading).trim();
        return str.length > 0 && /^\d+(\.\d+)?$/.test(str);
      };
      
      const isValidGps = (gps: string): boolean => {
        if (!gps || !gps.trim()) return false;
        const match = gps.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (!match) return false;
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      };
      
      // Determine changeout scope from explicit changeoutScope or fall back to work order data
      const woAny = workOrder as any;
      const hasSystemData = !!workOrder.oldSystemId || !!woAny.old_system_id;
      const hasModuleData = !!workOrder.oldModuleId || !!woAny.old_module_id;
      const needsSystem = changeoutScope ? (changeoutScope === "system" || changeoutScope === "both") : hasSystemData;
      const needsModule = changeoutScope ? (changeoutScope === "module" || changeoutScope === "both") : hasModuleData;
      
      // Validate required fields based on scope
      // For Reading Only mode (isReadingOnly: true):
      // - Old reading fields are NOT required (they exist in DB)
      // - New IDs are NOT required (will be copied from old IDs)
      // - Only new readings are required
      if (needsSystem) {
        // Old reading only required for changeout mode, not reading-only mode
        if (!isReadingOnly && !isValidSystemReading(oldSystemReading)) {
          return res.status(400).json({ message: "oldSystemReading is required and must be numeric" });
        }
        // New ID only required for changeout mode, not reading-only mode (will copy from old)
        if (!isReadingOnly && !newSystemId) {
          return res.status(400).json({ message: "newSystemId is required for completion" });
        }
        if (!isValidSystemReading(newSystemReading)) {
          return res.status(400).json({ message: "newSystemReading is required and must be numeric" });
        }
      }
      
      if (needsModule) {
        // Old reading only required for changeout mode, not reading-only mode
        if (!isReadingOnly && !isValidSystemReading(oldModuleReading)) {
          return res.status(400).json({ message: "oldModuleReading is required and must be numeric" });
        }
        // New ID only required for changeout mode, not reading-only mode (will copy from old)
        if (!isReadingOnly && !newModuleId) {
          return res.status(400).json({ message: "newModuleId is required for module changeout" });
        }
        if (!isValidSystemReading(newModuleReading)) {
          return res.status(400).json({ message: "newModuleReading is required and must be numeric" });
        }
      }
      
      if (gpsCoordinates && !isValidGps(gpsCoordinates)) {
        return res.status(400).json({ message: "Invalid GPS coordinates format. Use 'lat,lng' format" });
      }
      
      // Build update data - clear scheduledAt since status is changing to Completed
      const updateData: any = {
        status: "Completed",
        trouble: null,
        updatedAt: new Date().toISOString(),
        completedAt: completedAt || new Date().toISOString(),
        completedBy: currentUser.id,
        scheduledAt: null,
      };
      
      // System fields - only set if this is a system or both changeout
      if (needsSystem) {
        if (isReadingOnly) {
          // Reading Only mode: copy IDs and types from old, only update new reading
          // Don't overwrite old reading - it's already in the DB
          updateData.newSystemId = workOrder.oldSystemId || woAny.old_system_id;
          updateData.newSystemReading = String(newSystemReading).trim();
          // Copy type from old to new
          const existingOldType = woAny.oldSystemType || woAny.old_system_type;
          if (existingOldType) {
            updateData.newSystemType = existingOldType;
          }
        } else {
          // Changeout mode: use values from mobile request
          if (oldSystemReading !== undefined && oldSystemReading !== null) {
            updateData.oldSystemReading = String(oldSystemReading).trim();
          }
          if (newSystemReading !== undefined && newSystemReading !== null) {
            updateData.newSystemReading = String(newSystemReading).trim();
          }
          if (newSystemId) {
            updateData.newSystemId = newSystemId;
          }
          if (newSystemType) {
            updateData.newSystemType = newSystemType;
          }
        }
      }
      
      // Module fields - only set if this is a module or both changeout
      if (needsModule) {
        if (isReadingOnly) {
          // Reading Only mode: copy IDs and types from old, only update new reading
          // Don't overwrite old reading - it's already in the DB
          updateData.newModuleId = workOrder.oldModuleId || woAny.old_module_id;
          updateData.newModuleRead = String(newModuleReading).trim();
          // Copy type from old to new
          const existingOldModType = woAny.oldModuleType || woAny.old_module_type;
          if (existingOldModType) {
            updateData.newModuleType = existingOldModType;
          }
        } else {
          // Changeout mode: use values from mobile request
          if (oldModuleReading !== undefined && oldModuleReading !== null) {
            updateData.oldModuleRead = String(oldModuleReading).trim();
          }
          if (newModuleReading !== undefined && newModuleReading !== null) {
            updateData.newModuleRead = String(newModuleReading).trim();
          }
          if (newModuleId) {
            updateData.newModuleId = newModuleId;
          }
          if (oldModuleType) {
            updateData.oldModuleType = oldModuleType;
          }
          if (newModuleType) {
            updateData.newModuleType = newModuleType;
          }
        }
      }
      
      if (gpsCoordinates) {
        updateData.newGps = gpsCoordinates;
      }
      if (signatureName) {
        updateData.signatureName = signatureName;
      }
      if (signatureData) {
        updateData.signatureData = signatureData;
      }
      
      // Always add completion report header (similar to Trouble Report format)
      const timestamp = await getTimezoneFormattedTimestamp(project.timezone);
      const reportType = isReadingOnly ? "Reading Report" : "Changeout Report";
      const noteEntry = notes && notes.trim()
        ? `[${reportType} - ${timestamp}]\n${notes.trim()}`
        : `[${reportType} - ${timestamp}]`;
      updateData.notes = workOrder.notes 
        ? `${workOrder.notes}\n\n${noteEntry}`
        : noteEntry;
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        { ...updateData, inventoryUsage: mobileInventoryUsage(req) },
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.completed", updatedWorkOrder, currentUser);
      
      // Customer delivery is recorded transactionally by updateWorkOrder.
      
      // Emit SSE event
      emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: "System changeout completed successfully"
      });
    } catch (error: any) {
      console.error("Error in project-scoped mobile complete endpoint:", error);
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, code: "INVENTORY_CONFLICT" });
      res.status(500).json({ message: error.message || "Failed to complete system changeout" });
    }
  });

  // Bulk claim work orders - mobile batch operation
  app.post("/api/projects/:projectId/mobile/work-orders/bulk-claim", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "workOrderIds must be a non-empty array" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      const results: { id: number; claimed: boolean; message?: string }[] = [];
      
      for (const workOrderId of workOrderIds) {
        try {
          const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
          
          if (!workOrder) {
            results.push({ id: workOrderId, claimed: false, message: "Work order not found" });
            continue;
          }
          
          // Skip if already assigned to this user
          if (workOrder.assignedUserId === currentUser.id) {
            results.push({ id: workOrderId, claimed: false, message: "Already assigned to you" });
            continue;
          }
          
          // Use atomic claim to prevent race conditions
          const claimedWorkOrder = await workOrderStorage.claimWorkOrder(
            workOrderId,
            currentUser.id,
            updatedByUsername
          );
          
          if (claimedWorkOrder) {
            // Emit SSE event to notify other users
            emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
            results.push({ id: workOrderId, claimed: true });
          } else {
            results.push({ id: workOrderId, claimed: false, message: "Already claimed by another user" });
          }
        } catch (error) {
          console.error(`Error claiming work order ${workOrderId}:`, error);
          results.push({ id: workOrderId, claimed: false, message: String(error) });
        }
      }
      
      res.json({
        success: true,
        results,
        summary: {
          total: workOrderIds.length,
          claimed: results.filter(r => r.claimed).length,
          skipped: results.filter(r => !r.claimed).length
        }
      });
    } catch (error) {
      console.error("Error in bulk claim:", error);
      res.status(500).json({ message: "Failed to bulk claim work orders" });
    }
  });

  // Bulk update work order status - mobile batch operation
  app.post("/api/projects/:projectId/mobile/work-orders/bulk-status", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Must be assigned to project
      if (currentUser.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const { workOrderIds, status } = req.body;
      
      if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
        return res.status(400).json({ message: "workOrderIds must be a non-empty array" });
      }
      
      if (!status) {
        return res.status(400).json({ message: "status is required" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const updatedByUsername = currentUser.username || currentUser.id;
      
      const results: { id: number; updated: boolean; message?: string }[] = [];
      
      for (const workOrderId of workOrderIds) {
        try {
          // Get existing work order to check if we need to clear scheduledAt
          const existingWorkOrder = await workOrderStorage.getWorkOrder(workOrderId);
          
          // Build update data - clear scheduledAt if status is changing away from Scheduled
          const updateData: any = { status };
          if (existingWorkOrder?.status === "Scheduled" && status !== "Scheduled") {
            updateData.scheduledAt = null;
          }
          
          await workOrderStorage.updateWorkOrder(
            workOrderId,
            updateData,
            updatedByUsername
          );
          
          // Emit SSE event to notify other connected clients
          emitWorkOrderUpdated(projectId, workOrderId, currentUser.id);
          
          results.push({ id: workOrderId, updated: true });
        } catch (error) {
          console.error(`Error updating work order ${workOrderId}:`, error);
          results.push({ id: workOrderId, updated: false, message: String(error) });
        }
      }
      
      res.json({
        success: true,
        results,
        summary: {
          total: workOrderIds.length,
          updated: results.filter(r => r.updated).length,
          failed: results.filter(r => !r.updated).length
        }
      });
    } catch (error) {
      console.error("Error in bulk status update:", error);
      res.status(500).json({ message: "Failed to bulk update work order status" });
    }
  });

  // Geocode address to GPS coordinates (for desktop fallback)
  app.get("/api/geocode", isAuthenticated, async (req: any, res) => {
    try {
      const { address } = req.query;
      
      if (!address || typeof address !== 'string') {
        return res.status(400).json({ message: "Address is required" });
      }
      
      // Use Nominatim (OpenStreetMap) for geocoding - free and doesn't require API key
      const encodedAddress = encodeURIComponent(address);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`,
        {
          headers: {
            'User-Agent': 'MeterFlo/1.0 (Utility Work Order System)'
          }
        }
      );
      
      if (!response.ok) {
        return res.status(500).json({ message: "Geocoding service unavailable" });
      }
      
      const results = await response.json();
      
      if (results && results.length > 0) {
        const { lat, lon, display_name } = results[0];
        return res.json({
          lat: parseFloat(lat).toFixed(6),
          lng: parseFloat(lon).toFixed(6),
          displayName: display_name,
          source: "geocode"
        });
      }
      
      return res.status(404).json({ message: "Address not found" });
    } catch (error) {
      console.error("Geocoding error:", error);
      res.status(500).json({ message: "Failed to geocode address" });
    }
  });

  return httpServer;
}

// Helper function to trigger project webhooks
async function triggerProjectWebhook(
  project: any, 
  event: string, 
  data: any, 
  user: any
): Promise<void> {
  try {
    // Check if project has webhook URL configured
    const webhookUrl = project.webhookUrl;
    if (!webhookUrl) return;
    
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      projectId: project.id,
      projectName: project.name,
      triggeredBy: user?.username || "system",
      data
    };
    
    // Fire and forget - don't wait for response
    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Project-ID": String(project.id)
      },
      body: JSON.stringify(payload)
    }).catch(err => {
      console.error(`Webhook delivery failed for project ${project.id}:`, err);
    });
  } catch (error) {
    console.error("Error triggering webhook:", error);
  }
}
