import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { promises as fs, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertProjectWorkOrderSchema, insertProjectSchema, createUserSchema, updateUserSchema, resetPasswordSchema, updateProfileSchema, permissionKeys, insertExternalDatabaseConfigSchema, updateExternalDatabaseConfigSchema, insertImportConfigSchema, updateImportConfigSchema, databaseTypeEnum, importScheduleFrequencyEnum } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createProjectSchema, deleteProjectSchema, getProjectWorkOrderStorage, sanitizeSchemaName, backupProjectDatabase, restoreProjectDatabase, getProjectDatabaseStats } from "./projectDb";
import { pool } from "./db";
import { ensureProjectDirectory, renameProjectDirectory, saveWorkOrderFile, getWorkOrderFiles, deleteWorkOrderFile, deleteWorkOrderDirectory, getFilePath, getProjectFilesPath, setProjectFilesPath, deleteProjectDirectory, saveProjectFile, getProjectFiles, deleteProjectFile, getProjectFilePath, ensureProjectFtpDirectory, getProjectFtpFiles, deleteProjectFtpFile, getProjectFtpFilePath, saveProjectFtpFile, getProjectDirectoryName } from "./fileStorage";
import { ExternalDatabaseService } from "./externalDbService";
import { createBackupArchive, extractDatabaseBackupFromArchive, restoreFullSystem, restoreFilesFromArchive } from "./systemBackup";
import { createPgBackupArchive, extractBackupFromArchive, restorePgBackup, restoreFilesFromPgArchive } from "./pgBackup";
import { projectEventEmitter, emitWorkOrderCreated, emitWorkOrderUpdated, emitWorkOrderDeleted, emitFileAdded, emitFileDeleted, type ProjectEvent } from "./eventEmitter";
import { sendWorkOrderToCustomerApi } from "./customerApiService";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function getTimezoneFormattedTimestamp(): Promise<string> {
  const timezone = await storage.getSetting("default_timezone") || "America/Denver";
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

function validateOperationalHours(
  scheduledAt: string | Date | null | undefined,
  project: { operationalHoursEnabled?: boolean | null; operationalHoursStart?: string | null; operationalHoursEnd?: string | null }
): OperationalHoursValidationResult {
  if (!scheduledAt || !project.operationalHoursEnabled) {
    return { valid: true };
  }
  
  if (!project.operationalHoursStart || !project.operationalHoursEnd) {
    return { valid: true };
  }
  
  const scheduledDate = typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt;
  if (isNaN(scheduledDate.getTime())) {
    return { valid: true };
  }
  
  const scheduledHours = scheduledDate.getHours();
  const scheduledMinutes = scheduledDate.getMinutes();
  const scheduledTimeMinutes = scheduledHours * 60 + scheduledMinutes;
  
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
    console.log("Admin user created: username 'admin', password 'pa$$werd1'");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  await initializeAdminUser();
  await storage.seedDefaultWorkOrderStatuses();
  await storage.syncPermissionsFromRegistry();
  await storage.ensureDefaultSubroles();

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
          console.error("Login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({ message: "Login successful", user: { id: user.id, username: user.username, role: user.role } });
      });
    } catch (error) {
      console.error("Local login error:", error);
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
      
      res.json({ ...user, subroleKey });
    } catch (error) {
      console.error("Error fetching user:", error);
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
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
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
      const { role } = req.body;
      if (!["admin", "user", "customer"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const user = await storage.updateUserRole(req.params.id, role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
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
      
      const { username, password, firstName, lastName, email, role, subroleId } = parsed.data;
      
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
      
      res.status(201).json(user);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user
  app.patch("/api/users/:id", isAuthenticated, async (req: any, res) => {
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
      
      if (parsed.data.role && parsed.data.role !== "admin" && existingUser.role === "admin") {
        const adminCount = await storage.countActiveAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot demote the last admin. Create another admin first." });
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
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
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
      
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const user = await storage.updateUserPassword(targetUserId, passwordHash);
      
      res.json({ message: "Password reset successfully", user });
    } catch (error) {
      console.error("Error resetting password:", error);
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
      res.json(user);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
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
      
      if (existingUser.role === "admin") {
        const adminCount = await storage.countActiveAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot lock the last active admin. Create another admin first." });
        }
      }
      
      const { reason } = req.body;
      const user = await storage.lockUser(targetUserId, reason);
      
      res.json(user);
    } catch (error) {
      console.error("Error locking user:", error);
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
      
      const user = await storage.unlockUser(targetUserId);
      res.json(user);
    } catch (error) {
      console.error("Error unlocking user:", error);
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
      
      const projects = await storage.getUserProjects(targetUserId);
      res.json(projects);
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
      
      const { projectId } = req.body;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
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
      
      await storage.removeUserFromProject(req.params.userId, parseInt(req.params.projectId));
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from project:", error);
      res.status(500).json({ message: "Failed to remove user from project" });
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
      const canManageAccessLevels = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_ACCESS_LEVELS);
      if (!canManageAccessLevels) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage access levels" });
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
      const canManageAccessLevels = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_ACCESS_LEVELS);
      if (!canManageAccessLevels) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage access levels" });
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
      const canManageAccessLevels = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_ACCESS_LEVELS);
      if (!canManageAccessLevels) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage access levels" });
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
      const canManageAccessLevels = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_ACCESS_LEVELS);
      if (!canManageAccessLevels) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage access levels" });
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
      const canManageAccessLevels = await storage.hasPermission(currentUser, permissionKeys.SETTINGS_ACCESS_LEVELS);
      if (!canManageAccessLevels) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to manage access levels" });
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
      res.json(user);
    } catch (error) {
      console.error("Error updating user subrole:", error);
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
      res.json(prefs || { visibleColumns: [], stickyColumns: [] });
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
      
      // Users with nav.projects permission can see all projects
      const hasNavProjects = await storage.hasPermission(currentUser, permissionKeys.NAV_PROJECTS);
      if (hasNavProjects) {
        const projects = await storage.getProjects();
        res.json(projects);
      } else {
        // Other users only see projects they are assigned to
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
      const projectId = parseInt(req.params.id);
      
      // Check if user has nav.projects permission (can see all projects) or is assigned to this project
      const hasNavProjects = currentUser ? await storage.hasPermission(currentUser, permissionKeys.NAV_PROJECTS) : false;
      if (!hasNavProjects) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
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
      res.json(users);
    } catch (error) {
      console.error("Error fetching project users:", error);
      res.status(500).json({ message: "Failed to fetch project users" });
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

  app.post("/api/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const canCreateProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_CREATE);
      if (!canCreateProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to create projects" });
      }
      
      const parsed = insertProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid project data", errors: parsed.error.errors });
      }
      
      const project = await storage.createProject(parsed.data);
      
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

  app.patch("/api/projects/:id", isAuthenticated, async (req: any, res) => {
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
      
      // If name is changing, rename the project directory
      if (req.body.name && req.body.name !== existingProject.name) {
        await renameProjectDirectory(existingProject.name, req.body.name, projectId);
      }
      
      const project = await storage.updateProject(projectId, req.body);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error updating project:", error);
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
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // SSE endpoint for project-scoped real-time events
  app.get("/api/projects/:projectId/events", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
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
      }, 30000);
      
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
      }, 30000);
      
      req.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });
    } catch (error) {
      console.error("Global SSE connection error:", error);
      res.status(500).json({ message: "SSE connection failed" });
    }
  });

  // Project-scoped work orders
  app.get("/api/projects/:projectId/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      // Check if user has permission to view work orders
      const canViewWorkOrders = currentUser ? await storage.hasPermission(currentUser, permissionKeys.WORK_ORDERS_VIEW) : false;
      if (!canViewWorkOrders) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to view work orders" });
      }
      
      // Check project access - either has projects.view (can see all) or is assigned
      const canViewProjects = currentUser ? await storage.hasPermission(currentUser, permissionKeys.PROJECTS_VIEW) : false;
      if (!canViewProjects) {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found or not initialized" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const filters: { status?: string; assignedTo?: string } = {};
      
      if (req.query.status) filters.status = req.query.status;
      if (req.query.assignedTo) filters.assignedTo = req.query.assignedTo;
      
      if (currentUser?.role === "customer") {
        filters.status = "completed";
      }
      
      let workOrders = await workOrderStorage.getWorkOrders(filters);
      
      // Filter for field technicians - only show work orders assigned to them or their groups
      if (currentUser?.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician") {
          const userGroups = await storage.getUserGroupMemberships(currentUser.id);
          // assignedGroupId stores group names, not numeric IDs
          const userGroupNames = userGroups.map(g => g.name);
          
          workOrders = workOrders.filter(wo => {
            // Check if directly assigned to user
            if (wo.assignedUserId === currentUser.id) return true;
            // Check if assigned to one of user's groups (by name)
            if (wo.assignedGroupId && userGroupNames.includes(wo.assignedGroupId)) return true;
            return false;
          });
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
      const projectId = parseInt(req.params.projectId);
      
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
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // For field technicians, compute stats from their filtered work orders
      if (currentUser?.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician") {
          const userGroups = await storage.getUserGroupMemberships(currentUser.id);
          // assignedGroupId stores group names, not numeric IDs
          const userGroupNames = userGroups.map(g => g.name);
          
          const allWorkOrders = await workOrderStorage.getWorkOrders({});
          const filteredWorkOrders = allWorkOrders.filter(wo => {
            if (wo.assignedUserId === currentUser.id) return true;
            if (wo.assignedGroupId && userGroupNames.includes(wo.assignedGroupId)) return true;
            return false;
          });
          
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
      const projectId = parseInt(req.params.projectId);
      const meterId = req.query.meterId as string;
      
      if (!meterId) {
        return res.status(400).json({ message: "meterId query parameter is required" });
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
      
      // Query directly with JOINs to get snake_case format matching mobile sync endpoint
      // Searches both old_meter_id and new_meter_id fields
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
          WHERE w.old_meter_id = $1 OR w.new_meter_id = $1
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
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
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
        
        res.json(workOrder);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error fetching work order:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  // Look up work order by meter ID (searches both old and new meter IDs)
  app.get("/api/projects/:projectId/work-orders/by-meter/:meterId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      const meterId = decodeURIComponent(req.params.meterId);
      
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
      
      // Query directly with JOINs to get snake_case format matching mobile sync endpoint
      // Searches both old_meter_id and new_meter_id fields
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
          WHERE w.old_meter_id = $1 OR w.new_meter_id = $1
        `, [meterId]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Work order not found with meter ID: " + meterId });
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
      console.error("Error fetching work order by meter ID:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  // Claim a work order - auto-assign to current user when starting meter changeout
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
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Skip claim if already assigned to this user AND no group assignment
      if (workOrder.assignedUserId === currentUser.id && !workOrder.assignedGroupId) {
        return res.json({ message: "Already assigned to you", workOrder, claimed: false });
      }
      
      // Always perform claim when launching wizard - this assigns to the user and clears group
      // Use username for updated_by since it has a foreign key constraint to users table
      const updatedByUsername = currentUser.username || currentUser.id;
      
      // Assign work order to current user (clear group assignment)
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId, 
        { assignedUserId: currentUser.id, assignedGroupId: null },
        updatedByUsername
      );
      
      res.json({ message: "Work order assigned to you", workOrder: updatedWorkOrder, claimed: true });
    } catch (error) {
      console.error("Error claiming work order:", error);
      res.status(500).json({ message: "Failed to claim work order" });
    }
  });

  app.post("/api/projects/:projectId/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot create work orders" });
      }
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Validate operational hours if scheduledAt is provided
      if (req.body.scheduledAt) {
        const hoursValidation = validateOperationalHours(req.body.scheduledAt, project);
        if (!hoursValidation.valid) {
          return res.status(400).json({ message: hoursValidation.message });
        }
      }
      
      // Get the user's display name for createdBy
      const createdByName = currentUser?.firstName 
        ? `${currentUser.firstName}${currentUser.lastName ? ' ' + currentUser.lastName : ''}`
        : currentUser?.username || currentUser?.id;
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.createWorkOrder({
        ...req.body,
        createdBy: createdByName,
      });
      
      emitWorkOrderCreated(projectId, workOrder.id, currentUser?.id);
      res.status(201).json(workOrder);
    } catch (error) {
      console.error("Error creating work order:", error);
      res.status(500).json({ message: "Failed to create work order" });
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
      
      // Validate operational hours if scheduledAt is being updated
      if (req.body.scheduledAt) {
        const hoursValidation = validateOperationalHours(req.body.scheduledAt, project);
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
      
      // Check if status is being set to "Completed" and validate required fields
      const finalStatus = req.body.status || existingWorkOrder.status;
      if (finalStatus === "Completed") {
        const mergedData = { ...existingWorkOrder, ...req.body };
        const missingFields: string[] = [];
        
        if (!mergedData.oldMeterId) missingFields.push("Old Meter ID");
        if (mergedData.oldMeterReading === null || mergedData.oldMeterReading === undefined) missingFields.push("Old Meter Reading");
        if (!mergedData.newMeterId) missingFields.push("New Meter ID");
        if (mergedData.newMeterReading === null || mergedData.newMeterReading === undefined) missingFields.push("New Meter Reading");
        if (!mergedData.newGps) missingFields.push("New GPS");
        if (!mergedData.signatureData && !req.body.signatureData) missingFields.push("Signature");
        if (!mergedData.signatureName && !req.body.signatureName) missingFields.push("Signature Name");
        
        if (missingFields.length > 0) {
          return res.status(400).json({ 
            message: `Cannot set status to Completed. Missing required fields: ${missingFields.join(", ")}` 
          });
        }
      }
      
      // Use username for updated_by since it has a foreign key constraint to users table
      const updatedByUsername = currentUser?.username || currentUser?.id;
      
      const workOrder = await workOrderStorage.updateWorkOrder(workOrderId, req.body, updatedByUsername);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Send to customer API if work order was just completed
      const wasCompleted = existingWorkOrder.status !== "Completed" && workOrder.status === "Completed";
      if (wasCompleted) {
        const folderName = workOrder.customerWoId || String(workOrder.id);
        const woFolderPath = path.join(
          await getProjectFilesPath(),
          getProjectDirectoryName(project.name, project.id),
          "Work Orders",
          folderName
        );
        
        sendWorkOrderToCustomerApi(projectId, workOrder, {
          workOrderFolderPath: woFolderPath,
        }).catch(err => console.error("[CustomerAPI] Background send failed:", err));
      }
      
      emitWorkOrderUpdated(projectId, workOrderId, currentUser?.id);
      res.json(workOrder);
    } catch (error) {
      console.error("Error updating work order:", error);
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
      
      // Delete work order files/directory
      const folderName = workOrder.customerWoId || String(workOrder.id);
      await deleteWorkOrderDirectory(project.name, project.id, folderName, workOrder.id);
      
      // Delete work order from database
      await workOrderStorage.deleteWorkOrder(workOrderId);
      
      emitWorkOrderDeleted(projectId, workOrderId, currentUser?.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order:", error);
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
        updatedCount++;
      }
      
      // Emit event for the project
      projectEventEmitter.emit(`project:${projectId}`, { 
        type: 'bulk-status-update',
        updatedCount,
        status 
      });
      
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
      // Only set defaults for truly required fields
      const toImport = workOrdersData.map((wo: any) => ({
        customerWoId: wo.customerWoId || wo.title || null,
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
        serviceType: wo.serviceType || "Water",
        oldMeterId: wo.oldMeterId || wo.old_meter_id || null,
        oldMeterReading: wo.oldMeterReading || wo.old_meter_reading || null,
        newMeterId: wo.newMeterId || wo.new_meter_id || null,
        newMeterReading: wo.newMeterReading || wo.new_meter_reading || null,
        oldGps: wo.oldGps || wo.old_gps || null,
        newGps: wo.newGps || wo.new_gps || null,
        status: wo.status || "Open",
        scheduledAt: wo.scheduledAt || wo.scheduledDate || wo.scheduled_date || wo.scheduled_at || null,
        assignedUserId: wo.assignedUserId || wo.assigned_user_id || null,
        assignedGroupId: wo.assignedGroupId || wo.assigned_group_id || null,
        createdBy: createdByName,
        trouble: wo.trouble || null,
        notes: wo.notes || null,
        attachments: wo.attachments || null,
        oldMeterType: wo.oldMeterType || wo.old_meter_type || null,
        newMeterType: wo.newMeterType || wo.new_meter_type || null,
      }));
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const result = await workOrderStorage.importWorkOrders(toImport, createdByName);
      
      // Update history entry with results
      const status = result.errors && result.errors.length > 0 
        ? (result.imported > 0 ? "partial" : "failed") 
        : "success";
      await storage.updateFileImportHistoryEntry(
        historyEntry.id,
        status,
        result.imported || 0,
        result.errors?.length || 0,
        result.errors?.slice(0, 10).join("\n") || null
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error importing work orders:", error);
      res.status(500).json({ message: "Failed to import work orders" });
    }
  });

  // File upload for work orders
  app.post("/api/projects/:projectId/work-orders/:workOrderId/files", isAuthenticated, upload.single("file"), async (req: any, res) => {
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
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
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
      const projectId = parseInt(req.params.projectId);
      const workOrderId = parseInt(req.params.workOrderId);
      
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

  // Meter changeout workflow endpoint
  app.post("/api/projects/:projectId/work-orders/:workOrderId/meter-changeout", isAuthenticated, upload.array("photos", 20), async (req: any, res) => {
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
        return res.status(403).json({ message: "You do not have permission to perform meter changeouts" });
      }
      
      if (currentUser.role === "customer") {
        return res.status(403).json({ message: "Customers cannot perform meter changeouts" });
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
        oldMeterReading,
        newMeterId,
        newMeterReading,
        gpsCoordinates,
        completionNotes,
        signatureData,
        signatureName,
        photoTypes, // Array of types matching the files array: ["before", "before", "after", "after", "trouble"]
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
      
      // Validate meter reading format (digits only)
      const isValidMeterReading = (reading: string): boolean => {
        if (!reading || reading.trim().length === 0) return false;
        return /^\d+$/.test(reading.trim());
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
        // Success path - meter was changed
        // Validate required fields for success path
        if (!oldMeterReading || !newMeterId || !newMeterReading || !gpsCoordinates || !signatureName) {
          return res.status(400).json({ 
            message: "Missing required fields for meter changeout: old reading, new meter ID, new reading, GPS, and signature name are required" 
          });
        }
        
        // Validate meter readings are digits only
        if (!isValidMeterReading(oldMeterReading)) {
          return res.status(400).json({ 
            message: "Old meter reading must contain only digits (0-9)" 
          });
        }
        if (!isValidMeterReading(newMeterReading)) {
          return res.status(400).json({ 
            message: "New meter reading must contain only digits (0-9)" 
          });
        }
        
        // Validate GPS format
        if (!isValidGps(gpsCoordinates)) {
          return res.status(400).json({ 
            message: "Invalid GPS format. Use: latitude,longitude (e.g., 37.7749,-122.4194)" 
          });
        }
        
        updateData.oldMeterReading = oldMeterReading;
        updateData.newMeterId = newMeterId;
        updateData.newMeterReading = newMeterReading;
        updateData.newGps = gpsCoordinates;
        updateData.signatureData = signatureData || null;
        updateData.signatureName = signatureName || null;
        updateData.completedAt = new Date().toISOString();
        updateData.completedBy = currentUser.id;
        
        // Add completion notes if provided
        if (completionNotes && completionNotes.trim()) {
          const timestamp = await getTimezoneFormattedTimestamp();
          updateData.notes = workOrder.notes 
            ? `${workOrder.notes}\n\n[Meter Changeout Notes - ${timestamp}]\n${completionNotes.trim()}`
            : `[Meter Changeout Notes - ${timestamp}]\n${completionNotes.trim()}`;
        }
        
        // Get the "Completed" status from system
        const statuses = await storage.getWorkOrderStatuses();
        const completedStatus = statuses.find((s: any) => s.code.toLowerCase() === "completed" || s.label.toLowerCase() === "completed");
        if (completedStatus) {
          updateData.status = completedStatus.code;
        }
      } else {
        // Trouble path - meter could not be changed
        // Validate required fields for trouble path (GPS and signature NOT required)
        if (!troubleCode) {
          return res.status(400).json({ message: "Trouble code is required when meter cannot be changed" });
        }
        
        updateData.trouble = troubleCode;
        if (troubleNote) {
          const timestamp = await getTimezoneFormattedTimestamp();
          updateData.notes = workOrder.notes 
            ? `${workOrder.notes}\n\n[Trouble Report - ${timestamp}]\n${troubleNote}`
            : `[Trouble Report - ${timestamp}]\n${troubleNote}`;
        }
        
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
        console.error("Meter changeout: updateWorkOrder returned undefined for work order", workOrderId);
        return res.status(500).json({ message: "Failed to update work order" });
      }
      
      console.log("Meter changeout updated work order:", { 
        id: updatedWorkOrder.id, 
        status: updatedWorkOrder.status, 
        trouble: updatedWorkOrder.trouble 
      });
      
      res.json({ 
        success: true, 
        message: canChange ? "Meter changeout completed successfully" : "Trouble report submitted successfully",
        uploadedPhotos 
      });
    } catch (error: any) {
      console.error("Error processing meter changeout:", error);
      res.status(500).json({ message: error.message || "Failed to process meter changeout" });
    }
  });

  // Project-level files (separate from work order files)
  app.get("/api/projects/:projectId/files", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
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
      
      const files = await getProjectFiles(project.name, project.id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching project files:", error);
      res.status(500).json({ message: "Failed to fetch project files" });
    }
  });

  app.post("/api/projects/:projectId/files", isAuthenticated, upload.single("file"), async (req: any, res) => {
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
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  app.get("/api/projects/:projectId/files/:filename/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
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
      const projectId = parseInt(req.params.projectId);
      
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
  app.post("/api/projects/:projectId/ftp-files", isAuthenticated, upload.single("file"), async (req: any, res) => {
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
      const projectId = parseInt(req.params.projectId);
      
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
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
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
        oldMeterType,
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
          
          if (status) filters.status = status;
          if (assignedTo) filters.assignedTo = assignedTo;
          
          // Customers can only see completed work orders
          if (currentUser.role === "customer") {
            filters.status = "completed";
          }
          
          const workOrders = await workOrderStorage.getWorkOrders(filters);
          
          // Apply additional filters
          const filteredOrders = workOrders.filter(wo => {
            // Text search in customerWoId, customerName, address, notes, oldMeterId, newMeterId
            if (query) {
              const searchQuery = query.toLowerCase();
              const matchesWoId = wo.customerWoId?.toLowerCase().includes(searchQuery);
              const matchesName = wo.customerName?.toLowerCase().includes(searchQuery);
              const matchesAddress = wo.address?.toLowerCase().includes(searchQuery);
              const matchesNotes = wo.notes?.toLowerCase().includes(searchQuery);
              const matchesOldMeter = wo.oldMeterId?.toLowerCase().includes(searchQuery);
              const matchesNewMeter = wo.newMeterId?.toLowerCase().includes(searchQuery);
              const matchesRoute = wo.route?.toLowerCase().includes(searchQuery);
              const matchesZone = wo.zone?.toLowerCase().includes(searchQuery);
              if (!matchesWoId && !matchesName && !matchesAddress && !matchesNotes && 
                  !matchesOldMeter && !matchesNewMeter && !matchesRoute && !matchesZone) return false;
            }
            
            // Service type filter
            if (serviceType && wo.serviceType !== serviceType) return false;
            
            // Old meter type filter
            if (oldMeterType && (wo as any).oldMeterType !== oldMeterType) return false;
            
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
      
      switch (docType) {
        case "windows-deployment":
          filePath = path.join(process.cwd(), "deploy", "WINDOWS_DEPLOYMENT.md");
          break;
        case "mobile-api":
          filePath = path.join(process.cwd(), "MOBILE_API.md");
          break;
        case "customer-api":
          filePath = path.join(process.cwd(), "CUSTOMER_API_INTEGRATION.md");
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
      
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      const success = req.query.success === "true" ? true : req.query.success === "false" ? false : undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const logs = await storage.getCustomerApiLogs({ projectId, success, limit });
      
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

  // File Import History endpoints (Admin only)
  app.get("/api/file-import-history", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const limit = parseInt(req.query.limit as string) || 500;
      const history = await storage.getAllFileImportHistory(limit);
      
      // Enrich with project names
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let projectName = null;
        if (entry.projectId) {
          const project = await storage.getProject(entry.projectId);
          projectName = project?.name || null;
        }
        return { ...entry, projectName };
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const history = await storage.getAllFileImportHistory(10000);
      
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

  // External Database Import History endpoints (Admin only)
  app.get("/api/import-history", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const limit = parseInt(req.query.limit as string) || 500;
      const history = await storage.getAllImportHistory(limit);
      
      // Enrich with config name, database name, and project name
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let configName = null;
        let databaseName = null;
        let projectName = null;
        
        if (entry.importConfigId) {
          const importConfig = await storage.getImportConfig(entry.importConfigId);
          if (importConfig) {
            configName = importConfig.name;
            
            const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
            if (dbConfig) {
              databaseName = dbConfig.name;
              
              const project = await storage.getProject(dbConfig.projectId);
              projectName = project?.name || null;
            }
          }
        }
        
        return { ...entry, configName, databaseName, projectName };
      }));
      
      res.json(enrichedHistory);
    } catch (error) {
      console.error("Error fetching import history:", error);
      res.status(500).json({ message: "Failed to fetch import history" });
    }
  });

  app.get("/api/import-history/download", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const history = await storage.getAllImportHistory(10000);
      
      // Enrich with config name, database name, and project name
      const enrichedHistory = await Promise.all(history.map(async (entry) => {
        let configName = "";
        let databaseName = "";
        let projectName = "";
        
        if (entry.importConfigId) {
          const importConfig = await storage.getImportConfig(entry.importConfigId);
          if (importConfig) {
            configName = importConfig.name;
            
            const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
            if (dbConfig) {
              databaseName = dbConfig.name;
              
              const project = await storage.getProject(dbConfig.projectId);
              projectName = project?.name || "";
            }
          }
        }
        
        return { ...entry, configName, databaseName, projectName };
      }));
      
      // Create CSV content
      const csvHeaders = ["ID", "Date", "Project", "Database", "Import Config", "Status", "Records Imported", "Records Failed", "Completed At", "Error Details"];
      const csvRows = enrichedHistory.map(entry => [
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
  app.post("/api/projects/:projectId/database/restore", isAuthenticated, upload.single("backup"), async (req: any, res) => {
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
      
      const projects = await storage.getProjects();
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
            const mappedData: Record<string, any> = {};
            for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
              if (targetField && row[sourceCol] !== undefined) {
                mappedData[targetField] = row[sourceCol];
              }
            }
            
            if (!mappedData.customerWoId || !mappedData.customerId || !mappedData.customerName || !mappedData.address || !mappedData.serviceType) {
              failed++;
              errors.push(`Row missing required fields: ${JSON.stringify(row).slice(0, 100)}`);
              continue;
            }
            
            const serviceType = String(mappedData.serviceType);
            if (!["Water", "Electric", "Gas"].includes(serviceType)) {
              mappedData.serviceType = "Water";
            }
            
            if (mappedData.oldMeterReading) {
              mappedData.oldMeterReading = parseInt(String(mappedData.oldMeterReading)) || null;
            }
            if (mappedData.newMeterReading) {
              mappedData.newMeterReading = parseInt(String(mappedData.newMeterReading)) || null;
            }
            
            mappedData.status = String(mappedData.status || "pending");
            mappedData.createdBy = currentUser.id;
            
            const existingWo = await workOrderStorage.getWorkOrderByCustomerWoId(mappedData.customerWoId);
            if (existingWo) {
              await workOrderStorage.updateWorkOrder(existingWo.id, mappedData as any);
            } else {
              const validated = insertProjectWorkOrderSchema.parse(mappedData);
              await workOrderStorage.createWorkOrder(validated as any);
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

  // Meter Types API Routes
  app.get("/api/meter-types", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.query.projectId ? parseInt(req.query.projectId) : undefined;
      const meterTypes = await storage.getMeterTypes(projectId);
      res.json(meterTypes);
    } catch (error) {
      console.error("Error fetching meter types:", error);
      res.status(500).json({ message: "Failed to fetch meter types" });
    }
  });

  app.get("/api/meter-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const meterType = await storage.getMeterType(id);
      
      if (!meterType) {
        return res.status(404).json({ message: "Meter type not found" });
      }
      
      res.json(meterType);
    } catch (error) {
      console.error("Error fetching meter type:", error);
      res.status(500).json({ message: "Failed to fetch meter type" });
    }
  });

  app.post("/api/meter-types", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const meterType = await storage.createMeterType(req.body);
      res.status(201).json(meterType);
    } catch (error: any) {
      console.error("Error creating meter type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Meter type already exists" });
      }
      res.status(500).json({ message: "Failed to create meter type" });
    }
  });

  app.patch("/api/meter-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const meterType = await storage.updateMeterType(id, req.body);
      
      if (!meterType) {
        return res.status(404).json({ message: "Meter type not found" });
      }
      
      res.json(meterType);
    } catch (error: any) {
      console.error("Error updating meter type:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Meter type already exists" });
      }
      res.status(500).json({ message: "Failed to update meter type" });
    }
  });

  app.delete("/api/meter-types/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const meterType = await storage.getMeterType(id);
      
      if (!meterType) {
        return res.status(404).json({ message: "Meter type not found" });
      }
      
      await storage.deleteMeterType(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting meter type:", error);
      res.status(500).json({ message: "Failed to delete meter type" });
    }
  });

  app.post("/api/meter-types/:id/copy", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const existing = await storage.getMeterType(id);
      
      if (!existing) {
        return res.status(404).json({ message: "Meter type not found" });
      }
      
      const { targetProjectIds } = req.body;
      const projectIds = targetProjectIds || existing.projectIds;
      
      // Generate a unique productId by appending " - Copy" or " - Copy N"
      const allMeterTypes = await storage.getMeterTypes();
      const baseProductId = existing.productId;
      let newProductId = `${baseProductId} - Copy`;
      let copyNumber = 1;
      
      // Check if the productId already exists
      while (allMeterTypes.some(mt => mt.productId === newProductId)) {
        copyNumber++;
        newProductId = `${baseProductId} - Copy ${copyNumber}`;
      }
      
      const newMeterType = await storage.createMeterType({
        productId: newProductId,
        productLabel: `Copy of ${existing.productLabel}`,
        productDescription: existing.productDescription,
        projectIds: projectIds,
      });
      
      res.status(201).json(newMeterType);
    } catch (error) {
      console.error("Error copying meter type:", error);
      res.status(500).json({ message: "Failed to copy meter type" });
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
      
      const groups = await storage.getAllUserGroupsWithProjects();
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
      const members = await storage.getGroupMembers(groupId);
      res.json(members);
    } catch (error) {
      console.error("Error fetching group members:", error);
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
      
      await storage.removeUserFromGroup(groupId, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user from group:", error);
      res.status(500).json({ message: "Failed to remove user from group" });
    }
  });

  // Full System Backup/Restore API Routes
  // Uses pg_dump for SQL-format backup that handles foreign key constraints properly
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
      
      // Use pg_dump-based backup for proper SQL format with FK support
      await createPgBackupArchive(res);
    } catch (error) {
      console.error("Error creating full system backup:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to create full system backup" });
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
      
      // Extract and detect backup format (SQL or legacy JSON)
      const { sqlFile, metadata, legacyJson } = await extractBackupFromArchive(req.file.buffer);
      
      if (sqlFile && metadata?.format === "pg_dump_sql") {
        // New SQL format - use psql to restore with FK constraint handling
        console.log(`Restoring SQL backup from ${metadata.backupDate}, schemas: ${metadata.schemas.join(", ")}`);
        
        let filesResult = { filesRestored: 0, errors: [] as string[] };
        
        try {
          const dbResult = await restorePgBackup(sqlFile, { disableForeignKeys: true });
          
          if (restoreFiles) {
            const filesPath = await getProjectFilesPath();
            filesResult = await restoreFilesFromPgArchive(req.file.buffer, filesPath);
          }
          
          if (!dbResult.success) {
            return res.status(500).json({
              message: "Database restore failed",
              error: dbResult.error,
              warnings: dbResult.warnings,
              filesRestored: filesResult.filesRestored,
            });
          }
          
          return res.json({
            message: "Full system restore completed (SQL format)",
            format: "pg_dump_sql",
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
          message: "Full system restore completed (legacy JSON format)",
          format: "legacy_json",
          mainTablesRestored: dbResult.mainTablesRestored,
          projectsRestored: dbResult.projectsRestored,
          filesRestored: filesResult.filesRestored,
          errors: [...dbResult.errors, ...dbResult.projectErrors, ...filesResult.errors],
          warnings: dbResult.warnings,
        });
      } else {
        return res.status(400).json({ 
          message: "Invalid backup archive: could not find database_backup.sql or database_backup.json" 
        });
      }
    } catch (error) {
      console.error("Error restoring full system backup:", error);
      res.status(500).json({ message: "Failed to restore full system backup" });
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
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Check if user is a field technician - they can only see work orders assigned to them or their groups
      let isFieldTechnician = false;
      let userGroupNames: string[] = [];
      if (currentUser.subroleId) {
        const subrole = await storage.getSubrole(currentUser.subroleId);
        if (subrole?.key === "field_technician") {
          isFieldTechnician = true;
          const userGroups = await storage.getUserGroupMemberships(currentUser.id);
          userGroupNames = userGroups.map(g => g.name);
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
        
        // Field technician filtering - only show work orders assigned to them or their groups
        if (isFieldTechnician) {
          const assignmentConditions: string[] = [];
          // Assigned directly to user
          assignmentConditions.push(`w.assigned_user_id = $${paramCount++}`);
          values.push(currentUser.id);
          // Assigned to one of user's groups
          if (userGroupNames.length > 0) {
            assignmentConditions.push(`w.assigned_group_id = ANY($${paramCount++})`);
            values.push(userGroupNames);
          }
          conditions.push(`(${assignmentConditions.join(" OR ")})`);
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
        const [workOrderStatuses, troubleCodes, meterTypes, serviceTypes, projectUsers, allGroupsWithProjects] = await Promise.all([
          storage.getWorkOrderStatuses(),
          storage.getTroubleCodes(),
          storage.getMeterTypes(),
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
        
        res.json({
          success: true,
          serverTimestamp,
          workOrders: result.rows,
          referenceData: {
            workOrderStatuses,
            troubleCodes,
            meterTypes,
            serviceTypes,
            assignees: { users, groups }
          },
          meta: {
            count: result.rows.length,
            projectId,
            projectName: project.name
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
      
      const results: { id: number; status: string; conflict?: boolean; message?: string; serverUpdatedAt?: Date | null }[] = [];
      
      for (const woUpdate of workOrders) {
        try {
          const { id, clientUpdatedAt, forceOverwrite, ...updateData } = woUpdate;
          
          // Get current server version
          const serverWorkOrder = await workOrderStorage.getWorkOrder(id);
          
          if (!serverWorkOrder) {
            results.push({ id, status: "error", message: "Work order not found" });
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
          
          results.push({ id, status: "success" });
        } catch (error) {
          console.error(`Error updating work order ${woUpdate.id}:`, error);
          results.push({ id: woUpdate.id, status: "error", message: String(error) });
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
        updateData,
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

  // Mobile meter changeout - complete a meter changeout from mobile device
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
        return res.status(403).json({ message: "You do not have permission to perform meter changeouts" });
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
        oldMeterReading,
        newMeterId,
        newMeterReading,
        gpsCoordinates,
        signatureData,
        signatureName,
        photoTypes,
        completedAt: clientCompletedAt
      } = changeoutData;
      
      const files = req.files as Express.Multer.File[];
      const folderName = workOrder.customerWoId || String(workOrder.id);
      
      // Validation
      const isValidMeterReading = (reading: string): boolean => {
        if (!reading || reading.trim().length === 0) return false;
        return /^\d+$/.test(reading.trim());
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
        // Success path - meter was changed
        if (!oldMeterReading || !newMeterId || !newMeterReading || !gpsCoordinates || !signatureName) {
          return res.status(400).json({ 
            message: "Missing required fields for meter changeout" 
          });
        }
        
        if (!isValidMeterReading(oldMeterReading)) {
          return res.status(400).json({ message: "Old meter reading must contain only digits" });
        }
        if (!isValidMeterReading(newMeterReading)) {
          return res.status(400).json({ message: "New meter reading must contain only digits" });
        }
        if (!isValidGps(gpsCoordinates)) {
          return res.status(400).json({ message: "Invalid GPS coordinates format" });
        }
        
        updateData.status = "Completed";
        updateData.oldMeterReading = parseInt(oldMeterReading.trim(), 10);
        updateData.newMeterId = newMeterId;
        updateData.newMeterReading = parseInt(newMeterReading.trim(), 10);
        updateData.newGps = gpsCoordinates;
        updateData.signatureName = signatureName;
        updateData.completedAt = clientCompletedAt || new Date().toISOString();
        updateData.completedBy = currentUser.id;
        updateData.trouble = null;
        // Append completion notes to existing notes (mobile pattern)
        if (troubleNote && troubleNote.trim()) {
          const timestamp = await getTimezoneFormattedTimestamp();
          const noteEntry = `[Meter Changeout Notes - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleNote.trim()}`;
          updateData.notes = workOrder.notes 
            ? `${workOrder.notes}\n\n${noteEntry}`
            : noteEntry;
        }
        
        if (signatureData) {
          updateData.signatureData = signatureData;
        }
      } else {
        // Trouble path - could not change meter
        if (!troubleCode) {
          return res.status(400).json({ message: "Trouble code is required" });
        }
        
        updateData.status = "Trouble";
        updateData.trouble = troubleCode;
        // Append trouble notes to existing notes (mobile pattern)
        if (troubleNote && troubleNote.trim()) {
          const timestamp = await getTimezoneFormattedTimestamp();
          const noteEntry = `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${troubleNote.trim()}`;
          updateData.notes = workOrder.notes 
            ? `${workOrder.notes}\n\n${noteEntry}`
            : noteEntry;
        }
      }
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        updateData,
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.completed", updatedWorkOrder, currentUser);
      
      // Send to customer API if configured and work order is completed
      if (canChange && updatedWorkOrder) {
        const woFolderPath = path.join(
          await getProjectFilesPath(),
          getProjectDirectoryName(project.name, project.id),
          "Work Orders",
          folderName
        );
        
        sendWorkOrderToCustomerApi(projectId, updatedWorkOrder, {
          beforePhoto: existsSync(path.join(woFolderPath, "before")) ? path.join(woFolderPath, "before") : null,
          afterPhoto: existsSync(path.join(woFolderPath, "after")) ? path.join(woFolderPath, "after") : null,
          signature: existsSync(path.join(woFolderPath, `${folderName}-signature.png`)) ? path.join(woFolderPath, `${folderName}-signature.png`) : null,
          workOrderFolderPath: woFolderPath,
        }).catch(err => console.error("[CustomerAPI] Background send failed:", err));
      }
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: canChange ? "Meter changeout completed successfully" : "Trouble reported successfully"
      });
    } catch (error) {
      console.error("Error completing mobile meter changeout:", error);
      res.status(500).json({ message: "Failed to complete meter changeout" });
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
      
      const { projectId, troubleCode, notes, oldMeterReading, photos } = req.body;
      
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
        return res.status(403).json({ message: "You do not have permission to perform meter changeouts" });
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
      if (notes && notes.trim()) {
        const timestamp = new Date().toLocaleString();
        const noteEntry = `[Trouble Report - ${timestamp} by ${currentUser.username || currentUser.id}]\n${notes.trim()}`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
      }
      
      if (oldMeterReading !== undefined && oldMeterReading !== null) {
        updateData.oldMeterReading = parseInt(String(oldMeterReading), 10);
      }
      
      // The trouble code is included in updateData.trouble, which triggers auto-generated trouble note in updateWorkOrder
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        updateData,
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.trouble", updatedWorkOrder, currentUser);
      
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
        oldMeterReading,
        newMeterReading,
        newMeterId,
        newMeterType,
        gpsCoordinates,
        signatureData,
        signatureName,
        completedAt,
        notes,
        beforePhotos,
        afterPhotos
      } = req.body;
      
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }
      
      // Check permission
      const hasMeterChangeoutPermission = await storage.hasPermission(currentUser, "workOrders.meterChangeout");
      if (!hasMeterChangeoutPermission) {
        return res.status(403).json({ message: "You do not have permission to perform meter changeouts" });
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
      
      // Validation for meter changeout completion
      const isValidMeterReading = (reading: any): boolean => {
        if (reading === undefined || reading === null) return false;
        const str = String(reading).trim();
        return str.length > 0 && /^\d+$/.test(str);
      };
      
      const isValidGps = (gps: string): boolean => {
        if (!gps || !gps.trim()) return false;
        const match = gps.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (!match) return false;
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      };
      
      // Validate required fields for completion
      if (!newMeterId) {
        return res.status(400).json({ message: "newMeterId is required for completion" });
      }
      if (!isValidMeterReading(newMeterReading)) {
        return res.status(400).json({ message: "newMeterReading is required and must be numeric" });
      }
      if (gpsCoordinates && !isValidGps(gpsCoordinates)) {
        return res.status(400).json({ message: "Invalid GPS coordinates format. Use 'lat,lng' format" });
      }
      
      // Build update data
      const updateData: any = {
        status: "Completed",
        trouble: null,
        updatedAt: new Date().toISOString(),
        completedAt: completedAt || new Date().toISOString(),
        completedBy: currentUser.id,
      };
      
      if (oldMeterReading !== undefined && oldMeterReading !== null) {
        updateData.oldMeterReading = parseInt(String(oldMeterReading), 10);
      }
      if (newMeterReading !== undefined && newMeterReading !== null) {
        updateData.newMeterReading = parseInt(String(newMeterReading), 10);
      }
      if (newMeterId) {
        updateData.newMeterId = newMeterId;
      }
      if (newMeterType) {
        updateData.newMeterType = newMeterType;
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
      // Append user notes to existing notes (mobile pattern) - don't replace
      if (notes && notes.trim()) {
        const timestamp = await getTimezoneFormattedTimestamp();
        const noteEntry = `[Meter Changeout Notes - ${timestamp} by ${currentUser.username || currentUser.id}]\n${notes.trim()}`;
        updateData.notes = workOrder.notes 
          ? `${workOrder.notes}\n\n${noteEntry}`
          : noteEntry;
      }
      
      const updatedWorkOrder = await workOrderStorage.updateWorkOrder(
        workOrderId,
        updateData,
        updatedByUsername
      );
      
      // Trigger webhook if configured
      await triggerProjectWebhook(project, "work_order.completed", updatedWorkOrder, currentUser);
      
      // Send to customer API if configured
      if (updatedWorkOrder) {
        const woFolderPath = path.join(
          await getProjectFilesPath(),
          getProjectDirectoryName(project.name, project.id),
          "Work Orders",
          folderName
        );
        const signatureFilePath = path.join(woFolderPath, `${folderName}-signature.png`);
        
        sendWorkOrderToCustomerApi(projectId, updatedWorkOrder, {
          beforePhoto: null,
          afterPhoto: null,
          signature: existsSync(signatureFilePath) ? signatureFilePath : null,
          workOrderFolderPath: woFolderPath,
        }).catch(err => console.error("[CustomerAPI] Background send failed:", err));
      }
      
      res.json({
        success: true,
        workOrder: updatedWorkOrder,
        message: "Meter changeout completed successfully"
      });
    } catch (error: any) {
      console.error("Error in mobile complete endpoint:", error);
      res.status(500).json({ message: error.message || "Failed to complete meter changeout" });
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
          
          // Claim the work order
          await workOrderStorage.updateWorkOrder(
            workOrderId,
            { assignedUserId: currentUser.id, assignedGroupId: null },
            updatedByUsername
          );
          
          results.push({ id: workOrderId, claimed: true });
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
          await workOrderStorage.updateWorkOrder(
            workOrderId,
            { status },
            updatedByUsername
          );
          
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
