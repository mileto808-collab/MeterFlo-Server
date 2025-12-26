import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ColumnConfig } from "@/components/column-selector";

interface ColumnPreferencesData {
  visibleColumns: string[];
  stickyColumns: string[];
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
      if (!userId) return { visibleColumns: defaultColumns, stickyColumns: [] };
      const res = await fetch(`/api/users/${userId}/column-preferences/${pageKey}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { visibleColumns: defaultColumns, stickyColumns: [] };
        }
        throw new Error("Failed to fetch column preferences");
      }
      return res.json();
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ visibleColumns, stickyColumns }: { visibleColumns: string[]; stickyColumns?: string[] }) => {
      if (!userId) return;
      await apiRequest("PUT", `/api/users/${userId}/column-preferences/${pageKey}`, {
        visibleColumns,
        stickyColumns,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/users", userId, "column-preferences", pageKey] 
      });
    },
  });

  const visibleColumns = data?.visibleColumns || defaultColumns;
  const stickyColumns = (data?.stickyColumns as string[]) || [];

  const setVisibleColumns = (columns: string[]) => {
    saveMutation.mutate({ visibleColumns: columns, stickyColumns });
  };

  const setStickyColumns = (columns: string[]) => {
    saveMutation.mutate({ visibleColumns, stickyColumns: columns });
  };

  const toggleStickyColumn = (key: string) => {
    const newStickyColumns = stickyColumns.includes(key)
      ? stickyColumns.filter(k => k !== key)
      : [...stickyColumns, key];
    saveMutation.mutate({ visibleColumns, stickyColumns: newStickyColumns });
  };

  const isColumnSticky = (key: string) => stickyColumns.includes(key);

  const isColumnVisible = (key: string) => visibleColumns.includes(key);

  // Get only visible columns in the user's preferred order
  // The visibleColumns array order determines the display order
  const orderedColumns = useMemo(() => {
    // Create a map for quick lookup of column configs
    const columnMap = new Map(allColumns.map(c => [c.key, c]));
    
    // Return only visible columns in their saved order
    const ordered: ColumnConfig[] = [];
    for (const key of visibleColumns) {
      const col = columnMap.get(key);
      if (col) ordered.push(col);
    }
    
    return ordered;
  }, [visibleColumns, allColumns]);

  return {
    visibleColumns,
    setVisibleColumns,
    isColumnVisible,
    stickyColumns,
    setStickyColumns,
    toggleStickyColumn,
    isColumnSticky,
    isLoading,
    isSaving: saveMutation.isPending,
    orderedColumns,
  };
}
