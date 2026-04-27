// PM2 Ecosystem Configuration for MeterFlo
//
// SETUP INSTRUCTIONS FOR WINDOWS:
//
// 1. Install PM2 globally:
//    npm install -g pm2
//    npm install -g pm2-windows-startup
//
// 2. Navigate to your app directory:
//    cd C:\xampp\htdocs
//
// 3. Start the application:
//    pm2 start deploy/ecosystem.config.cjs
//
// 4. Save the process list:
//    pm2 save
//
// 5. Set up auto-start on Windows boot:
//    pm2-startup install
//
// 6. Useful PM2 commands:
//    pm2 list              - Show all running processes
//    pm2 logs meterflo     - View application logs
//    pm2 restart meterflo  - Restart the app
//    pm2 stop meterflo     - Stop the app
//    pm2 delete meterflo   - Remove from PM2
//
// SECURITY:
// Do NOT commit real secrets (DATABASE_URL passwords, SESSION_SECRET,
// SMTP_PASSWORD, etc.) into this file. Set them either in a `.env` file
// at the install root or as Windows system environment variables. The
// values below are placeholders only.

module.exports = {
  apps: [
    {
      name: 'meterflo',
      script: 'dist/index.cjs',
      // Adjust this path to your installation directory.
      // Use 'C:\\xampp\\htdocs' for a root install (Section 7),
      // or 'C:\\xampp\\htdocs\\meterflo' for a subdirectory install (Section 8a).
      cwd: 'C:\\xampp\\htdocs',

      // Environment variables
      //
      // IMPORTANT: anything declared in this `env` block OVERRIDES values
      // inherited from the parent shell, a `.env` file, or Windows system
      // environment variables. So if you want to keep secrets out of this
      // file (recommended), do NOT add `DATABASE_URL`, `SESSION_SECRET`,
      // or `SMTP_PASSWORD` keys here at all — leave them commented out
      // and set them via `.env` or Windows system env vars instead.
      // Only the non-secret values (NODE_ENV/PORT/HOST/COOKIE_SECURE)
      // are set here.
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        // Cookie security - leave as 'false' for HTTP. Flip to 'true' ONLY after
        // HTTPS is configured (see Section 9). Setting 'true' on HTTP will
        // silently break login because browsers will not send the session cookie.
        COOKIE_SECURE: 'false',
        // The following are intentionally commented out so the values from
        // your `.env` file or Windows system environment variables are used.
        // Uncomment ONLY if you have no other way to set them — and remember
        // that anything you put here is committed to git.
        //
        // DATABASE_URL: 'postgresql://meterflo_user:YOURPASSWORD@localhost:5432/meterflo',
        // SESSION_SECRET: 'YOUR_SESSION_SECRET',
        // SMTP_PASSWORD: 'set-in-env-not-here',
      },

      // Process management
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/meterflo-error.log',
      out_file: 'logs/meterflo-out.log',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
    }
  ]
};
