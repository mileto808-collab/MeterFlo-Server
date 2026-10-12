# Complete Windows Deployment Guide for MeterFlo

This comprehensive guide walks you through deploying MeterFlo (or any Replit Node.js/Express/React web application) on a Windows server with XAMPP/Apache, PostgreSQL, Git, and Node.js.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Software Installation](#2-software-installation)
3. [PostgreSQL Database Setup](#3-postgresql-database-setup)
4. [Clone the Project](#4-clone-the-project)
5. [Environment Variables](#5-environment-variables)
6. [Build the Application](#6-build-the-application)
   - [6a. Initialize the Database Schema](#6a-initialize-the-database-schema) (fresh installs)
7. [PM2 Process Manager Setup](#7-pm2-process-manager-setup)
8. [Apache Reverse Proxy Configuration](#8-apache-reverse-proxy-configuration)
   - [8a. Subdirectory Deployment](#8a-subdirectory-deployment-multiple-sites-on-same-server) (e.g., `/htdocs/meterflo/`)
9. [HTTPS/SSL Configuration](#9-httpsssl-configuration)
10. [Updating the Application](#10-updating-the-application)
11. [Useful Commands Reference](#11-useful-commands-reference)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Before starting, ensure you have administrator access to your Windows server.

**Required Software:**
| Software | Minimum Version | Purpose |
|----------|-----------------|---------|
| Node.js | 18.x or higher | JavaScript runtime |
| PostgreSQL | 14.x or higher | Database server |
| Git for Windows | 2.x or higher | Version control + Git Bash shell |
| XAMPP | 8.x or higher | Apache web server |

> **Note:** Git for Windows includes Git Bash, a Unix-like shell that can help resolve compatibility issues with certain npm/npx commands on Windows.

---

## 2. Software Installation

### 2.1 Install Node.js

1. Download from: https://nodejs.org/en/download/
2. Choose the **LTS** version (Windows Installer .msi)
3. Run the installer with default options
4. Verify installation:
   ```cmd
   node --version
   npm --version
   ```

> **Note:** Set `PORT=3000` in the protected install-root `.env`. The application's fallback is port 5000; the PM2 template no longer overrides host, port or cookie security. Keep Apache's `ProxyPass` target in sync with `.env`.

### 2.2 Install PostgreSQL

1. Download from: https://www.postgresql.org/download/windows/
2. Run the installer
3. **Important settings during installation:**
   - Set a strong password for the `postgres` superuser (remember this!)
   - Default port: `5432`
   - Check "Stack Builder" if you want additional tools
4. **Add PostgreSQL bin folder to Windows PATH** (required for backup/restore functionality):
   - Right-click "This PC" → Properties → Advanced system settings
   - Click "Environment Variables"
   - Under "System variables", find and select "Path", then click "Edit"
   - Click "New" and add: `C:\Program Files\PostgreSQL\{version}\bin`
     - Replace `{version}` with your PostgreSQL version (e.g., `16`, `17`)
   - Click OK to save all dialogs
   - **Restart Command Prompt** for the change to take effect
5. Verify installation:
   ```cmd
   psql --version
   pg_dump --version
   ```

> **Important:** The `pg_dump.exe` tool must be accessible from the command line for the Database Backup feature to work. If `pg_dump --version` returns an error, the backup/restore functionality will not work.

> **Alternative:** Set `PG_BIN_PATH` in the private `.env` or an approved service environment (e.g., `C:\Program Files\PostgreSQL\18\bin`), then restart MeterFlo. Do not add application settings to the PM2 configuration.

### 2.3 Install Git for Windows (includes Git Bash)

1. Download from: https://git-scm.com/download/win
2. Run the installer with default options
   - **Important:** Keep "Git Bash Here" option checked (default)
   - This installs Git Bash, which provides Unix-like shell utilities
3. Verify installation:
   ```cmd
   git --version
   ```

> **Tip:** Most commands work in Command Prompt, but if you encounter issues with `npx` or build scripts, try running them in Git Bash instead.

### 2.4 Install XAMPP

1. Download from: https://www.apachefriends.org/download.html
2. Run the installer
3. Install to default location: `C:\xampp`
4. After installation, open XAMPP Control Panel
5. Start Apache (we'll configure it later)

### 2.5 Install PM2 (Process Manager)

Open Command Prompt **as Administrator**:
```cmd
npm install -g pm2
npm install -g pm2-windows-startup
```

---

## 3. PostgreSQL Database Setup

### 3.1 Create the Database and User

Open Command Prompt and connect to PostgreSQL:
```cmd
psql -U postgres
```

Enter the postgres password you set during installation.

Create the role and use psql's interactive password prompt, which avoids putting the password into SQL or operating-system command history:
```sql
-- Create a dedicated user for the application
CREATE USER meterflo_user;
\password meterflo_user

-- Create the database
CREATE DATABASE meterflo OWNER meterflo_user;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE meterflo TO meterflo_user;

-- Exit psql
\q
```

### 3.2 Special Characters in Passwords

If your password contains special characters, you must URL-encode them in the DATABASE_URL:

| Character | URL Encoded |
|-----------|-------------|
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `/` | `%2F` |
| `:` | `%3A` |
| `=` | `%3D` |
| `?` | `%3F` |

**Example:** If password is `Pa$$word#123`, the DATABASE_URL becomes:
```
postgresql://meterflo_user:Pa%24%24word%23123@localhost:5432/meterflo
```

### 3.3 Configure PostgreSQL for Local Connections

Edit `C:\Program Files\PostgreSQL\{version}\data\pg_hba.conf`:

Find the line for IPv4 local connections and ensure it says:
```
# IPv4 local connections:
host    all             all             127.0.0.1/32            scram-sha-256
```

Restart PostgreSQL service after changes:
```cmd
net stop postgresql-x64-14
net start postgresql-x64-14
```
(Replace `14` with your PostgreSQL version number)

---

## 4. Clone the Project

### 4.1 Initial Clone from Replit

1. In Replit, go to your project
2. Click the "Git" tab in the left panel
3. Copy the repository URL

Clone to your XAMPP htdocs folder:
```cmd
cd C:\xampp\htdocs
git clone https://replit.com/@YourUsername/YourProject.git .
```

**Note:** The `.` at the end clones directly into htdocs without creating a subfolder.

### 4.2 Alternative: Download as ZIP

If git clone doesn't work:
1. In Replit, click the three dots menu → "Download as ZIP"
2. Extract the contents to `C:\xampp\htdocs\`

### 4.3 Install Node Dependencies

```cmd
cd C:\xampp\htdocs
npm install
```

---

## 5. Environment Variables

The application reads its secrets and runtime settings from a `.env` file in the install root. The repository ships a `.env.example` template — your only job here is to copy it to `.env` and fill in the real values. The server loads `.env` automatically on startup (via `dotenv`, imported at the top of `server/index.ts`), so there is nothing to wire up in the PM2 ecosystem file.

### 5.1 Create your `.env` from the template

```cmd
cd C:\xampp\htdocs
copy .env.example .env
notepad .env
```

`.env.example` is committed to the repo and contains only safe placeholders. `.env` is listed in `.gitignore` and must never be committed. Open `.env` and replace the placeholder values:

**For HTTP connections (no SSL):**
```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
COOKIE_SECURE=false
DATABASE_URL=postgresql://meterflo_user:your_password@localhost:5432/meterflo
SESSION_SECRET=generate-a-random-64-character-string-here
# Optional - only set if you configure email sending
# in Settings > Contact & Support Forms
SMTP_PASSWORD=your-smtp-password
```

**For HTTPS connections (with SSL):** the only change is `COOKIE_SECURE=true`. Set it after you have completed Section 9.

> **Why `HOST=127.0.0.1`:** Binding the Node listener to the loopback interface means port 3000 is reachable only from this machine. All public traffic comes through Apache on ports 80/443. Treat the firewall rule that blocks port 3000 as a fallback — `HOST=127.0.0.1` is the primary defense.

> **Security:** The repository ships `deploy/ecosystem.config.example.cjs`, not the machine-specific `deploy/ecosystem.config.cjs`. Copy the template as described in Section 7.2. The local copy is ignored, but ignore rules do not protect already-tracked/force-added files or remove historical secrets. Neither configuration file may contain credentials. The template's runtime guard permits only `NODE_ENV=production` in PM2's `env` block and rejects other environment blocks or command arguments.

**Settings precedence:** the PM2 template fixes production launch mode only. Approved inherited service/system variables win over `.env`; dotenv fills variables not already present, without overriding external secrets. Set `HOST`, `PORT`, `COOKIE_SECURE`, both recovery flags and application credentials in `.env` or your approved service environment, not both. Only root `.env` loads automatically; ignored variants such as `.env.production` do not load automatically.

**Optional settings and examples:** use `SMTP_PASSWORD` only when outbound email is configured; set `PG_BIN_PATH` to your PostgreSQL bin folder if it is not on PATH; set `LOG_DIR` to a protected log directory if the default `logs/` is unsuitable. Keep `EMERGENCY_HTTP_LOGIN=false` and `TURNSTILE_EMERGENCY_BYPASS=false` normally. Customer API settings can reference additional credential names, for example `CUSTOMER_API_TOKEN`; create that variable privately and configure only its name in MeterFlo.

**Protect private files:** restrict `.env`, logs, backups and PM2's home directory to the service identity and authorized administrators. On Windows, review Properties → Security and verify the service can still read `.env` before restarting. Do not place secret-bearing backups in Git or a publicly served directory. If Apache can serve install-root files directly, deny private files and `.git` as shown below, and verify direct HTTP requests are denied. Adapt the directory scope for subdirectory installs.
An example defense for a root install is below; adapt both paths for a subdirectory and verify requests such as `/.env` and `/.git/config` are denied (not served by an alias or fallback):

```apache
<Directory "C:/xampp/htdocs">
    <FilesMatch "(?i)^(\.env(?:\..*)?|ecosystem.*\.(?:cjs|js|mjs)|dump\.pm2(?:\.bak)?)$">
        Require all denied
    </FilesMatch>
</Directory>
<Directory "C:/xampp/htdocs/.git">
    Require all denied
</Directory>
```

### 5.2 Cookie Security Explained

| Variable | Value | When to Use |
|----------|-------|-------------|
| `COOKIE_SECURE` | not set or `false` | HTTP only (no SSL certificate) |
| `COOKIE_SECURE` | `true` | HTTPS enabled (SSL certificate installed) |

**Important:** If you set `COOKIE_SECURE=true` but don't have HTTPS configured, users will NOT be able to log in because the browser won't send the session cookie over HTTP.

If this mismatch locks you out, use the temporary [HTTP login recovery procedure](#temporary-http-login-recovery) in Section 12. The recovery flag takes precedence over `COOKIE_SECURE` without editing its permanent value. Cookie security is controlled by the running server's environment, not a database setting.

### 5.3 Generate a Secure SESSION_SECRET

Use Node.js to generate a random secret:
```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste it as the `SESSION_SECRET` value in your `.env` file.

### 5.4 Restart PM2 After Editing `.env`

`.env` is read once when the server starts. After any change to `.env`, restart the app so the new values take effect:

```cmd
pm2 restart meterflo
```

This works when the settings exist only in `.env` and the copied configuration already follows the new policy. **`--update-env` is not a guarantee that old PM2 overrides are removed.** For legacy/cached overrides, follow the clean-process migration in Section 10; verify the resulting cookie policy and recovery warning, not just an `online` status.

### 5.5 Alternative: Windows System Environment Variables

`.env` is the recommended path because it keeps application settings in one protected file. If your organization supplies credentials through an approved service environment, omit those entries from `.env`; inherited values take precedence. A Windows credential-store entry alone does not become a process variable—the service must explicitly supply it. After changing system variables, open a fresh terminal and restart the relevant PM2 service/daemon using your administrator's procedure; an already-running daemon may retain its old environment. Never print the full environment or PM2 process dump for troubleshooting.

---

## 6. Build the Application

### 6.1 Run the Build Script

The build process compiles TypeScript and bundles the application:

```cmd
cd C:\xampp\htdocs
npx tsx script/build.ts
```

This creates the `dist/` folder containing:
- `dist/index.cjs` - The compiled server
- `dist/public/` - The compiled frontend

### 6.2 Verify the Build

Check that the dist folder was created:
```cmd
dir dist
```

You should see `index.cjs` and a `public` folder.

---

## 6a. Initialize the Database Schema

On a brand-new database (the one you created in Section 3), the application's tables don't exist yet. The application will start without errors but every page will fail at runtime once it queries the database. You have two ways to populate the schema.

### 6a.1 Option A — Push the schema with Drizzle (fresh install)

This is the standard path for a clean install:

```cmd
cd C:\xampp\htdocs
npm run db:push
```

This runs `drizzle-kit push` (defined in `package.json`) and creates every table the application needs. It reads `DATABASE_URL` from your environment, so make sure the variables from Section 5 are set in your shell before running it.

If `drizzle-kit` reports that it would drop columns or tables and asks for confirmation, abort and re-check that you pointed it at an empty database — never accept destructive changes against a database that already holds work order data.

### 6a.2 Option B — Restore a Clean Database Backup

If you have a Clean Database Backup file (see "System Backup/Restore" in the System Admin Guide), restore it instead:

```cmd
psql -U postgres -d meterflo -f C:\path\to\clean-backup.sql
```

A Clean Database Backup includes the full schema plus the minimum configuration data needed to log in (admin user, subroles, permissions, system settings, work order statuses). After restoring, you do **not** need to run `npm run db:push`.

---

## 7. PM2 Process Manager Setup

### 7.1 Create Logs Directory

```cmd
cd C:\xampp\htdocs
mkdir logs
```

### 7.2 Configure PM2 Ecosystem File

Fresh clones contain a **secret-free template** and its policy validator. Create the ignored local copy:

```cmd
cd C:\xampp\htdocs
copy deploy\ecosystem.config.example.cjs deploy\ecosystem.config.cjs
node script/check-deployment-secrets.mjs --config deploy/ecosystem.config.cjs
```

Keep the copy in `deploy/` alongside `pm2-config-policy.cjs`. Its paths derive automatically from that directory on Windows/Linux, including subdirectory installs. Do not load dotenv inside the PM2 configuration: that would copy credentials into PM2's environment and saved process state. The application itself already loads dotenv.

The only fixed environment entry is `NODE_ENV: 'production'`. Do not add `HOST`, `PORT`, `COOKIE_SECURE`, recovery flags, credential placeholders, alternate `env_*` blocks or CLI arguments. Runtime validation rejects unsupported additions without printing values; static checks also reject unguarded configuration. These checks prevent accidental changes, not a privileged operator deliberately removing safeguards.

### 7.3 Start the Application

```cmd
cd C:\xampp\htdocs
pm2 start deploy/ecosystem.config.cjs
```

### 7.4 Verify It's Running

```cmd
pm2 list
```

You should see `meterflo` with status `online`.

Test direct access:
```cmd
curl http://127.0.0.1:3000
```

Or open `http://127.0.0.1:3000` in a browser.

### 7.5 Configure Auto-Start on Windows Boot

Save the current process list:
```cmd
pm2 save
```

Protect PM2's home directory and saved dumps. PM2 can serialize inherited environment variables; never commit or share its dumps, and do not restore an old dump containing legacy credential overrides after migration. Dotenv loading inside the application does not itself populate the PM2 daemon's environment.

Install Windows startup script:
```cmd
pm2-startup install
```

Follow any prompts. The application will now start automatically when Windows boots.

---

## 8. Apache Reverse Proxy Configuration

### 8.1 Enable Required Apache Modules

Edit `C:\xampp\apache\conf\httpd.conf` and find these lines (remove the `#` to uncomment):

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
```

### 8.2 Add Proxy Configuration

Add to the end of `C:\xampp\apache\conf\httpd.conf`:

```apache
<VirtualHost *:80>
    ServerName localhost
    
    # Preserve the original host header
    ProxyPreserveHost On
    
    # Proxy all requests to Node.js
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # Timeout for SSE (Server-Sent Events) connections
    ProxyTimeout 600
    
    # Disable buffering for real-time updates
    SetEnv proxy-sendchunked 1
    
    # Logging
    ErrorLog "logs/meterflo-error.log"
    CustomLog "logs/meterflo-access.log" common
</VirtualHost>
```

### 8.3 Restart Apache

Use XAMPP Control Panel: Stop Apache, then Start Apache.

Or via command line:
```cmd
C:\xampp\apache\bin\httpd.exe -k restart
```

### 8.4 Test the Setup

Open a browser and go to: `http://localhost`

You should see the application login page.

---

## 8a. Subdirectory Deployment (Multiple Sites on Same Server)

If you need to run MeterFlo in a subdirectory (e.g., `/meterflo/`) alongside other websites in `/htdocs/`, follow this configuration.

### Scenario

```
C:\xampp\htdocs\
├── meterflo\           ← MeterFlo application
│   ├── dist\
│   ├── deploy\
│   ├── package.json
│   └── ...
├── other-website\      ← Another website
└── index.html          ← Main htdocs landing page
```

Users access MeterFlo at: `http://yourserver.com/meterflo/`

### 8a.1 Clone/Install to Subdirectory

```cmd
cd C:\xampp\htdocs
mkdir meterflo
git clone https://replit.com/@YourUsername/YourProject.git meterflo
cd meterflo
npm install
```

### 8a.2 Configure Vite Base Path

Edit `vite.config.ts` in your MeterFlo directory and add the `base` option:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "/meterflo/",  // Add this line for subdirectory deployment
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  // ... rest of config
});
```

> **Important:** The `base` path must match your subdirectory name with leading and trailing slashes.

#### Also set the wouter router base path

Vite's `base` only fixes asset URLs (the `<script>` and `<link>` tags in the HTML). The frontend uses [wouter](https://github.com/molefrog/wouter) for client-side routing, and wouter still thinks the app is mounted at `/`. Without a matching router base, in-app links generated by `<Link href="/work-orders">` will navigate to `/work-orders` instead of `/meterflo/work-orders`, the browser will hit Apache's root rules instead of the proxy, and you'll see 404s or the wrong site.

Edit `client/src/App.tsx` (or wherever the top-level `<Router>` lives) and pass the matching `base` prop:

```typescript
import { Router } from "wouter";

// At the root of your app:
<Router base="/meterflo">
  {/* ...routes... */}
</Router>
```

Notes:
- The wouter `base` does **not** include a trailing slash (use `/meterflo`, not `/meterflo/`). The Vite `base` does (use `/meterflo/`). This asymmetry is by design in each library.
- Keep the two values in sync. If you change the subdirectory name, update both files.
- Rebuild after the change (Section 8a.9).

### 8a.3 Update PM2 Ecosystem Configuration

From the subdirectory install root, copy the template:

```cmd
cd C:\xampp\htdocs\meterflo
copy deploy\ecosystem.config.example.cjs deploy\ecosystem.config.cjs
```

No `cwd` edit is needed: the copied template derives `C:\xampp\htdocs\meterflo` from its location. Put `.env` in that root; configure host/port there. No `BASE_PATH` is needed because Apache strips the `/meterflo` prefix. Keep the validator file alongside the copy.

### 8a.4 Configure Apache httpd.conf for Subdirectory

Edit `C:\xampp\apache\conf\httpd.conf` and add the proxy configuration:

```apache
# Enable required modules (uncomment these lines)
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule rewrite_module modules/mod_rewrite.so

# Virtual Host configuration for multiple sites
<VirtualHost *:80>
    ServerName localhost
    DocumentRoot "C:/xampp/htdocs"
    
    # Serve static files from htdocs root for other websites
    <Directory "C:/xampp/htdocs">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    
    # Proxy MeterFlo subdirectory to Node.js application
    ProxyPreserveHost On
    
    # CRITICAL: Trailing slash configuration
    # ProxyPass /meterflo http://127.0.0.1:3000/
    #   - Request: GET /meterflo/api/users
    #   - Forwarded to Node.js as: GET /api/users
    #   - This STRIPS the /meterflo prefix before forwarding
    #
    # The Node.js/Express server receives requests at root (/)
    # and does NOT need any code changes.
    
    ProxyPass /meterflo http://127.0.0.1:3000/
    ProxyPassReverse /meterflo http://127.0.0.1:3000/
    
    # SSE (Server-Sent Events) support
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
    
    # Logging
    ErrorLog "logs/meterflo-error.log"
    CustomLog "logs/meterflo-access.log" common
</VirtualHost>
```

#### How This Works

| Browser Request | Apache Receives | Apache Forwards to Node.js |
|-----------------|-----------------|---------------------------|
| `GET /meterflo/` | `/meterflo/` | `GET /` |
| `GET /meterflo/api/users` | `/meterflo/api/users` | `GET /api/users` |
| `GET /meterflo/assets/index.js` | `/meterflo/assets/index.js` | `GET /assets/index.js` |

**Key Points:**
- Apache **strips** the `/meterflo` prefix before forwarding to Node.js
- The Node.js/Express server **does not need any code changes**
- The server receives clean URLs like `/api/users` instead of `/meterflo/api/users`
- Only Vite needs the `base` path (for generating correct asset URLs in HTML)

### 8a.5 Why Vite's Base Path is Needed

When Vite builds the frontend, it embeds asset URLs in the HTML:

**Without `base: "/meterflo/"`:**
```html
<script src="/assets/index.js"></script>  <!-- Won't work! -->
```

**With `base: "/meterflo/"`:**
```html
<script src="/meterflo/assets/index.js"></script>  <!-- Correct! -->
```

The browser requests `/meterflo/assets/index.js`, Apache strips the prefix and forwards `/assets/index.js` to Node.js, which serves the file correctly.

### 8a.6 Alternative: Keep Path Prefix in Node.js (Advanced)

If your application needs to know it's running under `/meterflo/`, use this configuration instead:

```apache
# This keeps /meterflo in the path sent to Node.js
ProxyPass /meterflo http://127.0.0.1:3000/meterflo
ProxyPassReverse /meterflo http://127.0.0.1:3000/meterflo
```

With this approach, your Express routes must be prefixed:
```javascript
// In server code - requires mounting all routes under /meterflo
const app = express();
const router = express.Router();

// All routes go on the router
router.get('/api/health', (req, res) => { ... });
router.use(express.static('dist/public'));

// Mount router under /meterflo
app.use('/meterflo', router);
```

> **Recommendation:** Use the path-stripping approach (Section 8a.4) as it requires no code changes.

### 8a.7 HTTPS Configuration for Subdirectory

For SSL/HTTPS with subdirectory deployment, update your VirtualHost:

```apache
<VirtualHost *:443>
    ServerName yourserver.com
    DocumentRoot "C:/xampp/htdocs"
    
    SSLEngine on
    SSLCertificateFile "conf/ssl.crt/server.crt"
    SSLCertificateKeyFile "conf/ssl.key/server.key"
    
    # Serve static files from htdocs root
    <Directory "C:/xampp/htdocs">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    
    # Proxy MeterFlo subdirectory to Node.js
    ProxyPreserveHost On
    ProxyPass /meterflo http://127.0.0.1:3000/
    ProxyPassReverse /meterflo http://127.0.0.1:3000/
    
    # SSE support
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
    
    # WebSocket support (if needed)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /meterflo/(.*) ws://127.0.0.1:3000/$1 [P,L]
</VirtualHost>

# HTTP to HTTPS redirect
<VirtualHost *:80>
    ServerName yourserver.com
    Redirect permanent / https://yourserver.com/
</VirtualHost>
```

### 8a.8 Environment Variables for Subdirectory

Your `.env` file or Windows System Environment Variables remain the same as a standard installation:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://meterflo_user:your_password@localhost:5432/meterflo
SESSION_SECRET=your-secret-key
```

> **Note:** No special environment variables are needed for subdirectory deployment. Apache handles the path prefix stripping, so the Node.js server runs identically to a root installation.

### 8a.9 Rebuild and Restart

After making these changes:

```cmd
cd C:\xampp\htdocs\meterflo
npx tsx script/build.ts
pm2 restart meterflo
```

Restart Apache:
```cmd
C:\xampp\apache\bin\httpd.exe -k restart
```

### 8a.10 Verify Subdirectory Setup

1. **Test MeterFlo**: Open `http://localhost/meterflo/` - should show login page
2. **Test other sites**: Open `http://localhost/` - should show htdocs index
3. **Test API**: Open `http://localhost/meterflo/api/health` - should return OK

### 8a.11 Troubleshooting Subdirectory Issues

| Issue | Solution |
|-------|----------|
| **404 on static assets** | Verify `base` in vite.config.ts matches your subdirectory |
| **API calls fail** | Check ProxyPass has correct trailing slashes |
| **Login redirect loops** | With the path-stripping config in Section 8a.4, the session cookie path can stay at the default `/` — no extra config needed. If you still get loops, you almost always have `COOKIE_SECURE=true` set while accessing over HTTP. Set it to `false` until HTTPS is configured (see Section 5.2 / 9.6), and confirm the browser is actually receiving and sending the `connect.sid` cookie via DevTools > Application > Cookies. |
| **CSS/JS not loading** | Rebuild after changing vite.config.ts base path |
| **In-app links go to the wrong URL** | The wouter router `base` is missing or doesn't match the Vite base — see Section 8a.2 |
| **Apache shows "Forbidden"** | Check Directory permissions in httpd.conf |

### 8a.12 Files Changed Summary

| File | Change |
|------|--------|
| `vite.config.ts` | Add `base: "/meterflo/"` for correct asset URLs |
| `client/src/App.tsx` | Add matching `base="/meterflo"` on the wouter `<Router>` |
| `deploy/ecosystem.config.cjs` | Update `cwd` path to subdirectory location |
| `C:\xampp\apache\conf\httpd.conf` | Add ProxyPass for subdirectory with path stripping |

> **Note:** No changes needed to `.env`, Express server code, or API routes. Apache handles all path prefix management.

---

## 9. HTTPS/SSL Configuration

Setting up HTTPS ensures secure encrypted connections to your MeterFlo server.

### 9.1 SSL Certificate Options

| Option | Cost | Best For | Validity |
|--------|------|----------|----------|
| **Self-Signed** | Free | Internal/testing | Unlimited |
| **Let's Encrypt** | Free | Production with public domain | 90 days (auto-renew) |
| **Commercial SSL** | $10-$200/year | Enterprise/regulated environments | 1-2 years |

### 9.2 Enable Required Apache Modules

Edit `C:\xampp\apache\conf\httpd.conf` and ensure these lines are **uncommented** (no `#` at the start):

```apache
LoadModule ssl_module modules/mod_ssl.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule rewrite_module modules/mod_rewrite.so
```

Also uncomment:
```apache
Include conf/extra/httpd-ssl.conf
```

---

### 9.3 Option A: Self-Signed Certificate (Quick Setup)

Self-signed certificates are ideal for internal networks or testing. Browsers will show a security warning, but the connection is still encrypted.

#### Step 1: Generate the Certificate

1. Navigate to `C:\xampp\apache`
2. Double-click `makecert.bat`
3. Answer the prompts:
   - **PEM Pass Phrase**: Enter a password (you'll need it twice)
   - **Country Code**: 2-letter code (e.g., `US`)
   - **State/Province**: Your state
   - **City**: Your city
   - **Organization**: Your company name
   - **Common Name**: Your server IP or domain (e.g., `192.168.1.152`)

The script creates:
- `C:\xampp\apache\conf\ssl.crt\server.crt`
- `C:\xampp\apache\conf\ssl.key\server.key`

#### Step 2: Configure HTTPS VirtualHost

Edit `C:\xampp\apache\conf\extra\httpd-vhosts.conf` and add:

```apache
<VirtualHost *:443>
    ServerName 192.168.1.152
    
    SSLEngine on
    SSLCertificateFile "conf/ssl.crt/server.crt"
    SSLCertificateKeyFile "conf/ssl.key/server.key"
    
    # Reverse proxy to Node.js app
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # WebSocket support for SSE
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:3000/$1 [P,L]
    
    # SSE support
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
</VirtualHost>
```

> **Note:** Replace `192.168.1.152` with your server's IP address and `3000` with your Node.js port. Keep the upstream URL as `127.0.0.1` (not `localhost`) to skip the DNS / IPv6 resolution step on Windows.

---

### 9.4 Option B: Let's Encrypt with win-acme (Production)

Let's Encrypt provides free, trusted SSL certificates. Requires a public domain pointing to your server.

#### Prerequisites
- A domain name (e.g., `meterflo.yourdomain.com`)
- Port 80 open to the internet (for certificate validation)
- DNS pointing to your server's public IP

#### Step 1: Download win-acme

1. Download from: https://github.com/win-acme/win-acme/releases
2. Get the `win-acme.v2.x.x.x64.pluggable.zip` file
3. Extract to `C:\win-acme`

#### Step 2: Run win-acme

Open Command Prompt as Administrator:
```cmd
cd C:\win-acme
wacs.exe --verbose
```

#### Step 3: Follow the Prompts

1. Press **M** (Create certificate with full options)
2. Select **Option 2** (Manual input for host names)
3. Enter your domain: `meterflo.yourdomain.com`
4. Select **Option 1** (Save verification file in webroot)
5. Enter webroot path: `C:\xampp\htdocs`
6. Choose **N** when asked about web.config
7. Select **Option 2** for RSA key
8. Select **Option 2** for PEM files output
9. Specify output folder: `C:\xampp\apache\conf\ssl`
10. Select **Option 5** (No additional storage)
11. Select **Option 3** for restart script (see below)

#### Step 4: Create Apache Restart Script

Create `C:\win-acme\Scripts\RestartApache.bat`:
```batch
@echo off
echo [INFO] Restarting Apache...
C:\xampp\apache\bin\httpd.exe -k restart
echo [INFO] Apache restarted successfully
```

#### Step 5: Configure HTTPS VirtualHost

Edit `C:\xampp\apache\conf\extra\httpd-vhosts.conf`:

```apache
<VirtualHost *:443>
    ServerName meterflo.yourdomain.com
    
    SSLEngine on
    SSLCertificateFile "C:/xampp/apache/conf/ssl/meterflo.yourdomain.com-chain.pem"
    SSLCertificateKeyFile "C:/xampp/apache/conf/ssl/meterflo.yourdomain.com-key.pem"
    
    # Reverse proxy to Node.js app
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # WebSocket support for SSE
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:3000/$1 [P,L]
    
    # SSE support
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
</VirtualHost>
```

> **Note:** win-acme automatically creates a scheduled task to renew certificates before they expire.

---

### 9.5 Force HTTP to HTTPS Redirect

Add this VirtualHost to redirect all HTTP traffic to HTTPS:

```apache
<VirtualHost *:80>
    ServerName 192.168.1.152
    Redirect permanent / https://192.168.1.152/
</VirtualHost>
```

For domain-based setup:
```apache
<VirtualHost *:80>
    ServerName meterflo.yourdomain.com
    Redirect permanent / https://meterflo.yourdomain.com/
</VirtualHost>
```

---

### 9.6 Update Environment for Secure Cookies

After enabling HTTPS, configure the application to use secure cookies:

1. Edit the protected install-root `.env` (or the approved service environment), setting:
   ```ini
   COOKIE_SECURE=true
   EMERGENCY_HTTP_LOGIN=false
   ```

2. Restart PM2:
   ```cmd
   pm2 restart meterflo
   ```

> Do not set cookie security in the PM2 configuration. If an old PM2/system override exists, migrate it using Section 10. Verify a fresh HTTPS login sets a `Secure`, `HttpOnly`, `SameSite=Lax` cookie and the HTTP recovery warning is absent.

---

### 9.7 Restart Apache and Test

```cmd
C:\xampp\apache\bin\httpd.exe -t
C:\xampp\apache\bin\httpd.exe -k restart
```

Test your setup:
- Visit `http://192.168.1.152` - should redirect to HTTPS
- Visit `https://192.168.1.152` - should show MeterFlo login page

---

### 9.8 Firewall Configuration

Ensure these ports are open:

| Port | Protocol | Purpose |
|------|----------|---------|
| 80 | TCP | HTTP (for redirect and Let's Encrypt validation) |
| 443 | TCP | HTTPS |

Windows Firewall commands:
```cmd
netsh advfirewall firewall add rule name="HTTP" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="HTTPS" dir=in action=allow protocol=TCP localport=443
```

---

### 9.9 Troubleshooting SSL

| Issue | Solution |
|-------|----------|
| **502 Proxy Error** | Node.js app not running. Check: `pm2 status` |
| **Browser shows "Not Secure"** | Self-signed cert (expected) or certificate doesn't match domain |
| **Apache won't start** | Check syntax: `httpd.exe -t` and logs: `C:\xampp\apache\logs\error.log` |
| **Port 443 in use** | Another service using port 443. Check: `netstat -an | findstr 443` |
| **Certificate expired** | For Let's Encrypt, run: `wacs.exe --renew --force` |

---

## 10. Updating the Application

### Deployment configuration migration

**Plan a short outage and secure backup first.** Earlier configurations may contain credentials, hard-coded cookie/port settings or cached recovery flags. A pull deleting a formerly tracked file can remove a clean local copy; a modified copy can instead block the pull. Do not rely on Git preserving it, and do not force-reset before backup.

1. Before upgrading, privately back up `.env`, the local configuration and necessary data outside the repository/web root with restricted access. Do not paste them into chat, logs or tickets. If `.env` already exists, preserve it; otherwise copy the safe environment template. Move any legacy configuration credentials and application settings into that private file, retaining your actual host, port, cookie and recovery choices.
2. Update and build the application. Check that the new PM2 example and policy validator are present. After confirming the private settings/backup, replace the old local configuration with the shipped template; remove old commented credential examples too:
   ```cmd
   copy /Y deploy\ecosystem.config.example.cjs deploy\ecosystem.config.cjs
   node script/check-deployment-secrets.mjs --config deploy/ecosystem.config.cjs
   ```
3. Correct/remove duplicate application overrides in the approved service/system environment. Open a fresh terminal. Recreate **only the MeterFlo app** to discard its per-app cached PM2 settings (this interrupts service):
   ```cmd
   pm2 delete meterflo
   pm2 start deploy/ecosystem.config.cjs
   pm2 save
   ```
   Do not use a restart alone to remove old keys. If the PM2 daemon/service itself inherited old settings, have the service administrator restart it with the corrected environment and recreate applications from approved definitions, not an old saved dump. Do not run `pm2 kill` on a shared daemon without coordinating downtime for every app.
4. Verify the intended port/host, successful login, correct HTTPS cookie flags, and absence of the recovery warning when `EMERGENCY_HTTP_LOGIN=false`. Reboot/service restart should retain the intended configuration. If a recovery flag is still enabled, correct the effective service environment rather than repeatedly editing `.env`.
5. Review the values-free history audit and arrange separately approved credential rotation for actual exposures. Session-secret rotation invalidates browser sessions; database-password changes require coordinated application updates; SMTP/API credentials must be revoked at their provider. Do not claim old credentials are safe merely because the file is now ignored.

Fresh installs follow Sections 5 and 7.2 directly. This release does not automatically overwrite an operator's ignored local configuration, change live credentials, revoke sessions, or rewrite Git history.

### 10.1 Setting Up GitHub for Updates (Recommended)

If you want to manage your MeterFlo installation through GitHub instead of Replit, follow these steps:

#### Step 1: Create a GitHub Repository

1. Go to https://github.com and create a new repository (e.g., `meterflo-server`)
2. Keep it private if you don't want the code publicly accessible

#### Step 2: Push Code from Replit to GitHub

In your Replit project, open the Shell and run:
```bash
git remote add github https://github.com/your-username/meterflo-server.git
git push github main
```

#### Step 3: Set Up GitHub on Windows Server

**Option A: New Installation (empty htdocs folder)**

If you're setting up a fresh Windows server:
```cmd
cd C:\xampp
git clone https://github.com/your-username/meterflo-server.git htdocs
```

**Option B: Existing Installation (already have MeterFlo in htdocs)**

If you already have MeterFlo installed and want to switch to GitHub:
```cmd
cd C:\xampp\htdocs

# Check current remote
git remote -v

# Change remote from Replit to GitHub
git remote set-url origin https://github.com/your-username/meterflo-server.git

# Verify the change
git remote -v
```

**For private repositories**, use a Personal Access Token (PAT):

1. Generate a token at: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Select scopes: `repo` (full control of private repositories)
3. Copy and save the token securely (you won't see it again)

When you run `git clone` or `git pull`, Git will prompt for credentials:
- **Username**: Your GitHub username
- **Password**: Paste your Personal Access Token (not your GitHub password)

#### Step 4: Save Git Credentials (Recommended)

Use Git Credential Manager to securely save your credentials:
```cmd
git config --global credential.helper manager
```

On the next `git clone` or `git pull`, a popup window will appear for GitHub authentication. Sign in once, and your credentials are saved securely.

**Alternative**: Use the store helper (saves credentials in plain text):
```cmd
git config --global credential.helper store
```

The next time you enter credentials, they'll be saved to `~/.git-credentials`.

#### Step 5: Verify Remote Configuration

```cmd
cd C:\xampp\htdocs
git remote -v
```

You should see your GitHub URL. If it shows Replit instead, update it:
```cmd
git remote set-url origin https://github.com/your-username/meterflo-server.git
```

### 10.2 Pull Latest Changes

```cmd
cd C:\xampp\htdocs
git pull origin main
```

If you downloaded manually without Git, re-download and extract the files.

### 10.3 Install Any New Dependencies

```cmd
npm install
```

### 10.4 Rebuild the Application

```cmd
npx tsx script/build.ts
```

### 10.5 Apply Database Schema Changes (when required)

If the release notes call out a schema change (new tables, new columns, dropped columns), run:

```cmd
npm run db:push
```

against the production database before restarting PM2. If a release does not mention schema changes, you can skip this step. Always take a database backup first when running schema changes against production data — see "System Backup/Restore" in the System Admin Guide.

### 10.6 Restart the Application

```cmd
pm2 restart meterflo
```

### 10.7 Quick Update Command (All-in-One)

```cmd
cd C:\xampp\htdocs && git pull origin main && npm install && npx tsx script/build.ts && pm2 restart meterflo
```

> Add `&& npm run db:push` before `&& pm2 restart meterflo` only when the release notes call for a schema change.

### 10.8 Troubleshooting Git Issues

> **Important**: Before running any `git reset --hard` command, always back up your entire htdocs folder. This command will overwrite ALL files.

#### Complete Backup Before Git Reset

Always create a full backup before destructive git commands. This protects:
- `.env` - Private application settings and credentials. An untracked, ignored file is preserved by a normal Git reset, but a previously tracked file is not protected by ignore rules; deletion/mirror commands can remove it.
- `deploy\ecosystem.config.cjs` - Ignored local copy of the secret-free template (automatic install-root paths and production launch mode only). Legacy copies must be reviewed before backing up or restoring.
- `Project Files\` folder - Work order attachments and uploads

**Full backup command:**
```cmd
cd C:\xampp

# Create timestamped backup folder
mkdir meterflo-backups

# Copy everything except node_modules, dist, and .git
robocopy htdocs meterflo-backups\htdocs-backup /MIR /XD node_modules dist .git
```

> **Note**: Running this command again will update the backup. To keep multiple backups, rename the previous backup folder first (e.g., `rename meterflo-backups\htdocs-backup htdocs-backup-old`).

#### Problem: "origin does not appear to be a git repository"

This occurs when the htdocs folder was created by extracting a ZIP file instead of using git clone.

```cmd
cd C:\xampp

# STEP 1: Create full backup first (see backup commands above)
robocopy htdocs meterflo-backups\htdocs-backup /MIR /XD node_modules dist .git

cd htdocs

# STEP 2: Initialize git and connect to GitHub
git init
git remote add origin https://github.com/mileto808-collab/meterflo-server.git
git fetch origin
git reset --hard origin/main

# STEP 3: Restore all local data from backup
robocopy C:\xampp\meterflo-backups\htdocs-backup\deploy deploy /E
robocopy C:\xampp\meterflo-backups\htdocs-backup\"Project Files" "Project Files" /E

# STEP 4: Reinstall and restart
npm install
npx tsx script/build.ts
pm2 restart meterflo
```

#### Problem: "destination path 'htdocs' already exists and is not an empty directory"

This occurs when you try to clone but htdocs already has files.

```cmd
cd C:\xampp

# STEP 1: Stop the application
pm2 stop meterflo

# STEP 2: Rename existing folder as complete backup
rename htdocs htdocs_backup

# STEP 3: Clone fresh from GitHub
git clone https://github.com/mileto808-collab/meterflo-server.git htdocs

# STEP 4: Restore all local data from backup
robocopy htdocs_backup\deploy htdocs\deploy /E
robocopy htdocs_backup\"Project Files" htdocs\"Project Files" /E

# STEP 5: Install dependencies and rebuild
cd htdocs
npm install
npx tsx script/build.ts

# STEP 6: Start application
pm2 start deploy/ecosystem.config.cjs
```

> **Note**: Your complete backup is in `htdocs_backup`. After verifying everything works, you can delete it: `rmdir /s /q C:\xampp\htdocs_backup`

#### Problem: "Could not read from remote repository"

This usually means authentication failed. Ensure:
1. The repository URL is correct
2. You have a valid Personal Access Token with `repo` scope
3. Git Credential Manager is configured: `git config --global credential.helper manager`

---

## 11. Useful Commands Reference

### PM2 Commands

| Command | Description |
|---------|-------------|
| `pm2 list` | Show all running processes |
| `pm2 logs meterflo` | View live application logs |
| `pm2 logs meterflo --lines 100` | View last 100 log lines |
| `pm2 restart meterflo` | Restart the application |
| `pm2 stop meterflo` | Stop the application |
| `pm2 start meterflo` | Start the application |
| `pm2 delete meterflo` | Remove from PM2 |
| `pm2 monit` | Real-time monitoring dashboard |
| `pm2 save` | Save current process list |
| `pm2 resurrect` | Restore saved process list |

### PostgreSQL Commands

| Command | Description |
|---------|-------------|
| `psql -U postgres` | Connect as superuser |
| `psql -U meterflo_user -d meterflo` | Connect as app user |
| `\l` | List all databases |
| `\dt` | List tables in current database |
| `\q` | Exit psql |

### Apache Commands

| Command | Description |
|---------|-------------|
| `C:\xampp\apache\bin\httpd.exe -k start` | Start Apache |
| `C:\xampp\apache\bin\httpd.exe -k stop` | Stop Apache |
| `C:\xampp\apache\bin\httpd.exe -k restart` | Restart Apache |
| `C:\xampp\apache\bin\httpd.exe -t` | Test configuration syntax |

### Build Commands

| Command | Description |
|---------|-------------|
| `npx tsx script/build.ts` | Build the application |
| `npm install` | Install dependencies |
| `npm ci` | Clean install dependencies |

---

## 12. Troubleshooting

### Cannot Log In / Session Not Working

**Symptoms:** Login appears to succeed but you're immediately logged out, or you can't log in at all.

**Causes and Solutions:**

1. **COOKIE_SECURE mismatch:**
   - If using HTTP (no SSL): Ensure `COOKIE_SECURE` is NOT set or is set to `false`
   - If using HTTPS: Set `COOKIE_SECURE=true`

2. **Session secret not set:**
   - Verify `SESSION_SECRET` environment variable is set
   - Restart PM2 after setting: `pm2 restart meterflo`

3. **Database connection issue:**
   - Check `DATABASE_URL` is correct
   - Verify PostgreSQL is running
   - Check PM2 logs: `pm2 logs meterflo`

#### Temporary HTTP login recovery

Use **`EMERGENCY_HTTP_LOGIN=true`** only when HTTPS-only session cookies prevent login over HTTP. It temporarily forces session-cookie `secure=false`, even when `COOKIE_SECURE=true`. Only the exact lowercase string `true` enables it; unset or `false` leaves the normal policy intact.

**Security warning:** this is a server-wide cookie policy, not an admin-only session exemption. All users' session cookies can travel over unencrypted HTTP while it is enabled. Use a trusted local/private connection; restrict server access during recovery. Username/password verification, account locks, session expiry and role permissions remain enforced. It does not reset passwords, unlock accounts, fix a missing session secret/database, bypass Turnstile, or require Replit authentication.

1. On the server, open the protected environment configuration used by the MeterFlo service. If the variable is not already supplied by PM2/service configuration, add this **non-secret** line to the install-root `.env`:

   ```ini
   EMERGENCY_HTTP_LOGIN=true
   ```

2. Restart the server. With the new template and settings supplied only by `.env`:

   ```cmd
   cd C:\xampp\htdocs
   pm2 restart meterflo
   ```

   The template rejects recovery flags in its `env` block. Service/system variables still override `.env`; a change in another desktop account/terminal is insufficient. For legacy PM2 overrides or cached settings, use the clean-process procedure in Section 10 instead of assuming `--update-env` removes old keys. Verify the effective behavior through the administrator warning.

3. Sign in using a valid, unlocked administrator account through the trusted HTTP connection. A persistent **HTTP login recovery is enabled** warning appears on every signed-in administrator page and links to this procedure. It cannot be dismissed while the flag is active.
4. Correct the underlying mismatch: use `COOKIE_SECURE=false` only for an intentionally HTTP-only local/private deployment, or fix HTTPS/proxy forwarding and keep `COOKIE_SECURE=true`. The emergency flag does not change the configured value. For a subdirectory deployment, also check cookie/proxy path handling described in Section 8a.
5. **Set `EMERGENCY_HTTP_LOGIN=false` in the effective `.env` or approved service environment**, then restart. Clear legacy/cached PM2 overrides using Section 10 if necessary. Once confirmed disabled, the unused variable can be removed. Editing a file alone does not update a running process.
6. Sign out, clear recovery-era browser cookies and sign in again through the intended URL. Confirm the administrator warning disappears. With `COOKIE_SECURE=true`, check that a new HTTPS login sets a `Secure`, `HttpOnly`, `SameSite=Lax` session cookie and an HTTP-only login does not establish a new browser session. With an intentional `COOKIE_SECURE=false` deployment, HTTP remains allowed after the override is removed.

Restoring secure-cookie policy does **not** revoke all existing database sessions or make your server reject every HTTP request. Enforce HTTP-to-HTTPS redirects/access restrictions at the proxy, and do not leave recovery-era cookies in use over HTTP. Existing sessions loaded after restart have their cookie options reapplied under the current policy; no permanent settings or work-order data are changed.

If Turnstile separately prevents reaching the login form, use its documented `TURNSTILE_EMERGENCY_BYPASS` procedure as a separate recovery action. The HTTP flag does not disable that challenge; remove any Turnstile bypass after correcting it too.

### Application Won't Start

**Check PM2 logs:**
```cmd
pm2 logs meterflo --lines 50
```

**Common issues:**

1. **Missing dist/index.cjs:**
   - Run the build: `npx tsx script/build.ts`

2. **Port already in use:**
   - Check if another process is using port 3000:
     ```cmd
     netstat -ano | findstr :3000
     ```
   - Kill the process or change the PORT environment variable

3. **Missing node_modules:**
   - Run: `npm install`

### Cannot Access via Apache (http://localhost)

1. **Verify Apache is running:**
   - Check XAMPP Control Panel
   - Or run: `C:\xampp\apache\bin\httpd.exe -t` to test config

2. **Verify proxy modules are enabled:**
   - Check `httpd.conf` for uncommented proxy modules

3. **Test direct access:**
   - Try `http://127.0.0.1:3000` directly
   - If this works but localhost doesn't, it's an Apache config issue

4. **Check Apache error logs:**
   - `C:\xampp\apache\logs\error.log`
   - `C:\xampp\apache\logs\meterflo-error.log`

### Database Connection Errors

1. **Verify PostgreSQL is running:**
   ```cmd
   psql -U postgres -c "SELECT 1"
   ```

2. **Check DATABASE_URL format:**
   - Must be: `postgresql://user:password@host:port/database`
   - Special characters in password must be URL-encoded

3. **Check pg_hba.conf:**
   - Ensure localhost connections are allowed

4. **Verify database exists:**
   ```cmd
   psql -U postgres -c "\l"
   ```

### SSE (Real-time Updates) Not Working

1. **Verify Apache proxy settings:**
   - `ProxyTimeout 600` must be set
   - `SetEnv proxy-sendchunked 1` must be set

2. **Restart Apache after config changes:**
   ```cmd
   C:\xampp\apache\bin\httpd.exe -k restart
   ```

### Calendar/Work Order Times Off by Several Hours

**Symptoms:** Work orders scheduled for a specific time (e.g., 9:00 AM) display at a different time (e.g., 2:00 AM or 4:00 PM) on the calendar. The offset is consistent (often 7 hours for Mountain Time).

**Cause:** Windows servers use the local system timezone for Date operations, while Linux servers default to UTC. This causes inconsistent date parsing between development (Replit/Linux) and production (Windows).

**Solution:** The application sets `process.env.TZ = 'UTC'` at the very start of `server/index.ts` to force consistent UTC behavior across all platforms. If you're experiencing this issue:

1. **Pull the latest code:**
   ```cmd
   cd C:\xampp\htdocs
   git pull origin main
   ```

2. **Rebuild and restart:**
   ```cmd
   npx tsx script/build.ts
   pm2 restart meterflo
   ```

3. **Verify the fix:**
   - Open the calendar and check that scheduled times display correctly
   - Create a new work order and verify the time saves correctly

**Technical Details:**
- The fix is in `server/index.ts` at the very first line (before any imports)
- It forces Node.js to interpret all dates in UTC regardless of Windows timezone settings
- Existing work orders stored in UTC will now display correctly

---

### Build Fails

1. **TypeScript errors:**
   - Check for syntax errors in the code
   - Run: `npx tsc --noEmit` to see TypeScript errors

2. **Missing dependencies:**
   - Run: `npm install`

3. **Disk space:**
   - Ensure sufficient disk space for the build

---

## Security Recommendations

1. **Keep secrets in `.env`, never in `deploy/ecosystem.config.cjs`**
   - Private environment variants and the local PM2 copy are ignored; the safe `.env.example` and `deploy/ecosystem.config.example.cjs` are tracked. Keep credentials in the protected environment and never force-add private files. Ignore rules do not remove already-tracked files.
   - On a fresh install, copy `.env.example` to `.env` and edit (Section 5). The application loads `.env` automatically on startup via `dotenv`.
   - If a secret was committed in the past — to `deploy/ecosystem.config.cjs` or anywhere else — rotate it at the source: change the database password in PostgreSQL, generate a new `SESSION_SECRET`, reset the SMTP password at your mail provider. Scrubbing the working copy does not undo the leak.
   - Audit accessible history using the redacted command below, not raw `git log -p` output, which can reveal credential values. See `deploy/SECRET_AUDIT.md` for findings, limits and unverified rotation actions. History rewriting is destructive, requires separate approval and coordination, and does not replace credential rotation.

### Deployment regression checks

Run from the repository root:

```cmd
npm run check:deployment-secrets
npm run test:deployment-secrets
npm run check:deployment-secrets:staged
npm run audit:secrets:history -- --report generated-artifacts/secrets/history-audit.json
```

The current-tree check examines tracked and non-ignored new text files plus ignore rules. The staged check reads **index contents**, so cleaning a working file does not hide a staged credential; tracked private files fail even if ignored. Stage intentional ignore-rule updates before running the staged check. Findings contain file/line/rule metadata only, never values or source excerpts. History findings classify known placeholders, examples and test fixtures separately from potential credential literals; they cannot establish provider validity or completed rotation.

The GitHub workflow runs current-tree checks and focused tests without live secrets. Other Git hosts need the same commands in their CI. To opt into the supplied local pre-commit hook, first review existing organizational hooks and then run `git config core.hooksPath .githooks`; do not replace required hooks without approval. Git hooks can be bypassed, so keep CI checks enabled. Do not commit generated audit artifacts, logs or PM2 dumps.

### Target-platform verification

Automated verification uses isolated Linux processes, temporary Git repositories and dummy credentials. It covers template paths, dotenv precedence, fresh-process reload, cookie-policy choices, stale external recovery overrides, index scanning and value redaction. **Actual Windows/PM2 service startup and reboot have not been verified here.** A Windows operator must check fresh-clone copying, NTFS/web access restrictions, service identity/cwd, host/port, HTTPS cookie flags, clean-process migration, both recovery flags disabled, and persistence after reboot—without printing the environment or using real values as command arguments.

2. **Use HTTPS in Production**
   - Get a proper SSL certificate
   - Set `COOKIE_SECURE=true`
   - Redirect HTTP to HTTPS

3. **Firewall Configuration**
   - Bind the Node listener to `127.0.0.1` (`HOST=127.0.0.1`) so port 3000 is unreachable from the network — this is the primary defense.
   - Block external access to port 3000 at the firewall as a fallback.
   - Only allow ports 80 (HTTP) and 443 (HTTPS) inbound.

4. **Strong Passwords**
   - Use complex passwords for PostgreSQL and SESSION_SECRET
   - Store passwords securely (`.env` file or Windows credential store, never in committed config files)

5. **Regular Backups**
   - Use the built-in backup feature in the application's Maintenance page
   - Also schedule PostgreSQL backups via Windows Task Scheduler

6. **Keep Software Updated**
   - Regularly update Node.js, PostgreSQL, and Apache
   - Pull application updates from Replit

---

## Quick Reference Card

### First-Time Setup (in order)
```cmd
1.  Install Node.js, PostgreSQL, Git, XAMPP
2.  npm install -g pm2 pm2-windows-startup
3.  Create PostgreSQL database and user
4.  git clone <repo-url> C:\xampp\htdocs
5.  cd C:\xampp\htdocs && npm install
6.  copy .env.example .env  REM then edit .env and fill in real values (Section 5)
7.  npx tsx script/build.ts
8.  npm run db:push          REM initialize the database schema (Section 6a)
9.  mkdir logs
10. copy deploy\ecosystem.config.example.cjs deploy\ecosystem.config.cjs
    node script/check-deployment-secrets.mjs --config deploy/ecosystem.config.cjs
    pm2 start deploy/ecosystem.config.cjs
11. pm2 save && pm2-startup install
12. Configure Apache proxy in httpd.conf
13. Restart Apache
14. Test at http://localhost
```

### After Code Updates
```cmd
cd C:\xampp\htdocs
git pull origin main
npm install
npx tsx script/build.ts
REM npm run db:push        (only if release notes mention a schema change)
pm2 restart meterflo
```

### Daily Operations
```cmd
pm2 list                    # Check status
pm2 logs meterflo        # View logs
pm2 restart meterflo     # Restart if needed
```
