import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, ArrowUp, ArrowDown, Plus, Trash2, GripVertical } from "lucide-react";

export interface SortCriterion {
  column: string;
  direction: "asc" | "desc";
}

export interface ColumnOption {
  key: string;
  label: string;
  sortKey?: string;
}

interface SortDialogProps {
  sortCriteria: SortCriterion[];
  setSortCriteria: (criteria: SortCriterion[]) => void;
  columns: ColumnOption[];
}

export function SortDialog({ sortCriteria, setSortCriteria, columns }: SortDialogProps) {
  const [open, setOpen] = useState(false);
  const [localCriteria, setLocalCriteria] = useState<SortCriterion[]>(sortCriteria);

  const sortableColumns = columns.filter(col => col.key !== "actions");
  
  const getColumnKey = (col: ColumnOption): string => col.sortKey || col.key;
  
  const validColumnKeys = new Set(sortableColumns.map(getColumnKey));

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      const validCriteria = sortCriteria.filter(c => validColumnKeys.has(c.column));
      const seen = new Set<string>();
      const deduped = validCriteria.filter(c => {
        if (seen.has(c.column)) return false;
        seen.add(c.column);
        return true;
      });
      setLocalCriteria(deduped);
    }
    setOpen(isOpen);
  };

  const getColumnLabel = (columnKey: string): string => {
    const col = sortableColumns.find(c => getColumnKey(c) === columnKey);
    return col?.label || columnKey;
  };

  const getAvailableColumns = (excludeIndex?: number): ColumnOption[] => {
    const usedColumns = new Set(
      localCriteria
        .filter((_, idx) => idx !== excludeIndex)
        .map(c => c.column)
    );
    return sortableColumns.filter(col => !usedColumns.has(getColumnKey(col)));
  };

  const addSortColumn = () => {
    const available = getAvailableColumns();
    if (available.length > 0) {
      const firstAvailable = available[0];
      setLocalCriteria([
        ...localCriteria,
        { column: getColumnKey(firstAvailable), direction: "asc" }
      ]);
    }
  };

  const removeSortColumn = (index: number) => {
    setLocalCriteria(localCriteria.filter((_, idx) => idx !== index));
  };

  const updateColumn = (index: number, column: string) => {
    const isDuplicate = localCriteria.some((c, idx) => idx !== index && c.column === column);
    if (isDuplicate) return;
    
    const newCriteria = [...localCriteria];
    newCriteria[index] = { ...newCriteria[index], column };
    setLocalCriteria(newCriteria);
  };

  const toggleDirection = (index: number) => {
    const newCriteria = [...localCriteria];
    newCriteria[index] = {
      ...newCriteria[index],
      direction: newCriteria[index].direction === "asc" ? "desc" : "asc"
    };
    setLocalCriteria(newCriteria);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newCriteria = [...localCriteria];
    [newCriteria[index - 1], newCriteria[index]] = [newCriteria[index], newCriteria[index - 1]];
    setLocalCriteria(newCriteria);
  };

  const moveDown = (index: number) => {
    if (index === localCriteria.length - 1) return;
    const newCriteria = [...localCriteria];
    [newCriteria[index], newCriteria[index + 1]] = [newCriteria[index + 1], newCriteria[index]];
    setLocalCriteria(newCriteria);
  };

  const applySort = () => {
    const validCriteria = localCriteria.filter(c => validColumnKeys.has(c.column));
    const seen = new Set<string>();
    const deduped = validCriteria.filter(c => {
      if (seen.has(c.column)) return false;
      seen.add(c.column);
      return true;
    });
    setSortCriteria(deduped);
    setOpen(false);
  };

  const clearAll = () => {
    setLocalCriteria([]);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          data-testid="button-sort-dialog"
          className={sortCriteria.length > 0 ? "border-primary" : ""}
        >
          <ArrowUpDown className="h-4 w-4 mr-1" />
          Sort
          {sortCriteria.length > 0 && (
            <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">
              {sortCriteria.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sort Columns</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-3 py-2">
          {localCriteria.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No sort columns selected. Click "Add Column" to start sorting.
            </p>
          ) : (
            localCriteria.map((criterion, index) => (
              <div 
                key={index} 
                className="flex items-center gap-2 p-2 bg-muted/50 rounded-md"
                data-testid={`sort-row-${index}`}
              >
                <div className="flex flex-col gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    data-testid={`button-move-up-${index}`}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => moveDown(index)}
                    disabled={index === localCriteria.length - 1}
                    data-testid={`button-move-down-${index}`}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>

                <span className="text-xs text-muted-foreground w-4">{index + 1}.</span>

                <Select
                  value={criterion.column}
                  onValueChange={(value) => updateColumn(index, value)}
                >
                  <SelectTrigger className="flex-1" data-testid={`select-column-${index}`}>
                    <SelectValue>{getColumnLabel(criterion.column)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableColumns(index).map(col => (
                      <SelectItem 
                        key={getColumnKey(col)} 
                        value={getColumnKey(col)}
                      >
                        {col.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleDirection(index)}
                  data-testid={`button-toggle-direction-${index}`}
                  className="w-20"
                >
                  {criterion.direction === "asc" ? (
                    <>
                      <ArrowUp className="h-3 w-3 mr-1" />
                      Asc
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3 w-3 mr-1" />
                      Desc
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSortColumn(index)}
                  data-testid={`button-remove-sort-${index}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addSortColumn}
              disabled={getAvailableColumns().length === 0}
              data-testid="button-add-sort-column"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Column
            </Button>
            {localCriteria.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                data-testid="button-clear-sort"
              >
                Clear All
              </Button>
            )}
          </div>
          <Button onClick={applySort} data-testid="button-apply-sort">
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
