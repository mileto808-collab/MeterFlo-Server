import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export function usePermissions() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const { data: permissions = [], isLoading: isPermissionsLoading } = useQuery<string[]>({
    queryKey: ["/api/users", user?.id, "permissions"],
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch(`/api/users/${user.id}/permissions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const isLoading = isAuthLoading || (!!user && isPermissionsLoading);

  const hasPermission = (permission: string): boolean => {
    if (user?.role === "admin") return true;
    return permissions.includes(permission);
  };

  return {
    permissions,
    hasPermission,
    isLoading,
    user,
  };
}
