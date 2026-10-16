import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Cable, Cog, FileBox, LockKeyhole, Package, Settings2, UsersRound, Wrench } from "lucide-react";
import type { SettingsGroup, SettingsSection, SettingsSectionKey } from "@/lib/settings-navigation";

type Props = {
  groups: SettingsGroup[];
  activeGroup: string;
  activeSection: SettingsSectionKey;
  onGroupChange: (group: string) => void;
  onSectionChange: (section: SettingsSectionKey) => void;
};

const groupIcons: Record<string, typeof Settings2> = {
  account: Settings2,
  access: UsersRound,
  "work-orders": Wrench,
  equipment: Package,
  files: FileBox,
  api: Cable,
  security: LockKeyhole,
  updates: Activity,
  system: Cog,
};

export function SettingsNavigation({ groups, activeGroup, activeSection, onGroupChange, onSectionChange }: Props) {
  const isMobile = useIsMobile();
  const currentGroup = groups.find(group => group.key === activeGroup) ?? groups[0];
  const currentSection = groups.flatMap(group => group.sections).find(section => section.key === activeSection);
  if (!currentGroup || !currentSection) return null;

  const selectSection = (section: SettingsSection) => {
    const parent = groups.find(group => group.sections.some(item => item.key === section.key));
    if (parent && parent.key !== activeGroup) onGroupChange(parent.key);
    onSectionChange(section.key);
  };

  return (
    <nav aria-label="Settings sections" className={`min-w-0 ${isMobile ? "flex-1" : ""}`}>
      {isMobile ? (
        <div className="flex min-w-0 items-center gap-2">
          {(() => {
            const Icon = groupIcons[currentGroup.key] ?? Settings2;
            return <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />;
          })()}
          <Select value={activeSection} onValueChange={(value) => selectSection(groups.flatMap(group => group.sections).find(section => section.key === value)!)} >
            <SelectTrigger className="h-9 min-w-0 flex-1" data-testid="settings-mobile-menu" aria-label="Choose settings section">
              <SelectValue>{currentSection.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groups.map(group => (
                <SelectGroup key={group.key}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.sections.map((section, index) => (
                    <SelectItem key={section.key} value={section.key}
                      data-testid={index === 0 ? `settings-tab-${group.key}` : `settings-section-nav-${section.key}`}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 gap-1 overflow-x-auto border-b pb-1" role="tablist" aria-label="Settings groups"
            onKeyDown={event => {
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
              const focused = buttons.findIndex(button => button.contains(event.target as Node));
              const index = focused >= 0 ? focused : groups.findIndex(group => group.key === activeGroup);
              const next = event.key === "ArrowRight" ? (index + 1) % groups.length :
                event.key === "ArrowLeft" ? (index - 1 + groups.length) % groups.length :
                event.key === "Home" ? 0 : event.key === "End" ? groups.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              onGroupChange(groups[next].key);
              buttons[next]?.focus();
            }}>
            {groups.map(group => {
              const Icon = groupIcons[group.key] ?? Settings2;
              const selected = group.key === activeGroup;
              return (
                <Button key={group.key} type="button" variant={selected ? "secondary" : "ghost"} size="sm"
                  id={`settings-group-${group.key}`} role="tab" tabIndex={selected ? 0 : -1}
                  aria-controls="settings-panel" aria-selected={selected} onClick={() => onGroupChange(group.key)}
                  data-testid={`settings-tab-${group.key}`} className="h-8 shrink-0 gap-1.5 px-2.5 text-xs">
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />{group.label}
                </Button>
              );
            })}
          </div>
          <div className="flex min-w-0 gap-1 overflow-x-auto pt-1.5" aria-label={`${currentGroup.label} sections`}>
            {currentGroup.sections.map(section => (
              <Button key={section.key} type="button" variant={activeSection === section.key ? "outline" : "ghost"}
                size="sm" aria-pressed={activeSection === section.key} onClick={() => onSectionChange(section.key)}
                data-testid={`settings-section-nav-${section.key}`} className="h-7 shrink-0 px-2.5 text-xs">
                {section.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
