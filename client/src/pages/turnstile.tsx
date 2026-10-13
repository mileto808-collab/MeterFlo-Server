import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { fetchTurnstileConfig, fetchTurnstileStatus } from "@/lib/login-security";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
        size?: "normal" | "compact";
      }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileConfig {
  enabled: boolean;
  siteKey: string;
  challengePoint: string;
}

export default function TurnstilePage() {
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [config, setConfig] = useState<TurnstileConfig | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [scriptRetry, setScriptRetry] = useState(0);
  const [widgetRetry, setWidgetRetry] = useState(0);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The widget may already have been torn down by the vendor script.
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setConfig(null);
    setScriptReady(false);
    const initialize = async () => {
      try {
        const status = await fetchTurnstileStatus();
        if (!active) return;
        if (!status.required || status.verified) {
          window.location.replace("/login");
          return;
        }
        const turnstileConfig = await fetchTurnstileConfig();
        if (!active) return;
        if (!turnstileConfig.enabled || !turnstileConfig.siteKey.trim()) {
          setError("Security verification is required, but Turnstile is not fully configured. Contact your MeterFlo administrator.");
          setLoading(false);
          return;
        }
        setConfig(turnstileConfig);
        setLoading(false);
      } catch (failure: unknown) {
        if (!active) return;
        setError(failure instanceof Error ? failure.message : "Could not confirm security verification status.");
        setLoading(false);
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [retryKey]);

  useEffect(() => {
    if (!config?.siteKey || loading || error) return;
    setScriptReady(false);
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }

    let active = true;
    const existing = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    const script = existing ?? document.createElement("script");
    let elapsed = 0;
    let poll = 0;
    let timeout = 0;
    const finish = () => {
      if (!active || !window.turnstile) return;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      setScriptReady(true);
    };
    const fail = () => {
      if (!active) return;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      if (!window.turnstile) script.remove();
      setError("The security challenge could not be loaded. Check your connection and retry.");
    };
    poll = window.setInterval(() => {
      elapsed += 200;
      if (window.turnstile) {
        finish();
      } else if (elapsed >= 12_000) {
        fail();
      }
    }, 200);
    timeout = window.setTimeout(fail, 12_000);
    const onLoad = () => finish();
    const onError = () => fail();
    window.onTurnstileLoad = onLoad;
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (window.onTurnstileLoad === onLoad) window.onTurnstileLoad = undefined;
    };
  }, [config?.siteKey, loading, error, scriptRetry]);

  const confirmSessionAndRedirect = useCallback(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 450));
      try {
        const status = await fetchTurnstileStatus();
        if (!mountedRef.current) return false;
        if (status.verified || !status.required) {
          window.location.replace("/login");
          return true;
        }
      } catch {
        // Retry status confirmation a bounded number of times after server verification.
      }
    }
    return false;
  }, []);

  const handleVerification = useCallback(async (token: string) => {
    if (!mountedRef.current || !token) return;
    setVerifying(true);
    setError(null);
    setSuccess(false);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/security/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ token }),
      });
      let result: { success?: boolean; message?: string };
      try {
        result = await response.json();
      } catch {
        throw new Error("The verification service returned an unreadable response. Please try again.");
      }
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Verification was not accepted. Please try again.");
      }
      setSuccess(true);
      const confirmed = await confirmSessionAndRedirect();
      if (!confirmed && mountedRef.current) {
        setSuccess(false);
        throw new Error("The server has not confirmed your verified session yet. Please complete the challenge again.");
      }
    } catch (failure: unknown) {
      if (!mountedRef.current) return;
      const message = failure instanceof Error && failure.name === "AbortError"
        ? "Verification timed out. Please try again."
        : failure instanceof Error
          ? failure.message
          : "Verification failed. Please try again.";
      setError(message);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          // Keep the retry path available if the widget cannot reset itself.
        }
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (mountedRef.current) setVerifying(false);
    }
  }, [confirmSessionAndRedirect]);

  useEffect(() => {
    if (!scriptReady || !config?.siteKey || !containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        // Re-rendering after a retry may find an already removed widget.
      }
      widgetIdRef.current = null;
    }
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: config.siteKey,
        callback: (token) => void handleVerification(token),
        "error-callback": () => setError("The challenge encountered an error. Please retry it."),
        "expired-callback": () => {
          setError("The challenge expired. Complete it again to continue.");
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              // Error message remains visible if reset fails.
            }
          }
        },
        theme: "auto",
        size: "normal",
      });
    } catch {
      setError("The security challenge could not be displayed. Please retry.");
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Vendor teardown can race route navigation.
        }
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady, config?.siteKey, handleVerification, widgetRetry]);

  const retry = () => {
    setError(null);
    if (config && !window.turnstile) {
      setScriptRetry((key) => key + 1);
    } else if (!config) {
      setRetryKey((key) => key + 1);
    } else if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        setScriptReady(false);
        setScriptRetry((key) => key + 1);
      }
    } else if (window.turnstile) {
      setWidgetRetry((key) => key + 1);
    }
  };

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-5">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back Home
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-5 py-8">
        <Card className="w-full max-w-md border-border/80 shadow-lg shadow-primary/5">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <img src="/meterflo-logo.png" alt="MeterFlo" className="h-20 w-auto object-contain" />
            </div>
            <div className="space-y-2">
              <div className="mx-auto h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                {success ? <CheckCircle2 className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
              </div>
              <CardTitle className="text-2xl">Security verification</CardTitle>
              <CardDescription>One quick check before you reach the MeterFlo login.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="space-y-3" aria-live="polite" aria-label="Loading security check">
                <div className="h-4 w-3/4 mx-auto rounded bg-muted animate-pulse" />
                <div className="h-16 rounded-md bg-muted animate-pulse" />
                <div className="h-4 w-1/2 mx-auto rounded bg-muted animate-pulse" />
              </div>
            ) : (
              <>
                <p className="text-sm text-center text-muted-foreground">
                  Complete the challenge below to continue. Your credentials are only entered on the separate login page.
                </p>
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="relative min-h-[70px] flex justify-center items-center">
                  <div ref={containerRef} className="min-h-[65px]" data-testid="turnstile-widget" />
                  {verifying && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90" aria-live="polite">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Confirming with MeterFlo…</span>
                    </div>
                  )}
                </div>
                {success && <p className="text-sm text-center text-muted-foreground">Challenge accepted. Confirming saved verification…</p>}
                {error && (
                  <Button variant="outline" className="w-full" onClick={retry} disabled={verifying}>
                    Retry verification
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <footer className="py-5 text-center text-xs text-muted-foreground">MeterFlo© · Secure sign-in</footer>
    </main>
  );
}
