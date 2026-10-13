export interface TurnstileStatus {
  required: boolean;
  verified: boolean;
}

export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string;
  challengePoint: string;
}

/** Bounded, uncached reads: a network/configuration failure never means verified. */
async function readSecurityJson(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Security verification is unavailable. Please retry or contact your administrator.");
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid security response. Please retry or contact your administrator.");
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Security verification timed out. Please check your connection and retry.");
    if (error instanceof SyntaxError) throw new Error("Invalid security response. Please retry or contact your administrator.");
    if (error instanceof TypeError) throw new Error("Cannot reach security verification. Please check your connection and retry.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTurnstileStatus(): Promise<TurnstileStatus> {
  const data = await readSecurityJson("/api/security/turnstile/status");
  if (typeof data.required !== "boolean" || typeof data.verified !== "boolean") {
    throw new Error("Invalid security status. Please retry or contact your administrator.");
  }
  return { required: data.required, verified: data.verified };
}

export async function fetchTurnstileConfig(): Promise<TurnstileConfig> {
  const data = await readSecurityJson("/api/security/turnstile-config");
  if (typeof data.enabled !== "boolean" || typeof data.siteKey !== "string") {
    throw new Error("Invalid security configuration. Please contact your administrator.");
  }
  // All saved challenge-point values now use the dedicated pre-login page.
  return { enabled: data.enabled, siteKey: data.siteKey.trim(), challengePoint: "turnstile" };
}
