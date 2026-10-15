import type { User } from "@shared/schema";

// Allowlist, not an omission list: new database credential/recovery fields must
// never become public just because they were added to the stored user.
export function userResponse(user: User | undefined) {
  if (!user) return undefined;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    subroleId: user.subroleId,
    isLocked: user.isLocked,
    lockedAt: user.lockedAt,
    lockedReason: user.lockedReason,
    lastLoginAt: user.lastLoginAt,
    address: user.address,
    city: user.city,
    state: user.state,
    zip: user.zip,
    phone: user.phone,
    website: user.website,
    notes: user.notes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Login historically returns this smaller shape; do not broaden it.
export function loginUserResponse(user: User) {
  return { id: user.id, username: user.username, role: user.role };
}
