import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Columns3 } from "lucide-react";

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
}

export function ColumnSelector({ 
  allColumns, 
  visibleColumns, 
  onChange,
  disabled = false 
}: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);

  const handleToggleColumn = (key: string, checked: boolean) => {
    const column = allColumns.find(c => c.key === key);
    if (column?.required) return;
    
    if (checked) {
      onChange([...visibleColumns, key]);
    } else {
      onChange(visibleColumns.filter(k => k !== key));
    }
  };

  const handleSelectAll = () => {
    onChange(allColumns.map(c => c.key));
  };

  const handleSelectNone = () => {
    const requiredColumns = allColumns.filter(c => c.required).map(c => c.key);
    onChange(requiredColumns);
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
      <PopoverContent className="w-56" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Show Columns</span>
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
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allColumns.map((column) => (
              <div 
                key={column.key} 
                className="flex items-center gap-2"
              >
                <Checkbox
                  id={`col-${column.key}`}
                  checked={visibleColumns.includes(column.key)}
                  onCheckedChange={(checked) => handleToggleColumn(column.key, !!checked)}
                  disabled={column.required}
                  data-testid={`checkbox-column-${column.key}`}
                />
                <label 
                  htmlFor={`col-${column.key}`}
                  className={`text-sm cursor-pointer flex-1 ${column.required ? 'text-muted-foreground' : ''}`}
                >
                  {column.label}
                  {column.required && <span className="text-xs ml-1">(required)</span>}
                </label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
