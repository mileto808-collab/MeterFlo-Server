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
