import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ColumnConfig } from "@/components/column-selector";

interface ColumnPreferencesData {
  visibleColumns: string[];
}

export function useColumnPreferences(
  pageKey: string,
  allColumns: ColumnConfig[]
) {
  const { user } = useAuth();
  const userId = user?.id;

  const defaultColumns = allColumns.map(c => c.key);

  const { data, isLoading } = useQuery<ColumnPreferencesData>({
    queryKey: ["/api/users", userId, "column-preferences", pageKey],
    queryFn: async () => {
      if (!userId) return { visibleColumns: defaultColumns };
      const res = await fetch(`/api/users/${userId}/column-preferences/${pageKey}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { visibleColumns: defaultColumns };
        }
        throw new Error("Failed to fetch column preferences");
      }
      return res.json();
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const saveMutation = useMutation({
    mutationFn: async (visibleColumns: string[]) => {
      if (!userId) return;
      await apiRequest("PUT", `/api/users/${userId}/column-preferences/${pageKey}`, {
        visibleColumns,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/users", userId, "column-preferences", pageKey] 
      });
    },
  });

  const visibleColumns = data?.visibleColumns || defaultColumns;

  const setVisibleColumns = (columns: string[]) => {
    saveMutation.mutate(columns);
  };

  const isColumnVisible = (key: string) => visibleColumns.includes(key);

  return {
    visibleColumns,
    setVisibleColumns,
    isColumnVisible,
    isLoading,
    isSaving: saveMutation.isPending,
  };
}
