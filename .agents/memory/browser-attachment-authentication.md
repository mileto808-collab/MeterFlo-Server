---
name: Browser attachment authentication
description: Native attachment downloads need cookie-based authentication in browser acceptance fixtures.
---

Use cookies, not only browser automation's extra HTTP headers, to authenticate native attachment-download acceptance tests.

**Why:** Chromium's native APK attachment download did not carry the fixture's extra authentication header, despite authenticated metadata and HEAD preflight requests succeeding. The download was cancelled. The same built UI and endpoint passed with a cookie-authenticated test principal.

**How to apply:** Use a legitimate signed-in session where possible. Isolated fixtures can use a test-only authentication cookie on their own test server. Never add a fixture authentication bypass to the running application.
