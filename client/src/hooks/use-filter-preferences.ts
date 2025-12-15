import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { FilterConfig } from "@/components/filter-selector";

interface FilterPreferencesData {
  visibleFilters: string[];
}

export function useFilterPreferences(
  pageKey: string,
  allFilters: FilterConfig[]
) {
  const { user } = useAuth();
  const userId = user?.id;

  const defaultFilters = allFilters.map(f => f.key);

  const { data, isLoading } = useQuery<FilterPreferencesData>({
    queryKey: ["/api/users", userId, "filter-preferences", pageKey],
    queryFn: async () => {
      if (!userId) return { visibleFilters: defaultFilters };
      const res = await fetch(`/api/users/${userId}/filter-preferences/${pageKey}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { visibleFilters: defaultFilters };
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
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/users", userId, "filter-preferences", pageKey] 
      });
    },
  });

  const visibleFilters = data?.visibleFilters || defaultFilters;

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
