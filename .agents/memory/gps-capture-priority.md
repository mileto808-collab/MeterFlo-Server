---
name: GPS capture priority
description: User-required GPS source priority and target device platforms.
---

"The app should always get gps from the internal or external device first, with the browser as the last fallback."

Target devices include Android and iOS phones and tablets, plus Windows/Linux laptops.

**Why:** The user explicitly requested this source priority and clarified the supported device types.

**How to apply:** Plan and verify device-first acquisition without representing browser geolocation as a separate direct hardware connection. Saved coordinates or address estimates must not prevent fresh capture unless the project's explicit Reuse old GPS policy authorizes valid old equipment coordinates. Never label reuse as a fresh fix.

The user approved requiring installed native apps/helpers for device-first GPS.

**Why:** The user selected "Allow native apps/helpers for device-first GPS (recommended)" after the cross-platform browser limitation was explained.

**How to apply:** Native components are allowed, but receiver compatibility and access to separately maintained mobile source still need verification. Reuse the existing separately maintained Expo client rather than assuming a second full mobile app is wanted.

"In projects with good reliable internet, it would be preferrable to have the option to use this web to do system/module changeouts, with good gps accuracy."

**Why:** The user explicitly requested web changeouts as an option and asked to preserve browser fallback on devices without internal or external GPS.

**How to apply:** Native helpers must not become prerequisites for web changeouts. Browser geolocation may itself use a phone's GPS; show reported accuracy rather than assuming acquisition path proves accuracy. Preserve clearly labeled reuse/manual alternatives under project rules and keep any new accuracy requirement opt-in.

Some projects specify GPS capture in the background; preserve that mode and show capture information in the wizard during review and submittal instead of routine capture messages.

**Why:** The user explicitly warned not to break background capture and requested viewable wizard review/submittal information rather than messages.

**How to apply:** Keep automatic acquisition alongside the active wizard without introducing an extra step or routine app notifications. Keep manual-step and disabled modes distinct; only explicit project requirements should interrupt submission. Browser/OS permission dialogs cannot be suppressed by the app.

The existing Expo mobile app is maintained separately from this workspace.

**Why:** The agreed scope allows a precise native integration handoff when that application's source is unavailable; it does not authorize replacing it with a new mobile app here.

**How to apply:** Keep web changeouts functional independently. Distinguish delivered bridge/helper code from integration into the separate mobile app, and never claim physical receiver or mobile-build verification without performing it.

GPS policy verification must exercise real project creation, reload, and completion—not only the settings editor or pure validation functions.

**Why:** A parsed accuracy requirement can silently disappear in creation-specific field selection, leaving completions unrestricted even though settings and validation tests pass.

**How to apply:** Use an owned disposable database to cover minimal and settings-rich project creation, then verify behavior against the reloaded policy. Distinguish a recorded device/browser fix on the same order from saved coordinates with no capture evidence; preserve genuine capture timestamps through delayed completion.

The per-project setting is named exactly "Reuse old GPS" and is off by default. With customer approval, valid old equipment GPS fills new GPS without a wizard GPS step, background acquisition, or location prompts. Missing or invalid old GPS keeps the existing capture rules.

**Why:** The user requested this exception for projects that do not need new GPS and explicitly shortened the setting's label.

**How to apply:** Use old equipment coordinates, not a previously saved new position. Mark reuse in review and audit history without inventing accuracy or capture time. Apply the policy to both systems and modules; trouble reports remain GPS-free. Keep the separately maintained Expo implementation distinct from web/API delivery.
