import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter } from "lucide-react";

export interface FilterConfig {
  key: string;
  label: string;
  required?: boolean;
}

interface FilterSelectorProps {
  allFilters: FilterConfig[];
  visibleFilters: string[];
  onChange: (visibleFilters: string[]) => void;
  disabled?: boolean;
}

export function FilterSelector({ 
  allFilters, 
  visibleFilters, 
  onChange,
  disabled = false 
}: FilterSelectorProps) {
  const [open, setOpen] = useState(false);

  const handleToggleFilter = (key: string, checked: boolean) => {
    const filter = allFilters.find(f => f.key === key);
    if (filter?.required) return;
    
    if (checked) {
      onChange([...visibleFilters, key]);
    } else {
      onChange(visibleFilters.filter(k => k !== key));
    }
  };

  const handleSelectAll = () => {
    onChange(allFilters.map(f => f.key));
  };

  const handleSelectNone = () => {
    const requiredFilters = allFilters.filter(f => f.required).map(f => f.key);
    onChange(requiredFilters);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={disabled}
          data-testid="button-filter-selector"
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Show Filters</span>
            <div className="flex gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSelectAll}
                className="h-7 text-xs px-2"
                data-testid="button-select-all-filters"
              >
                All
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSelectNone}
                className="h-7 text-xs px-2"
                data-testid="button-select-none-filters"
              >
                None
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allFilters.map((filter) => (
              <div 
                key={filter.key} 
                className="flex items-center gap-2"
              >
                <Checkbox
                  id={`filter-${filter.key}`}
                  checked={visibleFilters.includes(filter.key)}
                  onCheckedChange={(checked) => handleToggleFilter(filter.key, !!checked)}
                  disabled={filter.required}
                  data-testid={`checkbox-filter-${filter.key}`}
                />
                <label 
                  htmlFor={`filter-${filter.key}`}
                  className={`text-sm cursor-pointer flex-1 ${filter.required ? 'text-muted-foreground' : ''}`}
                >
                  {filter.label}
                  {filter.required && <span className="text-xs ml-1">(required)</span>}
                </label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
