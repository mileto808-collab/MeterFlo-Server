import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { coreUpdatePreview } from "../../../server/coreUpdatePreview";
import { CustomerForkInstructions, type CustomerForkReview } from "./customer-fork-instructions";
import { WindowsUpdateInstructions } from "./windows-update-instructions";

export type UpdatePreview = Awaited<ReturnType<typeof coreUpdatePreview>> & {
  forkReview?: CustomerForkReview;
};
const changeLabel = (status: string) => status === "??" ? "Untracked" :
  status.includes("U") || status === "AA" || status === "DD" ? "Unresolved conflict" :
  [status[0] !== " " ? "Staged" : "", status[1] !== " " ? "Working-tree change" : ""].filter(Boolean).join(" + ");

export function CoreUpdatePreview({open, onOpenChange, preview, copy}: {
  open:boolean; onOpenChange:(open:boolean)=>void; preview:UpdatePreview|null; copy:(text:string)=>void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Update Preview</DialogTitle>
        <DialogDescription>Informational only. Fetching references does not replace code, install dependencies, migrate data, stop the app or publish.</DialogDescription>
      </DialogHeader>
      <WindowsUpdateInstructions copy={copy} />
      <CustomerForkInstructions forkReview={preview?.forkReview} copy={copy} />
      {preview && <div className="space-y-4 text-sm">
        <h3 className="font-semibold">Numbered customer-release verification</h3>
        <p className="text-muted-foreground">The checks below concern approved, numbered customer releases,
          not the Windows origin/main updater. Missing release configuration does not mean a Windows update failed.
          It also does not prove the installation is up to date.</p>
        <div className="p-3 border rounded-md space-y-1">
          <p>Installed core: {preview.installed.version} · Extension API: {preview.installed.extensionApiVersion}</p>
          <p>Schema: {preview.installed.schemaVersion} · Declared installed schema: {preview.installed.installedSchemaVersion ?? "Unknown"}</p>
          <p className="break-all">Approved core source: {preview.installed.coreSource ?? "Not configured in the workspace instance manifest"}</p>
          <p className="break-all">Verified checkout baseline: {preview.installed.coreBaseline ? `${preview.installed.coreBaseline.version} / ${preview.installed.coreBaseline.commit}` : "Unknown"}</p>
          <p>Candidate: {preview.candidateVersion ?? "Not verified"} ({preview.remoteBranch || "No numbered tag"})</p>
          {preview.extensionCompatibility.map(x=><p key={x.id}>{x.id} {x.version}: {x.compatible ? "Compatible" : "Incompatible"}</p>)}
          {preview.installed.extensions.map(x=><p key={x.id}>Required by {x.id}: core {x.minCoreVersion} to before {x.maxCoreVersionExclusive}; API {x.extensionApiVersion}</p>)}
          {preview.installed.migrations.map(m=><p key={m.id}>Migration: {m.id} · {m.ownership} · {m.reversible ? "Declared reversible; review required" : "Not reversible by code rollback"}</p>)}
        </div>
        {!!preview.blockers.length && <div role="alert" className="p-3 border border-destructive rounded-md space-y-2">
          <p className="font-medium">Staged release preparation is blocked — do not overwrite this installation</p>
          <ul className="list-disc pl-5">{preview.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul>
          <p>Back up customer work and reconcile conflicts in a separate workspace. A hard reset is not an update recovery procedure.</p>
        </div>}
        {!preview.isGitRepo ? <p>There is no usable Git checkout here. Prepare and test the composed release in the customer's workspace; explicitly publish or activate it there.</p> :
          <p>Customer branch: {preview.currentBranch} · Ahead: {preview.commitsAhead ?? "Unknown"} · Behind: {preview.commitsBehind ?? "Unknown"}</p>}
        <p>{preview.message}</p>
        {!!preview.changes.length && <section>
          <h4 className="font-medium">Local changes (no private content shown)</h4>
          <ul>{preview.changes.map((c,i)=><li key={i} className="break-all">{changeLabel(c.status)}: <code>{c.file}</code></li>)}</ul>
        </section>}
        {!!preview.filesChanged.length && <section>
          <h4 className="font-medium">Core files changed ({preview.filesChanged.length})</h4>
          <pre className="p-3 bg-muted rounded-md text-xs overflow-auto max-h-40">{preview.filesChanged.join("\n")}</pre>
        </section>}
        {preview.diff && <section><h4 className="font-medium">Core change summary</h4>
          <pre className="p-3 bg-muted rounded-md text-xs overflow-auto max-h-40">{preview.diff}</pre></section>}
        {preview.canPrepare && preview.updateCommand && <section className="space-y-2">
          <h4 className="font-medium">Prepare a separate candidate release</h4>
          <p>Run from the existing application directory. Replace the target with a new directory outside the live installation. This does not activate or publish.</p>
          <code className="block p-3 bg-muted rounded-md break-all">{preview.updateCommand}</code>
          <Button variant="outline" onClick={()=>copy(preview.updateCommand)} data-testid="button-copy-update-command">Copy staging command</Button>
        </section>}
      </div>}
      <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
