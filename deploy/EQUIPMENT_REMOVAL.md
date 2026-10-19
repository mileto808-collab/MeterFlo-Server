# Project equipment removal and customer returns

These controls apply only to Inventory-enabled projects. Reading-only work and projects without Inventory retain their existing workflow.

## Configure a project

1. Open the project's **Inventory → Removed Equipment → Removal rules**.
2. Set mandatory warehouse returns separately for systems and modules.
3. Under **Technician options**, check the individual dispositions technicians may select and save each equipment's options.
   - With mandatory returns on, only checked warehouse-return choices are available.
   - With mandatory returns off, only the explicitly checked choices are available; other active rules are not automatically included.
   - New custom field dispositions must be selected here before technicians can use them.
4. Enable the warehouse dispositions your project supports. Built-in actions include return to usable stock, scrap, and **Return to customer**.
5. To create a custom disposition, enter its name and equipment/authority scope. Expand **Inventory behavior (advanced)** to explicitly select its action. Names and notes never determine the action.

Built-in actions cannot be reassigned. Once a custom action is selected for technicians or used, its behavior and equipment scope cannot be changed. Create a separate disposition instead. Renaming a disposition retains its identity and behavior; history retains the name recorded at the time.

## Process warehouse returns

1. A technician records a project-approved field disposition and return location.
2. An authorized receiver accepts equipment into quarantine.
3. After inspection, an authorized warehouse decision maker selects one disposition:
   - **Return to stock:** select a matching equipment item. One unit becomes usable stock at the receiving location, with serial tracking when applicable.
   - **Scrap:** records scrap without adding usable stock.
   - **Return to customer:** holds the equipment outside usable stock pending actual customer collection or dispatch.
4. For a customer return, record the recipient, optional collection/shipping reference, and handoff notes, then **Confirm customer handoff** only after it physically occurs.

Handoff records include the responsible user and server timestamp. Screens, history and printing use the project's timezone. Individual printouts include customer work-order identity, inspection decisions, corrections and handoff evidence. Activity records custody steps separately from disposition decisions.

## Bulk customer handoffs and manifests

1. In **Inventory → Removed Equipment**, decide which inspected equipment is **Return to customer**. It remains held outside usable stock.
2. Choose **Customer handoffs**, or **Verify and hand off to customer** on an individual entry.
3. Choose one source location and select the entries physically leaving that location. Search by the recorded old serial or customer work order. A handoff supports up to 500 entries.
4. Choose **Visually inspect recorded serials** and attest that every selected serial matches, or **Scan every serial**. A scanner can submit each scan with Enter; **Add scan** also accepts an entered serial.
5. Scanning requires one exact match per selected serial. Duplicate, missing, unexpected or ambiguous scans are rejected. Changing the equipment selection or verification mode clears verification.
6. Enter the customer recipient, optional collection/shipping reference and handoff notes. Confirm only after physical collection or dispatch.
7. **Print this manifest** prints a summary followed by a separate serials page. Scan mode prints the verified scans in scan order; visual mode prints the previously collected serials for the selected equipment. Equipment serial identities are not overwritten.
8. Reprint from **Completed handoffs**, the equipment entry's **Print customer manifest**, or the handoff Activity receipt. Manifest dates inherit the project timezone; work orders use customer IDs with internal-number fallback.

Handoffs require **Inventory: resolve removed equipment** (`inventory.resolveReturns`) and access to the source location. Each batch is atomic: a stale, moved, already-handed-off or invalid entry rejects the whole batch. No stock is released or deducted. Header and equipment lines are relational records, with project-scoped foreign keys and a uniqueness constraint preventing one equipment return from appearing in two manifests.

If a connection fails, **Retry this handoff** retains the original payload and posting identity while the page remains open, including after closing/reopening the dialog. Do not prepare a different handoff until that outcome is resolved. After a browser reload, check **Completed handoffs** first; completed equipment is no longer selectable. Backups retain the batch, verification evidence and custody links.

## Correct an incorrect decision

1. On an eligible entry, select **Correct warehouse decision**.
2. Verify the equipment is still physically present and has not been destroyed or handed to the customer.
3. Enter a correction reason and record the correction.
4. The entry returns to quarantine; choose its correct warehouse disposition.

Original history is retained. A correction of a stock release removes the available unit from the original location; missing, moved, consumed or reserved serials cannot be reversed this way. Already handed-off equipment cannot be undone with this action: it requires a real receiving process if it comes back.

A scrap note saying “return to customer” does not change the original scrap decision. An authorized user must explicitly correct it.

## Access

- Receiving authority permits acceptance into quarantine.
- Warehouse decision authority permits inspection decisions, audited corrections and customer handoffs.
- Removal-rule management authority permits project configuration.
- Technician inventory-use authority does not grant warehouse-decision or configuration authority.

The existing inventory schema-maintenance migration creates the relational technician-option links and seeds the new built-in customer-return choice. Existing stock, recorded decisions, notes and history are not reinterpreted.
