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

module.exports = {
  apps: [
    {
      name: 'meterflo',
      script: 'dist/index.cjs',
      cwd: 'C:\\xampp\\htdocs\\meterflo',  // Adjust this path to your installation directory
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        // Database connection - UPDATE THIS with your PostgreSQL credentials
        DATABASE_URL: 'postgresql://meterflo_user:fa713777@localhost:5000/meterflo',
        // Session secret - UPDATE THIS with a random 64-character string
        SESSION_SECRET: 'cbb4cefd9a9fd04b5399a31a03b6f8d6464f1320a05f4f6fac55ee72c27faf35',
        // Cookie settings for HTTP (set to 'true' if using HTTPS)
        COOKIE_SECURE: 'true',
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
