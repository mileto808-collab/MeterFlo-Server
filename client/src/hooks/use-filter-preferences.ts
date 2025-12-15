import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useEffect, useRef } from "react";
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
  const hasUpgradedRef = useRef<string | null>(null);

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

  // Auto-upgrade legacy preferences that don't have knownFilters
  // This is a one-time upgrade per user/page that enables proper new-filter detection going forward
  useEffect(() => {
    const upgradeKey = `${userId}-${pageKey}`;
    if (
      userId &&
      data?.visibleFilters &&
      data.knownFilters == null &&
      hasUpgradedRef.current !== upgradeKey
    ) {
      hasUpgradedRef.current = upgradeKey;
      // Silently upgrade the record by saving with knownFilters
      apiRequest("PUT", `/api/users/${userId}/filter-preferences/${pageKey}`, {
        visibleFilters: data.visibleFilters,
        knownFilters: allFilterKeys,
      }).then(() => {
        queryClient.invalidateQueries({
          queryKey: ["/api/users", userId, "filter-preferences", pageKey],
        });
      }).catch(() => {
        // Ignore upgrade failures - will retry next time
        hasUpgradedRef.current = null;
      });
    }
  }, [userId, pageKey, data, allFilterKeys]);

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
    if (!data?.visibleFilters) return allFilterKeys;
    
    const savedFilters = data.visibleFilters;
    
    // For legacy preferences without knownFilters, default to allFilterKeys
    // This preserves intentionally hidden filters (they stay hidden)
    // The useEffect above will auto-upgrade the record with knownFilters
    // so future new filters can be properly detected
    const knownFilters = data.knownFilters ?? allFilterKeys;
    
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
