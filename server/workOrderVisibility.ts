import { storage } from "./storage";
import { assignedToTechnician } from "../shared/work-order-assignment";
import type { User } from "../shared/schema";
import { inventoryDispatchScope } from "./inventoryDispatch";

export async function technicianAssignmentScope(user: User) {
  if (!user.subroleId || await storage.isAdminUser(user) ||
      (await storage.getSubrole(user.subroleId))?.key !== "field_technician") return null;
  const groups = await storage.getUserGroupMemberships(user.id);
  return { userId: user.id, groupNames: groups.map(group => group.name) };
}
export async function visibleAssignedOrders<T extends { id?: number; assignedUserId?: string | null; assignedGroupId?: string | number | null; status?: string }>(
  user: User, orders: T[], projectId?: number,
) {
  const scope = await technicianAssignmentScope(user);
  if (!scope) return orders;
  if (!projectId) return orders.filter(order => assignedToTechnician(order, scope.userId, scope.groupNames));
  const inventory = await inventoryDispatchScope(projectId, user.id, orders);
  if (!inventory.enabled) return orders.filter(order => assignedToTechnician(order, scope.userId, scope.groupNames));
  return orders.flatMap(order => {
    if (["completed", "closed", "cancelled"].includes(order.status?.toLowerCase() ?? "")) return [];
    const dispatch = order.id ? inventory.dispatch.get(order.id) : undefined;
    if (dispatch) {
      // A crew may verify the pickup together, but a scheduled install remains personal.
      const canStart = dispatch.canStart && (!order.assignedUserId || order.assignedUserId === user.id);
      return [{ ...order, inventoryDispatch: { ...dispatch, canStart,
        ...(!canStart && dispatch.canStart ? { reason: "This order is assigned to another technician. An authorized dispatcher must reassign it before you can start." } : {}) } }];
    }
    if (order.id && (inventory.requires.has(order.id) || inventory.batched.has(order.id))) return [];
    return assignedToTechnician(order, scope.userId, scope.groupNames) ? [order] : [];
  });
}
