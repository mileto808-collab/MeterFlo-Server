# GPS capture and device setup

## What the web app does

The order is native device/receiver capture when a bridge is connected, then
fresh high-accuracy browser location. Without a native app/helper, web changeouts
work directly through the browser. A browser may use the phone/tablet's GPS; the
web app cannot identify which physical receiver the browser selected.

Internet connectivity alone does not guarantee accuracy. Windows/Linux laptops
without GNSS commonly receive approximate Wi-Fi/network positions. An external
receiver must be supported by its OS, gpsd, NMEA output, or a verified vendor SDK.
Bluetooth pairing alone does not prove compatibility.

Native attempts have an 8-second budget; browser refinement has a 12-second
budget. Watchers, sockets, streams and helper processes are cancelled on exit.
Native responses must match the request ID, exact app origin, version and capture
session and contain a recent timestamp. Saved coordinates/address geocoding are
never substituted for a successful fresh acquisition.

### Project policy

Project → Work Orders → Wizard:

* **Automatic (Background):** capture starts while the technician works. No
  additional GPS step or capture toast is shown. Review & Submit contains source,
  coordinates, reported horizontal accuracy, project-local capture time, status
  and recovery actions. Optional capture is cancelled/frozen at submission.
* **Manual Step:** preserves the explicit GPS step. Review has the same information.
* **Disabled:** no acquisition and no GPS accuracy gate.
* **Reuse old GPS:** off by default. When enabled with customer approval and valid
  old equipment GPS exists, copy it to new GPS and skip both the GPS step and
  background acquisition, including device/browser permission prompts. Review
  labels it “Reused from old equipment”; history records reuse, not a fresh fix.
  This takes precedence over capture mode, including Disabled. Missing/invalid
  old GPS follows the normal mode and accuracy rules. Trouble reports never reuse
  or capture GPS.
* **Maximum GPS error (metres):** optional, initially unset. When set, completion
  requires a captured native/browser position with reported error no greater than
  this value. Missing/unknown/coarse accuracy and manual/saved/address-derived
  coordinates cannot satisfy this policy. This is enforced by the server as well
  as the wizard. Approved **Reuse old GPS** is a separate exception, not proof of
  accuracy. A reported accuracy is an estimate—not a hardware certification.

Manual/reuse actions are explicitly labelled. They do not invent measurement
accuracy or a capture timestamp. Existing site/equipment coordinates are not
erased when an optional capture fails.

## Windows/Linux local helper

This helper runs on the **technician's computer**, not the hosted Replit server.
It uses Node.js 20+ and built-in modules, so no npm packages are needed. Copy the
`script/gps-helper.mjs` file and the entire `script/gps/` directory together.

1. Create/trust a **local HTTPS certificate** covering `localhost` and
   `127.0.0.1`, using your organization's certificate tooling (for example mkcert).
   Never distribute the issuing CA's private key or disable certificate checking.
2. Choose a provider:
   - Linux: `gpsd`, serving an approved internal/external receiver on local port
     2947. TPV fixes must have mode 2/3 and fresh receiver time. Only reported `eph`
     is treated as horizontal error in metres; absent error stays unknown.
   - Linux serial: `nmea`, configured device such as `/dev/ttyUSB0`. Configure the
     device's baud rate first, e.g. `stty -F /dev/ttyUSB0 9600 raw -echo`. Grant the
     operator access to that device. USB/Bluetooth receivers exposing a serial
     NMEA stream can use this path.
   - Windows internal/OS receiver: `windows`, using the Windows location service.
     Enable location services and desktop-app location access. The OS may use
     fused sources; the UI deliberately says **Native device location**, not
     “external GPS verified.” Reported accuracy remains visible.
   - Windows external COM receiver: `nmea --device COM3 --baud 9600`, using the
     built-in .NET serial API through Windows PowerShell. Match the actual baud.
3. Start the helper with your **exact** app origin, trusted certificate paths and
   a private pairing-file location. Do not put keys in URLs or command arguments:

   Linux example (replace paths/site):
   ```sh
   node script/gps-helper.mjs --origin https://your-app.example \
     --cert /private/gps-local.pem --key /private/gps-local-key.pem \
     --token-file /home/tech/.config/meterflo-gps.pairing --provider gpsd
   ```

   Windows PowerShell example:
   ```powershell
   node script/gps-helper.mjs --origin https://your-app.example --cert "$env:USERPROFILE\gps-local.pem" --key "$env:USERPROFILE\gps-local-key.pem" --token-file "$env:USERPROFILE\meterflo-gps.pairing" --provider nmea --device COM3 --baud 9600
   ```
   For Windows location service use `--provider windows` without COM arguments.
   Create the parent pairing directory first. Keep Windows files in the operator's
   private profile and restrict their ACLs. New Linux pairing files use mode 0600.
