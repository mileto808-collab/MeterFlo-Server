---
name: Inventory order identity
description: Why readable procurement numbers and mutable supplier references must not replace order identities.
---
Keep a readable order number, a mutable supplier/customer reference and an immutable internal identity separate. Correcting a reference must continue editing the same draft, including after an unknown save outcome.

**Why:** Shipment recovery, receipts and command replay depend on the original identity. Treating a business-reference correction as a new identity can duplicate a draft or disconnect its physical shipment evidence.

**How to apply:** Any new editor or client must preserve internal identity across reference changes and retries. Human-readable labels are for presentation, never for rebinding saved shipment commands or rewriting old receipt references.

Expanded order details should not display raw order UUIDs. Keep the readable order number as the visible identifier; internal IDs can remain copyable for support.

**Why:** The user clarified that readable identifiers must also apply inside expanded order details, not only to order headings.

**How to apply:** Do not reintroduce raw UUID text when expanding an order. Preserve internal IDs in storage and transport, and keep full-ID search and copy actions working.

Returning an order to an editable draft must not silently invalidate or clear a saved shipment capture.

**Why:** Recoverable scans may include a prepared request with an unknown outcome. Editing the order underneath that capture can invalidate physical evidence or allow a late request against changed lines.

**How to apply:** Require explicit capture reconciliation or discard before un-releasing either order type. Serialize un-release with stock posting under the existing aggregate lock; posted dispatches and receipts always prevent returning to draft.

Restore must preserve locally known numbering high-water marks and known immutable numbers when old archives omit them; conflicts must fail explicitly.

**Why:** Printed order numbers and supplier communications can exist outside the database snapshot. Restoring stock does not make those already issued numbers unused.

**How to apply:** Maintain this boundary in both project and full-system restore paths. A fresh independent server cannot infer numbers issued elsewhere after its snapshot; do not promise global or gapless numbering across customer instances.

Show readable business identifiers and usernames in inventory activity and shipment documents. Printed internal tracking IDs should be barcodes, not raw UUID text.

**Why:** The user explicitly requested readable Activity details and receiving/transfer receipts, with a barcode in place of the printed internal ID.

**How to apply:** Preserve the original internal identity in barcode data and stored relationships. Never encode the editable supplier reference as if it were the internal ID or rewrite historical evidence merely to improve its display.

Print the readable receipt/order identifier alongside its own tracking barcode.

**Why:** The user found two unlabeled UUID barcodes indistinguishable and requested readable IDs with the barcodes.

**How to apply:** Identify each barcode with its readable receipt label or order number, while keeping receipt and order barcode payloads attached to their respective original internal IDs.
