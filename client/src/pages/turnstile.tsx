import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

export default function TurnstilePage() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [config, setConfig] = useState<{ enabled: boolean; siteKey: string } | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    setTimeout(() => {
      setLocation("/auth");
    }, 1500);
  }, [setLocation]);

  const handleVerification = useCallback(async (token: string) => {
    setVerifying(true);
    setError(null);
    
    try {
      const response = await fetch("/api/security/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setSuccess(true);
        redirectToLogin();
      } else {
        setError(result.message || "Verification failed. Please try again.");
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      }
    } catch (err) {
      setError("Network error. Please check your connection and try again.");
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    } finally {
      setVerifying(false);
    }
  }, [redirectToLogin]);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !config?.siteKey || !window.turnstile) return;
    
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
    }
    
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: config.siteKey,
      callback: handleVerification,
      "error-callback": () => {
        setError("Challenge error. Please refresh and try again.");
      },
      "expired-callback": () => {
        setError("Challenge expired. Please complete it again.");
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
      theme: "auto",
      size: "normal",
    });
  }, [config?.siteKey, handleVerification]);

  useEffect(() => {
    const checkStatusAndConfig = async () => {
      try {
        const [statusRes, configRes] = await Promise.all([
          fetch("/api/security/turnstile/status", { credentials: "include" }),
          fetch("/api/security/turnstile-config", { credentials: "include" }),
        ]);
        
        const status = await statusRes.json();
        const turnstileConfig = await configRes.json();
        
        if (!status.required || status.verified) {
          setLocation("/auth");
          return;
        }
        
        if (!turnstileConfig.enabled || !turnstileConfig.siteKey) {
          setLocation("/auth");
          return;
        }
        
        setConfig({ enabled: turnstileConfig.enabled, siteKey: turnstileConfig.siteKey });
        setLoading(false);
      } catch (err) {
        console.error("Failed to check turnstile status:", err);
        setLocation("/auth");
      }
    };
    
    checkStatusAndConfig();
  }, [setLocation]);

  useEffect(() => {
    if (!config?.siteKey || scriptLoadedRef.current) return;
    
    const loadScript = () => {
      if (document.querySelector('script[src*="turnstile"]')) {
        if (window.turnstile) {
          renderWidget();
        }
        return;
      }
      
      window.onTurnstileLoad = () => {
        scriptLoadedRef.current = true;
        renderWidget();
      };
      
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    };
    
    loadScript();
    
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [config?.siteKey, renderWidget]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading security check...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Shield className="h-12 w-12 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-bold">MeterFlo</CardTitle>
            <CardDescription className="text-base">
              Security Verification
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {success ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <div className="text-center space-y-2">
                <p className="font-medium text-lg">Verification Complete</p>
                <p className="text-muted-foreground">Redirecting to login...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">
                  Please complete the security check below to continue to the login page.
                </p>
              </div>
              
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <div className="flex justify-center">
                {verifying ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Verifying...</p>
                  </div>
                ) : (
                  <div ref={containerRef} className="min-h-[65px]" data-testid="turnstile-widget" />
                )}
              </div>
              
              <div className="text-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => window.location.reload()}
                  data-testid="button-refresh-challenge"
                >
                  Having trouble? Click to refresh
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
