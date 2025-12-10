import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertWorkOrderSchema, insertProjectSchema, createUserSchema, updateUserSchema, resetPasswordSchema, permissionKeys } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createProjectSchema, deleteProjectSchema, getProjectWorkOrderStorage, sanitizeSchemaName, backupProjectDatabase, restoreProjectDatabase, getProjectDatabaseStats } from "./projectDb";
import { ensureProjectDirectory, saveWorkOrderFile, getWorkOrderFiles, deleteWorkOrderFile, getFilePath, getProjectFilesPath, setProjectFilesPath, deleteProjectDirectory, saveProjectFile, getProjectFiles, deleteProjectFile, getProjectFilePath } from "./fileStorage";

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
      const workOrder = await workOrderStorage.updateWorkOrder(workOrderId, req.body);
      
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
        title: wo.title,
        description: wo.description || null,
        status: wo.status || "pending",
        priority: wo.priority || "medium",
        assignedTo: wo.assignedTo || null,
        createdBy: currentUser!.id,
        dueDate: wo.dueDate ? new Date(wo.dueDate) : null,
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
        priority,
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
            // Text search in title, description, notes
            if (query) {
              const searchQuery = query.toLowerCase();
              const matchesTitle = wo.title?.toLowerCase().includes(searchQuery);
              const matchesDesc = wo.description?.toLowerCase().includes(searchQuery);
              const matchesNotes = wo.notes?.toLowerCase().includes(searchQuery);
              if (!matchesTitle && !matchesDesc && !matchesNotes) return false;
            }
            
            // Priority filter
            if (priority && wo.priority !== priority) return false;
            
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

  return httpServer;
}
