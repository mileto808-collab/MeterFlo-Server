import { useRef, useEffect, ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EnhancedTableProps {
  headers: ReactNode[];
  children: ReactNode;
  freezeFirstColumn?: boolean;
  stickyHeader?: boolean;
  showTopScrollbar?: boolean;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function EnhancedTable({
  headers,
  children,
  freezeFirstColumn = true,
  stickyHeader = true,
  showTopScrollbar = true,
  emptyMessage = "No data found",
  isEmpty = false,
}: EnhancedTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const topScroll = topScrollRef.current;
    
    if (!scrollContainer || !topScroll || !showTopScrollbar) return;

    let isSyncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (isSyncing) return;
      isSyncing = true;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const handleMainScroll = () => syncScroll(scrollContainer, topScroll);
    const handleTopScroll = () => syncScroll(topScroll, scrollContainer);

    scrollContainer.addEventListener("scroll", handleMainScroll);
    topScroll.addEventListener("scroll", handleTopScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", handleMainScroll);
      topScroll.removeEventListener("scroll", handleTopScroll);
    };
  }, [showTopScrollbar]);

  useEffect(() => {
    const updateTopScrollWidth = () => {
      if (tableRef.current && topScrollRef.current) {
        const spacer = topScrollRef.current.firstChild as HTMLElement;
        if (spacer) {
          spacer.style.width = `${tableRef.current.scrollWidth}px`;
        }
      }
    };

    updateTopScrollWidth();
    const resizeObserver = new ResizeObserver(updateTopScrollWidth);
    if (tableRef.current) {
      resizeObserver.observe(tableRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [children]);

  const frozenColumnClass = freezeFirstColumn
    ? "sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
    : "";

  const stickyHeaderClass = stickyHeader ? "sticky top-0 z-20 bg-muted" : "";

  return (
    <div className="relative">
      {showTopScrollbar && (
        <div
          ref={topScrollRef}
          className="overflow-x-auto overflow-y-hidden h-3 border-b"
          style={{ scrollbarWidth: "thin" }}
        >
          <div style={{ height: "1px" }} />
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto w-full max-h-[calc(100vh-300px)] overflow-y-auto"
      >
        <Table ref={tableRef}>
          <TableHeader className={stickyHeaderClass}>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead
                  key={index}
                  className={index === 0 && freezeFirstColumn ? `${frozenColumnClass} bg-muted` : ""}
                >
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={headers.length} className="text-center py-8 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              children
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface EnhancedTableRowProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
  freezeFirstColumn?: boolean;
}

export function EnhancedTableRow({
  children,
  onClick,
  className = "",
  "data-testid": testId,
  freezeFirstColumn = true,
}: EnhancedTableRowProps) {
  const childArray = Array.isArray(children) ? children : [children];
  
  return (
    <TableRow
      onClick={onClick}
      className={className}
      data-testid={testId}
    >
      {childArray.map((child, index) => {
        if (index === 0 && freezeFirstColumn) {
          return (
            <TableCell
              key={index}
              className="sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
            >
              {child}
            </TableCell>
          );
        }
        return <TableCell key={index}>{child}</TableCell>;
      })}
    </TableRow>
  );
}
