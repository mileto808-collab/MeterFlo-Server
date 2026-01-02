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
7. [PM2 Process Manager Setup](#7-pm2-process-manager-setup)
8. [Apache Reverse Proxy Configuration](#8-apache-reverse-proxy-configuration)
9. [HTTPS Configuration (Optional)](#9-https-configuration-optional)
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

### 2.2 Install PostgreSQL

1. Download from: https://www.postgresql.org/download/windows/
2. Run the installer
3. **Important settings during installation:**
   - Set a strong password for the `postgres` superuser (remember this!)
   - Default port: `5432`
   - Check "Stack Builder" if you want additional tools
4. Verify installation:
   ```cmd
   psql --version
   ```

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

Run these SQL commands (replace `your_password` with a strong password):
```sql
-- Create a dedicated user for the application
CREATE USER meterflo_user WITH PASSWORD 'your_password';

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

### 5.1 Required Variables

Create a `.env` file in `C:\xampp\htdocs\` or set as Windows System Environment Variables.

**For HTTP connections (no SSL):**
```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://meterflo_user:your_password@localhost:5432/meterflo
SESSION_SECRET=generate-a-random-64-character-string-here
```

**For HTTPS connections (with SSL):**
```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://meterflo_user:your_password@localhost:5432/meterflo
SESSION_SECRET=generate-a-random-64-character-string-here
COOKIE_SECURE=true
```

### 5.2 Cookie Security Explained

| Variable | Value | When to Use |
|----------|-------|-------------|
| `COOKIE_SECURE` | not set or `false` | HTTP only (no SSL certificate) |
| `COOKIE_SECURE` | `true` | HTTPS enabled (SSL certificate installed) |

**Important:** If you set `COOKIE_SECURE=true` but don't have HTTPS configured, users will NOT be able to log in because the browser won't send the session cookie over HTTP.

### 5.3 Setting Windows System Environment Variables

1. Right-click "This PC" → Properties
2. Click "Advanced system settings"
3. Click "Environment Variables"
4. Under "System variables", click "New" for each variable
5. Add all the variables from Section 5.1
6. Click OK to save

**Note:** After changing system environment variables, you must restart Command Prompt and PM2.

### 5.4 Generate a Secure SESSION_SECRET

Use Node.js to generate a random secret:
```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and use it as your SESSION_SECRET.

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

## 7. PM2 Process Manager Setup

### 7.1 Create Logs Directory

```cmd
cd C:\xampp\htdocs
mkdir logs
```

### 7.2 Configure PM2 Ecosystem File

The file `deploy/ecosystem.config.cjs` is already configured. Verify the path matches your installation:

```javascript
module.exports = {
  apps: [
    {
      name: 'meterflo',
      script: 'dist/index.cjs',
      cwd: 'C:\\xampp\\htdocs',  // Adjust if your path is different
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
      },
      // ... rest of config
    }
  ]
};
```

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

## 9. HTTPS Configuration (Optional)

### 9.1 Obtain an SSL Certificate

Options:
- **Let's Encrypt** (free): Use Certbot or win-acme
- **Commercial SSL**: Purchase from a certificate authority
- **Self-signed** (testing only): Generate with OpenSSL

### 9.2 Enable SSL Module in Apache

Edit `C:\xampp\apache\conf\httpd.conf` and uncomment:

```apache
LoadModule ssl_module modules/mod_ssl.so
```

Also uncomment:
```apache
Include conf/extra/httpd-ssl.conf
```

### 9.3 Configure HTTPS Virtual Host

Edit `C:\xampp\apache\conf\extra\httpd-ssl.conf` or add to `httpd.conf`:

```apache
<VirtualHost *:443>
    ServerName yourdomain.com
    
    # SSL Configuration
    SSLEngine on
    SSLCertificateFile "C:/path/to/your/certificate.crt"
    SSLCertificateKeyFile "C:/path/to/your/private.key"
    SSLCertificateChainFile "C:/path/to/your/chain.crt"
    
    # Proxy to Node.js
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # SSE support
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
    
    # Logging
    ErrorLog "logs/meterflo-ssl-error.log"
    CustomLog "logs/meterflo-ssl-access.log" common
</VirtualHost>
```

### 9.4 Redirect HTTP to HTTPS

Add this to your HTTP VirtualHost (port 80):

```apache
<VirtualHost *:80>
    ServerName yourdomain.com
    Redirect permanent / https://yourdomain.com/
</VirtualHost>
```

### 9.5 Update Environment Variable

After enabling HTTPS, set the cookie to be secure:

1. Add to Windows System Environment Variables:
   - Variable: `COOKIE_SECURE`
   - Value: `true`

2. Restart PM2:
   ```cmd
   pm2 restart meterflo
   ```

### 9.6 Restart Apache

```cmd
C:\xampp\apache\bin\httpd.exe -k restart
```

---

## 10. Updating the Application

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

### 10.5 Restart the Application

```cmd
pm2 restart meterflo
```

### 10.6 Quick Update Command (All-in-One)

```cmd
cd C:\xampp\htdocs && git pull origin main && npm install && npx tsx script/build.ts && pm2 restart meterflo
```

### 10.7 Troubleshooting Git Issues

> **Important**: Before running any `git reset --hard` command, always back up your entire htdocs folder. This command will overwrite ALL files.

#### Complete Backup Before Git Reset

Always create a full backup before destructive git commands. This protects:
- `deploy\ecosystem.config.cjs` - Database connection and environment settings
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

1. **Use HTTPS in Production**
   - Get a proper SSL certificate
   - Set `COOKIE_SECURE=true`
   - Redirect HTTP to HTTPS

2. **Firewall Configuration**
   - Block external access to port 3000
   - Only allow ports 80 (HTTP) and 443 (HTTPS)

3. **Strong Passwords**
   - Use complex passwords for PostgreSQL and SESSION_SECRET
   - Store passwords securely

4. **Regular Backups**
   - Use the built-in backup feature in the application's Maintenance page
   - Also schedule PostgreSQL backups via Windows Task Scheduler

5. **Keep Software Updated**
   - Regularly update Node.js, PostgreSQL, and Apache
   - Pull application updates from Replit

---

## Quick Reference Card

### First-Time Setup (in order)
```cmd
1. Install Node.js, PostgreSQL, Git, XAMPP
2. npm install -g pm2 pm2-windows-startup
3. Create PostgreSQL database and user
4. git clone <repo-url> C:\xampp\htdocs
5. cd C:\xampp\htdocs && npm install
6. Set environment variables
7. npx tsx script/build.ts
8. mkdir logs
9. pm2 start deploy/ecosystem.config.cjs
10. pm2 save && pm2-startup install
11. Configure Apache proxy in httpd.conf
12. Restart Apache
13. Test at http://localhost
```

### After Code Updates
```cmd
cd C:\xampp\htdocs
git pull origin main
npm install
npx tsx script/build.ts
pm2 restart meterflo
```

### Daily Operations
```cmd
pm2 list                    # Check status
pm2 logs meterflo        # View logs
pm2 restart meterflo     # Restart if needed
```
