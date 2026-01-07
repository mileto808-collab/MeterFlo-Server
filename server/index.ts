import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { importScheduler } from "./importScheduler";
import { fileImportScheduler } from "./fileImportScheduler";
import { storage } from "./storage";
import { pool } from "./db";
import { getProjectWorkOrderStorage } from "./projectDb";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();

// Trust reverse proxy (Apache, nginx) for proper session handling
// This is required for sessions to work when behind a reverse proxy
app.set('trust proxy', 1);

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// BAREBONES TEST ENDPOINT - No middleware, no CORS, no auth
// This endpoint exists BEFORE any other middleware to test if requests reach Express at all
app.get('/api/mobile/ping', (req, res) => {
  const headers = {
    origin: req.headers.origin || '(none)',
    referer: req.headers.referer || '(none)',
    'x-mobile-app': req.headers['x-mobile-app'] || '(none)',
    'x-requested-with': req.headers['x-requested-with'] || '(none)',
    'user-agent': (req.headers['user-agent'] || '(none)').substring(0, 100),
  };
  console.log('[PING] Request received:', JSON.stringify(headers));
  
  // Set permissive CORS headers for this test endpoint
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Express server is reachable',
    receivedHeaders: headers
  });
});

// Handle OPTIONS preflight for the ping endpoint
app.options('/api/mobile/ping', (req, res) => {
  console.log('[PING] OPTIONS preflight received');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  res.sendStatus(200);
});

// ============================================================================
// MOBILE API ENDPOINTS - These run BEFORE any middleware to bypass CORS/session issues
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const JWT_EXPIRY = '7d';

// Helper to set mobile CORS headers
function setMobileCorsHeaders(res: Response) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Mobile-App');
}

// OPTIONS preflight for all mobile endpoints
app.options('/api/mobile/*', (req, res) => {
  console.log('[MOBILE] OPTIONS preflight for:', req.path);
  setMobileCorsHeaders(res);
  res.sendStatus(200);
});

// Mobile login endpoint - JWT based, no session dependency
app.post('/api/mobile/auth/login', express.json(), async (req, res) => {
  console.log('[MOBILE-AUTH] Login attempt received');
  setMobileCorsHeaders(res);
  
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      console.log('[MOBILE-AUTH] Missing username or password');
      return res.status(400).json({ message: 'Username and password are required' });
    }
    
    const user = await storage.getUserByUsername(username);
    if (!user || !user.passwordHash) {
      console.log('[MOBILE-AUTH] User not found:', username);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    if (user.isLocked) {
      console.log('[MOBILE-AUTH] Account locked:', username);
      return res.status(403).json({ 
        message: 'Account is locked', 
        reason: user.lockedReason || 'Contact administrator for assistance' 
      });
    }
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      console.log('[MOBILE-AUTH] Invalid password for:', username);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Update last login
    await storage.updateLastLogin(user.id);
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role,
        subroleId: user.subroleId
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    
    console.log('[MOBILE-AUTH] Login successful for:', username);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        subroleId: user.subroleId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[MOBILE-AUTH] Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Mobile auth verification endpoint - verifies JWT and returns user info
app.get('/api/mobile/auth/me', async (req, res) => {
  console.log('[MOBILE-AUTH] Verify token request');
  setMobileCorsHeaders(res);
  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string; role: string; subroleId: number | null };
    
    // Fetch fresh user data
    const user = await storage.getUser(String(decoded.userId));
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    if (user.isLocked) {
      return res.status(403).json({ 
        message: 'Account is locked', 
        reason: user.lockedReason || 'Contact administrator for assistance' 
      });
    }
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        subroleId: user.subroleId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      }
    });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    console.error('[MOBILE-AUTH] Token verification error:', error);
    res.status(500).json({ message: 'Token verification failed' });
  }
});

// JWT verification helper for mobile endpoints
async function verifyMobileJwt(req: Request, res: Response): Promise<{ userId: number; username: string; role: string; subroleId: number | null } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return null;
  }
  
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string; role: string; subroleId: number | null };
    
    const user = await storage.getUser(String(decoded.userId));
    if (!user) {
      res.status(401).json({ message: 'User not found' });
      return null;
    }
    
    if (user.isLocked) {
      res.status(403).json({ message: 'Account is locked', reason: user.lockedReason || 'Contact administrator for assistance' });
      return null;
    }
    
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ message: 'Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ message: 'Invalid token' });
    } else {
      res.status(500).json({ message: 'Token verification failed' });
    }
    return null;
  }
}

