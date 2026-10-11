import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { httpLoginCookiePolicy } from "./httpLoginRecovery";

export function getSession(cookieEnvironment: Record<string, string | undefined> = process.env) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  // In production with HTTPS, secure should be true
  // For HTTP (local/dev or reverse proxy without SSL), secure must be false
  const isSecure = httpLoginCookiePolicy(cookieEnvironment).secure;
  
  const middleware = session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
  // Stored sessions carry their original cookie options. Reapply the current
  // server policy after loading so recovery also works for existing sessions.
  const withCookiePolicy: RequestHandler = (req, res, next) => middleware(req, res, error => {
    if (error) return next(error);
    if (req.session) {
      const secure = httpLoginCookiePolicy(cookieEnvironment).secure;
      if (req.session.cookie.secure !== secure) {
        req.session.cookie.secure = secure;
        // Cookie-only edits are ignored by express-session's modified check.
        // This private marker makes it persist and issue the corrected cookie.
        (req.session as any).httpCookiePolicySecure = secure;
      }
    }
    next();
  });
  return withCookiePolicy;
}

export async function setupAuth(app: Express, cookieEnvironment: Record<string, string | undefined> = process.env) {
  app.set("trust proxy", 1);
  app.use(getSession(cookieEnvironment));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/security/http-login-recovery", isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { storage } = await import("./storage");
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      res.json({ enabled: httpLoginCookiePolicy(cookieEnvironment).enabled });
    } catch {
      res.status(500).json({ message: "Unable to read HTTP login recovery status" });
    }
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  return res.status(401).json({ message: "Session expired" });
};
