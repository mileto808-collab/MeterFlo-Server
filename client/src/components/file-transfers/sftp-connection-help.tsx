import { useState } from "react";
import { BookOpen, Check, ChevronDown, ClipboardList, Server, UploadCloud } from "lucide-react";

export function SftpConnectionHelp() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-md border border-sky-900/15 bg-sky-50/70 p-3 text-sky-950" aria-labelledby="sftp-help-title">
      <div className="flex items-start gap-2.5">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="sftp-help-title" className="text-sm font-semibold">How this SFTP connection works</h3>
          <p className="mt-1 text-xs leading-relaxed text-sky-950/80">
            MeterFlo is an <strong>outbound SFTP client</strong>: it connects to a remote server you specify to pull imports or push exports. This page does not create a server or provide customers with an address to connect to.
          </p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="sftp-connection-help-details"
            onClick={() => setOpen(value => !value)}
            className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs font-semibold text-sky-900 underline decoration-sky-900/40 underline-offset-2 hover:decoration-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700"
          >
            {open ? "Hide connection guidance" : "Show connection guidance"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {open && (
            <div id="sftp-connection-help-details" className="mt-3 space-y-3 border-t border-sky-900/15 pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded border border-sky-900/10 bg-background/70 p-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold"><UploadCloud className="h-3.5 w-3.5" />1. MeterFlo connects to your SFTP</h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Ask your SFTP administrator to create a restricted, project-specific server account for MeterFlo. This is a file-transfer account, not a MeterFlo web user. MeterFlo can pull customer imports and push customer exports using the remote directories you configure.
                  </p>
                </article>
                <article className="rounded border border-sky-900/10 bg-background/70 p-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold"><Server className="h-3.5 w-3.5" />2. Customers connect to a server we operate</h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    This needs a separately configured Windows/Linux or managed SFTP server; this page does not provide or provision one. Set up a restricted account per customer and project, with no interactive shell and isolated project directories. MeterFlo’s outbound client can use that shared handoff server: for example, the customer uploads to <code className="rounded bg-muted px-1">/incoming</code>, MeterFlo pulls; MeterFlo pushes to <code className="rounded bg-muted px-1">/outgoing</code>, and the customer downloads. These paths are examples only, not configured paths.
                  </p>
                  <p className="mt-1.5 text-xs font-medium leading-relaxed text-amber-900">Do not give customers the saved outbound profile as inbound instructions; they need the separately hosted server’s own address, account, and paths.</p>
                  <p className="mt-1.5 text-xs font-medium text-sky-900">Project FTP Files is a storage folder, not a listening FTP/SFTP endpoint.</p>
                </article>
              </div>
              <div className="rounded border border-sky-900/10 bg-background/70 p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold"><ClipboardList className="h-3.5 w-3.5" />Ask the SFTP administrator for these project-specific details</h4>
                <ul className="mt-2 grid gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Protocol: SFTP</li>
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Actual SFTP host/address—not automatically the website URL</li>
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Server-configured SSH port (usually 22)</li>
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Project-specific SFTP username</li>
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Approved SSH-key authentication (preferred) or password</li>
                  <li><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Independently verified SHA256 server host-key fingerprint</li>
                  <li className="sm:col-span-2"><Check className="mr-1 inline h-3 w-3 text-emerald-700" />Actual upload/download directory and agreed filename pattern</li>
                </ul>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Share the client’s <strong>public key</strong> with the SFTP administrator; private keys stay with the client that initiates the connection. Never share Replit workspace SSH credentials. Inbound customer accounts must be created on the hosting SFTP server—not here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
