import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { UserWithSubroleKey } from "@shared/schema";
import { useSystemRestore } from "@/lib/system-restore-state";

export function useAuth() {
  const restore = useSystemRestore();
  const { data: user, isLoading, error } = useQuery<UserWithSubroleKey | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    enabled: !restore,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
