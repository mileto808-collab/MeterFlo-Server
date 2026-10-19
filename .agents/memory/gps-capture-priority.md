---
name: GPS capture priority
description: User-required GPS source priority and target device platforms.
---

"The app should always get gps from the internal or external device first, with the browser as the last fallback."

Target devices include Android and iOS phones and tablets, plus Windows/Linux laptops.

**Why:** The user explicitly requested this source priority and clarified the supported device types.

**How to apply:** Plan and verify device-first acquisition without representing browser geolocation as a separate direct hardware connection. Saved coordinates or address estimates must not prevent attempting the requested fresh device capture or be labeled as a successful fresh fix.

The user approved requiring installed native apps/helpers for device-first GPS.

**Why:** The user selected "Allow native apps/helpers for device-first GPS (recommended)" after the cross-platform browser limitation was explained.

**How to apply:** Native components are allowed, but receiver compatibility and access to separately maintained mobile source still need verification. Reuse the existing separately maintained Expo client rather than assuming a second full mobile app is wanted.
