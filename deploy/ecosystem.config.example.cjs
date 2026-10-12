// Copy to ecosystem.config.cjs IN THIS DIRECTORY. No credentials go here.
// The install root is derived from the copy's location, on Windows or Linux.
// The application loads its protected root .env; inherited service variables
// take precedence. NODE_ENV is the sole fixed production-launch setting.
const path = require('node:path');
const { validateProductionConfig } = require('./pm2-config-policy.cjs');
const root = path.resolve(__dirname, '..');

module.exports = validateProductionConfig({
  apps: [{
    name: 'meterflo',
    script: path.join(root, 'dist', 'index.cjs'),
    cwd: root,
    env: { NODE_ENV: 'production' },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: path.join(root, 'logs', 'meterflo-error.log'),
    out_file: path.join(root, 'logs', 'meterflo-out.log'),
    merge_logs: true,
    kill_timeout: 5000,
  }],
});
