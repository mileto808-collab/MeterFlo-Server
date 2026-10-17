---
name: Route scheduling priorities
description: User-approved routing precedence, navigation, provider and billing boundaries.
---

Route optimization must protect appointment times before favoring higher-priority sub-statuses and reducing travel. Lower numeric sub-status ratings mean higher priority, for example Critical = 0 and Priority = 1.

**Why:** The user explicitly selected “Protect appointment times, then prioritize stops” rather than visiting higher-priority stops regardless of lateness.

**How to apply:** Keep appointment conflicts visible rather than silently treating urgency as permission to miss a scheduled visit. Preserve the separate core Scheduled status and sub-status identity.

Use hybrid navigation: show the route map and stop list inside MeterFlo, with active driving guidance in the phone's Maps app. It must work on iOS as well as Android.

**Why:** The user chose the recommended hybrid approach and explicitly added “Needs work on iOS too.”

**How to apply:** Keep MeterFlo's stop sequence and current-stop state when switching apps. Support Apple Maps on iOS, Google Maps where available and a browser fallback without assuming an installed navigation app.

Routing provider configuration must support a customer-operated instance's sitewide default and per-project configuration with that customer's credentials. Offer selectable providers rather than requiring Google, and allow credentials to be supplied later.

**Why:** The user deferred API keys and requested free-service choices, sitewide settings for self-operated MeterFlo instances, and project-specific customer keys.

**How to apply:** Make inheritance versus override explicit, protect credentials across project boundaries, and never silently charge an instance default when project credentials fail. Keep phone navigation choice independent of the routing provider.

Free-provider recommendations must account for permission to transmit customer addresses and device origins, not only quota or price.

**Why:** Hosted openrouteservice's terms checked in October 2026 prohibit transmitting personal data; its free quota was not sufficient justification to use it for technician/customer locations. Geoapify was selected as the hosted free-tier alternative to Google.

**How to apply:** Recheck current provider privacy, production-use and attribution terms before introducing alternatives or changing how route content is stored or displayed. Do not substitute public demo servers for customer production routing.

Protected project configuration requires runtime write isolation across every general project writer, not merely redacted reads or TypeScript payload types. Public browser credential references also require an explicit browser role, separate from server credential references.

**Why:** Existing general project updates preserve unknown settings. Adding a protected ORM column can therefore create a new write path around its dedicated permission and account restrictions; masking returned project fields does not close that path.

**How to apply:** Before adding credential-backed project settings, inspect ordinary create/edit/copy, storage and restore paths. Keep normal DTO round-trips harmless, validate dedicated writes, and verify rejected injection cannot become a public credential response.
