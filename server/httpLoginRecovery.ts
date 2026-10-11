/** Exact opt-in, server-controlled only. No password or role checks are bypassed. */
export function httpLoginCookiePolicy(environment: Record<string, string | undefined>) {
  const enabled = environment.EMERGENCY_HTTP_LOGIN === "true";
  return { enabled, secure: !enabled && environment.COOKIE_SECURE === "true" };
}
