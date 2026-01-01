// PM2 Ecosystem Configuration for WorkFlow Pro
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
//    pm2 logs workflowpro  - View application logs
//    pm2 restart workflowpro - Restart the app
//    pm2 stop workflowpro  - Stop the app
//    pm2 delete workflowpro - Remove from PM2

module.exports = {
  apps: [
    {
      name: 'workflowpro',
      script: 'dist/index.cjs',
      cwd: 'C:\\xampp\\htdocs',  // Adjust this path to your installation directory
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        // Database connection (uses existing DATABASE_URL from system env)
      },
      
      // Process management
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/workflowpro-error.log',
      out_file: 'logs/workflowpro-out.log',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
    }
  ]
};
