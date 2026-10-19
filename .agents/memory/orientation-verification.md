---
name: Orientation verification
description: Viewport screenshots and settled control visibility are needed to verify touch-landscape layouts.
---

For portrait-to-landscape acceptance, wait for resize rendering to settle, assert the compact control remains visible, and take a viewport-only screenshot.

**Why:** A full-page touch-landscape capture showed desktop navigation despite a preceding compact-control check; the settled viewport capture confirmed the compact layout. Full-page capture alone is not reliable evidence of orientation-sensitive rendering.

**How to apply:** Use a touch-enabled browser context and verify the visible control after rotation and capture. Reserve full-page images for scrolling/content checks rather than proof of landscape behavior.
