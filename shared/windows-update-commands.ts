/** Documentation commands only; the web application never executes these. */
export const windowsUpdateCommands = {
  routine: String.raw`cd /d C:\xampp\htdocs\meterflo && deploy\Update-MeterFlo.cmd`,
  bootstrap: String.raw`cd /d C:\xampp\htdocs\meterflo && git pull --ff-only origin main && deploy\Update-MeterFlo.cmd`,
  preflight: String.raw`cd /d C:\xampp\htdocs\meterflo && deploy\Update-MeterFlo.cmd --check`,
};
