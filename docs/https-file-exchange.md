# Secure HTTPS file exchange

HTTPS exchange is an **additional delivery method** on Replit and standalone Windows/Linux. Existing manual web imports/downloads, Project FTP Files, local-directory schedules, and outbound customer SFTP are unchanged. The separate **SFTP Server** tab now provides an optional inbound SFTP-only listener on standalone Windows/Linux; HTTPS exchange itself is not SSH/SFTP.

## Setup and access

Open **Project → File Import/Export → HTTPS Exchange**. The compact menu remains available on touch devices in portrait and landscape.

- **Settings:** enable the service, verify storage, and choose retention days.
- **Credentials:** create a project-specific customer credential with upload and/or download scope and an expiry of 1–365 days. Tokens are shown once, stored only as SHA256 hashes, and excluded from reports. Save them securely at the customer's end. Rotation invalidates the previous token immediately; revocation blocks further requests.
- **Files:** filter/search incoming and outgoing files, download using normal MeterFlo permissions, retry failed/partial incoming processing, or remove content with confirmation.
- **Activity:** filter and export transfer history. Files and activity support CSV, Excel, and printable PDF views. Dates use the project timezone. Filtered reports include all matching entries, not just the current page, up to 25,000.
- **Instructions:** copy or print actual current-origin endpoints and cURL/PowerShell examples. Instructions never contain a real token.

The **HTTPS File Exchange** permission controls settings, credentials, and manual content removal. Import/export permissions separately control ordinary inbox/outbox access. Project assignment and access locks still apply. Customer transfer credentials are not MeterFlo web accounts and cannot access normal application APIs.

### Storage and TLS

Replit uses private App Storage. The default attached bucket can be used; otherwise enter the private bucket ID. Storage must pass write/read/delete verification before enabling. Standalone installations use a private local directory under the configured project-files base by default, or an administrator-specified absolute directory outside public/build folders. Standalone storage requires no Replit account.

Customer endpoints require HTTPS on **all** platforms. For standalone installations, configure a certificate and HTTPS reverse proxy (for example IIS or nginx) that correctly supplies the forwarded protocol. Do not expose an unencrypted application listener as the public customer endpoint or blindly trust client-supplied proxy headers. Normal existing local/manual workflows are not forced to change protocols.

## Customer API

Base: `/api/file-exchange/v1/projects/{projectId}`

All requests send `Authorization: Bearer <PROJECT_TRANSFER_TOKEN>`. Never put credentials in URLs.

| Operation | Endpoint |
|---|---|
| Upload a complete file | `PUT /inbox/{URL-encoded-filename}` |
| List this credential's uploads | `GET /inbox?limit=25&offset=0` |
| Check this credential's upload | `GET /inbox/{fileId}` |
| List project exports | `GET /outbox?limit=25&offset=0` |
| Download export | `GET /outbox/{fileId}/download` |
| Acknowledge successful receipt | `POST /outbox/{fileId}/ack` |

Uploads require `Content-Type: application/octet-stream` and an `Idempotency-Key` of 8–128 letters, numbers, underscores, or hyphens. Send file bytes, not multipart form data. CSV, XLS, XLSX, and JSON are supported, up to 25 MB. Filenames use letters, numbers, spaces, underscores, dots, and hyphens; no paths or parent segments.

An optional `X-Content-SHA256` header is verified. The same key, filename, and bytes return the original transfer (`200` duplicate; `201` new). Reusing a key with different content or filename returns `409`. Retry unknown outcomes with the **same key**. An expired/deleted original remains the original transfer; using that key does not silently create another import.

Only completely stored, committed uploads are made visible for processing. Receipt does **not** mean import success: inspect the file status. Configure an enabled existing import configuration with source **HTTPS**, filename pattern, column mapping, and manual/scheduled frequency. HTTPS imports process up to 25 matching pending files per run, oldest first. Successful content hashes prevent repeat processing. Incoming files are staged privately only during processing; durable originals stay in exchange storage.

Configure export destination **HTTPS outbox** using existing export format, full/new-changed selection, arbitrary status/sub-status selection, filename templates, and schedules. Export checkpoints advance after successful durable publication, not after a failed storage attempt. Customer download/acknowledgement is tracked separately from generation. Download responses include `X-Content-SHA256`; acknowledge only after a verified complete download.

Rate limits and bounded concurrent uploads apply. Respect `Retry-After` on `429`; retry transient failures with the same identity. Plain HTTP returns `426`. Wrong project, expired/revoked credentials, or insufficient scopes are rejected.

## Retention, restores, and operations

Retention removes only **successfully processed inbox content** and **acknowledged outbox content**, measured from processing/acknowledgement time. Pending, failed/partial, and unacknowledged files are retained automatically. History, hashes, and receipt metadata remain after expiry or manual content deletion. Cleanup runs periodically while the application is running; storage failures are recorded and retried rather than silently claiming deletion.

Back up the private local exchange directory or App Storage bucket alongside database backups. Database backups include exchange configuration/history, not an embedded copy of external storage objects. A full system restore disables HTTPS exchange and revokes restored credentials: review storage and queues, issue new credentials, and explicitly enable the intended instance.

The relational schema is exported through the normal shared schema. Replit development uses the guarded development migration and production receives it through Publish. Standalone startup applies the existing additive migration. No deployment-time schema bypass or production-data replacement is introduced.
