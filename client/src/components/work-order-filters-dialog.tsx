import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Filter, X } from "lucide-react";
import type { WorkOrderStatus, TroubleCode, ServiceTypeRecord, SystemType, ModuleType } from "@shared/schema";

type Assignee = {
  type: "user" | "group";
  id: string;
  label: string;
  username?: string;
  key?: string;
};

type AssigneesResponse = {
  users: Assignee[];
  groups: Assignee[];
};

interface WorkOrderFiltersDialogProps {
  hasSystems: boolean;
  hasModules: boolean;
  filterSystemWoId: string;
  setFilterSystemWoId: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedStatus: string;
  setSelectedStatus: (value: string) => void;
  selectedServiceType: string;
  setSelectedServiceType: (value: string) => void;
  selectedAssignedTo: string;
  setSelectedAssignedTo: (value: string) => void;
  selectedAssignedGroup: string;
  setSelectedAssignedGroup: (value: string) => void;
  selectedTrouble: string;
  setSelectedTrouble: (value: string) => void;
  filterCustomerId: string;
  setFilterCustomerId: (value: string) => void;
  filterCustomerName: string;
  setFilterCustomerName: (value: string) => void;
  filterAddress: string;
  setFilterAddress: (value: string) => void;
  filterCity: string;
  setFilterCity: (value: string) => void;
  filterState: string;
  setFilterState: (value: string) => void;
  filterZip: string;
  setFilterZip: (value: string) => void;
  filterPhone: string;
  setFilterPhone: (value: string) => void;
  filterEmail: string;
  setFilterEmail: (value: string) => void;
  filterRoute: string;
  setFilterRoute: (value: string) => void;
  filterZone: string;
  setFilterZone: (value: string) => void;
  filterOldSystemId: string;
  setFilterOldSystemId: (value: string) => void;
  filterNewSystemId: string;
  setFilterNewSystemId: (value: string) => void;
  selectedOldSystemType: string;
  setSelectedOldSystemType: (value: string) => void;
  selectedNewSystemType: string;
  setSelectedNewSystemType: (value: string) => void;
  filterOldModuleId: string;
  setFilterOldModuleId: (value: string) => void;
  filterNewModuleId: string;
  setFilterNewModuleId: (value: string) => void;
  selectedOldModuleType: string;
  setSelectedOldModuleType: (value: string) => void;
  selectedNewModuleType: string;
  setSelectedNewModuleType: (value: string) => void;
  filterScheduledDateFrom: string;
  setFilterScheduledDateFrom: (value: string) => void;
  filterScheduledDateTo: string;
  setFilterScheduledDateTo: (value: string) => void;
  filterCreatedBy: string;
  setFilterCreatedBy: (value: string) => void;
  filterUpdatedBy: string;
  setFilterUpdatedBy: (value: string) => void;
  filterScheduledBy: string;
  setFilterScheduledBy: (value: string) => void;
  filterCompletedBy: string;
  setFilterCompletedBy: (value: string) => void;
  filterCompletedAtFrom: string;
  setFilterCompletedAtFrom: (value: string) => void;
  filterCompletedAtTo: string;
  setFilterCompletedAtTo: (value: string) => void;
  filterNotes: string;
  setFilterNotes: (value: string) => void;
  filterCreatedAtFrom: string;
  setFilterCreatedAtFrom: (value: string) => void;
  filterCreatedAtTo: string;
  setFilterCreatedAtTo: (value: string) => void;
  filterUpdatedAtFrom: string;
  setFilterUpdatedAtFrom: (value: string) => void;
  filterUpdatedAtTo: string;
  setFilterUpdatedAtTo: (value: string) => void;
  systemTypes: SystemType[];
  moduleTypes: ModuleType[];
  assigneesData: AssigneesResponse | undefined;
  workOrderStatuses: WorkOrderStatus[];
  serviceTypes: ServiceTypeRecord[];
  troubleCodes: TroubleCode[];
  hasActiveFilters: boolean;
  activeFilterCount: number;
  clearAllFilters: () => void;
}

