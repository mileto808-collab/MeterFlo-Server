# Home and Login regression checks

Run `npm run test:login-flow` for bounded security reads, malformed/unavailable
responses, legacy challenge-point normalization and real Passport logout.

Run `npm run build` then `npm run test:login-ui` in an environment with Playwright
and its Chromium browser available. If the environment provides them separately:

```
npm run test:login-ui -- /absolute/path/to/playwright/index.mjs /absolute/path/to/chromium
```

The UI runner serves the built application with a disposable in-memory Passport
fixture. It uses no production database or credentials and stubs the external
Cloudflare script/verification response deliberately. It verifies desktop/phone
navigation, genuine fixture login/logout session behavior, direct and legacy
routes, disabled/bypassed/already-verified/expired cases, missing configuration,
failed/stalled/malformed requests, rejected/unconfirmed verification, and blocked
script retry. Screenshots go to ignored `generated-artifacts/login-flow/`.

These tests do **not** prove real Cloudflare keys/domain configuration or
Windows reverse-proxy cookie forwarding. Verify those separately with a
disposable deployment or normal operator acceptance; never disable protection
on a live deployment to run this fixture.

The shared production `POST /api/auth/local/login` endpoint intentionally retains
the existing native-mobile contract and does not require Turnstile proof.
These tests prove the web navigation gate, not server-side challenge enforcement
on direct credential requests. A secure mobile exemption and API enforcement
require a separately approved, coordinated authentication change.
