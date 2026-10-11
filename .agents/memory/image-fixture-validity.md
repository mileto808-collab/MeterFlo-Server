---
name: Image fixture validity
description: Why image transport tests must also verify the integrity of their source fixtures.
---

Verify that an image fixture is a complete valid image, not merely decodable base64 with a recognizable header.

**Why:** A widely copied one-pixel PNG had an invalid image-data chunk CRC. Byte-for-byte upload/retrieval equality and MIME-signature checks would still pass because they reproduce the same corrupt source bytes.

**How to apply:** For PNG fixtures, verify chunk CRCs and decompressed pixel data, or use a real image decoder. Keep transport equality tests as a separate check. Byte-signature detection in a receiving example identifies format but must not be advertised as full image validation.
