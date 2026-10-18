import React from "react";
import { Button } from "@/components/ui/button";
import { windowsUpdateCommands } from "@shared/windows-update-commands";

export function WindowsUpdateInstructions({ copy }: { copy: (text: string) => void }) {
  return <section className="min-w-0 space-y-3 rounded-md border p-3 text-sm" data-testid="windows-update-instructions">
    <h3 className="font-semibold">Windows Git updates</h3>
    <p>For a standard Windows Git installation, run this on every update in Command Prompt,
      using the Windows account that owns MeterFlo’s PM2 process.</p>
    <p className="text-xs text-muted-foreground">The example folder is C:\xampp\htdocs\meterflo.
      Change it if your installation is elsewhere. Run on Windows, not in this web page or a hosted workspace.</p>
    <code className="block whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs"
      data-testid="windows-routine-command">{windowsUpdateCommands.routine}</code>
    <Button type="button" variant="outline" size="sm" onClick={() => copy(windowsUpdateCommands.routine)}
      data-testid="copy-windows-update">Copy update command</Button>
    <p>The updater pulls origin/main, installs build dependencies, runs checks, builds,
      applies inventory maintenance, restarts, and verifies the exact running build.</p>
    <p className="text-xs text-muted-foreground">Expect downtime. If a maintenance step fails,
      MeterFlo stays stopped; fix that step and rerun. Configuration, data and migration approvals
      are not reset. Do not use this workflow for staged releases or customer-extension installations.</p>
    <details className="space-y-2">
      <summary className="cursor-pointer font-medium">First-time setup and preflight commands</summary>
      <p>Only if the updater script has not reached your installation yet, pull it first:</p>
      <code className="block whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{windowsUpdateCommands.bootstrap}</code>
      <Button type="button" variant="outline" size="sm" onClick={() => copy(windowsUpdateCommands.bootstrap)}
        data-testid="copy-windows-bootstrap">Copy first-time command</Button>
      <p>Optional preflight: check the installation without pulling, installing, migrating or restarting:</p>
      <code className="block whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{windowsUpdateCommands.preflight}</code>
      <Button type="button" variant="outline" size="sm" onClick={() => copy(windowsUpdateCommands.preflight)}
        data-testid="copy-windows-preflight">Copy preflight command</Button>
    </details>
    <p className="text-xs text-muted-foreground">Full documentation: Documentation → Windows Deployment Guide → Updating the Application.
      The code must be pushed to the Git remote before Windows can pull it.</p>
  </section>;
}
