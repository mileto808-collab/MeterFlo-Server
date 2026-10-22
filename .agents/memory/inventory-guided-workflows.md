---
name: Inventory guided workflow entry
description: Product intent for the Start Inventory entry point and permission-aware wizard selection.
---

Start Inventory is the entry to a main wizard screen where users choose an inventory task they have permission to perform. The chosen task then launches its own step wizard; accepting removed systems/modules is one intended task.

The Start Inventory task selection stays in a modal; Fulfill / Stage Work Orders opens inline in the Inventory page, not in another modal.

**Why:** The user explicitly requested the task chooser modal followed by a same-screen fulfillment workflow.

**How to apply:** Preserve saved workflow state and scan entry while keeping the fulfillment workspace in the page. Confirmation and camera dialogs may still use their existing overlays.

On the fulfillment entry screen, workflow selector cards sit directly below “Choose a fulfillment workflow.” QR scanning is a button above that heading opening a scan modal; pickup-problem review must be prominent.

**Why:** The user requested a simpler entry screen without the expanded scanner form separating the heading from its choices.

**How to apply:** Keep scanner and paste controls inside the ticket modal, keep HID entry available, and use a clearly visible colored pickup-review action.

New crew and scheduled-work selection show only eligible work orders, with their list collapsed by default below Select all eligible matching orders and a sticky-footer return to workflow choices.

**Why:** The user wants bulk selection without a long expanded list, while retaining optional verification and individual deselection.

**How to apply:** Expanding or collapsing must not change selections; returning to workflow choices must preserve inputs and pending-command safety.

Fulfillment uses two phases with focused steps: Pick & stage (choose orders, setup, review/create, print/pick, capture stock, confirm, review/record pull) and Vehicle pickup (verify staged order, capture handoff, confirm, review/record handoff).

**Why:** The user wants the wizard to follow the physical warehouse process, avoiding one overloaded staging screen and reviewing mistakes before committing custody.

**How to apply:** Order selection excludes setup. Printing is optional and never moves stock. Capture screens contain quantities and serials, while reasons/acknowledgments belong in confirmation and exception actions stay secondary. Final reviews show moving-now quantities, remaining stock, shortages and serials; Back preserves captures. Only final Record actions post stock. Fully staged pulls make the batch ready for assigned-vehicle pickup; QR arrivals open verification, not another picking sequence. Preserve partial pulls/handoffs. Setup changes before posting must revalidate source availability and serials; after posting use explicit custody corrections or reassignment, never relabel recorded movement.

Saved order selections permit navigation to Batch Setup even if their current eligibility has changed.

**Why:** The user expects completed draft steps to remain accessible when resuming; creation eligibility must not prevent inspecting saved setup.

**How to apply:** Require a nonempty selection and normal permissions/pending-command safety for navigation, but keep strict eligibility and group/installer validation before review and creation. Explain invalid selections without silently deleting them.

**Why:** The user described a common task-selection screen, not a button tied directly to a single receiving workflow.

**How to apply:** When implementing guided inventory workflows, preserve that shared entry and enforce the permissions appropriate to each selected task. Do not assume Start Inventory should jump straight into removed-equipment acceptance.

Opening Fulfill / Stage Work Orders must always show its main workflow choices, even when a previous draft exists. All saved setup drafts and unfinished batches are resumed through Resume saved batch, not a Continue saved workflow area.

**Why:** The user wants a predictable entry screen rather than being taken automatically to the last fulfillment screen. This requirement applies to the Fulfill / Stage task button, not a change to Start Inventory.

**How to apply:** Manual entry uses the chooser, but refreshing within fulfillment retains the fulfillment workspace and current page. Selecting a batch process goes directly to its page without a replacement prompt; preserve meaningful work as a resumable draft and retain exact pending-operation identities.

Show Save Draft only after meaningful work, and Clear draft only for a saved draft. Meaningful work must also survive crashes, refreshes and interruptions as a draft under Resume saved batch, shared with any authorized project user. Merely visiting a workflow must not create an empty draft.

**Why:** The user wants another authorized warehouse worker to pick up saved work, not browser-only drafts or drafts created by merely visiting the wizard.

**How to apply:** Store meaningful setup drafts in the relational database and list them in Resume saved batch, including automatically recovered work. Do not expose a separate browser-local warning or Recover local inputs workflow. Retain unknown-operation identities without exposing a second posting path. Back to workflow choices belongs in the bottom sticky footer.

Authorized users must be able to delete a fulfillment batch if inventory has not been posted, or if all movements have been fully reversed and verified.

**Why:** The user rejected making previously posted batches linger forever after their inventory movements have been reversed.

**How to apply:** Remove eligible batches from working lists, retaining their movement, reversal, receipt and deletion history. Verify exact returned serials and quantities, outstanding reservations and unresolved issues; zero current quantity alone is not proof. Explain specifically what prevents deletion. Unlinked quantity transfers cannot establish which batch was reversed.

If inventory has not posted, Clear draft resets inputs while retaining the draft; Delete draft deletes the draft.

**Why:** The user explicitly distinguished resetting inputs from deleting a saved draft.

**How to apply:** Keep Clear draft and Delete draft as separate actions. Clear must not call draft deletion, and neither action may erase posted inventory history.

An explicit pick-ticket scan is an exception to the normal chooser-first entry: open that verified batch at the appropriate current step.

**Why:** The user needs warehouse staff to retrieve a staged order quickly when a crew arrives later, using an HID scanner anywhere in Inventory or the fulfillment camera. The technician's pickup notice/report must also show a QR that the warehouse can scan.

**How to apply:** Keep manual task entry predictable. Resolve scanned batch identity against current local permissions and state, not the printed status or scanned host. Waiting staged stock leads to handoff; unpicked work leads to staging; review and completed states must not expose an unsafe movement. Opening a scan never posts stock.

Ticket switching must preserve captured work and unresolved command identities, including separately saved correction work.

**Why:** A technician pickup can arrive while the warehouse worker has another workflow open, and an uncertain correction must not be bypassed by scanning a different ticket.

**How to apply:** Confirm before replacing different unrecorded work, recheck the target after confirmation, block unresolved commands unless their exact receipt proves completion, and reject stale lookup results after inputs change. Do not let the Inventory HID listener steal editable-field focus or consume unrelated serial scans.

External scans must wait for stored captures and the opening refresh before checking whether inputs changed.

**Why:** A cold scan previously raced saved-draft hydration; initialization looked like a new edit and stopped the scan, whereas scanning inside an already-open wizard worked.

**How to apply:** Keep the scan pending through initialization, including entry through the task chooser. Preserve genuine edit/unknown-outcome protection after initialization instead of weakening that protection to allow scans.

Each fulfillment wizard step must bring the next required control into view, focus it, and clearly highlight it; completion must bring its confirmation into view.

**Why:** Retaining the previous step's scroll position left phone users looking at the release-remainder section instead of the vehicle-handoff inputs.

**How to apply:** Apply this on forward/back navigation, resumed steps and movement outcomes, not on ordinary typing or background refreshes. Keep focus within the active dialog and account for the device keyboard without replacing saved captures. If the next field is already visible near the top, retain the section heading rather than scrolling it away; only scroll enough to reveal a distant field.

Explicit pick-ticket arrivals first focus and show the batch name plus its matching printed ticket number, rather than a quantity or scan input.

**Why:** The user needs to match the physical ticket immediately after scanning, including when returning to the staging step.

**How to apply:** Show the readable printed identifier beside the batch name. Realign to that heading even for a repeated scan of the same batch/step; ordinary step navigation still focuses the next required control.
