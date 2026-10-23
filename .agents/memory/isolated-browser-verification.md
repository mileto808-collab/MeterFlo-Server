---
name: Isolated browser verification
description: Avoid development-transport false positives in isolated signed-in integration tests.
---

Use the built frontend for browser acceptance checks when an isolated test server proxies HTTP APIs but does not implement the development server's WebSocket transport.

**Why:** An HTTP-only Vite proxy produced invalid fallback WebSocket URLs and browser page errors even while settings, navigation and persistence worked. Those errors described the test transport, not the shipped application.

**How to apply:** When testing with isolated dummy server credentials or a mock receiver, retain normal session authentication and exercise the production bundle. If testing the development bundle instead, support its WebSocket/HMR transport before treating transport errors as product regressions.

Rebuild the production bundle after source changes before running isolated browser acceptance.

**Why:** The isolated server serves the previous compiled application until it is rebuilt; source edits alone can make a correct fix appear to fail in browser tests.

**How to apply:** Pair every source-changing acceptance run with a fresh build. A live development preview updating through HMR does not update the isolated production fixture.

Acceptance proxies must preserve streaming API responses and cancel them when
the browser disconnects; buffering a long-lived event response can keep test
servers open after assertions finish.

**Why:** Authenticated browser acceptance reached the intended screen but the
HTTP proxy could not finish reading the application's continuous event stream.

**How to apply:** Treat event transport and teardown as part of the test harness,
not evidence of a failed screen or permission check.

Wait for workspace hydration before deciding which navigation action to take;
closing a task and reloading a task need not return to the same entry screen.

**Why:** A visibility check made before hydration mistook a restored open
workflow for the Inventory list, then waited for a launcher that was correctly
absent. Closing the workflow instead returned to the task chooser.

**How to apply:** Await an actionable workspace surface first, then navigate
from the restored page, task chooser, or Inventory list as appropriate. Do not
replace persisted-screen behavior or add timing sleeps to accommodate tests.

For nested animated modal tests, wait for the child layer to detach and click
the live parent overlay through a locator, not a raw coordinate mouse event.

**Why:** A child can be visually hidden while its dismissable layer still
intercepts pointers. Immediate coordinate clicks produced intermittent missing
parent-dismissal warnings despite the same user flow working after settling.

**How to apply:** Let locator actionability checks wait for the target overlay;
do not add arbitrary sleeps or weaken the warning assertion.

Sequential Select-menu acceptance checks should wait for the previous listbox
layer to detach before opening the next selection.

**Why:** A closing animated layer can still intercept the next click even after
the selected section is visible, producing intermittent false navigation failures.

**How to apply:** Assert the previous listbox is detached rather than adding a
sleep or treating the closing animation as a failed settings save.

Dismiss the development preview's own banner before viewport-fit acceptance
checks, using its normal Close banner control.

**Why:** The injected banner changes document geometry. Browser actionability
scrolling can then move the outer document and resize the application mid-click,
creating false pagination resets and misleading short-landscape screenshots.

**How to apply:** Keep authentication intact, dismiss the banner as a visitor
would, and test the application's actual available viewport. Verify complete
mixed-height page traversal and rotation, not only a successful Next click.

Close finished live observer tabs before opening additional pages in an owned
HTTP/1.1 acceptance server.

**Why:** Multiple SSE connections can exhaust Chromium's shared per-origin
connection pool. A new page may render normally while its recovery fetch waits
indefinitely, even though a separate API request returns the correct data. This
can resemble a broken recovery component or stalled local storage.

**How to apply:** Retain observers until their concurrency/live-update assertions
finish, then close them before testing another page. Diagnose pending browser
requests and connection use before changing recovery logic or weakening checks.
