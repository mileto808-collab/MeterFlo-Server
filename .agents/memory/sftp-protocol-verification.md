---
name: SFTP protocol verification
description: Why embedded SFTP acceptance must check client session completion, not just transferred bytes.
---

Test a real OpenSSH batch through successful process exit, including both upload and download; matching bytes alone is insufficient.

**Why:** Transfers and every individual CLOSE succeeded while the OpenSSH process still waited for the server's SSH channel to close after EOF. High-level JavaScript clients hid the missing session-completion behavior by actively ending their own connection.

**How to apply:** Include normal client EOF/channel closure, interrupted uploads, and application shutdown in acceptance. Do not treat successful authentication or individual file operations as proof of full client compatibility.

Exercise raw SFTP navigation requests as well as high-level client operations.

**Why:** Client libraries can normalize paths before sending them, hiding a server rejection of harmless current-directory discovery. Successful OpenSSH and library transfers alone do not establish compatibility with another client's navigation.

**How to apply:** Replay current-directory aliases, repeated separators and bounded parent navigation on the wire; check the final authorized virtual tree separately from path spelling. Never resolve customer paths with an operating-system path resolver. Unless a client trace identifies the rejected spelling, do not claim that an activity screenshot establishes the exact request.

Do not assume ssh2's server has every runtime property advertised by its Node net.Server TypeScript inheritance.

**Why:** Its runtime is an EventEmitter wrapper around a network server; a type-valid listening-property check reported a running listener as stopped.

**How to apply:** Verify listener state against the real bound address and exercise actual stop/restart, not only a type check.

Use ssh2's default CommonJS import for runtime values under the project's tsx/ESM development runner; reserve named imports for types.

**Why:** Named runtime imports passed TypeScript and the compiled CommonJS build, but development startup failed because the package did not expose a named utils export to native ESM.

**How to apply:** Verify both development startup and the built standalone server after changes to this package boundary.
