import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertWorkOrderSchema, insertProjectSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

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

  app.patch("/api/users/:id/project", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      const { projectId } = req.body;
      const user = await storage.updateUserProject(req.params.id, projectId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user project:", error);
      res.status(500).json({ message: "Failed to update user project" });
    }
  });

  app.get("/api/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role === "customer") {
        if (currentUser.projectId) {
          const project = await storage.getProject(currentUser.projectId);
          res.json(project ? [project] : []);
        } else {
          res.json([]);
        }
        return;
      }
      const projects = await storage.getProjects();
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const projectId = parseInt(req.params.id);
      
      if (currentUser?.role === "customer") {
        if (currentUser.projectId !== projectId) {
          return res.status(403).json({ message: "Forbidden: You can only view your assigned project" });
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

  app.post("/api/projects", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      const parsed = insertProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid project data", errors: parsed.error.errors });
      }
      const project = await storage.createProject(parsed.data);
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      await storage.deleteProject(parseInt(req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.get("/api/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const filters: { projectId?: number; status?: string; assignedTo?: string } = {};
      
      if (req.query.projectId) {
        filters.projectId = parseInt(req.query.projectId);
      }
      if (req.query.status) {
        filters.status = req.query.status;
      }
      if (req.query.assignedTo) {
        filters.assignedTo = req.query.assignedTo;
      }
      
      if (currentUser?.role === "customer") {
        if (currentUser.projectId) {
          filters.projectId = currentUser.projectId;
          filters.status = "completed";
        } else {
          res.json([]);
          return;
        }
      }
      
      const workOrders = await storage.getWorkOrders(filters);
      res.json(workOrders);
    } catch (error) {
      console.error("Error fetching work orders:", error);
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });

  app.get("/api/work-orders/stats", isAuthenticated, async (req: any, res) => {
    try {
      const stats = await storage.getWorkOrderStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching work order stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/work-orders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      const workOrder = await storage.getWorkOrder(parseInt(req.params.id));
      
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      if (currentUser?.role === "customer") {
        if (workOrder.projectId !== currentUser.projectId || workOrder.status !== "completed") {
          return res.status(403).json({ message: "Forbidden: You can only view completed work orders for your project" });
        }
      }
      
      res.json(workOrder);
    } catch (error) {
      console.error("Error fetching work order:", error);
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  app.post("/api/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot create work orders" });
      }
      
      const parsed = insertWorkOrderSchema.safeParse({
        ...req.body,
        createdBy: req.user.claims.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid work order data", errors: parsed.error.errors });
      }
      const workOrder = await storage.createWorkOrder(parsed.data);
      res.status(201).json(workOrder);
    } catch (error) {
      console.error("Error creating work order:", error);
      res.status(500).json({ message: "Failed to create work order" });
    }
  });

  app.patch("/api/work-orders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role === "customer") {
        return res.status(403).json({ message: "Customers cannot edit work orders" });
      }
      
      const workOrder = await storage.updateWorkOrder(parseInt(req.params.id), req.body);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json(workOrder);
    } catch (error) {
      console.error("Error updating work order:", error);
      res.status(500).json({ message: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      await storage.deleteWorkOrder(parseInt(req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting work order:", error);
      res.status(500).json({ message: "Failed to delete work order" });
    }
  });

  app.post("/api/import/work-orders", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
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
        projectId: wo.projectId || null,
        assignedTo: wo.assignedTo || null,
        createdBy: req.user.claims.sub,
        dueDate: wo.dueDate ? new Date(wo.dueDate) : null,
        notes: wo.notes || null,
        attachments: wo.attachments || null,
      }));
      
      const result = await storage.importWorkOrders(toImport);
      res.json(result);
    } catch (error) {
      console.error("Error importing work orders:", error);
      res.status(500).json({ message: "Failed to import work orders" });
    }
  });

  return httpServer;
}
