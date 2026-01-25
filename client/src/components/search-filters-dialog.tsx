import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { WorkOrderStatus, TroubleCode, ServiceTypeRecord, SystemType, ModuleType, Project } from "@shared/schema";

type User = {
  id: string | number;
  username: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
};

type UserGroup = {
  id: number;
  name: string;
};

interface SearchFiltersDialogProps {
  hasSystems: boolean;
  hasModules: boolean;
  selectedProject: string;
  setSelectedProject: (value: string) => void;
  selectedStatuses: string[];
  setSelectedStatuses: (value: string[]) => void;
  selectedServiceTypes: string[];
  setSelectedServiceTypes: (value: string[]) => void;
  filterSystemWoId: string;
  setFilterSystemWoId: (value: string) => void;
  filterCustomerWoId: string;
  setFilterCustomerWoId: (value: string) => void;
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
  filterOldSystemType: string;
  setFilterOldSystemType: (value: string) => void;
  filterNewSystemType: string;
  setFilterNewSystemType: (value: string) => void;
  filterOldModuleId: string;
  setFilterOldModuleId: (value: string) => void;
  filterNewModuleId: string;
  setFilterNewModuleId: (value: string) => void;
  filterOldModuleType: string;
  setFilterOldModuleType: (value: string) => void;
  filterNewModuleType: string;
  setFilterNewModuleType: (value: string) => void;
  filterScheduledDateFrom: string;
  setFilterScheduledDateFrom: (value: string) => void;
  filterScheduledDateTo: string;
  setFilterScheduledDateTo: (value: string) => void;
  filterAssignedTo: string;
  setFilterAssignedTo: (value: string) => void;
  filterAssignedGroup: string;
  setFilterAssignedGroup: (value: string) => void;
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
  filterTroubleCode: string;
  setFilterTroubleCode: (value: string) => void;
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
  projects: Project[];
  systemTypes: SystemType[];
  moduleTypes: ModuleType[];
  users: User[];
  userGroups: UserGroup[];
  workOrderStatuses: WorkOrderStatus[];
  serviceTypes: ServiceTypeRecord[];
  troubleCodes: TroubleCode[];
  hasActiveFilters: boolean;
  activeFilterCount: number;
  clearAllFilters: () => void;
}

