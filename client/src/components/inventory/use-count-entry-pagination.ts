import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Fit count entries to the space the editor actually has, rather than assuming
 * a fixed row count. The count body remains the only scroll surface, so small
 * viewports can always reach both the pager and the sticky editor actions.
 */
export function useCountEntryPagination(
  entriesRef: RefObject<HTMLElement | null>,
  reserveRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  countId: string,
) {
  const [pageSize, setPageSize] = useState(1);
  const measurement = useRef({ countId: "", width: 0, rowHeight: 0 });

  useLayoutEffect(() => {
    const entries = entriesRef.current;
    if (!entries) return;
    const scroll = entries.closest<HTMLElement>(".overflow-y-auto");
    if (!scroll) return;
    let frame = 0;

    const measureNow = () => {
        // A disappearing vertical scrollbar changes clientWidth, not layout
        // width. Do not mistake that for rotation and forget the tallest row.
        const width = scroll.getBoundingClientRect().width;
        if (measurement.current.countId !== countId || Math.abs(width - measurement.current.width) > 2)
          measurement.current = { countId, width, rowHeight: 0 };
        const entryRect = entries.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        // The reserve block follows the currently-rendered page, so its top
        // moves as page size changes. Reserve its height (not its position) to
        // avoid measuring the current row count as the available capacity.
        const reservedHeight = reserveRef.current?.getBoundingClientRect().height ?? 0;
        const entryOffset = entryRect.top + scroll.scrollTop - scrollRect.top;
        const usable = Math.max(0, scroll.clientHeight - entryOffset - reservedHeight - 28);
        const measured = [...entries.querySelectorAll<HTMLElement>("[data-count-entry]")].reduce(
          (max, row) => Math.max(max, row.getBoundingClientRect().height),
          0,
        );
        measurement.current.rowHeight = Math.max(measurement.current.rowHeight, measured);
        const rowHeight = measurement.current.rowHeight || (width < 640 ? 126 : 94);
        const next = Math.max(1, Math.min(100, Math.floor((usable + 8) / (rowHeight + 8))));
        setPageSize(current => current === next ? current : next);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureNow);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(entries);
    if (reserveRef.current) observer.observe(reserveRef.current);
    entries.querySelectorAll("[data-count-entry]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    measureNow();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [entriesRef, reserveRef, layoutKey, countId]);

  return pageSize;
}
