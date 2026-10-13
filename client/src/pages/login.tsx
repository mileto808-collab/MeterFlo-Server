import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { fetchTurnstileStatus } from "@/lib/login-security";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setSecurityError(null);
    fetchTurnstileStatus()
      .then((status) => {
        if (!active) return;
        if (status.required && !status.verified) {
          window.location.replace("/turnstile");
          return;
        }
        setChecking(false);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setSecurityError(failure instanceof Error ? failure.message : "Unable to confirm security status.");
        setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [retryKey]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const status = await fetchTurnstileStatus();
      if (!mountedRef.current) return;
      if (status.required && !status.verified) {
        window.location.replace("/turnstile");
        return;
      }
      await apiRequest("POST", "/api/auth/local/login", { username: username.trim(), password });
      window.location.assign("/");
    } catch (failure: unknown) {
      if (mountedRef.current) {
        setError(failure instanceof Error ? failure.message : "Sign in could not be completed. Please try again.");
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
        <Link href="/" aria-label="Back to MeterFlo home" className="inline-flex items-center">
          <img src="/meterflo-logo.png" alt="MeterFlo" className="h-14 w-auto object-contain" />
        </Link>
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center justify-center px-5 py-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
          <Card className="border-border/80 shadow-lg shadow-primary/5">
            <CardHeader className="space-y-4 pb-5">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
              </div>
              <div>
                <CardTitle className="text-2xl">Log in to MeterFlo</CardTitle>
                <CardDescription className="mt-2">
                  Use your account credentials to access your work orders and project tools.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {checking ? (
                <div className="space-y-4" aria-live="polite" aria-label="Checking security status">
                  <div className="h-10 rounded-md bg-muted animate-pulse" />
                  <div className="h-10 rounded-md bg-muted animate-pulse" />
                  <div className="h-10 rounded-md bg-muted animate-pulse" />
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Confirming this sign-in is protected.
                  </p>
                </div>
              ) : securityError ? (
                <div className="space-y-4">
                  <Alert variant="destructive">
                    <AlertDescription>{securityError}</AlertDescription>
                  </Alert>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" onClick={() => setRetryKey((key) => key + 1)}>Retry check</Button>
                    <Link href="/" className="w-full">
                      <Button variant="secondary" className="w-full">Back Home</Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {error && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="Enter your username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      data-testid="input-username"
                      disabled={submitting}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        data-testid="input-password"
                        className="pr-11"
                        disabled={submitting}
                        required
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        data-testid="button-toggle-password"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting} data-testid="button-login-submit">
                    {submitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
                    ) : "Log In"}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">Authorized MeterFlo users only.</p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <footer className="py-5 text-center text-xs text-muted-foreground">
        MeterFlo© · Utility field work, in sync
      </footer>
    </main>
  );
}
