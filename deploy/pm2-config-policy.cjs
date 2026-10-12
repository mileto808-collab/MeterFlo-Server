// Run when PM2 loads the copied production template. Never load .env here:
// dotenv belongs in the application, not in PM2's saved process environment.
const permitted = new Set([
  'name', 'script', 'cwd', 'env', 'instances', 'autorestart', 'watch',
  'max_memory_restart', 'log_date_format', 'error_file', 'out_file',
  'merge_logs', 'kill_timeout',
]);

function validateProductionConfig(config) {
  const reject = () => { throw new Error(
    'Unsafe MeterFlo PM2 configuration. Use the shipped template; keep application settings and credentials in the protected environment, not PM2 config or arguments.',
  ); };
  if (!config || Object.keys(config).some(key => key !== 'apps') ||
      !Array.isArray(config.apps) || config.apps.length !== 1) reject();
  for (const app of config.apps) {
    if (!app || Object.keys(app).some(key => !permitted.has(key))) reject();
    if (typeof app.cwd !== 'string' || typeof app.script !== 'string' ||
        !/[\\/]dist[\\/]index\.cjs$/.test(app.script)) reject();
    if (!app.env || Object.keys(app.env).length !== 1 ||
        app.env.NODE_ENV !== 'production') reject();
  }
  return config;
}

module.exports = { validateProductionConfig };
