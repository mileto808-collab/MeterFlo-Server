import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";

interface HttpLoginRecoveryStatus {
  enabled: boolean;
}

export function HttpLoginRecoveryAlert() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data, isError } = useQuery<HttpLoginRecoveryStatus>({
    queryKey: ["/api/security/http-login-recovery"],
    enabled: isAdmin,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch("/api/security/http-login-recovery", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Unable to check HTTP login recovery (${response.status})`);
      }
      const status = await response.json();
      if (typeof status?.enabled !== "boolean") {
        throw new Error("Invalid HTTP login recovery status");
      }
      return status;
    },
  });

  if (!isAdmin || (data?.enabled !== true && !isError)) {
    return null;
  }

  return (
    <div className="px-4 pt-4 md:px-6" data-testid="alert-http-login-recovery">
      <Alert className="mx-auto max-w-screen-2xl border-amber-700/30 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        <AlertTitle className="text-base font-semibold">
          {data?.enabled === true ? "HTTP login recovery is enabled" : "Unable to confirm HTTP login recovery status"}
        </AlertTitle>
        <AlertDescription className="space-y-2 text-sm leading-relaxed">
          {data?.enabled !== true ? <p>
            The server status check failed. Check the effective server environment
            before assuming recovery mode is disabled. This check will retry automatically.
          </p> : <p>
            While this server setting is on, session cookies can travel over
            unencrypted HTTP for <strong>all users</strong>. Password and role
            checks still apply.
          </p>}
          <p>
            Restrict access to a trusted local or private network. Fix{" "}
            <code className="rounded bg-amber-900/10 px-1 py-0.5 font-mono text-[0.9em] dark:bg-amber-100/10">
              COOKIE_SECURE
            </code>{" "}
            and HTTPS, then remove{" "}
            <code className="rounded bg-amber-900/10 px-1 py-0.5 font-mono text-[0.9em] dark:bg-amber-100/10">
              EMERGENCY_HTTP_LOGIN
            </code>{" "}
            or set it to{" "}
            <code className="rounded bg-amber-900/10 px-1 py-0.5 font-mono text-[0.9em] dark:bg-amber-100/10">
              false
            </code>{" "}
            and restart the server.
          </p>
          <Link
            href="/documentation?doc=windows-deployment#temporary-http-login-recovery"
            className="inline-flex font-medium text-amber-900 underline decoration-amber-800/50 underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 dark:text-amber-200 dark:decoration-amber-200/50 dark:focus-visible:outline-amber-200"
          >
            Read the temporary HTTP login recovery instructions
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  );
}
