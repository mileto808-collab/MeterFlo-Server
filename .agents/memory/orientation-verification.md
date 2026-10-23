---
name: Orientation verification
description: Viewport screenshots and settled control visibility are needed to verify touch-landscape layouts.
---

For portrait-to-landscape acceptance, wait for resize rendering to settle, assert the compact control remains visible, and take a viewport-only screenshot.

**Why:** A full-page touch-landscape capture showed desktop navigation despite a preceding compact-control check; the settled viewport capture confirmed the compact layout. Full-page capture alone is not reliable evidence of orientation-sensitive rendering.

**How to apply:** Use a touch-enabled browser context and verify the visible control after rotation and capture. Reserve full-page images for scrolling/content checks rather than proof of landscape behavior.

Wait for animated or measured workspace geometry to settle before diagnosing clipping after a viewport change.

**Why:** Immediate bounding-box checks have reported oversized dialogs and a footer below the viewport while a subsequent settled capture showed the correctly fitted layout. Animations and available-height measurements can finish after the resize event; two animation frames were not sufficient in one case.

**How to apply:** Poll viewport bounds after resizing, then inspect the viewport screenshot and nested scroll-container widths. For persistent wizard controls, include the footer's bottom edge and a positive content-pane height. Do not infer a permanent CSS defect from an intermediate size.
