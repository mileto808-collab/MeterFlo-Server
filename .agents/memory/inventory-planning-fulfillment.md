---

Technicians and authorized users occasionally need to add planned inventory line items in Work Order Details. Technicians should not see unnecessary fields or areas intended for higher-authority inventory work.

**Why:** The user described Work Order Details → Inventory as confusing and explicitly asked for a simpler technician interface.

**How to apply:** Separate simple item/quantity planning from reservation, source, serial, staging and corrective controls. Hide unauthorized areas instead of merely disabling their actions; enforce the same boundaries on the server.

Planning additions, overriding equipment-derived requirements, and reserving stock are separate authorities. Supplemental planned items after staging or handoff must not rewrite the original picked batch or its physical custody.

**Why:** The user approved the simplified technician view and permission separation, including supplemental demand that preserves stock already dispatched.

**How to apply:** Keep field actual-use authority separate from work-order planning and warehouse management. Preserve existing overrides when an ordinary planner edits additions. Treat additions above already covered demand as uncovered planning; reductions below covered demand still need explicit inventory resolution.
name: Inventory planning and fulfillment intent
description: User requirements for manual planned work-order items, future warehouse fulfillment, and onsite serial selection.
---

Manual additions under work-order details → Inventory must remain planned until actual use; adding them must not automatically reserve or deduct stock.

**Why:** The user explicitly wants manually added items to follow the planned-demand behavior of imported type-correlated items.

**How to apply:** Keep planned additions distinct from deliberate reservations and from completed-work actual consumption.

MeterFlo receives bulk imported Open work orders assigned to groups; Scheduled work orders are individually assigned. The user eventually wants a fulfillment process under Start Inventory to help warehouses pull and stage stock for that work.

**Why:** Warehouse preparation must reflect the user's crew/group dispatch and individually scheduled installation workflows.

**How to apply:** Treat fulfillment as warehouse preparation, not proof of installation or a reason to promise the same group work separately to every group member.

Late item-type link setup after importing work orders must support recovery without deleting and re-importing those orders.

**Why:** The user encountered this sequence and imports can contain thousands of records; destructive re-import is not an acceptable recovery workflow.

**How to apply:** Preserve work-order identities, captures, manual plans, reservations and fulfillment history. Distinguish missing mapping from assignment eligibility or demand already covered, and offer project-wide readiness feedback rather than silently resetting operational records.

The installed serial is not known at import time: the technician may grab a random system/module onsite and explicitly record its serial during changeout.

**Why:** The user described this as the normal physical workflow, not an exceptional case.

**How to apply:** Do not require installed-serial allocation during import or planning. Recording serial custody on receipt/transfer is separate from assigning an installed serial to a work order.

Manual fulfillment/staging must work without a wizard. Future wizards streamline existing manual processes and make them accessible from one interface.

**Why:** The user explicitly clarified this task's scope after the initial first-stage proposal.

**How to apply:** Deliver the manual operations and reuse their underlying commands for later guided workflows; do not defer basic fulfillment functionality until wizard implementation.

The user approved a Staging-location approach for the shared stock pool. The fulfillment wizard must cover warehouse pulling, physical staging, and transfer to a vehicle—not stop after planning or staging.

**Why:** The user explicitly requested the warehouse worker be able to handle the whole process in one guided workflow.

**How to apply:** Keep shared crew pools distinct from individually scheduled reservations. Treat Staging as physical custody, never installation, and retain onsite selection of actual installed serials.

The user wants a printable pick ticket during physical picking, placed on the pulled stock in Staging. Technicians assigned to the intended vehicle need to know that stock is waiting and see its items and quantities to help verify loading. Pickup alerts are only needed while the app is open, not while it is closed.

**Why:** Staging and vehicle pickup may occur at different times; the warehouse worker leaves the physical order waiting for its vehicle/crew.

**How to apply:** Treat the ticket and vehicle-assignee pickup visibility as fulfillment requirements. Keep staging custody separate from the later recorded physical vehicle handoff. Do not introduce closed-app push, SMS or email alerts for this workflow.

Pickup viewing is a vehicle-assignee capability, not general warehouse authority. Showing or acknowledging a notice must never record pickup or transfer stock.

**Why:** The crew needs to inspect the physical items and quantities awaiting its vehicle without gaining warehouse-wide inventory access. The warehouse still owns the recorded physical handoff.

**How to apply:** Derive readiness from persisted custody; full staging is ready automatically, while a partial pull needs an explicit readiness decision. Recheck vehicle membership and project access on reads and live refreshes; withhold reassigned scheduled batches and clear completed handoffs. Keep each user's viewed status separate from stock and custody history.

Keep completed fulfillment batches in searchable, filterable, exportable history, separate from resuming unfinished work. Active batches that cannot safely resume still need a distinct review/release path; do not silently hide their remaining holds.

**Why:** The user expects “Resume saved batch” to contain only valid unfinished batches, while completed batches remain findable and warehouse workers still need to resolve interrupted or reassigned custody work.

**How to apply:** Recheck assignment, access, and physical location eligibility against current server state on every load and posting. A crew batch may hand off already-staged stock after an assignment change, but must not pull more; changed scheduled assignments require review before handoff. Preserve physical receipts and pending drafts.

Resolve compatible scheduled reassignments through a guided review rather than requiring a release and a second physical pull.

**Why:** The user needs an easy resolution when a scheduled installer changes, with clear explanations of what changed and what the warehouse should do next.

**How to apply:** Explicitly review the saved/current assignment and the current installer's assigned vehicle. Reuse unhanded-off staged stock without moving or duplicating it; keep historical physical custody intact. Explain incompatible requirements, split installers, access problems, and already-delivered stock with actionable alternatives. Never guess a historical installer that an older batch did not record.

Opening or navigating a fulfillment workflow is not saved work. Do not offer “Continue saved workflow” or warn about replacing inputs unless the user made substantive selections or captures, or an operation needs recovery.

**Why:** The user saw a false saved-workflow prompt after merely choosing a crew flow and leaving the screen open.

**How to apply:** Treat mode/step changes, time spent on the page and exploratory search filters as viewing state. Retain selected orders, entered batch/location details, physical captures and protected retry identities. Remove empty local drafts so they cannot reappear after a refresh.

After a staging pull is recorded, moving to the vehicle-handoff step must not require another reason or physical confirmation for that same pull.

**Why:** The user found repeated pull controls confusing and expects to continue directly when staging is complete. Vehicle handoff is still a separate physical movement that must be recorded.

**How to apply:** Distinguish navigation from stock posting. Keep partial pulls available, make the next phase clear once staging is complete, and require explicit approval before discarding unrecorded movement entries.

Vehicle handoff must offer visual acceptance of all displayed available staged serials and optional searchable checkbox selection for partial handoffs, alongside manual scanning.

**Why:** The user requested visual acceptance after reviewing the staged serial list on a phone, then partial selection so workers can choose only physically handed-over units without editing a long text list. Neither alternative removes the requirement to record a physical pickup.

**How to apply:** Acceptance fills the handoff scan list and corresponding quantity, excludes previously delivered units, and preserves matching scans without duplication. It is draft preparation only; retain physical handoff confirmation and server-side custody checks before posting.

Keep the current fulfillment workflow for now, including required recording of pickups. Do not introduce unrecorded direct-from-Staging field use.

**Why:** After discussing stock-aware replenishment, optional vehicle handoff, and Returns locations, the user said, “Lets keep it the same for now. Forced recording pickups is better.”

**How to apply:** Preserve recorded staging and vehicle handoffs. Further replenishment changes, vehicle-free workflows, and a dedicated Returns type remain proposals requiring approval.
