---
name: Isolated browser verification
description: Avoid development-transport false positives in isolated signed-in integration tests.
---

Use the built frontend for browser acceptance checks when an isolated test server proxies HTTP APIs but does not implement the development server's WebSocket transport.

**Why:** An HTTP-only Vite proxy produced invalid fallback WebSocket URLs and browser page errors even while settings, navigation and persistence worked. Those errors described the test transport, not the shipped application.

**How to apply:** When testing with isolated dummy server credentials or a mock receiver, retain normal session authentication and exercise the production bundle. If testing the development bundle instead, support its WebSocket/HMR transport before treating transport errors as product regressions.
