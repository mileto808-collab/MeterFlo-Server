---
name: Physical and mobile location assignments
description: User's distinction between shared brick-and-mortar warehouses and assigned vehicles.
---

The user does not see a need to assign a user to a brick-and-mortar warehouse; user assignments are for non-brick-and-mortar locations such as vehicles.

**Why:** The user stated this distinction while asking what additional location users control.

**How to apply:** Use this distinction when revising location assignments. Do not merely hide assignment fields while leaving non-administrators dependent on those hidden grants; clarify the shared-warehouse permission policy before changing authorization.

The user approved shared warehouse access versus assigned-user mobile access, and requested authorized creation, editing and deletion of location types in their own relational table, like item Categories. Type management belongs in Locations near Add location, with a configurable setting for whether user assignments apply.

**Why:** The user wants configurable location types rather than treating every location as an individually assigned warehouse.

**How to apply:** Default physical warehouses to shared project access and vehicles to assigned-user access; keep action permissions and project boundaries enforced. Use stable type references rather than names as identifiers, and do not treat a type rename as an access-policy change.

Legacy backup restoration must not repeat the live cutover to shared warehouse
access. A backup predating configurable location types retains the former
assignment-restricted policy; backups with explicit types retain those policies.

**Why:** The live cutover is the user's approved access change. Replaying it during
a historical restore could silently grant access beyond the restored assignments.

**How to apply:** Keep the live-migration default separate from conservative legacy
restore/read-only-export compatibility. Preserve hidden assignments in either case.
