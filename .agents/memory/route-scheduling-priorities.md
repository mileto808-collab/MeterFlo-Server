---
name: Route scheduling priorities
description: User-approved precedence for optimizing Scheduled work-order visits.
---

Route optimization must protect appointment times before favoring higher-priority sub-statuses and reducing travel. Lower numeric sub-status ratings mean higher priority, for example Critical = 0 and Priority = 1.

**Why:** The user explicitly selected “Protect appointment times, then prioritize stops” rather than visiting higher-priority stops regardless of lateness.

**How to apply:** Keep appointment conflicts visible rather than silently treating urgency as permission to miss a scheduled visit. Preserve the separate core Scheduled status and sub-status identity.

Use hybrid navigation: show the route map and stop list inside MeterFlo, with active driving guidance in the phone's Maps app. It must work on iOS as well as Android.

**Why:** The user chose the recommended hybrid approach and explicitly added “Needs work on iOS too.”

**How to apply:** Keep MeterFlo's stop sequence and current-stop state when switching apps. Support Apple Maps on iOS, Google Maps where available and a browser fallback without assuming an installed navigation app.
