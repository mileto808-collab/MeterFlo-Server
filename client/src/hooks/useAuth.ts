import { useQuery } from "@tanstack/react-query";
import type { UserWithSubroleKey } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<UserWithSubroleKey | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
