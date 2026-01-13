import { useState, useMemo, useCallback, useEffect } from "react";
import { workOrderFilterFields, getInitialFilterValues, type FilterFieldConfig } from "@/config/workOrderFilters";

export interface WorkOrderFilterState {
  systemWoId: string;
  searchQuery: string;
  status: string;
  serviceType: string;
  assignedTo: string;
  assignedGroup: string;
  trouble: string;
  oldSystemType: string;
  newSystemType: string;
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  route: string;
  zone: string;
  oldSystemId: string;
  newSystemId: string;
  oldModuleId: string;
  newModuleId: string;
  oldModuleType: string;
  newModuleType: string;
  scheduledAtFrom: string;
  scheduledAtTo: string;
  createdBy: string;
  updatedBy: string;
  scheduledBy: string;
  completedBy: string;
  completedAtFrom: string;
  completedAtTo: string;
  notes: string;
  createdAtFrom: string;
  createdAtTo: string;
  updatedAtFrom: string;
  updatedAtTo: string;
  [key: string]: string;
}

interface UseWorkOrderFiltersOptions {
  storageKey?: string;
  persistToSession?: boolean;
}

const initialState: WorkOrderFilterState = getInitialFilterValues() as WorkOrderFilterState;

export function useWorkOrderFilters(options: UseWorkOrderFiltersOptions = {}) {
  const { storageKey, persistToSession = false } = options;
  
  const [filters, setFiltersState] = useState<WorkOrderFilterState>(() => {
    if (persistToSession && storageKey) {
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
          return { ...initialState, ...JSON.parse(stored) };
        }
      } catch (e) {
        console.error("Failed to restore filter state:", e);
      }
    }
    return { ...initialState };
  });

  useEffect(() => {
    if (persistToSession && storageKey) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(filters));
      } catch (e) {
        console.error("Failed to save filter state:", e);
      }
    }
  }, [filters, persistToSession, storageKey]);

  const setFilter = useCallback((key: string, value: string) => {
    setFiltersState(prev => ({ ...prev, [key]: value }));
  }, []);

  const setFilters = useCallback((newFilters: Partial<WorkOrderFilterState>) => {
    setFiltersState(prev => {
      const result = { ...prev };
      for (const [key, value] of Object.entries(newFilters)) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
      return result;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({ ...initialState });
  }, []);

  const hasActiveFilters = useMemo(() => {
    return Object.entries(filters).some(([key, value]) => {
      const config = workOrderFilterFields.find(f => f.key === key || `${f.key}From` === key || `${f.key}To` === key);
      if (!config) return false;
      if (config.type === "select" || config.type === "user-select" || config.type === "group-select") {
        return value !== "all";
      }
      return value !== "";
    });
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const field of workOrderFilterFields) {
      if (field.type === "date-range") {
        if (filters[`${field.key}From`] || filters[`${field.key}To`]) {
          count++;
        }
      } else if (field.type === "select" || field.type === "user-select" || field.type === "group-select") {
        if (filters[field.key] !== "all") {
          count++;
        }
      } else {
        if (filters[field.key]) {
          count++;
        }
      }
    }
    return count;
  }, [filters]);

  return {
    filters,
    setFilter,
    setFilters,
    resetFilters,
    hasActiveFilters,
    activeFilterCount,
    filterFields: workOrderFilterFields,
  };
}

export type { FilterFieldConfig };
