---
name: Secret audit classification
description: Avoid false leak claims and credential disclosure when extending deployment checks.
---

Credential-shaped names are not proof of literal credentials. Use language-aware checks for code, distinguish references/masks/permission symbols from literals, and keep audit output limited to location and classification metadata.

**Why:** regex-only checks misclassified schema types, runtime variables and redaction markers as leaked credentials. Repository history also contains public examples and synthetic fixtures; neither pattern matches nor cleanup prove provider validity or completed rotation.

**How to apply:** when adding audit patterns, include reference and synthetic-fixture regressions plus value-redaction tests. Treat non-placeholder historical literals as potential exposures requiring owner verification; never print raw source/history or compare against live secret values.

For URL checks, distinguish authority/userinfo from ports and paths before classifying credentials.

**Why:** a broad pattern can mistake a hostname's port followed by an `@scope` path segment for a password. That creates blocking false positives even for credential-free package addresses; it is not evidence of an exposed secret.

**How to apply:** include port-plus-scoped-path negative cases alongside real-userinfo positive cases. Do not weaken secret checks or exempt whole test directories to accommodate synthetic fixtures.
