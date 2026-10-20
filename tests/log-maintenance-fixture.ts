import "dotenv/config";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../server/db";
import { LogRepository } from "../server/logMaintenanceRepository";
import { LogFiles } from "../server/logMaintenanceFiles";
import { LogMaintenanceService } from "../server/logMaintenanceService";

export async function fixture() {
  const ns = `log_fixture_${randomUUID().replace(/-/g,"")}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"meterflo-log-test-"));
  await pool.query(`CREATE SCHEMA "${ns}"`);
  const n = `"${ns}".`;
  try {
    await pool.query(`
      CREATE TABLE ${n}system_settings(key text PRIMARY KEY,value text,updated_at timestamp DEFAULT now());
      CREATE TABLE ${n}projects(id int PRIMARY KEY,name text);
      INSERT INTO ${n}projects VALUES (1,'Fixture North'),(2,'Fixture South');
      CREATE TABLE ${n}customer_api_deliveries(id text PRIMARY KEY,status text,snapshot jsonb,payload text);
      CREATE TABLE ${n}customer_api_logs(id int PRIMARY KEY,project_id int,delivery_id text,success boolean,created_at timestamp);
      CREATE TABLE ${n}api_import_runs(id text PRIMARY KEY,project_id int,config_id int,status text,started_at timestamp,completed_at timestamp);
      CREATE TABLE ${n}external_database_configs(id int PRIMARY KEY,project_id int);
      CREATE TABLE ${n}import_configs(id int PRIMARY KEY,external_db_config_id int);
      CREATE TABLE ${n}import_history(id int PRIMARY KEY,import_config_id int,status text,records_failed int,started_at timestamp,completed_at timestamp);
      CREATE TABLE ${n}file_import_history(id int PRIMARY KEY,project_id int,file_import_config_id int,status text,records_failed int,started_at timestamp,completed_at timestamp);
      CREATE TABLE ${n}file_export_runs(id text PRIMARY KEY,config_id text,project_id int,status text,created_at timestamptz,completed_at timestamptz);
      CREATE TABLE ${n}file_export_attempts(id text PRIMARY KEY,run_id text REFERENCES ${n}file_export_runs(id) ON DELETE CASCADE,status text,started_at timestamptz,completed_at timestamptz);
      CREATE TABLE ${n}file_export_run_items(run_id text REFERENCES ${n}file_export_runs(id) ON DELETE CASCADE,payload jsonb);
      CREATE TABLE ${n}file_export_checkpoints(config_id text,work_order_id int,content_hash text);
      CREATE TABLE ${n}file_import_receipts(config_id int,content_hash text);
      CREATE TABLE ${n}https_transfer_files(id text PRIMARY KEY,status text,storage_key text);
      CREATE TABLE ${n}sftp_server_events(id text PRIMARY KEY,project_id int,status text,created_at timestamptz);
      CREATE TABLE ${n}https_transfer_events(id text PRIMARY KEY,project_id int,created_at timestamptz);
      INSERT INTO ${n}external_database_configs VALUES(1,1);
      INSERT INTO ${n}import_configs VALUES(1,1);
      INSERT INTO ${n}customer_api_deliveries VALUES
        ('done','delivered','{}','fixture-payload'),('failed','failed','{}','fixture-retry'),
        ('pending','pending','{}','fixture-pending'),('paused','paused','{}','fixture-paused'),
        ('processing','processing','{}','fixture-processing'),('retrying','retrying','{}','fixture-retrying');
      INSERT INTO ${n}customer_api_logs VALUES
        (1,1,'done',true,'2000-01-01'),(2,1,'done',false,'2000-01-01'),
        (3,1,'failed',false,'2000-01-01'),(4,1,NULL,false,'2000-01-01'),
        (5,2,NULL,true,'2000-01-01'),(6,1,'pending',false,'2000-01-01'),
        (7,1,'paused',false,'2000-01-01'),(8,1,'processing',false,'2000-01-01'),
        (9,1,'retrying',false,'2000-01-01'),(10,1,'done',true,now()),
        (11,1,'missing',true,'2000-01-01');
      INSERT INTO ${n}api_import_runs VALUES
        ('a',1,1,'succeeded','2000-01-01','2000-01-01'),
        ('b',1,1,'succeeded','2000-02-01','2000-02-01'),
        ('c',1,2,'failed','2000-01-01','2000-01-01'),
        ('d',1,3,'partial','2000-01-01','2000-01-01'),
        ('e',1,4,'interrupted','2000-01-01','2000-01-01'),
        ('f',1,5,'cancelled','2000-01-01','2000-01-01'),
        ('g',1,6,'running','2000-01-01',NULL),
        ('h',1,7,'retrying','2000-01-01',NULL),
        ('i',1,8,'queued','2000-01-01',NULL);
      INSERT INTO ${n}import_history VALUES
        (1,1,'success',0,'2000-01-01','2000-01-01'),
        (2,1,'success',0,'2000-02-01','2000-02-01'),
        (3,1,'failed',1,'2000-01-01','2000-01-01');
      INSERT INTO ${n}file_import_history VALUES
        (1,1,1,'success',0,'2000-01-01','2000-01-01'),
        (2,1,1,'success',0,'2000-02-01','2000-02-01'),
        (3,1,1,'partial',1,'2000-01-01','2000-01-01'),
        (4,1,NULL,'success',0,'2000-01-01','2000-01-01');
    `);
    for (const name of ["error.log","error-2000-01-01T00-00-00-000Z.log","unrelated.log","meterflo-out.log",".env"]) {
      await fs.writeFile(path.join(dir,name),"fixture-only log\n");
      await fs.utimes(path.join(dir,name),new Date("2000-01-01"),new Date("2000-01-01"));
    }
    const repository = new LogRepository(pool,ns), files = new LogFiles(dir);
    return { ns,n,dir,repository,files,service:new LogMaintenanceService(repository,files),
      async dispose() { await pool.query(`DROP SCHEMA "${ns}" CASCADE`); await fs.rm(dir,{recursive:true,force:true}); } };
  } catch (e) {
    await pool.query(`DROP SCHEMA "${ns}" CASCADE`); await fs.rm(dir,{recursive:true,force:true}); throw e;
  }
}

export async function seedTransferHistory(f: Awaited<ReturnType<typeof fixture>>) {
  await pool.query(`
    INSERT INTO ${f.n}file_export_runs VALUES
      ('old','config-a',1,'success','2000-01-01','2000-01-01'),
      ('latest','config-a',1,'success','2000-02-01','2000-02-01'),
      ('retry','config-b',1,'failed','2000-01-01','2000-01-01'),
      ('active','config-c',1,'running','2000-01-01',NULL);
    INSERT INTO ${f.n}file_export_attempts VALUES
      ('old-success','old','success','2000-01-01','2000-01-01'),
      ('old-resolved-failure','old','failed','2000-01-01','2000-01-01'),
      ('latest-success','latest','success','2000-02-01','2000-02-01'),
      ('retry-failure','retry','failed','2000-01-01','2000-01-01'),
      ('active-attempt','active','running','2000-01-01',NULL);
    INSERT INTO ${f.n}file_export_run_items VALUES('old','{"fixture":"preserve"}'),('latest','{"fixture":"preserve"}');
    INSERT INTO ${f.n}file_export_checkpoints VALUES('config-a',1,'fixture-hash');
    INSERT INTO ${f.n}file_import_receipts VALUES(1,'fixture-hash');
    INSERT INTO ${f.n}https_transfer_files VALUES('stored-file','available','fixture-storage');
    INSERT INTO ${f.n}sftp_server_events VALUES
      ('sftp-one',1,'failed','2000-01-01'),('sftp-two',2,'success','2000-01-01'),
      ('sftp-global',NULL,'success','2000-01-01'),('sftp-recent',1,'success',now());
    INSERT INTO ${f.n}https_transfer_events VALUES
      ('https-one',1,'2000-01-01'),('https-two',2,'2000-01-01'),('https-recent',1,now());
  `);
}
