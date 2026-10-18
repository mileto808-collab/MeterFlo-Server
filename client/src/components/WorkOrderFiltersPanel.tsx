import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type WorkOrderFilterState, type FilterFieldConfig } from "@/hooks/use-work-order-filters";
import type { ServiceTypeRecord, WorkOrderStatus, SystemType, TroubleCode, User, UserGroup } from "@shared/schema";

interface ModuleType {
  id: number;
  productId: string;
  productLabel: string;
  description?: string | null;
  projectId?: number | null;
}

interface FilterDataSources {
  serviceTypes?: ServiceTypeRecord[];
  statuses?: WorkOrderStatus[];
  systemTypes?: SystemType[];
  moduleTypes?: ModuleType[];
  troubleCodes?: Array<TroubleCode & { ruleKey: string }>;
  users?: User[];
  userGroups?: UserGroup[];
}

interface WorkOrderFiltersPanelProps {
  filters: WorkOrderFilterState;
  setFilter: (key: string, value: string) => void;
  visibleFilters: string[];
  isFilterVisible: (key: string) => boolean;
  dataSources: FilterDataSources;
  isGlobalSearch?: boolean;
}

export function WorkOrderFiltersPanel({
  filters,
  setFilter,
  visibleFilters,
  isFilterVisible,
  dataSources,
  isGlobalSearch = false,
}: WorkOrderFiltersPanelProps) {
  const {
    serviceTypes = [],
    statuses = [],
    systemTypes = [],
    moduleTypes = [],
    troubleCodes = [],
    users = [],
    userGroups = [],
  } = dataSources;

  const getUserDisplayName = (user: User) => {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.username || user.id;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 p-4 bg-muted/50 rounded-lg border">
      {isFilterVisible("systemWoId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-system-wo-id">System WO ID</Label>
          <Input
            id="filter-system-wo-id"
            data-testid="input-filter-system-wo-id"
            placeholder="System ID..."
            value={filters.systemWoId}
            onChange={(e) => setFilter("systemWoId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("searchQuery") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-search">Search</Label>
          <Input
            id="filter-search"
            data-testid="input-filter-search"
            placeholder="Search WO ID, name, address, system..."
            value={filters.searchQuery}
            onChange={(e) => setFilter("searchQuery", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("status") && statuses.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select value={filters.status} onValueChange={(v) => setFilter("status", v)}>
            <SelectTrigger id="filter-status" data-testid="select-filter-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={s.code}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("serviceType") && serviceTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-service-type">Service Type</Label>
          <Select value={filters.serviceType} onValueChange={(v) => setFilter("serviceType", v)}>
            <SelectTrigger id="filter-service-type" data-testid="select-filter-service-type">
              <SelectValue placeholder="All Service Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Service Types</SelectItem>
              {serviceTypes.map((st) => (
                <SelectItem key={st.id} value={st.code}>{st.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("assignedTo") && users.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-assigned-to">Assigned To (User)</Label>
          <Select value={filters.assignedTo} onValueChange={(v) => setFilter("assignedTo", v)}>
            <SelectTrigger id="filter-assigned-to" data-testid="select-filter-assigned-to">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{getUserDisplayName(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("assignedGroup") && userGroups.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-assigned-group">Assigned To (Group)</Label>
          <Select value={filters.assignedGroup} onValueChange={(v) => setFilter("assignedGroup", v)}>
            <SelectTrigger id="filter-assigned-group" data-testid="select-filter-assigned-group">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {userGroups.map((g) => (
                <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("trouble") && troubleCodes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-trouble">Trouble Code</Label>
          <Select value={filters.trouble} onValueChange={(v) => setFilter("trouble", v)}>
            <SelectTrigger id="filter-trouble" data-testid="select-filter-trouble">
              <SelectValue placeholder="All Trouble Codes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Trouble Codes</SelectItem>
              {troubleCodes.map((tc) => (
                <SelectItem key={tc.id} value={tc.ruleKey}>{tc.code} - {tc.label || tc.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("oldSystemType") && systemTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-old-system-type">Old System Type</Label>
          <Select value={filters.oldSystemType} onValueChange={(v) => setFilter("oldSystemType", v)}>
            <SelectTrigger id="filter-old-system-type" data-testid="select-filter-old-system-type">
              <SelectValue placeholder="All System Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All System Types</SelectItem>
              {systemTypes.map((st) => (
                <SelectItem key={st.id} value={st.productId}>{st.productLabel || st.productId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("newSystemType") && systemTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-new-system-type">New System Type</Label>
          <Select value={filters.newSystemType} onValueChange={(v) => setFilter("newSystemType", v)}>
            <SelectTrigger id="filter-new-system-type" data-testid="select-filter-new-system-type">
              <SelectValue placeholder="All System Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All System Types</SelectItem>
              {systemTypes.map((st) => (
                <SelectItem key={st.id} value={st.productId}>{st.productLabel || st.productId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("customerId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-customer-id">Customer ID</Label>
          <Input
            id="filter-customer-id"
            data-testid="input-filter-customer-id"
            placeholder="Filter..."
            value={filters.customerId}
            onChange={(e) => setFilter("customerId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("customerName") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-customer-name">Customer Name</Label>
          <Input
            id="filter-customer-name"
            data-testid="input-filter-customer-name"
            placeholder="Filter..."
            value={filters.customerName}
            onChange={(e) => setFilter("customerName", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("address") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-address">Address</Label>
          <Input
            id="filter-address"
            data-testid="input-filter-address"
            placeholder="Filter..."
            value={filters.address}
            onChange={(e) => setFilter("address", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("city") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-city">City</Label>
          <Input
            id="filter-city"
            data-testid="input-filter-city"
            placeholder="Filter..."
            value={filters.city}
            onChange={(e) => setFilter("city", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("state") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-state">State</Label>
          <Input
            id="filter-state"
            data-testid="input-filter-state"
            placeholder="Filter..."
            value={filters.state}
            onChange={(e) => setFilter("state", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("zip") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-zip">ZIP</Label>
          <Input
            id="filter-zip"
            data-testid="input-filter-zip"
            placeholder="Filter..."
            value={filters.zip}
            onChange={(e) => setFilter("zip", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("phone") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-phone">Phone</Label>
          <Input
            id="filter-phone"
            data-testid="input-filter-phone"
            placeholder="Filter..."
            value={filters.phone}
            onChange={(e) => setFilter("phone", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("email") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-email">Email</Label>
          <Input
            id="filter-email"
            data-testid="input-filter-email"
            placeholder="Filter..."
            value={filters.email}
            onChange={(e) => setFilter("email", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("route") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-route">Route</Label>
          <Input
            id="filter-route"
            data-testid="input-filter-route"
            placeholder="Filter..."
            value={filters.route}
            onChange={(e) => setFilter("route", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("zone") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-zone">Zone</Label>
          <Input
            id="filter-zone"
            data-testid="input-filter-zone"
            placeholder="Filter..."
            value={filters.zone}
            onChange={(e) => setFilter("zone", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("oldSystemId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-old-system-id">Old System ID</Label>
          <Input
            id="filter-old-system-id"
            data-testid="input-filter-old-system-id"
            placeholder="Filter..."
            value={filters.oldSystemId}
            onChange={(e) => setFilter("oldSystemId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("newSystemId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-new-system-id">New System ID</Label>
          <Input
            id="filter-new-system-id"
            data-testid="input-filter-new-system-id"
            placeholder="Filter..."
            value={filters.newSystemId}
            onChange={(e) => setFilter("newSystemId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("oldModuleId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-old-module-id">Old Module ID</Label>
          <Input
            id="filter-old-module-id"
            data-testid="input-filter-old-module-id"
            placeholder="Filter..."
            value={filters.oldModuleId}
            onChange={(e) => setFilter("oldModuleId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("oldModuleType") && moduleTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-old-module-type">Old Module Type</Label>
          <Select value={filters.oldModuleType} onValueChange={(v) => setFilter("oldModuleType", v)}>
            <SelectTrigger id="filter-old-module-type" data-testid="select-filter-old-module-type">
              <SelectValue placeholder="All Module Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Module Types</SelectItem>
              {moduleTypes.map((mt) => (
                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel || mt.productId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("newModuleId") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-new-module-id">New Module ID</Label>
          <Input
            id="filter-new-module-id"
            data-testid="input-filter-new-module-id"
            placeholder="Filter..."
            value={filters.newModuleId}
            onChange={(e) => setFilter("newModuleId", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("newModuleType") && moduleTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-new-module-type">New Module Type</Label>
          <Select value={filters.newModuleType} onValueChange={(v) => setFilter("newModuleType", v)}>
            <SelectTrigger id="filter-new-module-type" data-testid="select-filter-new-module-type">
              <SelectValue placeholder="All Module Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Module Types</SelectItem>
              {moduleTypes.map((mt) => (
                <SelectItem key={mt.id} value={mt.productId}>{mt.productLabel || mt.productId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("scheduledAt") && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="filter-scheduled-from">Scheduled At</Label>
            <div className="flex items-center gap-2">
              <Input
                id="filter-scheduled-from"
                data-testid="input-filter-scheduled-from"
                type="date"
                value={filters.scheduledAtFrom}
                onChange={(e) => setFilter("scheduledAtFrom", e.target.value)}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                id="filter-scheduled-to"
                data-testid="input-filter-scheduled-to"
                type="date"
                value={filters.scheduledAtTo}
                onChange={(e) => setFilter("scheduledAtTo", e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {isFilterVisible("createdBy") && users.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-created-by">Created By</Label>
          <Select value={filters.createdBy} onValueChange={(v) => setFilter("createdBy", v)}>
            <SelectTrigger id="filter-created-by" data-testid="select-filter-created-by">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{getUserDisplayName(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("updatedBy") && users.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-updated-by">Updated By</Label>
          <Select value={filters.updatedBy} onValueChange={(v) => setFilter("updatedBy", v)}>
            <SelectTrigger id="filter-updated-by" data-testid="select-filter-updated-by">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{getUserDisplayName(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("scheduledBy") && users.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-scheduled-by">Scheduled By</Label>
          <Select value={filters.scheduledBy} onValueChange={(v) => setFilter("scheduledBy", v)}>
            <SelectTrigger id="filter-scheduled-by" data-testid="select-filter-scheduled-by">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{getUserDisplayName(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("completedBy") && users.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-completed-by">Completed By</Label>
          <Select value={filters.completedBy} onValueChange={(v) => setFilter("completedBy", v)}>
            <SelectTrigger id="filter-completed-by" data-testid="select-filter-completed-by">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{getUserDisplayName(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isFilterVisible("completedAt") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-completed-from">Completed At</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-completed-from"
              data-testid="input-filter-completed-from"
              type="date"
              value={filters.completedAtFrom}
              onChange={(e) => setFilter("completedAtFrom", e.target.value)}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              id="filter-completed-to"
              data-testid="input-filter-completed-to"
              type="date"
              value={filters.completedAtTo}
              onChange={(e) => setFilter("completedAtTo", e.target.value)}
            />
          </div>
        </div>
      )}

      {isFilterVisible("notes") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-notes">Notes</Label>
          <Input
            id="filter-notes"
            data-testid="input-filter-notes"
            placeholder="Filter..."
            value={filters.notes}
            onChange={(e) => setFilter("notes", e.target.value)}
          />
        </div>
      )}

      {isFilterVisible("createdAt") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-created-from">Created At</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-created-from"
              data-testid="input-filter-created-from"
              type="date"
              value={filters.createdAtFrom}
              onChange={(e) => setFilter("createdAtFrom", e.target.value)}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              id="filter-created-to"
              data-testid="input-filter-created-to"
              type="date"
              value={filters.createdAtTo}
              onChange={(e) => setFilter("createdAtTo", e.target.value)}
            />
          </div>
        </div>
      )}

      {isFilterVisible("updatedAt") && (
        <div className="space-y-1.5">
          <Label htmlFor="filter-updated-from">Updated At</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-updated-from"
              data-testid="input-filter-updated-from"
              type="date"
              value={filters.updatedAtFrom}
              onChange={(e) => setFilter("updatedAtFrom", e.target.value)}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              id="filter-updated-to"
              data-testid="input-filter-updated-to"
              type="date"
              value={filters.updatedAtTo}
              onChange={(e) => setFilter("updatedAtTo", e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
