---
name: GPS capture priority
description: User-required GPS source priority and target device platforms.
---

"The app should always get gps from the internal or external device first, with the browser as the last fallback."

Target devices include Android and iOS phones and tablets, plus Windows/Linux laptops.

**Why:** The user explicitly requested this source priority and clarified the supported device types.

**How to apply:** Plan and verify device-first acquisition without representing browser geolocation as a separate direct hardware connection. Do not assume permission to require installed native components; obtain that architecture decision before committing to a cross-platform direct-device implementation.
