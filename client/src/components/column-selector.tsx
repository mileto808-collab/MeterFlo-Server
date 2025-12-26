import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Columns3, ChevronUp, ChevronDown, GripVertical, Pin, PinOff } from "lucide-react";

export interface ColumnConfig {
  key: string;
  label: string;
  required?: boolean;
}

interface ColumnSelectorProps {
  allColumns: ColumnConfig[];
  visibleColumns: string[];
  onChange: (visibleColumns: string[]) => void;
  disabled?: boolean;
  orderedColumns?: ColumnConfig[];
  stickyColumns?: string[];
  onStickyChange?: (stickyColumns: string[]) => void;
}

export function ColumnSelector({ 
  allColumns, 
  visibleColumns, 
  onChange,
  disabled = false,
  orderedColumns,
  stickyColumns = [],
  onStickyChange
}: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);

  // Show visible columns first (in order), then hidden columns at the end
  // This ensures all columns are displayed for selection
  const displayColumns = (() => {
    if (!orderedColumns) return allColumns;
    
    // Get hidden columns (in allColumns but not in orderedColumns)
    const visibleKeys = new Set(orderedColumns.map(c => c.key));
    const hiddenColumns = allColumns.filter(c => !visibleKeys.has(c.key));
    
    // Return visible columns first, then hidden ones
    return [...orderedColumns, ...hiddenColumns];
  })();

  const handleToggleColumn = (key: string, checked: boolean) => {
    const column = allColumns.find(c => c.key === key);
    if (column?.required) return;
    
    if (checked) {
      // When adding a column, add it at the end of visible columns
      onChange([...visibleColumns, key]);
    } else {
      onChange(visibleColumns.filter(k => k !== key));
    }
  };

  const handleSelectAll = () => {
    // Preserve current visible order and add remaining columns at the end
    const currentVisible = visibleColumns.filter(k => allColumns.some(c => c.key === k));
    const remaining = allColumns.filter(c => !currentVisible.includes(c.key)).map(c => c.key);
    onChange([...currentVisible, ...remaining]);
  };

  const handleSelectNone = () => {
    const requiredColumns = allColumns.filter(c => c.required).map(c => c.key);
    onChange(requiredColumns);
  };

  const handleMoveUp = (key: string) => {
    const idx = visibleColumns.indexOf(key);
    if (idx <= 0) return; // Can't move up if first or not found
    
    const newOrder = [...visibleColumns];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    onChange(newOrder);
  };

  const handleMoveDown = (key: string) => {
    const idx = visibleColumns.indexOf(key);
    if (idx === -1 || idx >= visibleColumns.length - 1) return; // Can't move down if last or not found
    
    const newOrder = [...visibleColumns];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    onChange(newOrder);
  };

  const handleToggleSticky = (key: string) => {
    if (!onStickyChange) return;
    if (stickyColumns.includes(key)) {
      onStickyChange(stickyColumns.filter(k => k !== key));
    } else {
      onStickyChange([...stickyColumns, key]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={disabled}
          data-testid="button-column-selector"
        >
          <Columns3 className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Show & Reorder Columns</span>
            <div className="flex gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSelectAll}
                className="h-7 text-xs px-2"
                data-testid="button-select-all-columns"
              >
                All
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSelectNone}
                className="h-7 text-xs px-2"
                data-testid="button-select-none-columns"
              >
                None
              </Button>
            </div>
          </div>
        </div>
        <div 
          className="max-h-[300px] overflow-y-scroll p-3 space-y-1"
          style={{ 
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {displayColumns.map((column, index) => {
            const isVisible = visibleColumns.includes(column.key);
            const visibleIndex = visibleColumns.indexOf(column.key);
            const isFirst = visibleIndex === 0;
            const isLast = visibleIndex === visibleColumns.length - 1;
            const isSticky = stickyColumns.includes(column.key);
            
            return (
              <div 
                key={column.key} 
                className={`flex items-center gap-1 py-1 px-1 rounded ${isVisible ? 'bg-muted/50' : ''}`}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <Checkbox
                  id={`col-${column.key}`}
                  checked={isVisible}
                  onCheckedChange={(checked) => handleToggleColumn(column.key, !!checked)}
                  disabled={column.required}
                  data-testid={`checkbox-column-${column.key}`}
                />
                <label 
                  htmlFor={`col-${column.key}`}
                  className={`text-sm cursor-pointer flex-1 truncate ${column.required ? 'text-muted-foreground' : ''}`}
                >
                  {column.label}
                  {column.required && <span className="text-xs ml-1">(required)</span>}
                </label>
                {isVisible && (
                  <div className="flex gap-0.5 flex-shrink-0">
                    {onStickyChange && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-6 w-6 ${isSticky ? 'text-primary' : ''}`}
                            onClick={() => handleToggleSticky(column.key)}
                            data-testid={`button-pin-${column.key}`}
                          >
                            {isSticky ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {isSticky ? 'Unfreeze column' : 'Freeze column'}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveUp(column.key)}
                      disabled={isFirst}
                      data-testid={`button-move-up-${column.key}`}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveDown(column.key)}
                      disabled={isLast}
                      data-testid={`button-move-down-${column.key}`}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
