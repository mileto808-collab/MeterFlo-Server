export const embeddedSftpDdl = `
CREATE TABLE IF NOT EXISTS public.sftp_server_settings (
 id integer PRIMARY KEY,enabled boolean NOT NULL DEFAULT false,host text NOT NULL DEFAULT '0.0.0.0',
 port integer NOT NULL DEFAULT 2222,public_host text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.sftp_server_accounts (
 id uuid PRIMARY KEY,project_id integer NOT NULL CONSTRAINT sx_accounts_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 username text NOT NULL UNIQUE,label text NOT NULL,auth_type text NOT NULL,public_key text,password_hash text,
 can_upload boolean NOT NULL,can_download boolean NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.sftp_server_events (
 id uuid PRIMARY KEY,project_id integer CONSTRAINT sx_events_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 username text NOT NULL,action text NOT NULL,status text NOT NULL,file_name text,bytes integer NOT NULL DEFAULT 0,
 message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sx_events_history ON public.sftp_server_events(project_id,created_at);
`;
