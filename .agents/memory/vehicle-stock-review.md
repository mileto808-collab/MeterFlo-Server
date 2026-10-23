---
name: Vehicle stock review
description: Read-only vehicle inventory entry points, scope and reporting authority.
---

Technicians need a quick, live view of system-expected stock in vehicles they can access, available beside Pickups and in the Start Inventory task list.

**Why:** The user approved this shortcut so technicians can check what should be onboard without entering a warehouse operation or physical count.

**How to apply:** Keep it read-only, show quantities and serials, preserve current project/location authorization, and distinguish staged pickup stock from recorded onboard stock. Opening or printing must not create drafts or post inventory.

Authorized users can review all vehicles and print reports. Broad vehicle visibility is granted to administrators and users with location-type/access-management authority, within accessible inventory-enabled projects; it does not confer stock-movement permission.

**Why:** The user requested all-vehicle review and printing for authorized users. Existing location-access administrators already control who can access vehicles, whereas technician inventory-view permission alone must not expose other crews' restricted vehicles.

**How to apply:** Recheck permissions for every read, serial request and print. Treat vehicle identity as project plus location ID, because copies/restores can reuse location IDs. Label stale or disconnected data clearly rather than presenting it as a current physical count.
