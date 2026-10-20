// Test-only entry: imports the REAL wizard; never exposed by the production app.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SystemChangeoutWizard } from "../../client/src/components/system-changeout-wizard";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { Toaster } from "../../client/src/components/ui/toaster";
import "../../client/src/index.css";

const query = new URLSearchParams(location.search);
const settings: any = {
  wizardMode: query.get("workflow") || "changeout",
  gpsMode: query.get("mode") || "automatic",
  reuseOldGps: query.get("reuse") === "true",
  gpsMaxAccuracyMetres: query.has("limit") ? Number(query.get("limit")) : null,
  timezone: "America/New_York",
  showNotesStep: false, showBeforePhotosStep: false, showAfterPhotosStep: false, showSignatureStep: false,
  systemReadingIntegerDigits: 6, systemReadingDecimalPlaces: 4, moduleReadingIntegerDigits: 6, moduleReadingDecimalPlaces: 4,
};
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, queryFn: async ({ queryKey }) => {
    const response = await fetch(queryKey.join("/"));
    if (!response.ok) throw new Error("Fixture service unavailable");
    return response.json();
  },
} } });
function Fixture() {
  const [open, setOpen] = useState(true);
  const [id, setId] = useState(1);
  return <QueryClientProvider client={client}><TooltipProvider>
    <button id="reopen" onClick={() => { setId(value => value + 1); setOpen(true); }}>Reopen</button>
    <SystemChangeoutWizard isOpen={open} onClose={() => setOpen(false)}
      onComplete={async data => {
        (window as any).submissions ??= []; (window as any).submissions.push(data);
      }}
      projectId={3} workOrderId={id} customerWoId="GPS-TEST" serviceType="Electric"
      oldSystemId="OLD-SYSTEM" oldSystemType="E360" newSystemType="E460"
      existingGps={query.get("saved") || undefined} oldGps={query.has("old") ? query.get("old") || undefined : "40, -80"}
      address="GPS fixture" wizardConfig={settings} />
    <Toaster />
  </TooltipProvider></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
