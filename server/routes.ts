import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertProjectWorkOrderSchema, insertProjectSchema, createUserSchema, updateUserSchema, resetPasswordSchema, permissionKeys, insertExternalDatabaseConfigSchema, updateExternalDatabaseConfigSchema, insertImportConfigSchema, updateImportConfigSchema, databaseTypeEnum, importScheduleFrequencyEnum } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createProjectSchema, deleteProjectSchema, getProjectWorkOrderStorage, sanitizeSchemaName, backupProjectDatabase, restoreProjectDatabase, getProjectDatabaseStats } from "./projectDb";
import { ensureProjectDirectory, saveWorkOrderFile, getWorkOrderFiles, deleteWorkOrderFile, getFilePath, getProjectFilesPath, setProjectFilesPath, deleteProjectDirectory, saveProjectFile, getProjectFiles, deleteProjectFile, getProjectFilePath, ensureProjectFtpDirectory, getProjectFtpFiles, deleteProjectFtpFile, getProjectFtpFilePath, saveProjectFtpFile } from "./fileStorage";
import { ExternalDatabaseService } from "./externalDbService";
import { createBackupArchive, extractDatabaseBackupFromArchive, restoreFullSystem, restoreFilesFromArchive } from "./systemBackup";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // User management (Admin only)
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Create new user (Admin only)
  app.post("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Update user (Admin only)
  app.patch("/api/users/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Reset user password (Admin only)
  app.post("/api/users/:id/reset-password", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Lock user (Admin only)
  app.post("/api/users/:id/lock", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Unlock user (Admin only)
  app.post("/api/users/:id/unlock", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Delete user (Admin only)
  app.delete("/api/users/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      
      if (currentUser?.role !== "admin" && currentUser?.id !== targetUserId) {
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  app.put("/api/subroles/:id/permissions", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  // Project endpoints
  app.get("/api/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      
      if (currentUser?.role === "admin") {
        const projects = await storage.getProjects();
        res.json(projects);
      } else if (currentUser?.role === "user") {
        const projects = await storage.getUserProjects(currentUser.id);
        res.json(projects);
      } else {
        const projects = await storage.getUserProjects(currentUser!.id);
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
      
      if (currentUser?.role !== "admin") {
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      
      // Check if user has access to this project
      if (currentUser?.role !== "admin") {
        const isAssigned = await storage.isUserAssignedToProject(currentUser!.id, projectId);
        if (!isAssigned) {
          return res.status(403).json({ message: "Forbidden: You are not assigned to this project" });
        }
      }
      
      // Get users assigned to this project
      const projectUsers = await storage.getProjectUsers(projectId);
      
      // Get all user groups
      const userGroupsList = await storage.getAllUserGroups();
      
      // Format users for dropdown
      const users = projectUsers.map(user => ({
        type: "user" as const,
        id: user.id,
        label: user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`
          : user.username || user.email || user.id,
        username: user.username,
      }));
      
      // Format user groups for dropdown
      const groups = userGroupsList.map(group => ({
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
      const canManageProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_MANAGE);
      if (!canManageProjects) {
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
      const canManageProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_MANAGE);
      if (!canManageProjects) {
        return res.status(403).json({ message: "Forbidden: You don't have permission to edit projects" });
      }
      const project = await storage.updateProject(parseInt(req.params.id), req.body);
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
      const canManageProjects = await storage.hasPermission(currentUser, permissionKeys.PROJECTS_MANAGE);
      if (!canManageProjects) {
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

  // Project-scoped work orders
  app.get("/api/projects/:projectId/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.projectId);
      
      if (currentUser?.role !== "admin") {
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
      
      const workOrders = await workOrderStorage.getWorkOrders(filters);
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
      const stats = await workOrderStorage.getWorkOrderStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching work order stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
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
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.getWorkOrder(workOrderId);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      if (currentUser?.role === "customer" && workOrder.status !== "completed") {
        return res.status(403).json({ message: "Forbidden: Customers can only view completed work orders" });
      }
      
      res.json(workOrder);
    } catch (error) {
      console.error("Error fetching work order:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
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
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const workOrder = await workOrderStorage.createWorkOrder({
        ...req.body,
        createdBy: currentUser!.id,
      });
      
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
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      
      // Get the user's display name for updatedBy
      const updatedByName = currentUser?.firstName 
        ? `${currentUser.firstName}${currentUser.lastName ? ' ' + currentUser.lastName : ''}`
        : currentUser?.username || currentUser?.id;
      
      const workOrder = await workOrderStorage.updateWorkOrder(workOrderId, req.body, updatedByName);
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
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
      
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const project = await storage.getProject(projectId);
      if (!project || !project.databaseName) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      await workOrderStorage.deleteWorkOrder(parseInt(req.params.workOrderId));
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order:", error);
      res.status(500).json({ message: "Failed to delete work order" });
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
      
      const { workOrders: workOrdersData } = req.body;
      if (!Array.isArray(workOrdersData)) {
        return res.status(400).json({ message: "workOrders must be an array" });
      }
      
      const toImport = workOrdersData.map((wo: any) => ({
        customerWoId: wo.customerWoId || wo.title,
        customerId: wo.customerId || "",
        customerName: wo.customerName || "",
        address: wo.address || "",
        serviceType: wo.serviceType || "Water",
        status: wo.status || "pending",
        assignedTo: wo.assignedTo || null,
        createdBy: currentUser!.id,
        notes: wo.notes || null,
        attachments: wo.attachments || null,
      }));
      
      const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
      const result = await workOrderStorage.importWorkOrders(toImport);
      res.json(result);
    } catch (error) {
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
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const filePath = await saveWorkOrderFile(
        project.name,
        project.id,
        workOrderId,
        req.file.originalname,
        req.file.buffer
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
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      const files = await getWorkOrderFiles(project.name, project.id, workOrderId);
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
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      await deleteWorkOrderFile(
        project.name,
        project.id,
        parseInt(req.params.workOrderId),
        req.params.filename
      );
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({ message: "Failed to delete file" });
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

  // Database backup/restore endpoints (Admin only)
  
  // Get database stats for a project
  app.get("/api/projects/:projectId/database/stats", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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

  app.patch("/api/work-order-statuses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const status = await storage.updateWorkOrderStatus(id, req.body);
      
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }
      
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
      
      await storage.deleteWorkOrderStatus(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order status:", error);
      res.status(500).json({ message: "Failed to delete work order status" });
    }
  });

  // User Groups API Routes
  app.get("/api/user-groups", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const groups = await storage.getAllUserGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching user groups:", error);
      res.status(500).json({ message: "Failed to fetch user groups" });
    }
  });

  app.get("/api/user-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const group = await storage.getUserGroup(id);
      
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const { name, description } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Group name is required" });
      }
      
      const group = await storage.createUserGroup({ name: name.trim(), description });
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const { name, description } = req.body;
      
      const group = await storage.updateUserGroup(id, { 
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
      });
      
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
  app.get("/api/system/backup", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      await createBackupArchive(res);
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

  app.post("/api/system/restore", isAuthenticated, largeUpload.single("backup"), async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No backup file provided" });
      }
      
      const clearExisting = req.body.clearExisting === "true";
      const restoreFiles = req.body.restoreFiles !== "false";
      
      const backupData = await extractDatabaseBackupFromArchive(req.file.buffer);
      
      if (!backupData) {
        return res.status(400).json({ message: "Invalid backup archive: could not find database_backup.json" });
      }
      
      const dbResult = await restoreFullSystem(backupData, { clearExisting });
      
      let filesResult = { filesRestored: 0, errors: [] as string[] };
      if (restoreFiles) {
        const filesPath = await getProjectFilesPath();
        filesResult = await restoreFilesFromArchive(req.file.buffer, filesPath);
      }
      
      res.json({
        message: "Full system restore completed",
        mainTablesRestored: dbResult.mainTablesRestored,
        projectsRestored: dbResult.projectsRestored,
        filesRestored: filesResult.filesRestored,
        errors: [...dbResult.errors, ...filesResult.errors],
      });
    } catch (error) {
      console.error("Error restoring full system backup:", error);
      res.status(500).json({ message: "Failed to restore full system backup" });
    }
  });

  return httpServer;
}
