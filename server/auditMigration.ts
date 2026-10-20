import type { Pool, PoolClient } from "pg";
import { enableAuditing } from "./auditContext";

const businessTables = [
  "projects","users","subroles","permissions","subrole_permissions","user_projects",
  "user_groups","user_group_members","user_group_projects","project_holidays","system_settings",
  "api_import_configs","api_import_runs","external_database_configs","import_configs","import_history",
  "file_import_configs","file_import_history","work_order_statuses","work_order_sub_statuses","trouble_codes","service_types",
  "system_types","system_type_projects","module_types","module_type_projects","project_service_types",
  "work_order_time_tracking","mobile_apk_releases","mobile_apk_publication","mobile_apk_uploads",
];
export function quoteAuditIdentifier(name:string) { return `"${name.replace(/"/g,'""')}"`; }
export async function installProjectAudit(client:PoolClient,schemaName:string) {
  const schema = quoteAuditIdentifier(schemaName);
  await client.query(`DROP TRIGGER IF EXISTS meterflo_business_audit ON ${schema}.work_orders`);
  await client.query(`CREATE TRIGGER meterflo_business_audit AFTER INSERT OR UPDATE OR DELETE ON ${schema}.work_orders
    FOR EACH ROW EXECUTE FUNCTION meterflo_audit.capture()`);
}
export async function initializeAudit(pool:Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS meterflo_audit;
      CREATE TABLE IF NOT EXISTS meterflo_audit.events (
        sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        actor_id text, actor_label text NOT NULL, actor_kind text NOT NULL, source text NOT NULL,
        action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, entity_label text NOT NULL,
        project_id integer, project_label text, operation_id text NOT NULL, outcome text NOT NULL,
        changes jsonb NOT NULL DEFAULT '[]', metadata jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS audit_scope_time ON meterflo_audit.events(project_id,occurred_at DESC,sequence DESC);
      CREATE INDEX IF NOT EXISTS audit_actor_time ON meterflo_audit.events(actor_id,occurred_at DESC);
      CREATE INDEX IF NOT EXISTS audit_entity_time ON meterflo_audit.events(entity_type,entity_id,occurred_at DESC);
      CREATE INDEX IF NOT EXISTS audit_operation ON meterflo_audit.events(operation_id);
      CREATE TABLE IF NOT EXISTS meterflo_audit.project_scopes (
        schema_name text PRIMARY KEY, project_id integer NOT NULL, project_label text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meterflo_audit.entity_scopes (
        entity_type text NOT NULL, entity_id text NOT NULL, project_id integer NOT NULL, project_label text,
        PRIMARY KEY(entity_type,entity_id)
      );
      CREATE TABLE IF NOT EXISTS meterflo_audit.policy (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), automatic boolean NOT NULL DEFAULT false,
        days integer NOT NULL DEFAULT 365 CHECK(days BETWEEN 1 AND 3650)
      );
      INSERT INTO meterflo_audit.policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS meterflo_audit.operations (
        id text PRIMARY KEY, actor_id text, actor_label text NOT NULL, actor_kind text NOT NULL,
        source text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, entity_label text NOT NULL,
        project_id integer, project_label text, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        completed_at timestamptz, outcome text NOT NULL DEFAULT 'started', instance_id text NOT NULL
      );
      CREATE OR REPLACE FUNCTION meterflo_audit.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='UPDATE' OR current_setting('meterflo.audit_retention',true) IS DISTINCT FROM 'authorized' THEN
          RAISE EXCEPTION 'Audit events are append-only';
        END IF;
        RETURN OLD;
      END $$;
      DROP TRIGGER IF EXISTS audit_append_only ON meterflo_audit.events;
      CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON meterflo_audit.events
        FOR EACH ROW EXECUTE FUNCTION meterflo_audit.append_only();
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION meterflo_audit.safe_value(k text,v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
      BEGIN
        IF v IS NULL OR v='null'::jsonb THEN RETURN 'null'::jsonb; END IF;
        -- A positive allowlist: unknown/unstructured fields are metadata-only,
        -- including future credentials added to a business table.
        IF k = ANY(ARRAY[
          'id','key','name','username','role','subrole_id','user_id','group_id','project_id','config_id','permission_id',
          'is_active','enabled','is_default','is_system','status','status_id','assigned_to','scheduled_date','scheduled_at',
          'service_duration_minutes','appointment_window_start','appointment_window_end',
          'default_service_minutes','default_appointment_tolerance_minutes',
          'service_type','service_type_id','customer_wo_id','customer_id','customer_name','address','city','state','zip',
          'old_system_id','new_system_id','old_module_id','new_module_id','old_system_type','new_system_type',
          'old_system_type_id','new_system_type_id','old_module_type','new_module_type','old_module_type_id','new_module_type_id',
          'old_system_reading','new_system_reading','old_module_read','new_module_read','old_gps','new_gps',
          'gps_source','gps_accuracy','gps_captured_at','gps_receiver',
          'assigned_user_id','assigned_group_id','created_by','updated_by','completed_by','scheduled_by','signature_name','route','zone',
          'system_reading_decimal_places','module_reading_decimal_places','wizard_mode','wizard_gps_mode','wizard_reuse_old_gps',
          'wizard_show_notes_step','wizard_show_gps_step','wizard_show_before_photos_step','wizard_show_after_photos_step',
          'wizard_show_signature_step','changeout_equipment_type','reading_equipment_type','timezone',
          'search_show_barcode_scan','search_show_qr_code_scan','search_show_manual_entry','search_show_hid_scanner',
          'customer_api_enabled','customer_api_auth_type','customer_api_send_photos','webhook_enabled',
          'operational_hours_enabled','operational_hours_start','operational_hours_end','operational_hours_days',
          'date','holiday_date','type','code','color','sort_order','display_order','requires_note','is_completed',
          'started_at','completed_at','closed_at','closed_by','review_started_at','start_time','end_time','duration','duration_seconds',
          'created_count','updated_count','skipped_count','failed_count','records_imported','records_failed',
          'created','updated','skipped','failed','version','version_name','version_code','size_bytes',
          'release_id','published','is_latest','method','schedule','schedule_minutes','schedule_enabled',
          'schedule_frequency','custom_cron_expression','is_enabled','ssl_enabled','database_type','port','delimiter','has_header',
          'import_type','backup_type','source','config_name','system_type_id','module_type_id','work_order_id','system_work_order_id'
        ]) AND jsonb_typeof(v) NOT IN ('object','array') THEN
          -- Even nominal labels cannot be used to smuggle URLs, bearer values,
          -- signatures or arbitrarily large text into this trail.
          IF length(v::text)>500 OR v::text ~* '(://|bearer[[:space:]]|data:|BEGIN.*PRIVATE KEY)' THEN
            RETURN to_jsonb('[changed]'::text);
          END IF;
          RETURN v;
        END IF;
        IF k='operational_hours_days' AND v::text ~ '^\\["?[A-Za-z", ]*\\]$' THEN RETURN v; END IF;
        RETURN to_jsonb('[changed]'::text);
      END $$;
      CREATE OR REPLACE FUNCTION meterflo_audit.capture() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE ctx jsonb; oldrow jsonb; newrow jsonb; item record; oldv jsonb; newv jsonb;
        diffs jsonb:='[]'; pid integer; plabel text; target text; label text;
        etype text; event_action text; event_outcome text:='success'; opid text; runstatus text;
      BEGIN
        ctx := nullif(current_setting('meterflo.audit_context',true),'')::jsonb;
        IF ctx IS NULL THEN RETURN NULL; END IF;
        oldrow:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
        newrow:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
        IF TG_TABLE_NAME IN ('api_import_runs','file_import_history','import_history') AND TG_OP='DELETE' THEN RETURN NULL; END IF;
        IF TG_TABLE_NAME='system_settings' AND coalesce(newrow->>'key',oldrow->>'key') IN
          ('logMaintenance.history') THEN RETURN NULL; END IF;
        FOR item IN SELECT key FROM jsonb_each(oldrow || newrow) LOOP
          IF item.key = ANY(ARRAY['created_at','updated_at','last_login_at','last_run_at','last_run_status',
            'last_run_error','next_run_at','heartbeat_at','next_attempt_at','cursor','watermark','checkpoint',
            'page_number','page_value','candidate_cursor','visited','fetch_attempts','page_attempts',
            'messages','error_details','error_message','current_url','database_name','last_run_message','last_run_record_count',
            'last_tested_at','last_test_result','last_processed_file']) OR item.key IN
            ('old_system_reading_text','new_system_reading_text','old_module_read_text','new_module_read_text') THEN CONTINUE; END IF;
          oldv:=oldrow->item.key; newv:=newrow->item.key;
          IF item.key='value' AND TG_TABLE_NAME='system_settings' AND coalesce(newrow->>'key',oldrow->>'key')=ANY(ARRAY[
            'default_timezone','cookie_secure','turnstile_enabled','local_auth_enabled','session_timeout_minutes',
            'mobile_app_enabled','reading_precision','log_rotation_mib'
          ]) THEN
            IF oldv IS DISTINCT FROM newv THEN
              diffs:=diffs || jsonb_build_array(jsonb_build_object('field',item.key,
                'before',meterflo_audit.safe_value('name',oldv),'after',meterflo_audit.safe_value('name',newv)));
            END IF;
            CONTINUE;
          END IF;
          IF item.key IN ('old_system_reading','new_system_reading','old_module_read','new_module_read') THEN
            oldv:=coalesce(oldrow->(item.key || '_text'),to_jsonb(oldrow->>item.key));
            newv:=coalesce(newrow->(item.key || '_text'),to_jsonb(newrow->>item.key));
            IF oldv='null'::jsonb THEN oldv:=to_jsonb(oldrow->>item.key); END IF;
            IF newv='null'::jsonb THEN newv:=to_jsonb(newrow->>item.key); END IF;
          END IF;
          IF oldv IS DISTINCT FROM newv THEN
            diffs:=diffs || jsonb_build_array(jsonb_build_object('field',item.key,
              'before',meterflo_audit.safe_value(item.key,oldv),'after',meterflo_audit.safe_value(item.key,newv)));
          END IF;
        END LOOP;
        IF diffs='[]'::jsonb THEN RETURN NULL; END IF;
        pid:=nullif(coalesce(newrow->>'project_id',oldrow->>'project_id'),'')::integer;
        IF TG_TABLE_NAME='import_configs' THEN
          SELECT project_id INTO pid FROM public.external_database_configs WHERE id=coalesce(newrow->>'external_db_config_id',oldrow->>'external_db_config_id')::integer;
        ELSIF TG_TABLE_NAME='import_history' THEN
          SELECT e.project_id INTO pid FROM public.import_configs i JOIN public.external_database_configs e ON e.id=i.external_db_config_id
            WHERE i.id=coalesce(newrow->>'import_config_id',oldrow->>'import_config_id')::integer;
        END IF;
        IF TG_TABLE_NAME='projects' THEN
          pid:=coalesce(newrow->>'id',oldrow->>'id')::integer;
          plabel:=coalesce(newrow->>'name',oldrow->>'name');
          IF TG_OP<>'DELETE' AND newrow->>'database_name' IS NOT NULL THEN
            INSERT INTO meterflo_audit.project_scopes(schema_name,project_id,project_label)
            VALUES(newrow->>'database_name',pid,plabel)
            ON CONFLICT(schema_name) DO UPDATE SET project_id=EXCLUDED.project_id,project_label=EXCLUDED.project_label;
          END IF;
        ELSIF TG_TABLE_SCHEMA<>'public' THEN
          SELECT project_id,project_label INTO pid,plabel FROM meterflo_audit.project_scopes WHERE schema_name=TG_TABLE_SCHEMA;
          IF pid IS NULL THEN RAISE EXCEPTION 'Audit project scope missing'; END IF;
        END IF;
        target:=coalesce(newrow->>'id',oldrow->>'id',newrow->>'key',oldrow->>'key',
          concat_ws(':',coalesce(newrow->>'subrole_id',oldrow->>'subrole_id'),
            coalesce(newrow->>'permission_id',oldrow->>'permission_id'),
            coalesce(newrow->>'user_id',oldrow->>'user_id'),pid));
        IF pid IS NULL THEN
          SELECT project_id,project_label INTO pid,plabel FROM meterflo_audit.entity_scopes
            WHERE entity_type=TG_TABLE_NAME AND entity_id=target;
        END IF;
        IF pid IS NOT NULL AND plabel IS NULL THEN
          SELECT name INTO plabel FROM public.projects WHERE id=pid;
          IF plabel IS NULL THEN SELECT project_label INTO plabel FROM meterflo_audit.project_scopes WHERE project_id=pid LIMIT 1; END IF;
        END IF;
        IF pid IS NOT NULL AND TG_TABLE_SCHEMA='public' THEN
          INSERT INTO meterflo_audit.entity_scopes(entity_type,entity_id,project_id,project_label)
          VALUES(TG_TABLE_NAME,target,pid,plabel) ON CONFLICT(entity_type,entity_id)
            DO UPDATE SET project_id=EXCLUDED.project_id,project_label=EXCLUDED.project_label;
        END IF;
        label:=coalesce(newrow->>'name',oldrow->>'name',newrow->>'username',oldrow->>'username',
          newrow->>'customer_wo_id',oldrow->>'customer_wo_id',newrow->>'key',oldrow->>'key',target);
        label:=trim(both '"' from meterflo_audit.safe_value('name',to_jsonb(label))::text);
        etype:=TG_TABLE_NAME; opid:=ctx->>'operationId';
        event_action:=CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
        IF TG_TABLE_NAME IN ('api_import_runs','file_import_history','import_history') THEN
          runstatus:=coalesce(newrow->>'status',newrow->>'run_status','running');
          IF TG_OP='INSERT' THEN event_action:='import.started'; event_outcome:='started';
          ELSIF runstatus IN ('queued','running','retrying') THEN RETURN NULL;
          ELSIF coalesce(oldrow->>'status',oldrow->>'run_status') IS NOT DISTINCT FROM runstatus THEN RETURN NULL;
          ELSE event_action:='import.finished'; event_outcome:=runstatus; END IF;
          opid:=CASE WHEN TG_TABLE_NAME='api_import_runs' THEN TG_TABLE_NAME || ':' || target ELSE ctx->>'operationId' END;
        END IF;
        INSERT INTO meterflo_audit.events(actor_id,actor_label,actor_kind,source,action,entity_type,
          entity_id,entity_label,project_id,project_label,operation_id,outcome,changes,metadata)
        VALUES(ctx->>'actorId',meterflo_audit.safe_value('name',ctx->'actorLabel')#>>'{}',ctx->>'actorKind',ctx->>'source',event_action,etype,
          meterflo_audit.safe_value('id',to_jsonb(target))#>>'{}',label,pid,
          meterflo_audit.safe_value('name',to_jsonb(plabel))#>>'{}',opid,event_outcome,diffs,'{}');
        RETURN NULL;
      END $$;
    `);
    await client.query(`INSERT INTO meterflo_audit.project_scopes SELECT database_name,id,name FROM public.projects
      WHERE database_name IS NOT NULL ON CONFLICT(schema_name) DO UPDATE SET project_id=EXCLUDED.project_id,project_label=EXCLUDED.project_label`);
    // Scope snapshots are not historical events. They let cascade-deleted
    // pre-existing configuration remain project-scoped after its parent is gone.
    await client.query(`INSERT INTO meterflo_audit.entity_scopes(entity_type,entity_id,project_id,project_label)
      SELECT 'import_configs',i.id::text,e.project_id,p.name FROM public.import_configs i
      JOIN public.external_database_configs e ON e.id=i.external_db_config_id JOIN public.projects p ON p.id=e.project_id
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET project_id=EXCLUDED.project_id,project_label=EXCLUDED.project_label`);
    for (const table of businessTables) {
      const found=await client.query("SELECT to_regclass($1) present",[`public.${table}`]);
      if (!found.rows[0].present) continue;
      await client.query(`DROP TRIGGER IF EXISTS meterflo_business_audit ON public.${quoteAuditIdentifier(table)}`);
      await client.query(`CREATE TRIGGER meterflo_business_audit AFTER INSERT OR UPDATE OR DELETE ON public.${quoteAuditIdentifier(table)}
        FOR EACH ROW EXECUTE FUNCTION meterflo_audit.capture()`);
    }
    const {rows}=await client.query(`SELECT table_schema FROM information_schema.tables WHERE table_name='work_orders'
      AND table_schema IN (SELECT schema_name FROM meterflo_audit.project_scopes)`);
    for (const r of rows) await installProjectAudit(client,r.table_schema);
    await client.query("COMMIT");
    enableAuditing();
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
