# Windows Deployment Guide for WorkFlow Pro

This guide covers deploying WorkFlow Pro on a Windows server with Apache and PM2.

## Prerequisites

- Node.js 18+ installed
- XAMPP (or standalone Apache) installed
- PostgreSQL database configured
- Application built (`node_modules\.bin\tsx script/build.ts`)

## Step 1: Configure Environment Variables

Set these as Windows System Environment Variables:
1. Right-click "This PC" → Properties → Advanced system settings
2. Click "Environment Variables"
3. Add under "System variables":

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/workflowpro` |
| `SESSION_SECRET` | `your-random-secret-key` |

## Step 2: Install PM2 (Process Manager)

Open Command Prompt as Administrator:

```cmd
npm install -g pm2
npm install -g pm2-windows-startup
```

## Step 3: Start the Application with PM2

Navigate to your app directory and start:

```cmd
cd C:\xampp\htdocs
pm2 start deploy/ecosystem.config.cjs
```

Verify it's running:
```cmd
pm2 list
```

## Step 4: Configure Auto-Start on Boot

Save the current process list:
```cmd
pm2 save
```

Install the startup script:
```cmd
pm2-startup install
```

Follow any prompts. The app will now start automatically when Windows boots.

## Step 5: Configure Apache Reverse Proxy

### Enable Required Modules

Edit `C:\xampp\apache\conf\httpd.conf` and uncomment (remove the `#` from):

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
```

### Add Proxy Configuration

Add to the end of `httpd.conf` or in `httpd-vhosts.conf`:

```apache
<VirtualHost *:80>
    ServerName localhost
    
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # Timeout for SSE connections
    ProxyTimeout 600
    SetEnv proxy-sendchunked 1
</VirtualHost>
```

### Restart Apache

Use XAMPP Control Panel or:
```cmd
C:\xampp\apache\bin\httpd.exe -k restart
```

## Step 6: Test the Setup

1. Access `http://localhost` in your browser
2. The login page should appear
3. Check PM2 logs if there are issues:
   ```cmd
   pm2 logs workflowpro
   ```

## Useful PM2 Commands

| Command | Description |
|---------|-------------|
| `pm2 list` | Show all running processes |
| `pm2 logs workflowpro` | View application logs |
| `pm2 logs workflowpro --lines 100` | View last 100 log lines |
| `pm2 restart workflowpro` | Restart the application |
| `pm2 stop workflowpro` | Stop the application |
| `pm2 delete workflowpro` | Remove from PM2 |
| `pm2 monit` | Real-time monitoring dashboard |

## Updating the Application

After pulling new code:

```cmd
cd C:\xampp\htdocs
node_modules\.bin\tsx script/build.ts
pm2 restart workflowpro
```

## Troubleshooting

### App won't start
- Check logs: `pm2 logs workflowpro`
- Verify environment variables are set
- Ensure PostgreSQL is running

### Can't access via Apache
- Verify Apache is running
- Check `logs/workflowpro-error.log`
- Ensure proxy modules are enabled
- Test direct access: `http://127.0.0.1:3000`

### Database connection errors
- Verify DATABASE_URL is correct
- Ensure PostgreSQL allows connections from localhost
- Check pg_hba.conf if needed

## Security Recommendations

1. **Use HTTPS**: Get an SSL certificate and configure Apache for HTTPS
2. **Firewall**: Block port 3000 externally, only allow port 80/443
3. **Strong passwords**: Use complex passwords for database and sessions
4. **Regular backups**: Use the built-in backup feature in Maintenance
