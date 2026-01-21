CREATE TABLE "customer_api_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_api_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"work_order_id" integer,
	"customer_wo_id" varchar(100),
	"request_url" varchar(500) NOT NULL,
	"request_method" varchar(10) DEFAULT 'POST' NOT NULL,
	"request_payload" text,
	"response_status" integer,
	"response_body" text,
	"success" boolean DEFAULT false,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_database_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "external_database_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"database_type" varchar(50) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"database_name" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"ssl_enabled" boolean DEFAULT false,
	"additional_options" jsonb,
	"is_active" boolean DEFAULT true,
	"last_tested_at" timestamp,
	"last_test_result" boolean,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "file_import_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_import_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"delimiter" varchar(10) DEFAULT ',' NOT NULL,
	"has_header" boolean DEFAULT true,
	"column_mapping" jsonb,
	"schedule_frequency" varchar(50) DEFAULT 'manual' NOT NULL,
	"custom_cron_expression" varchar(100),
	"is_enabled" boolean DEFAULT true,
	"processed_file_pattern" varchar(255),
	"last_processed_file" varchar(500),
	"last_run_at" timestamp,
	"last_run_status" varchar(50),
	"last_run_message" text,
	"last_run_record_count" integer,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "file_import_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_import_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"file_import_config_id" integer,
	"project_id" integer,
	"import_source" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"user_name" varchar(255),
	"file_name" varchar(500) NOT NULL,
	"status" varchar(50) NOT NULL,
	"records_imported" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"error_details" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "import_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"external_db_config_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"sql_query" text NOT NULL,
	"column_mapping" jsonb,
	"schedule_frequency" varchar(50) DEFAULT 'manual' NOT NULL,
	"custom_cron_expression" varchar(100),
	"is_enabled" boolean DEFAULT true,
	"last_run_at" timestamp,
	"last_run_status" varchar(50),
	"last_run_message" text,
	"last_run_record_count" integer,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "import_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"import_config_id" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"records_imported" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"error_details" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "module_type_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "module_type_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"module_type_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "module_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "module_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" varchar(100) NOT NULL,
	"product_label" varchar(255) NOT NULL,
	"product_description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "module_types_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(100) NOT NULL,
	"label" varchar(100) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "project_holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"name" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_service_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_service_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"service_type_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"description" text,
	"customer_email" varchar,
	"phone" varchar(50),
	"address" varchar(255),
	"city" varchar(100),
	"state" varchar(50),
	"zip" varchar(20),
	"notes" text,
	"database_name" varchar(255),
	"is_active" boolean DEFAULT true,
	"webhook_url" varchar(500),
	"webhook_enabled" boolean DEFAULT false,
	"customer_api_enabled" boolean DEFAULT false,
	"customer_api_url" varchar(500),
	"customer_api_auth_type" varchar(20) DEFAULT 'none',
	"customer_api_key_header" varchar(100),
	"customer_api_secret_env_var" varchar(100),
	"customer_api_send_photos" boolean DEFAULT true,
	"operational_hours_enabled" boolean DEFAULT false,
	"operational_hours_start" varchar(10),
	"operational_hours_end" varchar(10),
	"operational_hours_days" text[],
	"timezone" varchar(100),
	"wizard_mode" varchar(20) DEFAULT 'changeout',
	"wizard_gps_mode" varchar(20) DEFAULT 'automatic',
	"wizard_show_notes_step" boolean DEFAULT true,
	"wizard_show_gps_step" boolean DEFAULT true,
	"wizard_show_before_photos_step" boolean DEFAULT true,
	"wizard_show_after_photos_step" boolean DEFAULT true,
	"wizard_show_signature_step" boolean DEFAULT true,
	"search_show_barcode_scan" boolean DEFAULT true,
	"search_show_qr_code_scan" boolean DEFAULT true,
	"search_show_manual_entry" boolean DEFAULT true,
	"search_show_hid_scanner" boolean DEFAULT true,
	"changeout_equipment_type" varchar(20) DEFAULT 'both',
	"reading_equipment_type" varchar(20) DEFAULT 'both',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"color" varchar(20),
	"is_default" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "service_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subrole_permissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subrole_permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"subrole_id" integer NOT NULL,
	"permission_key" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subroles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subroles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"base_role" varchar(20) DEFAULT 'user' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "subroles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(100) NOT NULL,
	"value" text,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "system_type_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_type_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"system_type_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" varchar(100) NOT NULL,
	"product_label" varchar(255) NOT NULL,
	"product_description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_types_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "trouble_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trouble_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "trouble_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_column_preferences" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_column_preferences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"page_key" varchar(50) NOT NULL,
	"visible_columns" jsonb NOT NULL,
	"sticky_columns" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_filter_preferences" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_filter_preferences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"page_key" varchar(50) NOT NULL,
	"visible_filters" jsonb NOT NULL,
	"known_filters" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_group_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"group_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_group_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_group_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"group_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"username" varchar(100),
	"password_hash" varchar(255),
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"subrole_id" integer,
	"is_locked" boolean DEFAULT false,
	"locked_at" timestamp,
	"locked_reason" varchar(255),
	"last_login_at" timestamp,
	"address" varchar(255),
	"city" varchar(100),
	"state" varchar(50),
	"zip" varchar(20),
	"phone" varchar(50),
	"website" varchar(255),
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "work_order_statuses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_order_statuses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"description" text,
	"color" varchar(20),
	"is_default" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "work_order_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_order_time_tracking" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_order_time_tracking_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"system_work_order_id" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customer_api_logs" ADD CONSTRAINT "customer_api_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_database_configs" ADD CONSTRAINT "external_database_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_import_configs" ADD CONSTRAINT "file_import_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_import_history" ADD CONSTRAINT "file_import_history_file_import_config_id_file_import_configs_id_fk" FOREIGN KEY ("file_import_config_id") REFERENCES "public"."file_import_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_import_history" ADD CONSTRAINT "file_import_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_configs" ADD CONSTRAINT "import_configs_external_db_config_id_external_database_configs_id_fk" FOREIGN KEY ("external_db_config_id") REFERENCES "public"."external_database_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_history" ADD CONSTRAINT "import_history_import_config_id_import_configs_id_fk" FOREIGN KEY ("import_config_id") REFERENCES "public"."import_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_type_projects" ADD CONSTRAINT "module_type_projects_module_type_id_module_types_id_fk" FOREIGN KEY ("module_type_id") REFERENCES "public"."module_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_type_projects" ADD CONSTRAINT "module_type_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_holidays" ADD CONSTRAINT "project_holidays_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_service_types" ADD CONSTRAINT "project_service_types_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_service_types" ADD CONSTRAINT "project_service_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subrole_permissions" ADD CONSTRAINT "subrole_permissions_subrole_id_subroles_id_fk" FOREIGN KEY ("subrole_id") REFERENCES "public"."subroles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_type_projects" ADD CONSTRAINT "system_type_projects_system_type_id_system_types_id_fk" FOREIGN KEY ("system_type_id") REFERENCES "public"."system_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_type_projects" ADD CONSTRAINT "system_type_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_column_preferences" ADD CONSTRAINT "user_column_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_filter_preferences" ADD CONSTRAINT "user_filter_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_projects" ADD CONSTRAINT "user_group_projects_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_projects" ADD CONSTRAINT "user_group_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_subrole_id_subroles_id_fk" FOREIGN KEY ("subrole_id") REFERENCES "public"."subroles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_time_tracking" ADD CONSTRAINT "work_order_time_tracking_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");