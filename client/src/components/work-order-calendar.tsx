import { useState, useMemo, useCallback, type DragEvent } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  addMonths,
  subMonths,
  subWeeks,
  subDays,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
  setHours,
  setMinutes,
  setSeconds,
  getHours,
  getMinutes,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Search,
  X,
  Clock,
  MapPin,
  GripVertical,
  CalendarDays,
  CalendarRange,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectWorkOrder } from "../../../server/projectDb";
import type { WorkOrderStatus, ServiceTypeRecord } from "@shared/schema";

type CalendarView = "month" | "week" | "day";

interface WorkOrderCalendarProps {
  workOrders: ProjectWorkOrder[];
  statuses: WorkOrderStatus[];
  serviceTypes: ServiceTypeRecord[];
  onWorkOrderClick: (workOrder: ProjectWorkOrder) => void;
  onReschedule: (workOrderId: number, newScheduledAt: string) => Promise<void>;
  projectId: number;
}

interface DragState {
  workOrder: ProjectWorkOrder | null;
  isDragging: boolean;
}

export function WorkOrderCalendar({
  workOrders,
  statuses,
  serviceTypes,
  onWorkOrderClick,
  onReschedule,
  projectId,
}: WorkOrderCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [dragState, setDragState] = useState<DragState>({ workOrder: null, isDragging: false });
  const [rescheduleDialog, setRescheduleDialog] = useState<{
    open: boolean;
    workOrder: ProjectWorkOrder | null;
    targetDate: Date | null;
    time: string;
  }>({ open: false, workOrder: null, targetDate: null, time: "09:00" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedForScheduling, setSelectedForScheduling] = useState<ProjectWorkOrder | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  const getStatusColor = useCallback((statusCode: string) => {
    const status = statuses.find((s) => s.code === statusCode || s.label === statusCode);
    if (status?.color) {
      const colorMap: Record<string, string> = {
        blue: "bg-blue-500",
        green: "bg-green-500",
        orange: "bg-orange-500",
        red: "bg-red-500",
        yellow: "bg-yellow-500",
        purple: "bg-purple-500",
        gray: "bg-gray-500",
      };
      return colorMap[status.color] || "bg-gray-500";
    }
    return "bg-gray-500";
  }, [statuses]);

  const getStatusBorderColor = useCallback((statusCode: string) => {
    const status = statuses.find((s) => s.code === statusCode || s.label === statusCode);
    if (status?.color) {
      const colorMap: Record<string, string> = {
        blue: "border-l-blue-500",
        green: "border-l-green-500",
        orange: "border-l-orange-500",
        red: "border-l-red-500",
        yellow: "border-l-yellow-500",
        purple: "border-l-purple-500",
        gray: "border-l-gray-500",
      };
      return colorMap[status.color] || "border-l-gray-500";
    }
    return "border-l-gray-500";
  }, [statuses]);

  const getStatusBackgroundColor = useCallback((statusCode: string) => {
    const status = statuses.find((s) => s.code === statusCode || s.label === statusCode);
    if (status?.color) {
      const colorMap: Record<string, string> = {
        blue: "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700",
        green: "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700",
        orange: "bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700",
        red: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700",
        yellow: "bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700",
        purple: "bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700",
        gray: "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600",
      };
      return colorMap[status.color] || "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600";
    }
    return "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600";
  }, [statuses]);

  const getServiceTypeBackgroundColor = useCallback((serviceTypeCode: string) => {
    const serviceType = serviceTypes.find((st) => st.code === serviceTypeCode || st.label === serviceTypeCode);
    if (serviceType?.color) {
      const colorMap: Record<string, string> = {
        blue: "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700",
        green: "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700",
        orange: "bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700",
        red: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700",
        yellow: "bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700",
        purple: "bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700",
        gray: "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600",
      };
      return colorMap[serviceType.color] || "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600";
    }
    return "bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-600";
  }, [serviceTypes]);

  const scheduledWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => wo.scheduledAt);
  }, [workOrders]);

  const unscheduledWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => !wo.scheduledAt);
  }, [workOrders]);

  const filteredSearchResults = useMemo(() => {
    if (!searchQuery.trim()) return unscheduledWorkOrders.slice(0, 20);
    const query = searchQuery.toLowerCase();
    return workOrders
      .filter(
        (wo) =>
          wo.customerWoId?.toLowerCase().includes(query) ||
          wo.address?.toLowerCase().includes(query) ||
          wo.customerId?.toLowerCase().includes(query) ||
          wo.customerName?.toLowerCase().includes(query) ||
          wo.oldSystemId?.toLowerCase().includes(query)
      )
      .slice(0, 50);
  }, [workOrders, unscheduledWorkOrders, searchQuery]);

  const parseScheduledAt = useCallback((scheduledAt: string | Date): Date => {
    if (scheduledAt instanceof Date) return scheduledAt;
    return parseISO(scheduledAt);
  }, []);

  const getWorkOrdersForDate = useCallback(
    (date: Date) => {
      return scheduledWorkOrders.filter((wo) => {
        if (!wo.scheduledAt) return false;
        const woDate = parseScheduledAt(wo.scheduledAt);
        return isSameDay(woDate, date);
      });
    },
    [scheduledWorkOrders, parseScheduledAt]
  );

  const getWorkOrdersForHour = useCallback(
    (date: Date, hour: number) => {
      return scheduledWorkOrders.filter((wo) => {
        if (!wo.scheduledAt) return false;
        const woDate = parseScheduledAt(wo.scheduledAt);
        return isSameDay(woDate, date) && getHours(woDate) === hour;
      });
    },
    [scheduledWorkOrders, parseScheduledAt]
  );

  const navigatePrev = () => {
    if (view === "month") setCurrentDate(subMonths(currentDate, 1));
    else if (view === "week") setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const navigateNext = () => {
    if (view === "month") setCurrentDate(addMonths(currentDate, 1));
    else if (view === "week") setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const goToToday = () => setCurrentDate(new Date());

  const handleDragStart = (e: DragEvent<HTMLDivElement>, workOrder: ProjectWorkOrder) => {
    e.dataTransfer.setData("text/plain", workOrder.id.toString());
    e.dataTransfer.effectAllowed = "move";
    setDragState({ workOrder, isDragging: true });
  };

  const handleDragEnd = () => {
    setDragState({ workOrder: null, isDragging: false });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetDate: Date, hour?: number) => {
    e.preventDefault();
    const workOrderId = parseInt(e.dataTransfer.getData("text/plain"));
    const workOrder = workOrders.find((wo) => wo.id === workOrderId);
    
    if (workOrder) {
      let time = "09:00";
      if (hour !== undefined) {
        time = `${hour.toString().padStart(2, "0")}:00`;
      } else if (workOrder.scheduledAt) {
        const existing = parseScheduledAt(workOrder.scheduledAt);
        time = `${getHours(existing).toString().padStart(2, "0")}:${getMinutes(existing).toString().padStart(2, "0")}`;
      }
      
      setRescheduleDialog({
        open: true,
        workOrder,
        targetDate,
        time,
      });
    }
    setDragState({ workOrder: null, isDragging: false });
  };

  const handleCellClick = (date: Date, hour?: number) => {
    if (selectedForScheduling) {
      let time = "09:00";
      if (hour !== undefined) {
        time = `${hour.toString().padStart(2, "0")}:00`;
      }
      setRescheduleDialog({
        open: true,
        workOrder: selectedForScheduling,
        targetDate: date,
        time,
      });
    }
  };

  const confirmReschedule = async () => {
    if (!rescheduleDialog.workOrder || !rescheduleDialog.targetDate) return;
    
    setIsRescheduling(true);
    try {
      const [hours, minutes] = rescheduleDialog.time.split(":").map(Number);
      let scheduledDate = rescheduleDialog.targetDate;
      scheduledDate = setHours(scheduledDate, hours);
      scheduledDate = setMinutes(scheduledDate, minutes);
      scheduledDate = setSeconds(scheduledDate, 0);
      
      const scheduledAt = scheduledDate.toISOString();
      await onReschedule(rescheduleDialog.workOrder.id, scheduledAt);
      
      setRescheduleDialog({ open: false, workOrder: null, targetDate: null, time: "09:00" });
      setSelectedForScheduling(null);
      setSearchOpen(false);
      setSearchQuery("");
    } finally {
      setIsRescheduling(false);
    }
  };

  const selectForScheduling = (workOrder: ProjectWorkOrder) => {
    setSelectedForScheduling(workOrder);
    setSearchOpen(false);
  };

  const cancelSchedulingMode = () => {
    setSelectedForScheduling(null);
  };

  const renderWorkOrderCard = (workOrder: ProjectWorkOrder, compact = false) => {
    const isDraggable = workOrder.status !== "Completed" && workOrder.status !== "Closed";
    
    return (
      <div
        key={workOrder.id}
        draggable={isDraggable}
        onDragStart={(e) => handleDragStart(e, workOrder)}
        onDragEnd={handleDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          onWorkOrderClick(workOrder);
        }}
        className={cn(
          "rounded-md border p-1.5 cursor-pointer hover-elevate text-xs",
          getServiceTypeBackgroundColor(workOrder.serviceType || ""),
          isDraggable && "cursor-grab active:cursor-grabbing",
          dragState.workOrder?.id === workOrder.id && "opacity-50"
        )}
        data-testid={`calendar-wo-${workOrder.id}`}
      >
        <div className="flex items-start gap-1">
          {isDraggable && <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">WO {workOrder.customerWoId || workOrder.id}</div>
            {workOrder.address && (
              <div className="text-muted-foreground truncate flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" />
                {workOrder.address}
              </div>
            )}
            {workOrder.scheduledAt && (
              <div className="text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {format(parseScheduledAt(workOrder.scheduledAt), "h:mm a")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    const weeks: Date[][] = [];
    let day = calendarStart;
    while (day <= calendarEnd) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(day);
        day = addDays(day, 1);
      }
      weeks.push(week);
    }

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="p-2 text-center text-sm font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-rows-[repeat(auto-fill,minmax(100px,1fr))]">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map((date) => {
                const dayWorkOrders = getWorkOrdersForDate(date);
                const isCurrentMonth = isSameMonth(date, currentDate);
                const isDropTarget = dragState.isDragging || selectedForScheduling;

                return (
                  <div
                    key={date.toISOString()}
                    className={cn(
                      "border-r last:border-r-0 p-1 min-h-[100px] relative",
                      !isCurrentMonth && "bg-muted/30",
                      isToday(date) && "bg-primary/5",
                      isDropTarget && "hover:bg-primary/10 transition-colors"
                    )}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, date)}
                    onClick={() => handleCellClick(date)}
                    data-testid={`calendar-day-${format(date, "yyyy-MM-dd")}`}
                  >
                    <div
                      className={cn(
                        "text-sm font-medium mb-1",
                        !isCurrentMonth && "text-muted-foreground",
                        isToday(date) && "text-primary"
                      )}
                    >
                      {format(date, "d")}
                    </div>
                    <div className="space-y-0.5 overflow-hidden">
                      {dayWorkOrders.slice(0, 3).map((wo) => renderWorkOrderCard(wo, true))}
                      {dayWorkOrders.length > 3 && (
                        <div className="text-xs text-muted-foreground pl-1">
                          +{dayWorkOrders.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(weekStart, i));
    }
    const hours = Array.from({ length: 12 }, (_, i) => i + 6);

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b sticky top-0 bg-background z-10">
          <div className="p-2" />
          {days.map((date) => (
            <div
              key={date.toISOString()}
              className={cn(
                "p-2 text-center border-l",
                isToday(date) && "bg-primary/5"
              )}
            >
              <div className="text-xs text-muted-foreground">{format(date, "EEE")}</div>
              <div className={cn("text-lg font-medium", isToday(date) && "text-primary")}>
                {format(date, "d")}
              </div>
            </div>
          ))}
        </div>
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {hours.map((hour) => (
              <div key={hour} className="contents">
                <div className="p-2 text-xs text-muted-foreground text-right border-b">
                  {format(setHours(new Date(), hour), "h a")}
                </div>
                {days.map((date) => {
                  const hourWorkOrders = getWorkOrdersForHour(date, hour);
                  const isDropTarget = dragState.isDragging || selectedForScheduling;

                  return (
                    <div
                      key={`${date.toISOString()}-${hour}`}
                      className={cn(
                        "border-l border-b min-h-[60px] p-0.5",
                        isToday(date) && "bg-primary/5",
                        isDropTarget && "hover:bg-primary/10 transition-colors"
                      )}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, date, hour)}
                      onClick={() => handleCellClick(date, hour)}
                      data-testid={`calendar-slot-${format(date, "yyyy-MM-dd")}-${hour}`}
                    >
                      {hourWorkOrders.map((wo) => renderWorkOrderCard(wo))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 16 }, (_, i) => i + 6);

    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b text-center sticky top-0 bg-background z-10">
          <div className="text-xs text-muted-foreground">{format(currentDate, "EEEE")}</div>
          <div className={cn("text-2xl font-medium", isToday(currentDate) && "text-primary")}>
            {format(currentDate, "MMMM d, yyyy")}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-[80px_1fr]">
            {hours.map((hour) => {
              const hourWorkOrders = getWorkOrdersForHour(currentDate, hour);
              const isDropTarget = dragState.isDragging || selectedForScheduling;

              return (
                <div key={hour} className="contents">
                  <div className="p-2 text-sm text-muted-foreground text-right border-b">
                    {format(setHours(new Date(), hour), "h:mm a")}
                  </div>
                  <div
                    className={cn(
                      "border-l border-b min-h-[80px] p-1",
                      isDropTarget && "hover:bg-primary/10 transition-colors"
                    )}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, currentDate, hour)}
                    onClick={() => handleCellClick(currentDate, hour)}
                    data-testid={`calendar-hour-${hour}`}
                  >
                    <div className="space-y-1">
                      {hourWorkOrders.map((wo) => renderWorkOrderCard(wo))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 p-3 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={navigatePrev} data-testid="calendar-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={navigateNext} data-testid="calendar-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday} data-testid="calendar-today">
            Today
          </Button>
          <h2 className="text-lg font-semibold ml-2">
            {view === "month" && format(currentDate, "MMMM yyyy")}
            {view === "week" && `Week of ${format(startOfWeek(currentDate), "MMM d, yyyy")}`}
            {view === "day" && format(currentDate, "MMMM d, yyyy")}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {selectedForScheduling && (
            <div className="flex items-center gap-2 bg-primary/10 px-3 py-1.5 rounded-md">
              <CalendarIcon className="h-4 w-4 text-primary" />
              <span className="text-sm">
                Click a date to schedule: <strong>WO {selectedForScheduling.customerWoId || selectedForScheduling.id}</strong>
              </span>
              <Button variant="ghost" size="icon" onClick={cancelSchedulingMode} className="h-6 w-6">
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="calendar-search">
                <Search className="h-4 w-4 mr-2" />
                Search & Schedule
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-3 border-b">
                <Input
                  placeholder="Search work orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="calendar-search-input"
                />
              </div>
              <ScrollArea className="h-[300px]">
                <div className="p-2 space-y-1">
                  {filteredSearchResults.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-2 text-center">
                      No work orders found
                    </div>
                  ) : (
                    filteredSearchResults.map((wo) => (
                      <div
                        key={wo.id}
                        className="p-2 rounded-md hover-elevate cursor-pointer"
                        onClick={() => selectForScheduling(wo)}
                        data-testid={`search-result-${wo.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn("text-xs text-white", getStatusColor(wo.status || "Open"))}
                          >
                            {wo.status || "Open"}
                          </Badge>
                          <span className="font-medium text-sm">WO {wo.customerWoId || wo.id}</span>
                        </div>
                        {wo.address && (
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {wo.address}
                          </div>
                        )}
                        {wo.scheduledAt && (
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(parseScheduledAt(wo.scheduledAt), "MMM d, h:mm a")}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          <div className="flex items-center border rounded-md">
            <Button
              variant={view === "month" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("month")}
              className="rounded-r-none"
              data-testid="view-month"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "week" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("week")}
              className="rounded-none border-x"
              data-testid="view-week"
            >
              <CalendarRange className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "day" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("day")}
              className="rounded-l-none"
              data-testid="view-day"
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "month" && renderMonthView()}
        {view === "week" && renderWeekView()}
        {view === "day" && renderDayView()}
      </div>

      <Dialog open={rescheduleDialog.open} onOpenChange={(open) => !open && setRescheduleDialog({ open: false, workOrder: null, targetDate: null, time: "09:00" })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rescheduleDialog.workOrder?.scheduledAt ? "Reschedule" : "Schedule"} Work Order
            </DialogTitle>
            <DialogDescription>
              WO {rescheduleDialog.workOrder?.customerWoId || rescheduleDialog.workOrder?.id}
              {rescheduleDialog.workOrder?.address && ` - ${rescheduleDialog.workOrder.address}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium">Date</label>
                <div className="text-lg font-semibold">
                  {rescheduleDialog.targetDate && format(rescheduleDialog.targetDate, "EEEE, MMMM d, yyyy")}
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <Input
                type="time"
                value={rescheduleDialog.time}
                onChange={(e) => setRescheduleDialog((prev) => ({ ...prev, time: e.target.value }))}
                className="w-40 mt-1"
                data-testid="reschedule-time"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRescheduleDialog({ open: false, workOrder: null, targetDate: null, time: "09:00" })}
              disabled={isRescheduling}
            >
              Cancel
            </Button>
            <Button onClick={confirmReschedule} disabled={isRescheduling} data-testid="confirm-reschedule">
              {isRescheduling ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
