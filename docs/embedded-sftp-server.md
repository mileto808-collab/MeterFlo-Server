# Built-in SFTP server

Standalone Windows/Linux installations now include an optional **SFTP-only SSH server** using `ssh2`, in the MeterFlo process. It is disabled by default. Replit instances do not start this listener; use **HTTPS Exchange** there. HTTPS remains available on standalone instances too. This does not install OpenSSH, create operating-system accounts, or enable remote terminal access.

## Configure

1. Open **Project → File Import/Export → SFTP Server → Server settings** as a site administrator.
2. Choose the bind IP and port (default `0.0.0.0:2222`, allowed range 1–65535). Ports below 1024 may need additional operating-system permission on Linux; prefer 2222 and firewall forwarding rather than running MeterFlo as root. Specify the actual customer-facing DNS name or IP, without a scheme/path/port. Enabling the server starts it; disabling disconnects all customers across all projects. Settings are shared by the instance, not separate listeners per project.
3. Allow the chosen TCP port through Windows Firewall or the Linux firewall. Configure NAT/port forwarding if necessary. MeterFlo does not modify firewall rules, DNS, certificates, routers, or Windows service configuration. Prefer a firewall allowlist of customer source networks.
4. The application/service account needs write access to the configured project FTP root and `.meterflo-sftp` under MeterFlo's working directory. Use a local filesystem supporting atomic hard links (for example NTFS or ext4); unsupported storage fails explicitly rather than exposing partial uploads.
5. Under **Accounts**, create a uniquely named account for this customer/project. The existing **Customer SFTP Connections** permission controls project account management and logs; shared listener settings/restart additionally require the site administrator role. Give upload, download, or both permissions, an expiry within 365 days, and an OpenSSH public key (preferred) or a password of 16–256 characters.
6. Copy/print the account instructions. Supply the public hostname, port, username, and independently verified SHA256 fingerprint. No password/private key is printed or retrievable. These are transfer credentials, not MeterFlo web accounts or Windows/Linux accounts.

The server uses its own persistent Ed25519 host key in `.meterflo-sftp/host_ed25519`. Do not delete it during Git updates; do not commit it. On Linux it is owner-only. On Windows restrict the directory ACL to the service identity and authorized administrators; Unix permission bits do not enforce Windows ACLs. Back this private directory up securely alongside the installation. Database backups do not include this local key. Replacing the key changes the fingerprint and requires customers to independently verify it again. Corrupt/insecure existing keys fail startup instead of being silently regenerated.

## Customer folders

- `/incoming` is **upload-only**, scoped to the account's project. Upload CSV, XLS, XLSX, or JSON, at most 25 MB, using the final filename. Configure clients to disable temporary-name upload/rename, resume, and post-upload attribute changes. No overwrite, rename, directory creation, delete, symlink, or browsing arbitrary paths is allowed. Concurrently uploading the same filename cannot overwrite the first successful file.
- A file stays in hidden staging until a successful SFTP CLOSE atomically publishes complete bytes into that project's existing **Project FTP Files** directory. Disconnecting before CLOSE discards the partial upload. An interrupted upload does not enter the importer. If the application crashes, inaccessible staging bytes can remain; an administrator may remove them while MeterFlo is stopped.
- Existing **LOCAL / server-folder** import configurations process uploaded files, manually or on schedule, with the existing filename glob and column mapping. Do **not** select remote SFTP as the import source for the built-in inbox. Upload success is separate from import success; check import history for record errors. Existing content deduplication applies.
- `/outgoing` is **read-only** and shows successfully generated exports whose destination is **Server local folder** for this project. Exports to HTTPS or an external SFTP destination are not exposed. Import uploads, project documents, work-order attachments, and other projects' files are never listed or downloadable.
- Shell, exec, SSH forwarding/tunnels, agent forwarding, filesystem links, and other subsystems are unavailable. Limits include 64 concurrent connections, four per peer, one session per connection, 16 open file/directory handles, bounded request queues, authentication timeout, idle timeout, and peer authentication throttling.

Example: `sftp -P 2222 customer_project@files.example.com`, then `put orders_20261020.csv /incoming/orders_20261020.csv` or `get /outgoing/ACTUAL_GENERATED_FILENAME.csv`. Replace the example hostname, username, and filenames with the copied project instructions. Verify the server fingerprint before trusting the connection; never disable host-key checking in customer scripts.

## FileZilla navigation and Windows updates

Use **SFTP — SSH File Transfer Protocol**, the configured port and a MeterFlo project transfer account in FileZilla Site Manager. Compare its host fingerprint with MeterFlo. Leave the default remote directory blank or set it to `/`; do not enter a Windows drive path or the physical Project FTP Files path. The virtual root lists only folders granted to this account; `/incoming` intentionally lists no uploaded files.

Current-directory requests such as `/.`, `//.`, `/incoming/.`, repeated separators inside a virtual path, and `/incoming/..` resolve within this project's virtual tree. Parent navigation above `/`, unknown intermediate folders, network/drive paths and paths through a filename remain denied. A path alias never grants upload/download access.

If login succeeds but Activity shows failed **realpath/opendir** with the old **“Parent paths are not permitted”** message, the instance may still be running the old path validator. Update the standalone instance using the existing tracked Windows updater, complete its build and restart, and disconnect/reconnect FileZilla. For an existing PM2 installation, `pm2 restart meterflo` restarts the app after a successful update; `pm2 logs meterflo` and `pm2 describe meterflo` help confirm the running instance. Restart alone does not install changed code. Preserve `.meterflo-sftp` and verify that the fingerprint has not changed.

No manual FTP-folder creation, operating-system SFTP user or broad Windows permission grant fixes a virtual-root path rejection. MeterFlo creates the physical project folder when needed; its service identity still needs the documented filesystem access for actual uploads/downloads. Account expiry/revocation, inactive/locked projects and disabled listener settings remain independent causes of denied operations.

## Status, history, and recovery

The tab displays listener status/start errors, project accounts, scoped success/failure history, search/date filters in the project timezone, and CSV/Excel/print exports. Site administrators also see global listener events and unknown-user authentication failures. Passwords, private keys, and SSH authentication payloads are not logged.

Revoking an account disconnects its active sessions; expiry, project deletion/inactivity, site/project access locks, and server disablement block subsequent file operations. Full system restore stops the listener, disables restored server settings, and revokes restored SFTP accounts; review the instance and create replacement accounts before enabling it. Schedules/manual import and export behavior are otherwise unchanged. A listener startup failure does not stop the MeterFlo website or HTTPS exchange.

## File columns and help

SFTP transports the same files as existing local imports; it does not add new work-order columns. The Imports help compares supported inputs against the **live project work_orders table** and current import handlers. Customer ID, customer name, and address remain required by import validation. Customer work-order ID is recommended and can be generated when omitted; service type is conditional on project configuration. Generated/audit/GPS-proof fields are not ordinary file inputs. Review the live required/optional column guide and mappings for your selected manual or scheduled import; download export columns from the existing export configuration.