export function WorkOrderFiltersDialog({
  hasSystems,
  hasModules,
  filterSystemWoId,
  setFilterSystemWoId,
  searchQuery,
  setSearchQuery,
  selectedStatus,
  setSelectedStatus,
  selectedServiceType,
  setSelectedServiceType,
  selectedAssignedTo,
  setSelectedAssignedTo,
  selectedAssignedGroup,
  setSelectedAssignedGroup,
  selectedTrouble,
  setSelectedTrouble,
  filterCustomerId,
  setFilterCustomerId,
  filterCustomerName,
  setFilterCustomerName,
  filterAddress,
  setFilterAddress,
  filterCity,
  setFilterCity,
  filterState,
  setFilterState,
  filterZip,
  setFilterZip,
  filterPhone,
  setFilterPhone,
  filterEmail,
  setFilterEmail,
  filterRoute,
  setFilterRoute,
  filterZone,
  setFilterZone,
  filterOldSystemId,
  setFilterOldSystemId,
  filterNewSystemId,
  setFilterNewSystemId,
  selectedOldSystemType,
  setSelectedOldSystemType,
  selectedNewSystemType,
  setSelectedNewSystemType,
  filterOldModuleId,
  setFilterOldModuleId,
  filterNewModuleId,
  setFilterNewModuleId,
  selectedOldModuleType,
  setSelectedOldModuleType,
  selectedNewModuleType,
  setSelectedNewModuleType,
  filterScheduledDateFrom,
  setFilterScheduledDateFrom,
  filterScheduledDateTo,
  setFilterScheduledDateTo,
  filterCreatedBy,
  setFilterCreatedBy,
  filterUpdatedBy,
  setFilterUpdatedBy,
  filterScheduledBy,
  setFilterScheduledBy,
  filterCompletedBy,
  setFilterCompletedBy,
  filterCompletedAtFrom,
  setFilterCompletedAtFrom,
  filterCompletedAtTo,
  setFilterCompletedAtTo,
  filterNotes,
  setFilterNotes,
  filterCreatedAtFrom,
  setFilterCreatedAtFrom,
  filterCreatedAtTo,
  setFilterCreatedAtTo,
  filterUpdatedAtFrom,
  setFilterUpdatedAtFrom,
  filterUpdatedAtTo,
  setFilterUpdatedAtTo,
  systemTypes,
  moduleTypes,
  assigneesData,
  workOrderStatuses,
  serviceTypes,
  troubleCodes,
  hasActiveFilters,
  activeFilterCount,
  clearAllFilters,
}: WorkOrderFiltersDialogProps) {
  const [open, setOpen] = useState(false);

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="pt-4 first:pt-0">
      <h4 className="text-sm font-semibold text-foreground mb-3">{title}</h4>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="relative" data-testid="button-filters-dialog">
          <Filter className="h-3.5 w-3.5 mr-1" />
          Filters
          {hasActiveFilters && (
            <Badge variant="default" className="ml-1.5 h-5 min-w-5 px-1.5 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Filter Work Orders</DialogTitle>
          <DialogDescription>
            Apply filters to narrow down the work orders list
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 max-h-[60vh] -mx-6 px-6">
          <div className="space-y-4 pb-4">
            <SectionHeader title="Work Order Info" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dialog-filter-system-wo-id">System WO ID</Label>
                <Input
                  id="dialog-filter-system-wo-id"
                  placeholder="System ID..."
                  value={filterSystemWoId}
                  onChange={(e) => setFilterSystemWoId(e.target.value)}
                  data-testid="dialog-input-filter-system-wo-id"
                />
              </div>
              <div>
                <Label htmlFor="dialog-filter-search">Search</Label>
                <Input
                  id="dialog-filter-search"
                  placeholder="Search WO ID, name, address, system..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="dialog-input-filter-search"
                />
              </div>
            </div>

            <Separator className="my-4" />
            <SectionHeader title="Status & Assignment" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dialog-filter-status">Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger id="dialog-filter-status" data-testid="dialog-select-filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {workOrderStatuses.map((status) => (
                      <SelectItem key={status.id} value={status.label}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="dialog-filter-service-type">Service Type</Label>
                <Select value={selectedServiceType} onValueChange={setSelectedServiceType}>
                  <SelectTrigger id="dialog-filter-service-type" data-testid="dialog-select-filter-service-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Service Types</SelectItem>
                    {serviceTypes.map((type) => (
                      <SelectItem key={type.id} value={type.code}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-assigned-to">Assigned To (User)</Label>
                  <Select value={selectedAssignedTo} onValueChange={setSelectedAssignedTo}>
                    <SelectTrigger id="dialog-filter-assigned-to" data-testid="dialog-select-filter-assigned-to">
                      <SelectValue placeholder="All Users" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-assigned-group">Assigned To (Group)</Label>
                  <Select value={selectedAssignedGroup} onValueChange={setSelectedAssignedGroup}>
                    <SelectTrigger id="dialog-filter-assigned-group" data-testid="dialog-select-filter-assigned-group">
                      <SelectValue placeholder="All Groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Groups</SelectItem>
                      {assigneesData.groups.map((group) => (
                        <SelectItem key={group.id} value={String(group.id)}>{group.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {troubleCodes.length > 0 && (
                <div>
                  <Label htmlFor="dialog-filter-trouble">Trouble Code</Label>
                  <Select value={selectedTrouble} onValueChange={setSelectedTrouble}>
                    <SelectTrigger id="dialog-filter-trouble" data-testid="dialog-select-filter-trouble">
                      <SelectValue placeholder="All Trouble Codes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Trouble Codes</SelectItem>
                      <SelectItem value="none">No Trouble</SelectItem>
                      {troubleCodes.map((tc) => (
                        <SelectItem key={tc.id} value={tc.code}>{tc.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator className="my-4" />
            <SectionHeader title="Customer Info" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dialog-filter-customer-id">Customer ID</Label>
                <Input id="dialog-filter-customer-id" placeholder="Filter..." value={filterCustomerId} onChange={(e) => setFilterCustomerId(e.target.value)} data-testid="dialog-input-filter-customer-id" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-customer-name">Customer Name</Label>
                <Input id="dialog-filter-customer-name" placeholder="Filter..." value={filterCustomerName} onChange={(e) => setFilterCustomerName(e.target.value)} data-testid="dialog-input-filter-customer-name" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-address">Address</Label>
                <Input id="dialog-filter-address" placeholder="Filter..." value={filterAddress} onChange={(e) => setFilterAddress(e.target.value)} data-testid="dialog-input-filter-address" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-city">City</Label>
                <Input id="dialog-filter-city" placeholder="Filter..." value={filterCity} onChange={(e) => setFilterCity(e.target.value)} data-testid="dialog-input-filter-city" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-state">State</Label>
                <Input id="dialog-filter-state" placeholder="Filter..." value={filterState} onChange={(e) => setFilterState(e.target.value)} data-testid="dialog-input-filter-state" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-zip">ZIP</Label>
                <Input id="dialog-filter-zip" placeholder="Filter..." value={filterZip} onChange={(e) => setFilterZip(e.target.value)} data-testid="dialog-input-filter-zip" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-phone">Phone</Label>
                <Input id="dialog-filter-phone" placeholder="Filter..." value={filterPhone} onChange={(e) => setFilterPhone(e.target.value)} data-testid="dialog-input-filter-phone" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-email">Email</Label>
                <Input id="dialog-filter-email" placeholder="Filter..." value={filterEmail} onChange={(e) => setFilterEmail(e.target.value)} data-testid="dialog-input-filter-email" />
              </div>
            </div>

            <Separator className="my-4" />
            <SectionHeader title="Location" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dialog-filter-route">Route</Label>
                <Input id="dialog-filter-route" placeholder="Filter..." value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)} data-testid="dialog-input-filter-route" />
              </div>
              <div>
                <Label htmlFor="dialog-filter-zone">Zone</Label>
                <Input id="dialog-filter-zone" placeholder="Filter..." value={filterZone} onChange={(e) => setFilterZone(e.target.value)} data-testid="dialog-input-filter-zone" />
              </div>
            </div>

            {hasSystems && (
              <>
                <Separator className="my-4" />
                <SectionHeader title="System Equipment" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dialog-filter-old-system-id">Old System ID</Label>
                    <Input id="dialog-filter-old-system-id" placeholder="Filter..." value={filterOldSystemId} onChange={(e) => setFilterOldSystemId(e.target.value)} data-testid="dialog-input-filter-old-system-id" />
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-new-system-id">New System ID</Label>
                    <Input id="dialog-filter-new-system-id" placeholder="Filter..." value={filterNewSystemId} onChange={(e) => setFilterNewSystemId(e.target.value)} data-testid="dialog-input-filter-new-system-id" />
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-old-system-type">Old System Type</Label>
                    <Select value={selectedOldSystemType} onValueChange={setSelectedOldSystemType}>
                      <SelectTrigger id="dialog-filter-old-system-type" data-testid="dialog-select-filter-old-system-type">
                        <SelectValue placeholder="All System Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All System Types</SelectItem>
                        {systemTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-new-system-type">New System Type</Label>
                    <Select value={selectedNewSystemType} onValueChange={setSelectedNewSystemType}>
                      <SelectTrigger id="dialog-filter-new-system-type" data-testid="dialog-select-filter-new-system-type">
                        <SelectValue placeholder="All System Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All System Types</SelectItem>
                        {systemTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {hasModules && (
              <>
                <Separator className="my-4" />
                <SectionHeader title="Module Equipment" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dialog-filter-old-module-id">Old Module ID</Label>
                    <Input id="dialog-filter-old-module-id" placeholder="Filter..." value={filterOldModuleId} onChange={(e) => setFilterOldModuleId(e.target.value)} data-testid="dialog-input-filter-old-module-id" />
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-new-module-id">New Module ID</Label>
                    <Input id="dialog-filter-new-module-id" placeholder="Filter..." value={filterNewModuleId} onChange={(e) => setFilterNewModuleId(e.target.value)} data-testid="dialog-input-filter-new-module-id" />
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-old-module-type">Old Module Type</Label>
                    <Select value={selectedOldModuleType} onValueChange={setSelectedOldModuleType}>
                      <SelectTrigger id="dialog-filter-old-module-type" data-testid="dialog-select-filter-old-module-type">
                        <SelectValue placeholder="All Module Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Module Types</SelectItem>
                        {moduleTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="dialog-filter-new-module-type">New Module Type</Label>
                    <Select value={selectedNewModuleType} onValueChange={setSelectedNewModuleType}>
                      <SelectTrigger id="dialog-filter-new-module-type" data-testid="dialog-select-filter-new-module-type">
                        <SelectValue placeholder="All Module Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Module Types</SelectItem>
                        {moduleTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            <Separator className="my-4" />
            <SectionHeader title="Scheduling & Audit" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Scheduled At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="dialog-filter-scheduled-date-from" type="date" value={filterScheduledDateFrom} onChange={(e) => setFilterScheduledDateFrom(e.target.value)} data-testid="dialog-input-filter-scheduled-date-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="dialog-filter-scheduled-date-to" type="date" value={filterScheduledDateTo} onChange={(e) => setFilterScheduledDateTo(e.target.value)} data-testid="dialog-input-filter-scheduled-date-to" className="flex-1" />
                </div>
              </div>
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-created-by">Created By</Label>
                  <Select value={filterCreatedBy} onValueChange={setFilterCreatedBy}>
                    <SelectTrigger id="dialog-filter-created-by" data-testid="dialog-select-filter-created-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-updated-by">Updated By</Label>
                  <Select value={filterUpdatedBy} onValueChange={setFilterUpdatedBy}>
                    <SelectTrigger id="dialog-filter-updated-by" data-testid="dialog-select-filter-updated-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-scheduled-by">Scheduled By</Label>
                  <Select value={filterScheduledBy} onValueChange={setFilterScheduledBy}>
                    <SelectTrigger id="dialog-filter-scheduled-by" data-testid="dialog-select-filter-scheduled-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {assigneesData && (
                <div>
                  <Label htmlFor="dialog-filter-completed-by">Completed By</Label>
                  <Select value={filterCompletedBy} onValueChange={setFilterCompletedBy}>
                    <SelectTrigger id="dialog-filter-completed-by" data-testid="dialog-select-filter-completed-by">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {assigneesData.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="md:col-span-2">
                <Label>Completed At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="dialog-filter-completed-at-from" type="date" value={filterCompletedAtFrom} onChange={(e) => setFilterCompletedAtFrom(e.target.value)} data-testid="dialog-input-filter-completed-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="dialog-filter-completed-at-to" type="date" value={filterCompletedAtTo} onChange={(e) => setFilterCompletedAtTo(e.target.value)} data-testid="dialog-input-filter-completed-at-to" className="flex-1" />
                </div>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="dialog-filter-notes">Notes</Label>
                <Input id="dialog-filter-notes" placeholder="Filter..." value={filterNotes} onChange={(e) => setFilterNotes(e.target.value)} data-testid="dialog-input-filter-notes" />
              </div>
              <div className="md:col-span-2">
                <Label>Created At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="dialog-filter-created-at-from" type="date" value={filterCreatedAtFrom} onChange={(e) => setFilterCreatedAtFrom(e.target.value)} data-testid="dialog-input-filter-created-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="dialog-filter-created-at-to" type="date" value={filterCreatedAtTo} onChange={(e) => setFilterCreatedAtTo(e.target.value)} data-testid="dialog-input-filter-created-at-to" className="flex-1" />
                </div>
              </div>
              <div className="md:col-span-2">
                <Label>Updated At</Label>
                <div className="flex gap-2 items-center">
                  <Input id="dialog-filter-updated-at-from" type="date" value={filterUpdatedAtFrom} onChange={(e) => setFilterUpdatedAtFrom(e.target.value)} data-testid="dialog-input-filter-updated-at-from" className="flex-1" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input id="dialog-filter-updated-at-to" type="date" value={filterUpdatedAtTo} onChange={(e) => setFilterUpdatedAtTo(e.target.value)} data-testid="dialog-input-filter-updated-at-to" className="flex-1" />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasActiveFilters && (
            <Button 
              variant="outline" 
              onClick={clearAllFilters}
              data-testid="button-dialog-clear-all-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
          <Button onClick={() => setOpen(false)} data-testid="button-dialog-close-filters">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