// Mobile endpoint: Get user's assigned projects
app.get('/api/mobile/users/:id/projects', async (req, res) => {
  console.log('[MOBILE-API] GET /api/mobile/users/:id/projects');
  setMobileCorsHeaders(res);
  
  const decoded = await verifyMobileJwt(req, res);
  if (!decoded) return;
  
  try {
    const targetUserId = req.params.id;
    
    // Users can only view their own projects via mobile
    if (String(decoded.userId) !== targetUserId) {
      return res.status(403).json({ message: 'Forbidden: Can only access your own projects' });
    }
    
    const projects = await storage.getUserProjects(targetUserId);
    console.log('[MOBILE-API] Returning', projects.length, 'projects for user', targetUserId);
    res.json(projects);
  } catch (error) {
    console.error('[MOBILE-API] Error fetching user projects:', error);
    res.status(500).json({ message: 'Failed to fetch user projects' });
  }
});

// Mobile endpoint: Sync download - bulk fetch work orders for offline cache
app.get('/api/mobile/projects/:projectId/sync/download', async (req, res) => {
  console.log('[MOBILE-API] GET /api/mobile/projects/:projectId/sync/download');
  setMobileCorsHeaders(res);
  
  const decoded = await verifyMobileJwt(req, res);
  if (!decoded) return;
  
  try {
    const currentUser = await storage.getUser(String(decoded.userId));
    if (!currentUser) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    if (currentUser.role === 'customer') {
      return res.status(403).json({ message: 'Forbidden: Customer portal configuration required' });
    }
    
    const projectId = parseInt(req.params.projectId);
    
    // Must be assigned to project (admins bypass)
    if (currentUser.role !== 'admin') {
      const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
      if (!isAssigned) {
        return res.status(403).json({ message: 'Forbidden: You are not assigned to this project' });
      }
    }
    
    const project = await storage.getProject(projectId);
    if (!project || !project.databaseName) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    // Check if user is a field technician
    let isFieldTechnician = false;
    let userGroupNames: string[] = [];
    if (currentUser.subroleId) {
      const subrole = await storage.getSubrole(currentUser.subroleId);
      if (subrole?.key === 'field_technician') {
        isFieldTechnician = true;
        const userGroups = await storage.getUserGroupMemberships(currentUser.id);
        userGroupNames = userGroups.map(g => g.name);
      }
    }
    
    // Parse query parameters
    const { lastSyncTimestamp, assignedUserId, assignedGroupId, status, limit, offset } = req.query;
    
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
      
      // Field technician filtering
      if (isFieldTechnician) {
        const assignmentConditions: string[] = [];
        assignmentConditions.push(`w.assigned_user_id = $${paramCount++}`);
        values.push(currentUser.id);
        if (userGroupNames.length > 0) {
          assignmentConditions.push(`(w.assigned_group_id = ANY($${paramCount++}) AND w.assigned_user_id IS NULL)`);
          values.push(userGroupNames);
        }
        conditions.push(`(${assignmentConditions.join(' OR ')})`);
      }
      
      if (lastSyncTimestamp) {
        conditions.push(`w.updated_at > $${paramCount++}`);
        values.push(new Date(lastSyncTimestamp as string));
      }
      
      if (assignedUserId && !isFieldTechnician) {
        conditions.push(`w.assigned_user_id = $${paramCount++}`);
        values.push(assignedUserId);
      }
      
      if (assignedGroupId && !isFieldTechnician) {
        conditions.push(`w.assigned_group_id = $${paramCount++}`);
        values.push(assignedGroupId);
      }
      
      if (status) {
        conditions.push(`w.status = $${paramCount++}`);
        values.push(status);
      }
      
      // Mobile users never receive Closed or Completed work orders
      conditions.push(`LOWER(w.status) NOT IN ('completed', 'closed')`);
      
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      query += ' ORDER BY w.updated_at DESC';
      
      if (limit) {
        query += ` LIMIT $${paramCount++}`;
        values.push(parseInt(limit as string));
      }
      if (offset) {
        query += ` OFFSET $${paramCount++}`;
        values.push(parseInt(offset as string));
      }
      
      const result = await client.query(query, values);
      const serverTimestamp = new Date().toISOString();
      
      // Get reference data
      const [workOrderStatuses, troubleCodes, systemTypes, serviceTypes, projectUsers, allGroupsWithProjects] = await Promise.all([
        storage.getWorkOrderStatuses(),
        storage.getTroubleCodes(),
        storage.getSystemTypes(),
        storage.getServiceTypes(),
        storage.getProjectUsers(projectId),
        storage.getAllUserGroupsWithProjects()
      ]);
      
      const users = projectUsers.map(user => ({
        type: 'user' as const,
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
        type: 'group' as const,
        id: `group:${group.id}`,
        label: group.name,
        key: group.name,
      }));
      
      console.log('[MOBILE-API] Returning', result.rows.length, 'work orders for project', projectId);
      res.json({
        success: true,
        serverTimestamp,
        workOrders: result.rows,
        referenceData: {
          workOrderStatuses,
          troubleCodes,
          systemTypes,
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
    console.error('[MOBILE-API] Error in sync download:', error);
    res.status(500).json({ message: 'Failed to download work orders for sync' });
  }
});

// Mobile endpoint: Sync upload - batch submit work order updates with conflict detection
app.post('/api/mobile/projects/:projectId/sync/upload', express.json(), async (req, res) => {
  console.log('[MOBILE-API] POST /api/mobile/projects/:projectId/sync/upload');
  setMobileCorsHeaders(res);
  
  const decoded = await verifyMobileJwt(req, res);
  if (!decoded) return;
  
  try {
    const currentUser = await storage.getUser(String(decoded.userId));
    const projectId = parseInt(req.params.projectId);
    
    if (!currentUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    // Must be assigned to project (admins bypass)
    if (currentUser.role !== 'admin') {
      const isAssigned = await storage.isUserAssignedToProject(currentUser.id, projectId);
      if (!isAssigned) {
        return res.status(403).json({ message: 'Forbidden: You are not assigned to this project' });
      }
    }
    
    const project = await storage.getProject(projectId);
    if (!project || !project.databaseName) {
      return res.status(404).json({ message: 'Project not found' });
    }
    
    const { workOrders, clientSyncTimestamp } = req.body;
    
    if (!Array.isArray(workOrders)) {
      return res.status(400).json({ message: 'workOrders must be an array' });
    }
    
    const workOrderStorage = getProjectWorkOrderStorage(project.databaseName);
    const updatedByUsername = currentUser.username || currentUser.id;
    
    const results: { id: number; status: string; conflict?: boolean; message?: string; serverUpdatedAt?: Date | null }[] = [];
    
    for (const woUpdate of workOrders) {
      try {
        const { id, clientUpdatedAt, forceOverwrite, ...updateData } = woUpdate;
        
        const serverWorkOrder = await workOrderStorage.getWorkOrder(id);
        
        if (!serverWorkOrder) {
          results.push({ id, status: 'error', message: 'Work order not found' });
          continue;
        }
        
        const serverUpdatedAt = serverWorkOrder.updatedAt ? new Date(serverWorkOrder.updatedAt).getTime() : 0;
        const clientLastKnown = clientUpdatedAt ? new Date(clientUpdatedAt).getTime() : 0;
        
        if (clientLastKnown > 0 && serverUpdatedAt > clientLastKnown && !forceOverwrite) {
          results.push({ 
            id, 
            status: 'conflict', 
            conflict: true,
            message: 'Server has newer data - please sync and retry. Use forceOverwrite:true to override.',
            serverUpdatedAt: serverWorkOrder.updatedAt
          });
          continue;
        }
        
        await workOrderStorage.updateWorkOrder(id, updateData, updatedByUsername);
        results.push({ id, status: 'success' });
      } catch (error) {
        console.error(`[MOBILE-API] Error updating work order ${woUpdate.id}:`, error);
        results.push({ id: woUpdate.id, status: 'error', message: String(error) });
      }
    }
    
    const serverTimestamp = new Date().toISOString();
    
    console.log('[MOBILE-API] Sync upload complete:', results.filter(r => r.status === 'success').length, 'successful');
    res.json({
      success: true,
      serverTimestamp,
      results,
      summary: {
        total: workOrders.length,
        successful: results.filter(r => r.status === 'success').length,
        conflicts: results.filter(r => r.status === 'conflict').length,
        errors: results.filter(r => r.status === 'error').length
      }
    });
  } catch (error) {
    console.error('[MOBILE-API] Error in sync upload:', error);
    res.status(500).json({ message: 'Failed to upload work order changes' });
  }
});

// ============================================================================
// END MOBILE API ENDPOINTS
// ============================================================================

// CORS middleware for mobile app connections (including native Android/iOS apps)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const refererHeader = req.headers.referer || req.headers.referrer;
  const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
  
  // Check for mobile app headers - these bypass Origin/Referer validation entirely
  // ONLY X-Mobile-App triggers bypass (not X-Requested-With, which browsers send)
  const xMobileApp = req.headers['x-mobile-app'];
  const isMobileAppRequest = xMobileApp === 'MeterFlo' || xMobileApp === 'true';
  
  // Helper to extract hostname from a URL string
  const getHostname = (urlString: string): string | null => {
    try {
      const url = new URL(urlString);
      return url.hostname.toLowerCase();
    } catch {
      return null;
    }
  };
  
  // Helper to check if a hostname is allowed
  const isAllowedHostname = (hostname: string): boolean => {
    // Allow Replit dev/app domains
    if (hostname.endsWith('.replit.dev') || hostname.endsWith('.replit.app')) {
      return true;
    }
    
    // Allow localhost for development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
    
    // Allow production domain meterflo.com and any subdomains
    if (hostname === 'meterflo.com' || hostname.endsWith('.meterflo.com')) {
      return true;
    }
    
    return false;
  };
  
  // Helper to check if origin/referer is allowed
  const isAllowedOrigin = (urlString: string): boolean => {
    const hostname = getHostname(urlString);
    if (hostname) {
      return isAllowedHostname(hostname);
    }
    // Fallback to simple string checks if URL parsing fails
    const lower = urlString.toLowerCase();
    return lower.includes('replit.dev') || 
           lower.includes('replit.app') || 
           lower.includes('localhost') ||
           lower.includes('meterflo.com');
  };
  
  // Determine if this request should get CORS headers
  let allowedOriginForHeader: string | null = null;
  
  // PRIORITY 1: Mobile app with X-Mobile-App or X-Requested-With header
  // These requests bypass Origin/Referer validation entirely
  if (isMobileAppRequest) {
    // Mobile app request - always allow and use production domain for CORS
    allowedOriginForHeader = 'https://meterflo.com';
  } else if (origin && isAllowedOrigin(origin)) {
    // Browser request with valid Origin header
    allowedOriginForHeader = origin;
  } else if (!origin && referer && isAllowedOrigin(referer)) {
    // Native mobile app: no Origin but valid Referer - extract origin from referer
    const hostname = getHostname(referer);
    if (hostname) {
      const refererUrl = new URL(referer);
      allowedOriginForHeader = `${refererUrl.protocol}//${refererUrl.host}`;
    }
  } else if (!origin && !referer) {
    // Native mobile app with no Origin or Referer headers
    // Allow these requests but set a wildcard or specific origin for CORS
    // For credentials to work, we need a specific origin - use the production domain
    allowedOriginForHeader = 'https://meterflo.com';
  }
  
  // Set CORS headers if we have an allowed origin
  if (allowedOriginForHeader) {
    res.header('Access-Control-Allow-Origin', allowedOriginForHeader);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Mobile-App');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  }
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(
  express.json({
    limit: '100mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '100mb' }));

// Debug logging middleware for mobile app header analysis
// This logs Origin, Referer, and X-Requested-With headers for auth endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/mobile')) {
    const origin = req.headers.origin || '(none)';
    const referer = req.headers.referer || req.headers.referrer || '(none)';
    const xRequestedWith = req.headers['x-requested-with'] || '(none)';
    const xMobileApp = req.headers['x-mobile-app'] || '(none)';
    const userAgent = req.headers['user-agent'] || '(none)';
    const isMobile = xMobileApp !== '(none)' || xRequestedWith === 'XMLHttpRequest';
    console.log(`[MOBILE-DEBUG] ${req.method} ${req.path} (mobile=${isMobile})`);
    console.log(`  Origin: ${origin}`);
    console.log(`  Referer: ${referer}`);
    console.log(`  X-Requested-With: ${xRequestedWith}`);
    console.log(`  X-Mobile-App: ${xMobileApp}`);
    console.log(`  User-Agent: ${userAgent?.substring(0, 100)}`);
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // HOST defaults to 0.0.0.0 for external access, but can be overridden via environment variable
  // On Windows, 0.0.0.0 may not work - set HOST=127.0.0.1 if you get ENOTSUP errors
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
    },
    () => {
      log(`serving on port ${port}`);
      // Ensure administrator subrole exists with all permissions
      storage.ensureAdministratorSubrole().then(() => {
        log("Administrator subrole initialized");
      }).catch(err => {
        log(`Failed to initialize administrator subrole: ${err.message}`);
      });
      importScheduler.initialize().catch(err => {
        log(`Failed to initialize import scheduler: ${err.message}`);
      });
      fileImportScheduler.initialize().catch(err => {
        log(`Failed to initialize file import scheduler: ${err.message}`);
      });
    },
  );
})();
