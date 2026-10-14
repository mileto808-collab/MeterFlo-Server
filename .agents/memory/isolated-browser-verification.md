---
name: Isolated browser verification
description: Avoid development-transport false positives in isolated signed-in integration tests.
---

Use the built frontend for browser acceptance checks when an isolated test server proxies HTTP APIs but does not implement the development server's WebSocket transport.

**Why:** An HTTP-only Vite proxy produced invalid fallback WebSocket URLs and browser page errors even while settings, navigation and persistence worked. Those errors described the test transport, not the shipped application.

**How to apply:** When testing with isolated dummy server credentials or a mock receiver, retain normal session authentication and exercise the production bundle. If testing the development bundle instead, support its WebSocket/HMR transport before treating transport errors as product regressions.

Acceptance proxies must preserve streaming API responses and cancel them when
the browser disconnects; buffering a long-lived event response can keep test
servers open after assertions finish.

**Why:** Authenticated browser acceptance reached the intended screen but the
HTTP proxy could not finish reading the application's continuous event stream.

**How to apply:** Treat event transport and teardown as part of the test harness,
not evidence of a failed screen or permission check.
