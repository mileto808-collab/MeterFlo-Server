---
name: Inventory guided workflow entry
description: Product intent for the Start Inventory entry point and permission-aware wizard selection.
---

Start Inventory is the entry to a main wizard screen where users choose an inventory task they have permission to perform. The chosen task then launches its own step wizard; accepting removed systems/modules is one intended task.

**Why:** The user described a common task-selection screen, not a button tied directly to a single receiving workflow.

**How to apply:** When implementing guided inventory workflows, preserve that shared entry and enforce the permissions appropriate to each selected task. Do not assume Start Inventory should jump straight into removed-equipment acceptance.

Opening Fulfill / Stage Work Orders must always show its main workflow choices, even when a previous draft exists. Returning to saved inputs is an explicit Continue saved workflow action.

**Why:** The user wants a predictable entry screen rather than being taken automatically to the last fulfillment screen. This requirement applies to the Fulfill / Stage task button, not a change to Start Inventory.

**How to apply:** Keep saved inputs and exact pending-operation identities intact behind the start screen. Confirm before replacing unrecorded inputs, and prevent a new workflow from bypassing an unresolved operation.

An explicit pick-ticket scan is an exception to the normal chooser-first entry: open that verified batch at the appropriate current step.

**Why:** The user needs warehouse staff to retrieve a staged order quickly when a crew arrives later, using an HID scanner anywhere in Inventory or the fulfillment camera. The technician's pickup notice/report must also show a QR that the warehouse can scan.

**How to apply:** Keep manual task entry predictable. Resolve scanned batch identity against current local permissions and state, not the printed status or scanned host. Waiting staged stock leads to handoff; unpicked work leads to staging; review and completed states must not expose an unsafe movement. Opening a scan never posts stock.

Ticket switching must preserve captured work and unresolved command identities, including separately saved correction work.

**Why:** A technician pickup can arrive while the warehouse worker has another workflow open, and an uncertain correction must not be bypassed by scanning a different ticket.

**How to apply:** Confirm before replacing different unrecorded work, recheck the target after confirmation, block unresolved commands unless their exact receipt proves completion, and reject stale lookup results after inputs change. Do not let the Inventory HID listener steal editable-field focus or consume unrelated serial scans.

Each fulfillment wizard step must bring the next required control into view, focus it, and clearly highlight it; completion must bring its confirmation into view.

**Why:** Retaining the previous step's scroll position left phone users looking at the release-remainder section instead of the vehicle-handoff inputs.

**How to apply:** Apply this on forward/back navigation, resumed steps and movement outcomes, not on ordinary typing or background refreshes. Keep focus within the active dialog and account for the device keyboard without replacing saved captures. If the next field is already visible near the top, retain the section heading rather than scrolling it away; only scroll enough to reveal a distant field.
