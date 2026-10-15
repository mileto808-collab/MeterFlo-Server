---
name: Image fixture validity
description: Why image transport tests must also verify the integrity of their source fixtures.
---

Verify that an image fixture is a complete valid image, not merely decodable base64 with a recognizable header.

**Why:** A widely copied one-pixel PNG had an invalid image-data chunk CRC. Byte-for-byte upload/retrieval equality and MIME-signature checks would still pass because they reproduce the same corrupt source bytes.

**How to apply:** For PNG fixtures, verify chunk CRCs and decompressed pixel data, or use a real image decoder. Keep transport equality tests as a separate check. Byte-signature detection in a receiving example identifies format but must not be advertised as full image validation.

Rasterize SVG barcode fixtures at their viewBox dimensions before independently decoding them.

**Why:** An SVG without explicit width/height can acquire the browser's default image dimensions, shrinking narrow bars below one pixel and producing a false scanner failure despite valid vector output.

**How to apply:** Set canvas dimensions from the SVG viewBox and pass explicit draw dimensions. Decode the rendered bars with an independent scanner; checking SVG markup or echoing its input does not prove readability.
