import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkGpsPairing, readGpsPairing, saveGpsPairing } from "@/lib/gps-native-bridge";

export default function GpsSetup() {
  const [paired, setPaired] = useState(() => readGpsPairing());
  const [url, setUrl] = useState(paired?.url ?? "https://localhost:47764/");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function connect() {
    setBusy(true); setMessage("");
    try {
      const pairing = { url, token };
      await checkGpsPairing(pairing);
      saveGpsPairing(pairing); setPaired(pairing); setToken("");
      setMessage("Helper paired for this browser on this device. Device capture will be attempted before browser location.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message + " Check the certificate, allowed website and local-network permission." : "Could not connect to the helper.");
    } finally { setBusy(false); }
  }
  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6" data-testid="gps-device-setup">
      <div><h1 className="text-xl font-semibold">GPS device setup</h1>
        <p className="mt-2 text-sm text-muted-foreground">Web changeouts do not require a native app or helper. Your browser can use the device's location service, including phone GPS. Accuracy depends on the receiver and surroundings—not just internet connectivity.</p></div>
      <div className="space-y-3 rounded-md border p-4">
        <h2 className="font-medium">Optional Windows/Linux helper</h2>
        <p className="text-sm text-muted-foreground">Install and start the helper on this laptop, trust its local HTTPS certificate, and authorize this exact website: <span className="break-all font-mono">{window.location.origin}</span>. Pairing stays in this browser, not on the server.</p>
        <div className="space-y-1"><Label htmlFor="gps-helper-url">Helper HTTPS address</Label>
          <Input id="gps-helper-url" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} /></div>
        <div className="space-y-1"><Label htmlFor="gps-helper-key">Pairing key from the helper's local file</Label>
          <Input id="gps-helper-key" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} disabled={busy} /></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void connect()} disabled={busy || !token}>{busy ? "Connecting…" : "Test & pair helper"}</Button>
          {paired && <Button type="button" variant="outline" disabled={busy} onClick={() => { saveGpsPairing(null); setPaired(null); setMessage("Helper disconnected. Browser fallback remains available."); }}>Disconnect helper</Button>}
        </div>
        {message && <p role="status" className="text-sm break-words">{message}</p>}
      </div>
      <div className="space-y-2 text-sm"><h2 className="font-medium">Android/iOS phones and tablets</h2>
        <p>Use the web app directly for browser location, or the separately maintained MeterFlo native app once its GPS bridge is integrated. External receivers must support that operating system or a verified vendor integration. Bluetooth pairing alone does not establish receiver compatibility.</p>
        <p>Background capture stays quiet. Review & Submit shows the source, reported accuracy and capture time. Project accuracy requirements apply equally to native and browser readings.</p>
      </div>
      <Link href="/" className="text-sm underline">Back to dashboard</Link>
    </section>
  );
}
