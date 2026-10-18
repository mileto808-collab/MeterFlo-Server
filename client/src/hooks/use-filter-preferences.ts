import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { FilterConfig } from "@/components/filter-selector";

interface FilterPreferencesData {
  visibleFilters: string[];
  knownFilters?: string[];
}

export function useFilterPreferences(
  pageKey: string,
  allFilters: FilterConfig[]
) {
  const { user } = useAuth();
  const userId = user?.id;

  const allFilterKeys = useMemo(() => allFilters.map(f => f.key), [allFilters]);

  const { data, isLoading } = useQuery<FilterPreferencesData>({
    queryKey: ["/api/users", userId, "filter-preferences", pageKey],
    queryFn: async () => {
      if (!userId) return { visibleFilters: allFilterKeys, knownFilters: allFilterKeys };
      const res = await fetch(`/api/users/${userId}/filter-preferences/${pageKey}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { visibleFilters: allFilterKeys, knownFilters: allFilterKeys };
        }
        throw new Error("Failed to fetch filter preferences");
      }
      return res.json();
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const saveMutation = useMutation({
    mutationFn: async (visibleFilters: string[]) => {
      if (!userId) return;
      await apiRequest("PUT", `/api/users/${userId}/filter-preferences/${pageKey}`, {
        visibleFilters,
        knownFilters: allFilterKeys,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/users", userId, "filter-preferences", pageKey] 
      });
    },
  });

  // Smart merge: add genuinely new filters (not in knownFilters) but keep intentional hiding intact
  const visibleFilters = useMemo(() => {
    if (!Array.isArray(data?.visibleFilters) || !Array.isArray(data?.knownFilters)) return allFilterKeys;
    
    const savedFilters = data.visibleFilters;
    
    const knownFilters = data.knownFilters;
    
    // Find genuinely NEW filters = current filters that weren't known when preferences were saved
    // These are different from intentionally hidden filters (which are in knownFilters but not in visibleFilters)
    const genuinelyNewFilters = allFilterKeys.filter(key => !knownFilters.includes(key));
    
    // Add only genuinely new filters to the visible list (and dedupe)
    if (genuinelyNewFilters.length > 0) {
      const merged = [...savedFilters, ...genuinelyNewFilters];
      return Array.from(new Set(merged));
    }
    
    // Filter out any saved filters that no longer exist in allFilterKeys
    return savedFilters.filter(key => allFilterKeys.includes(key));
  }, [data?.visibleFilters, data?.knownFilters, allFilterKeys]);

  const setVisibleFilters = (filters: string[]) => {
    saveMutation.mutate(filters);
  };

  const isFilterVisible = (key: string) => visibleFilters.includes(key);

  return {
    visibleFilters,
    setVisibleFilters,
    isFilterVisible,
    isLoading,
    isSaving: saveMutation.isPending,
  };
}