export function SearchFiltersDialog({
  hasSystems,
  hasModules,
  selectedProject,
  setSelectedProject,
  selectedStatuses,
  setSelectedStatuses,
  selectedServiceTypes,
  setSelectedServiceTypes,
  filterSystemWoId,
  setFilterSystemWoId,
  filterCustomerWoId,
  setFilterCustomerWoId,
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
  filterOldSystemType,
  setFilterOldSystemType,
  filterNewSystemType,
  setFilterNewSystemType,
  filterOldModuleId,
  setFilterOldModuleId,
  filterNewModuleId,
  setFilterNewModuleId,
  filterOldModuleType,
  setFilterOldModuleType,
  filterNewModuleType,
  setFilterNewModuleType,
  filterScheduledDateFrom,
  setFilterScheduledDateFrom,
  filterScheduledDateTo,
  setFilterScheduledDateTo,
  filterAssignedTo,
  setFilterAssignedTo,
  filterAssignedGroup,
  setFilterAssignedGroup,
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
  filterTroubleCode,
  setFilterTroubleCode,
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
  projects,
  systemTypes,
  moduleTypes,
  users,
  userGroups,
  workOrderStatuses,
  serviceTypes,
  troubleCodes,
  hasActiveFilters,
  activeFilterCount,
  clearAllFilters,
}: SearchFiltersDialogProps) {
  const [open, setOpen] = useState(false);

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="pt-4 first:pt-0">
      <h4 className="text-sm font-semibold text-foreground mb-3">{title}</h4>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-testid="button-open-filters">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Search Filters</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-clear-all-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            Filter search results by various criteria
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-4">
            <SectionHeader title="Project & Status" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Project</Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger data-testid="select-filter-project">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Status</Label>
                <div className="flex flex-wrap gap-3 mt-2">
                  {workOrderStatuses.map((status) => {
                    const isSelected = selectedStatuses.includes(status.label);
                    return (
                      <div key={status.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`search-status-${status.id}`}
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedStatuses([...selectedStatuses, status.label]);
                            } else {
                              setSelectedStatuses(selectedStatuses.filter(s => s !== status.label));
                            }
                          }}
                          data-testid={`checkbox-search-status-${status.label.toLowerCase().replace(/\s+/g, '-')}`}
                        />
                        <label
                          htmlFor={`search-status-${status.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {status.label}
                        </label>
                      </div>
                    );
                  })}
                </div>
                {selectedStatuses.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setSelectedStatuses([])}
                    data-testid="button-clear-search-status-filter"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear Status Filter
                  </Button>
                )}
              </div>
              <div className="col-span-2">
                <Label>Service Type</Label>
                <div className="flex flex-wrap gap-3 mt-2">
                  {serviceTypes.map((type) => {
                    const isSelected = selectedServiceTypes.includes(type.code);
                    return (
                      <div key={type.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`search-service-type-${type.id}`}
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedServiceTypes([...selectedServiceTypes, type.code]);
                            } else {
                              setSelectedServiceTypes(selectedServiceTypes.filter(s => s !== type.code));
                            }
                          }}
                          data-testid={`checkbox-search-service-type-${type.code.toLowerCase().replace(/\s+/g, '-')}`}
                        />
                        <label
                          htmlFor={`search-service-type-${type.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {type.label}
                        </label>
                      </div>
                    );
                  })}
                </div>
                {selectedServiceTypes.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setSelectedServiceTypes([])}
                    data-testid="button-clear-search-service-type-filter"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear Service Type Filter
                  </Button>
                )}
              </div>
              {troubleCodes.length > 0 && (
                <div>
                  <Label>Trouble Code</Label>
                  <Select value={filterTroubleCode} onValueChange={setFilterTroubleCode}>
                    <SelectTrigger data-testid="select-filter-trouble-code">
                      <SelectValue placeholder="All Trouble Codes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Trouble Codes</SelectItem>
                      {troubleCodes.map((tc) => (
                        <SelectItem key={tc.id} value={tc.code}>{tc.code} - {tc.description}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator />

            <SectionHeader title="Work Order Info" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>System WO ID</Label>
                <Input
                  placeholder="Filter by system WO ID..."
                  value={filterSystemWoId}
                  onChange={(e) => setFilterSystemWoId(e.target.value)}
                  data-testid="input-filter-system-wo-id"
                />
              </div>
              <div>
                <Label>WO ID</Label>
                <Input
                  placeholder="Filter by WO ID..."
                  value={filterCustomerWoId}
                  onChange={(e) => setFilterCustomerWoId(e.target.value)}
                  data-testid="input-filter-customer-wo-id"
                />
              </div>
            </div>

            <Separator />

            <SectionHeader title="Customer Information" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Customer ID</Label>
                <Input
                  placeholder="Filter by customer ID..."
                  value={filterCustomerId}
                  onChange={(e) => setFilterCustomerId(e.target.value)}
                  data-testid="input-filter-customer-id"
                />
              </div>
              <div>
                <Label>Customer Name</Label>
                <Input
                  placeholder="Filter by customer name..."
                  value={filterCustomerName}
                  onChange={(e) => setFilterCustomerName(e.target.value)}
                  data-testid="input-filter-customer-name"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  placeholder="Filter by phone..."
                  value={filterPhone}
                  onChange={(e) => setFilterPhone(e.target.value)}
                  data-testid="input-filter-phone"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  placeholder="Filter by email..."
                  value={filterEmail}
                  onChange={(e) => setFilterEmail(e.target.value)}
                  data-testid="input-filter-email"
                />
              </div>
            </div>

            <Separator />

            <SectionHeader title="Location" />
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Address</Label>
                <Input
                  placeholder="Filter by address..."
                  value={filterAddress}
                  onChange={(e) => setFilterAddress(e.target.value)}
                  data-testid="input-filter-address"
                />
              </div>
              <div>
                <Label>City</Label>
                <Input
                  placeholder="Filter by city..."
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  data-testid="input-filter-city"
                />
              </div>
              <div>
                <Label>State</Label>
                <Input
                  placeholder="Filter by state..."
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  data-testid="input-filter-state"
                />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input
                  placeholder="Filter by ZIP..."
                  value={filterZip}
                  onChange={(e) => setFilterZip(e.target.value)}
                  data-testid="input-filter-zip"
                />
              </div>
              <div>
                <Label>Route</Label>
                <Input
                  placeholder="Filter by route..."
                  value={filterRoute}
                  onChange={(e) => setFilterRoute(e.target.value)}
                  data-testid="input-filter-route"
                />
              </div>
              <div>
                <Label>Zone</Label>
                <Input
                  placeholder="Filter by zone..."
                  value={filterZone}
                  onChange={(e) => setFilterZone(e.target.value)}
                  data-testid="input-filter-zone"
                />
              </div>
            </div>

            {hasSystems && (
              <>
                <Separator />
                <SectionHeader title="System Equipment" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Old System ID</Label>
                    <Input
                      placeholder="Filter by old system ID..."
                      value={filterOldSystemId}
                      onChange={(e) => setFilterOldSystemId(e.target.value)}
                      data-testid="input-filter-old-system-id"
                    />
                  </div>
                  <div>
                    <Label>Old System Type</Label>
                    <Select value={filterOldSystemType} onValueChange={setFilterOldSystemType}>
                      <SelectTrigger data-testid="select-filter-old-system-type">
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {systemTypes.map((st) => (
                          <SelectItem key={st.id} value={st.productLabel}>{st.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>New System ID</Label>
                    <Input
                      placeholder="Filter by new system ID..."
                      value={filterNewSystemId}
                      onChange={(e) => setFilterNewSystemId(e.target.value)}
                      data-testid="input-filter-new-system-id"
                    />
                  </div>
                  <div>
                    <Label>New System Type</Label>
                    <Select value={filterNewSystemType} onValueChange={setFilterNewSystemType}>
                      <SelectTrigger data-testid="select-filter-new-system-type">
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {systemTypes.map((st) => (
                          <SelectItem key={st.id} value={st.productLabel}>{st.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {hasModules && (
              <>
                <Separator />
                <SectionHeader title="Module Equipment" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Old Module ID</Label>
                    <Input
                      placeholder="Filter by old module ID..."
                      value={filterOldModuleId}
                      onChange={(e) => setFilterOldModuleId(e.target.value)}
                      data-testid="input-filter-old-module-id"
                    />
                  </div>
                  <div>
                    <Label>Old Module Type</Label>
                    <Select value={filterOldModuleType} onValueChange={setFilterOldModuleType}>
                      <SelectTrigger data-testid="select-filter-old-module-type">
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {moduleTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productLabel}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>New Module ID</Label>
                    <Input
                      placeholder="Filter by new module ID..."
                      value={filterNewModuleId}
                      onChange={(e) => setFilterNewModuleId(e.target.value)}
                      data-testid="input-filter-new-module-id"
                    />
                  </div>
                  <div>
                    <Label>New Module Type</Label>
                    <Select value={filterNewModuleType} onValueChange={setFilterNewModuleType}>
                      <SelectTrigger data-testid="select-filter-new-module-type">
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {moduleTypes.map((mt) => (
                          <SelectItem key={mt.id} value={mt.productLabel}>{mt.productLabel}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            <Separator />

            <SectionHeader title="Scheduling & Assignment" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Scheduled From</Label>
                <Input
                  type="date"
                  value={filterScheduledDateFrom}
                  onChange={(e) => setFilterScheduledDateFrom(e.target.value)}
                  data-testid="input-filter-scheduled-from"
                />
              </div>
              <div>
                <Label>Scheduled To</Label>
                <Input
                  type="date"
                  value={filterScheduledDateTo}
                  onChange={(e) => setFilterScheduledDateTo(e.target.value)}
                  data-testid="input-filter-scheduled-to"
                />
              </div>
              {users.length > 0 && (
                <>
                  <div>
                    <Label>Assigned To (User)</Label>
                    <Select value={filterAssignedTo} onValueChange={setFilterAssignedTo}>
                      <SelectTrigger data-testid="select-filter-assigned-to">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName || (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username || String(u.id))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Scheduled By</Label>
                    <Select value={filterScheduledBy} onValueChange={setFilterScheduledBy}>
                      <SelectTrigger data-testid="select-filter-scheduled-by">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName || (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username || String(u.id))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {userGroups.length > 0 && (
                <div>
                  <Label>Assigned To (Group)</Label>
                  <Select value={filterAssignedGroup} onValueChange={setFilterAssignedGroup}>
                    <SelectTrigger data-testid="select-filter-assigned-group">
                      <SelectValue placeholder="All Groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Groups</SelectItem>
                      {userGroups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator />

            <SectionHeader title="Audit Information" />
            <div className="grid grid-cols-2 gap-4">
              {users.length > 0 && (
                <>
                  <div>
                    <Label>Created By</Label>
                    <Select value={filterCreatedBy} onValueChange={setFilterCreatedBy}>
                      <SelectTrigger data-testid="select-filter-created-by">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName || (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username || String(u.id))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Updated By</Label>
                    <Select value={filterUpdatedBy} onValueChange={setFilterUpdatedBy}>
                      <SelectTrigger data-testid="select-filter-updated-by">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName || (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username || String(u.id))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Completed By</Label>
                    <Select value={filterCompletedBy} onValueChange={setFilterCompletedBy}>
                      <SelectTrigger data-testid="select-filter-completed-by">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName || (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username || String(u.id))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div>
                <Label>Completed From</Label>
                <Input
                  type="date"
                  value={filterCompletedAtFrom}
                  onChange={(e) => setFilterCompletedAtFrom(e.target.value)}
                  data-testid="input-filter-completed-from"
                />
              </div>
              <div>
                <Label>Completed To</Label>
                <Input
                  type="date"
                  value={filterCompletedAtTo}
                  onChange={(e) => setFilterCompletedAtTo(e.target.value)}
                  data-testid="input-filter-completed-to"
                />
              </div>
              <div>
                <Label>Created From</Label>
                <Input
                  type="date"
                  value={filterCreatedAtFrom}
                  onChange={(e) => setFilterCreatedAtFrom(e.target.value)}
                  data-testid="input-filter-created-from"
                />
              </div>
              <div>
                <Label>Created To</Label>
                <Input
                  type="date"
                  value={filterCreatedAtTo}
                  onChange={(e) => setFilterCreatedAtTo(e.target.value)}
                  data-testid="input-filter-created-to"
                />
              </div>
              <div>
                <Label>Updated From</Label>
                <Input
                  type="date"
                  value={filterUpdatedAtFrom}
                  onChange={(e) => setFilterUpdatedAtFrom(e.target.value)}
                  data-testid="input-filter-updated-from"
                />
              </div>
              <div>
                <Label>Updated To</Label>
                <Input
                  type="date"
                  value={filterUpdatedAtTo}
                  onChange={(e) => setFilterUpdatedAtTo(e.target.value)}
                  data-testid="input-filter-updated-to"
                />
              </div>
            </div>

            <Separator />

            <SectionHeader title="Notes" />
            <div>
              <Label>Notes Contains</Label>
              <Input
                placeholder="Filter by notes content..."
                value={filterNotes}
                onChange={(e) => setFilterNotes(e.target.value)}
                data-testid="input-filter-notes"
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-close-filters">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
