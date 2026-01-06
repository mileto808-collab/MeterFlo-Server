import { useEffect, useRef, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProjectEvent {
  type: "workorder_created" | "workorder_updated" | "workorder_deleted" | "file_added" | "file_deleted";
  projectId: number;
  workOrderId?: number;
  userId?: string;
  timestamp: string;
}

interface UseProjectEventsOptions {
  onWorkOrderUpdated?: (workOrderId: number) => void;
}

export function useProjectEvents(projectId: number | null, options?: UseProjectEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const invalidateProjectQueries = useCallback((event: ProjectEvent) => {
    if (!event.projectId) return;

    switch (event.type) {
      case "workorder_created":
      case "workorder_updated":
      case "workorder_deleted":
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey;
            if (Array.isArray(key) && typeof key[0] === 'string') {
              return key[0].startsWith(`/api/projects/${event.projectId}/work-orders`);
            }
            return false;
          }
        });
        // Call the optional callback for work order updates
        if (event.type === "workorder_updated" && event.workOrderId && options?.onWorkOrderUpdated) {
          options.onWorkOrderUpdated(event.workOrderId);
        }
        break;
      case "file_added":
      case "file_deleted":
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey;
            if (Array.isArray(key) && typeof key[0] === 'string') {
              return key[0].startsWith(`/api/projects/${event.projectId}/files`) ||
                     key[0].includes(`/work-orders/${event.workOrderId}/files`);
            }
            return false;
          }
        });
        break;
    }
  }, [options?.onWorkOrderUpdated]);

  const connect = useCallback(() => {
    if (!projectId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/projects/${projectId}/events`, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      console.log(`SSE connected for project ${projectId}`);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: ProjectEvent = JSON.parse(event.data);
        invalidateProjectQueries(data);
      } catch (error) {
        console.error("Failed to parse SSE event:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      eventSource.close();
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    eventSourceRef.current = eventSource;
  }, [projectId, invalidateProjectQueries]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return null;
}

export function useGlobalEvents() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const invalidateGlobalQueries = useCallback((event: ProjectEvent) => {
    switch (event.type) {
      case "workorder_created":
      case "workorder_updated":
      case "workorder_deleted":
        if (event.projectId) {
          queryClient.invalidateQueries({ 
            predicate: (query) => {
              const key = query.queryKey;
              if (Array.isArray(key) && typeof key[0] === 'string') {
                return key[0].startsWith(`/api/projects/${event.projectId}/work-orders`);
              }
              return false;
            }
          });
        }
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey;
            if (Array.isArray(key) && typeof key[0] === 'string') {
              return key[0].includes('/dashboard') || key[0].includes('/stats');
            }
            return false;
          }
        });
        // Also invalidate search results queries
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey;
            if (Array.isArray(key) && typeof key[0] === 'string') {
              return key[0].startsWith('/api/search/work-orders');
            }
            return false;
          }
        });
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource("/api/events", {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      console.log("Global SSE connected");
    };

    eventSource.onmessage = (event) => {
      try {
        const data: ProjectEvent = JSON.parse(event.data);
        invalidateGlobalQueries(data);
      } catch (error) {
        console.error("Failed to parse SSE event:", error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    eventSourceRef.current = eventSource;
  }, [invalidateGlobalQueries]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return null;
}