4. Open **GPS device setup** from the wizard's Review & Submit. Enter
   `https://127.0.0.1:47764/` and the pairing key from the local file, then select
   **Test & pair helper**. Allow local-network access if the browser requests it.
   When testing in an embedded preview, opening the app in its own tab may be
   necessary for local-network permission. This pairing UI is separate from quiet
   background capture; it never forces setup during a changeout.
5. Pairing is stored only in this browser's origin-local storage, not sent to the
   hosted app server. A successful pair verifies helper connectivity, not a
   receiver fix. The helper binds only to `127.0.0.1`, permits only configured
   origins, authenticates every operation and rejects replayed/expired requests.
   Stop it when unused. Delete its pairing file while stopped and restart to
   rotate the pairing key; re-pair browsers afterwards.

NMEA parsing validates sentence checksum, active receiver state, coordinate ranges
and UTC date/time. RMC supplies no metre accuracy; **HDOP is not converted into a
made-up metre accuracy**. Projects requiring reported accuracy should use a
provider reporting it (gpsd/vendor/OS) or an acceptable browser fix.

## Android and iOS phones/tablets: separate Expo project

The Expo application is maintained separately and its source is not in this
repository. No Expo app was created or replaced here.

`examples/native-gps/MeterFloGpsWebView.tsx` is a concrete integration screen for
that project. Integrate it there with `expo-location` and `react-native-webview`,
declare foreground location usage in the native app configuration, and request
foreground permission in an explicit native device-setup screen. Rebuild the
native client after permission/config changes. It never needs background tracking
permission for an open changeout wizard.

The screen injects a cancellable `window.meterfloGps` adapter only for the approved
HTTPS origin and restricts navigation to it. It calls the real native location
API, correlates/cancels messages and never labels the device as external unless
the provider can prove that. On Android the OS/vendor integration must actually
route a supported external receiver to native location. iOS external GNSS may
require MFi/vendor SDK support. Replace the native position call with the
approved SDK when needed; preserve the same request/response validation.

The existing Expo app's native changeout screen can reuse this contract without
a WebView: attempt native capture, then use the web workflow if the native
provider is unavailable. Do not implement a second fake browser-as-native bridge.
Integrating and building the separately maintained Expo app remains separate work.

### Native bridge contract, version 1

Request: `{version:1,id:<UUID>,origin:<exact HTTPS origin>,startedAt:<epoch ms>,timeoutMs:<bounded ms>}`.
Response: `{version:1,id,origin,fix:{coordinates,source:"native",accuracy:<metres|null>,capturedAt:<ISO UTC>,receiver:"internal"|"external"|"unknown"}}`.
The bridge exposes `capture(request)` and `cancel(id)`. Browser fixes are labelled
`source:"browser",receiver:"unknown"`, never relabelled as native/external.

Web multipart completion JSON includes `gpsCoordinates` and `gpsCapture`.
The GPS object has `coordinates`, `source`, `accuracy`, `capturedAt`, `receiver`.
Project-scoped mobile completion and sync use the same `gpsCapture` object
alongside `newGps`/`gpsCoordinates`. Existing coordinates without metadata remain
historic coordinates with unknown provenance, not fabricated fresh fixes.
Offline upload preserves the original capture timestamp, not upload time.

### Schema and upgrades

Metadata is relational: the project stores its nullable accuracy requirement;
project work-order tables store source, horizontal error, capture time and known
receiver category. JSON and SQL backups preserve it; captured-data reset clears
it only when the user chooses to clear captured fields.

Development: `npx tsx script/migrate-gps.ts --development`. This guarded command
updates development only and preserves coordinates. Managed production receives
the schema through Publish; no managed-production startup DDL was added.
Standalone Windows/Linux performs its normal additive initialization after a
normal Git/npm/build/restart update.

## Verification and limits

Automated checks cover native-first ordering, browser-only/no-helper fallback,
permission failure, coarse/unknown accuracy, nonce/origin/freshness rejection,
cancellation and watcher cleanup, NMEA/gpsd fixtures, helper authentication/replay,
and web wizard review/submission in desktop, phone and tablet orientations.

No physical GNSS receiver, Windows location service, Android device or iOS device
was available in the development container. Windows PowerShell execution,
OS certificate/local-network permissions, actual external-receiver routing and
the separately maintained Expo integration must be verified on those devices
before claiming hardware support. The browser never guarantees a particular
physical receiver; the UI reports only what is known.
