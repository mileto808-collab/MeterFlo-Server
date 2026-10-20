// Load environment variables from a .env file in the current working directory
// before anything else runs. `dotenv` does NOT override variables that are
// already set in the process environment (e.g. Windows system env vars or
// Replit secrets), so this is safe to run unconditionally in dev and prod.
import "dotenv/config";

// Force UTC timezone for consistent behavior across Windows and Linux servers
// This must be set BEFORE any Date operations or imports that use Date
process.env.TZ = 'UTC';

import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { assertAttachmentLayoutReady } from "./attachmentMigrationCatalog";
import { serveStatic } from "./static";
import { createServer } from "http";
import { importScheduler } from "./importScheduler";
import { fileImportScheduler } from "./fileImportScheduler";
import { storage } from "./storage";
import { registerCustomerExtensions } from "./customerExtensions";
import { isAuthenticated } from "./replitAuth";
import { initializeLogger, logger } from "./logger";
import { initializeCustomerApi, startCustomerApiWorker } from "./customerApiService";
import { initializeApiImports, startApiImportWorker } from "./apiImportService";
import { startLogMaintenance } from "./logMaintenanceRoutes";
import { initializeReadingPrecision } from "./readingPrecisionMigration";
import { initializeProjectExactReadings } from "./exactReadingMigration";
import { pool } from "./db";
import { initializeAudit } from "./auditMigration";
import { reconcileAuditOperations, startAuditRetention } from "./auditService";
import { initializeInventory } from "./inventoryMigration";
import { requestLogging } from "./requestLogging";
import { initializeRouting } from "./routing/configuration";
import { initializeVisitScheduling } from "./visitScheduling";
import { initializeAccessLocks } from "./accessLocks";
import { initializeGpsSchema } from "./gpsSchema";
import { initializeBackupSchema } from "./backups/schema";
import { startBackupWorker } from "./backups/service";
import { initializeFileTransfers } from "./file-transfers/schema";
import { initializeEmbeddedSftp } from "./file-transfers/embedded-server";
import { startFileExportWorker } from "./file-transfers/exports";
import { initializeWorkOrderLifecycle } from "./work-order-lifecycle/schema";
import { startAutomaticClosing } from "./work-order-lifecycle/service";

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

// CORS middleware for mobile app connections
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow requests from Replit dev/app domains (mobile app)
  if (origin && (
    origin.endsWith('.replit.dev') || 
    origin.endsWith('.replit.app') ||
    origin.includes('localhost')
  )) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

const jsonBodyParser =
  express.json({
    limit: '100mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });
app.use((req, res, next) => req.path.startsWith("/api/file-exchange/") ? next() : jsonBodyParser(req, res, next));

const urlBodyParser = express.urlencoded({ extended: false, limit: '100mb' });
app.use((req, res, next) => req.path.startsWith("/api/file-exchange/") ? next() : urlBodyParser(req, res, next));

// Cookie parser for reading cookies (needed for Turnstile verification)
app.use(cookieParser());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use(requestLogging(log));

(async () => {
  // Initialize persistent file logging
  initializeLogger();
  await initializeRouting();
  await initializeVisitScheduling();
  await initializeGpsSchema(pool);
  await initializeWorkOrderLifecycle(pool);
  await initializeBackupSchema(pool);
  await initializeFileTransfers(pool);
  await initializeReadingPrecision(pool);
  await initializeProjectExactReadings(pool);
  await initializeCustomerApi();
  await initializeApiImports();
  await initializeAudit(pool);
  await initializeAccessLocks();
  await reconcileAuditOperations();
  
  await initializeInventory(pool);
  await assertAttachmentLayoutReady();
  await registerRoutes(httpServer, app);
  await registerCustomerExtensions(app, {auth:isAuthenticated, storage});

  // Missing API routes must not fall through to the web application's HTML.
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "API endpoint not found." });
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    // Log detailed error to file, return minimal info to user
    logger.error('Unhandled request error', err, {
      method: req.method,
      path: req.path,
      status
    });

    res.status(status).json({ message });
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
      // Reserve the web port first. A saved optional SFTP listener must never prevent web administration.
      void initializeEmbeddedSftp();
      startCustomerApiWorker();
      startApiImportWorker();
      startLogMaintenance();
      startAuditRetention();
      startBackupWorker();
      startFileExportWorker();
      startAutomaticClosing();
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
