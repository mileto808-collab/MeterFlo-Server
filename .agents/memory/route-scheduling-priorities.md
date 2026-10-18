---
name: Route scheduling priorities
description: User-approved routing precedence, navigation, address-review safety, provider and billing boundaries.
---

Route optimization must protect appointment times before favoring higher-priority sub-statuses and reducing travel. Lower numeric sub-status ratings mean higher priority, for example Critical = 0 and Priority = 1.

**Why:** The user explicitly selected “Protect appointment times, then prioritize stops” rather than visiting higher-priority stops regardless of lateness.

Field technicians' dispatch lists contain only Scheduled orders personally assigned to them, not unclaimed group work. Authorized support staff and managers can see across technicians, but must generate separate routes per assignee, never a combined technician route. Unassigned orders require assignment and must not be silently routed.

**Why:** The user explicitly rejected combining different technicians' work into one route.

**How to apply:** Allow optimization when any Scheduled orders exist in the filtered grid, ignoring other statuses. A shared warehouse origin applies independently to each technician. Printing one or all routes must keep each technician's stops separate and start each route on a new printed page.

Meaningful provider address discrepancies require explicit per-location review before a route is activated. A confirmed alternate address applies to that plan only, not a permanent alias or permission to rewrite work-order addresses or equipment GPS history.

**Why:** The user approved address-match review after a high-confidence lookup resolved a different numbered road; provider confidence alone did not establish the correct service property.

**How to apply:** Preserve this review boundary when adding providers or changing navigation. Recheck changed address/location results rather than carrying approval into another plan or customer context.


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

Use the work-order street address for route destinations when present. Saved equipment GPS is a fallback only for orders without a street address; an unresolved address must not silently fall back to those coordinates.

**Why:** Imported or historical equipment GPS can point to a different region than the displayed service address. Syntactically valid coordinates are not proof they represent the current job site.

**How to apply:** Preserve historical GPS rather than rewriting it to correct routing. Keep manual/device origins independent of stop resolution, and invalidate saved routes whenever destination-resolution policy changes.

Separate navigation-link correctness from geocoding accuracy. Geoapify's confidence of 1 and `full_match` do not guarantee that the returned street name matches the submitted street.

**Why:** A live address lookup returned a different numbered road while reporting full confidence, and Google Maps reverse-labeled the resulting coordinates with yet another address.

**How to apply:** Verify both the selected-stop coordinates in the outgoing link and the provider's resolved address. Do not claim the physical property is verified from confidence scores or a passing handoff test alone.

Dispatch must remain an explicit action for one assignee, and a manager's device
location must not become that technician's shared origin.

**Why:** Dispatch is an authorization and location-privacy boundary, not a
different way to recover the manager's full planning session.

**How to apply:** If durable or multi-instance dispatch is introduced later,
persist business identities relationally and separate them from licensed provider
payloads. Do not turn transient route geometry or one-plan address confirmations
into permanent business evidence merely to improve recovery.
