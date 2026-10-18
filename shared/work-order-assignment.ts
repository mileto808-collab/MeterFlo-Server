/** Group membership grants access independently of status or a direct assignment. */
export function assignedToTechnician(
  order: { assignedUserId?: string | null; assignedGroupId?: string | number | null },
  userId: string,
  groupNames: readonly string[],
) {
  return order.assignedUserId === userId ||
    // Despite the historical field name, work orders reference user_groups.name.
    (typeof order.assignedGroupId === "string" && groupNames.includes(order.assignedGroupId));
}
