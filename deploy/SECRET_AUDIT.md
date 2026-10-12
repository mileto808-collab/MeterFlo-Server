# Deployment Secret Audit and Remediation

## Scope and result

Audit date: **2026-10-12 UTC** (2026-10-11 in America/Denver). The reproducible audit examined a snapshot of **18 accessible references, 6,900 reachable commits and 1,791 text blobs** in a non-shallow repository. It skipped **894 binary blobs and one oversized blob**. Source lines, credential values and environment dumps were neither printed nor included in this report. The detailed values-free object/line report is generated privately by:

```sh
npm run audit:secrets:history -- --report generated-artifacts/secrets/history-audit.json
```

The output directory is excluded from Git and Replit packaging. Re-running may change coverage as references/commits change. The audit reads historical objects, not live environment-secret values, and never compares findings with current credentials.

## Findings requiring owner verification

| Historical location | Credential category | Action |
|---|---|---|
| `deploy/ecosystem.config.cjs` | Session-signing secret, SMTP password and password-bearing database URLs | Confirm whether literals were ever used; treat real values as exposed and arrange separately approved rotation. |
| `attached_assets/_1768070542078.env` | Session-signing secret and database URL password | Review uploaded configuration exposure even though the uploads directory is now ignored. |
| `attached_assets/ecosystem.config_1768068728855.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `attached_assets/ecosystem.config_1768070351680.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `attached_assets/ecosystem.config_1768071237025.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `attached_assets/ecosystem.local_1768115021398.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `attached_assets/ecosystem.local_1768116695902.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `attached_assets/ecosystem.local_1768117108424.cjs` | Session-signing secret and database URL password | Same verification/rotation requirement. |
| `.replit` | Historical JWT-signing variable | Establish whether this legacy credential was used and whether the relevant signer has been retired or rotated. No current JWT credential is inferred from this historical finding. |
| `server/routes.ts` | Shared initial-administrator password supplied to password hashing | This is a known application bootstrap default, not evidence of a live deployment-environment secret. Change the initial administrator password before exposure; a unique first-administrator setup is deferred authentication work. No existing account was inspected or changed. |

The first nine location groups contain **non-placeholder credential-shaped literals**, not verified provider credentials. A session/database credential may recur across uploaded files; occurrences do not prove distinct credentials. Owner confirmation and provider-side revocation checks are required.

Known environment placeholders, documented URL/password examples, permission symbols, redaction masks and clearly labeled synthetic fixtures are classified separately and are not claimed as actual secret exposures. Ordinary code references to environment variables are not classified as literals. Classification cannot prove that an operator never reused an example as a real credential.

## What is fixed now

- Private `.env` variants, runtime PM2 config, logs, dumps and generated reports are ignored; safe templates remain trackable.
- A tracked, guarded PM2 example derives portable install-root paths and fixes production launch mode only. Application settings/credentials are not embedded in it.
- Static working-tree/index checks reject tracked private environment/config files, suspect credential literals and unsafe PM2 overrides. A staged credential cannot be hidden by cleaning its working copy.
- GitHub CI runs the scoped checks and isolated tests. An optional local hook is provided but not automatically installed over organizational hooks.
- Deployment instructions cover fresh clones, protected files, precedence, legacy/cached overrides, backups and recovery.

These changes do **not** sanitize historical commits or automatically replace ignored operator configurations.

## Approval and rotation checklist

**No rotation, revocation, Git-history rewriting or live configuration migration has been performed. Rotation status remains unverified.**

1. Have the credential owner review flagged locations in a protected local session. Do not paste raw history, values or process dumps into chat, tickets, logs or Git. Record only the credential category, owner action and confirmation status.
2. If a database password was real, schedule its provider/database change with the matching protected environment update and service restart. Avoid an outage caused by updating only one side.
3. If a session/JWT signing secret was real and remains relevant, approve a new secret and restart the affected services. Session-secret rotation signs browser users out; communicate this before proceeding.
4. If an SMTP/API credential was real, revoke/replace it at its provider, store the replacement through the approved secure environment process, and verify sending/delivery. Updating `.env` alone does not revoke the old credential.
5. Review protected backups, PM2 saved state and external CI artifacts for stale copies. Never restore a credential-bearing legacy config/dump or assume ignoring a path cleans its history.
6. Separately decide whether coordinated history rewriting is warranted. It can disrupt clones/branches/checkpoints and requires informed approval; it cannot retract copies others already obtained or replace rotation.

## Coverage limitations and outstanding verification

- Accessible local reference snapshots only: no remote fetching, external forks, deleted/unreachable objects, reflogs or provider-side checks.
- Pattern-based plaintext assignment/URL/SQL detection, selected provider-token/private-key signatures and a bootstrap-default check; not an exhaustive security scan or a guarantee that all secrets are absent.
- No OCR, binary/archive extraction, large-blob examination or decoding of arbitrary encrypted/encoded values. Identical objects reused under different paths may have only a representative path recorded.
- Live secrets, actual account passwords, production data and private operator environments were not examined.
- Dummy-credential tests verify dotenv loading, cwd derivation, process-environment precedence, fresh-process reload, cookie-policy choices and redaction on Linux. **Actual Windows/PM2 service startup, daemon-cache cleanup and reboot persistence remain operator verification steps** in the Windows guide.
