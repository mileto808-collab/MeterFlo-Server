import React from "react";
import { Button } from "@/components/ui/button";

export type CustomerForkReview = {
  canPrepare: boolean;
  blockers: string[];
  command: string;
};

function safeBlocker(text: string): string {
  return text
    .replace(/(?:[A-Za-z]:\\|\/)[^\s"'<>]+/g, "[local path]")
    .replace(/`[^`]*`/g, "[local detail]")
    .replace(/\b[a-f0-9]{40}\b/gi, "[commit]")
    .trim();
}

export function CustomerForkInstructions({
  forkReview,
  copy,
}: {
  forkReview?: CustomerForkReview;
  copy: (text: string) => void;
}) {
  const blockers = forkReview?.blockers.map(safeBlocker).filter(Boolean) ?? [];

  return (
    <section
      aria-labelledby="customer-fork-heading"
      className="min-w-0 space-y-4 rounded-md border border-primary/25 bg-primary/[0.035] p-4 text-sm"
      data-testid="customer-fork-instructions"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Customer fork workflow</p>
        <h3 id="customer-fork-heading" className="font-semibold">Keep three update paths separate</h3>
        <p className="text-muted-foreground">
          Routine Windows installs update from <code>origin/main</code>. Numbered, supported releases use
          extension staging. Direct-code customer forks need an isolated, developer-reviewed merge.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-md border bg-background/70 p-3">
          <h4 className="font-medium">1. Routine Windows update</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the Windows instructions above for the standard <code>origin/main</code> updater. It is not
            a way to merge customer code or install extensions.
          </p>
        </article>
        <article className="rounded-md border bg-background/70 p-3">
          <h4 className="font-medium">2. Supported extension staging</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Use a verified numbered customer release and its separate staging workflow. Never overwrite
            the live installation to test a candidate.
          </p>
        </article>
        <article className="rounded-md border bg-background/70 p-3">
          <h4 className="font-medium">3. Direct-code fork merge</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Stage only in an isolated review directory, then have a developer resolve and review the
            result before any deployment decision.
          </p>
        </article>
      </div>

      {!forkReview?.canPrepare ? (
        <div role="status" className="space-y-2 rounded-md border border-amber-600/35 bg-amber-500/[0.06] p-3">
          <h4 className="font-medium">Fork review preparation is blocked</h4>
          <p className="text-xs text-muted-foreground">
            The required review prerequisites are not currently satisfied. No command is offered here;
            resolve the listed prerequisites and check again.
          </p>
          {blockers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No prerequisite details are available in this preview.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-background/70 p-3">
          <h4 className="font-medium">Prepare an isolated review candidate</h4>
          <p className="text-xs text-muted-foreground">
            Run this CLI command in the existing customer development checkout. It creates a new directory
            outside the live installation containing <code>checkout/</code> and <code>review.json</code>.
            Live source and data are left untouched. Preparation stops for review even after a clean Git merge.
          </p>
          <code className="block break-all rounded-md bg-muted p-3 text-xs" data-testid="customer-fork-command">
            {forkReview.command}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(forkReview.command)}
            data-testid="copy-customer-fork-command"
          >
            Copy fork preparation command
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Review is a manual workflow, not activation</h4>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>In <code>checkout/</code>, resolve every conflict, inspect the changes, and commit the reviewed result.</li>
          <li>Test with separate nonproduction database and storage, plus a sanitized build environment.</li>
          <li>
            Choose one CLI action: status, resume, abort or approve. For example:
            <code className="mt-1 block break-all rounded-md bg-muted p-2 text-xs text-foreground">
              npm run review:customer-fork -- status --target "ABSOLUTE_REVIEW_DIRECTORY"
            </code>
          </li>
          <li>
            Approval also requires <code>--confirm-tests --confirm-customizations --confirm-dependencies --confirm-migrations</code>.
            These are operator attestations, not automatic test runs or proof of database state.
          </li>
          <li>Deployment and publishing remain explicit, separate operator actions.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          A fork-review receipt is not an extension-staging receipt and cannot be activated with{" "}
          <code>activate:customer-release</code>.
        </p>
      </div>

      <a
        href="/documentation"
        className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="customer-fork-documentation"
      >
        Read deployment documentation
      </a>
    </section>
  );
}
