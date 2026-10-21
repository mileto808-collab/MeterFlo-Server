import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";

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
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");

  const invalidateProjectQueries = useCallback((event: ProjectEvent) => {
    if (!event.projectId) return;

    switch (event.type) {
      case "workorder_created":
      case "workorder_updated":
      case "workorder_deleted":
        queryClient.invalidateQueries({ 
          predicate: (query) => {
            const key = query.queryKey;
            if (Array.isArray(key)) {
              if (typeof key[0] === 'string') {
                if (key[0].startsWith(`/api/projects/${event.projectId}/work-orders`)) {
                  return true;
                }
                if (key[0] === '/api/projects' && key[1] === event.projectId && key[2] === 'work-orders') {
                  return true;
                }
              }
              if (Array.isArray(key[0]) && typeof key[0][0] === 'string') {
                if (key[0][0].startsWith(`/api/projects/${event.projectId}/work-orders`)) {
                  return true;
                }
              }
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
                     key[0].startsWith(`/api/projects/${event.projectId}/ftp-files`) ||
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

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus(current => current === "connecting" ? "connecting" : "reconnecting");
    const eventSource = new EventSource(`/api/projects/${projectId}/events`, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      if (eventSourceRef.current !== eventSource) return;
      setStatus("live");
      // Reconnection is a state resync boundary, not proof that no events were missed.
      invalidateProjectQueries({ type: "workorder_updated", projectId, timestamp: new Date().toISOString() });
      console.log(`SSE connected for project ${projectId}`);
    };

    eventSource.onmessage = (event) => {
      if (eventSourceRef.current !== eventSource) return;
      try {
        const data: ProjectEvent = JSON.parse(event.data);
        window.dispatchEvent(new CustomEvent("meterflo:work-order-event", { detail: data }));
        invalidateProjectQueries(data);
      } catch (error) {
        console.error("Failed to parse SSE event:", error);
      }
    };

    eventSource.onerror = (error) => {
      if (eventSourceRef.current !== eventSource) return;
      setStatus("reconnecting");
      console.error("SSE connection error:", error);
      eventSource.close();
      eventSourceRef.current = null;
      
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
    setStatus("connecting");
    connect();
    const resume = () => {
      if (document.visibilityState === "visible" && projectId)
        invalidateProjectQueries({ type: "workorder_updated", projectId, timestamp: new Date().toISOString() });
    };
    document.addEventListener("visibilitychange", resume);

    return () => {
      document.removeEventListener("visibilitychange", resume);
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

  return { status };
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
