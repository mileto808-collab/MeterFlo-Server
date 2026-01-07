import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { importScheduler } from "./importScheduler";
import { fileImportScheduler } from "./fileImportScheduler";
import { storage } from "./storage";

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

// CORS middleware for mobile app connections (including native Android/iOS apps)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const refererHeader = req.headers.referer || req.headers.referrer;
  const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
  
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
  
  if (origin && isAllowedOrigin(origin)) {
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
    const userAgent = req.headers['user-agent'] || '(none)';
    console.log(`[MOBILE-DEBUG] ${req.method} ${req.path}`);
    console.log(`  Origin: ${origin}`);
    console.log(`  Referer: ${referer}`);
    console.log(`  X-Requested-With: ${xRequestedWith}`);
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
