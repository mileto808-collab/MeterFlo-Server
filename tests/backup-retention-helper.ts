import { cleanRetention } from "../server/backups/service";
import { withBackupExclusive } from "../server/backups/lock";
import { pool } from "../server/db";
import { enableAuditing, serviceAuditContext, withAuditContext } from "../server/auditContext";
import { z } from "zod";
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
enableAuditing();
try { await withAuditContext(serviceAuditContext("backup-retention-acceptance"), async () => {
  const [id, schedule, folder] = process.argv.slice(2);
  z.string().uuid().parse(id); z.string().uuid().parse(schedule);
  await pool.query(`INSERT INTO public.backup_runs(id,schedule_id,schedule_name,backup_type,trigger,status,destination_kind,destination_path,bucket_id,completed_at)
    VALUES($1,$2,'Old fixture','database','scheduled','succeeded','local',$3,'',now()-interval '60 days')`, [id, schedule, folder]);
  await withBackupExclusive(async () => {
    await cleanRetention();
    await pool.query("UPDATE public.backup_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule]);
  });
}); }
finally { await pool.end(); }
