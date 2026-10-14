---
name: Portable npm lockfiles
description: Internal locked tarball URLs can break standalone Windows/Linux installation despite a public npm registry setting.
---

Review locked package download addresses after managed dependency changes; preserve versions and integrity when mapping verified public counterparts.

**Why:** This project encountered internal package-firewall download URLs in its committed lockfile. Windows could fetch public npm metadata but could not resolve the internal tarball host, ending in ENOTFOUND and npm's misleading Exit handler never called message. Registry selection alone does not repair explicitly locked internal URLs.

**How to apply:** Treat standalone dependency portability as part of dependency-change verification, not a Node-version issue by default. Check actual failing download addresses, validate equivalent public artifacts, and avoid deleting the lockfile or regenerating the dependency graph as an unexamined workaround.
