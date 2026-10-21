import bcrypt from "bcryptjs";

// Public first-install credentials, not a deployed instance's current password.
// Use only when creating a new administrator, never to reset a live account.
export const BOOTSTRAP_ADMIN_USERNAME = "admin";
export const BOOTSTRAP_ADMIN_PASSWORD = "pa$$werd1";
export const bootstrapAdminHash = () => bcrypt.hash(BOOTSTRAP_ADMIN_PASSWORD, 10);
