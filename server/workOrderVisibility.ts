import { storage } from "./storage";
import { assignedToTechnician } from "../shared/work-order-assignment";
import type { User } from "../shared/schema";

export async function technicianAssignmentScope(user: User) {
  if (!user.subroleId || await storage.isAdminUser(user) ||
      (await storage.getSubrole(user.subroleId))?.key !== "field_technician") return null;
  const groups = await storage.getUserGroupMemberships(user.id);
  return { userId: user.id, groupNames: groups.map(group => group.name) };
}
export async function visibleAssignedOrders<T extends { assignedUserId?: string | null; assignedGroupId?: string | number | null }>(
  user: User, orders: T[],
) {
  const scope = await technicianAssignmentScope(user);
  return scope ? orders.filter(order => assignedToTechnician(order, scope.userId, scope.groupNames)) : orders;
}
