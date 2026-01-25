import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { 
  ClipboardList, 
  Menu, 
  Mail, 
  Layers, 
  Server,
  Smartphone,
  ChevronLeft
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactFormDialog } from "@/components/contact-form-dialog";
import { useState } from "react";
import { Link } from "wouter";

export default function MeterFloMobileFeatures() {
  const [contactFormOpen, setContactFormOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/" data-testid="link-home-logo">
              <img 
                src="/meterflo-logo.png" 
                alt="MeterFlo" 
                className="h-40 w-auto cursor-pointer"
                data-testid="img-meterflo-logo"
              />
            </Link>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-menu">
                  <Menu className="h-4 w-4 mr-2" />
                  Menu
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid="menu-item-features">
                    <Layers className="h-4 w-4 mr-2" />
                    Features
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild data-testid="menu-item-meterflo-server">
                      <Link href="/features/meterflo-server">
                        <Server className="h-4 w-4 mr-2" />
                        MeterFlo Server
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild data-testid="menu-item-meterflo-mobile">
                      <Link href="/features/meterflo-mobile">
                        <Smartphone className="h-4 w-4 mr-2" />
                        MeterFlo Mobile
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem 
                  onClick={() => setContactFormOpen(true)}
                  data-testid="menu-item-contact-us"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Contact Us
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <ContactFormDialog open={contactFormOpen} onOpenChange={setContactFormOpen} />
      
      <main className="py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <Link href="/">
              <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-home">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Home
              </Button>
            </Link>
            <h1 className="text-4xl font-bold tracking-tight mb-4">MeterFlo Mobile App Features</h1>
          </div>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Mobile Login</h2>
            <p className="text-muted-foreground mb-6">The MeterFlo Mobile Login Page. Once a field tech signs in when the device is online, it saves the login credentials locally so that field techs can login when there is no internet connection.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-xs mx-auto">
              <img src="/screenshots/mobile/mobile-login.png" alt="Mobile Login Screen" className="w-full" data-testid="img-mobile-login" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Project Selection</h2>
            <p className="text-muted-foreground mb-6">A field tech can be a member of multiple projects. When they log in to the mobile app, they will select a project.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-xs mx-auto">
              <img src="/screenshots/mobile/select-project.png" alt="Select Project Screen" className="w-full" data-testid="img-select-project" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Work Orders Screen</h2>
            <p className="text-muted-foreground mb-6">The main Work Orders screen displays all assigned work orders with key information at a glance.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/work-orders-screen.png" alt="Work Orders List" className="w-full" data-testid="img-work-orders-screen" />
                </div>
                <p className="text-sm text-muted-foreground">Work Orders List</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/work-order-detail1.png" alt="Work Order Detail" className="w-full" data-testid="img-wo-detail-1" />
                </div>
                <p className="text-sm text-muted-foreground">Work Order Detail</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/work-order-detail2.png" alt="Work Order Detail Expanded" className="w-full" data-testid="img-wo-detail-2" />
                </div>
                <p className="text-sm text-muted-foreground">System/Module Details</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Capture Wizard</h2>
            <p className="text-muted-foreground mb-6">Capture meter and/or module data for meter/module changeouts, or meter/module readings. The wizard guides field techs through each step of the process.</p>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step1.png" alt="Can The Changeout Proceed?" className="w-full" data-testid="img-wizard-step-1" />
                </div>
                <p className="text-xs text-muted-foreground">1. Confirm Proceed</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step2.png" alt="Capture Old Reading" className="w-full" data-testid="img-wizard-step-2" />
                </div>
                <p className="text-xs text-muted-foreground">2. Old Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step3.png" alt="Before Photos" className="w-full" data-testid="img-wizard-step-3" />
                </div>
                <p className="text-xs text-muted-foreground">3. Before Photos</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step4.png" alt="Physical Changeout" className="w-full" data-testid="img-wizard-step-4" />
                </div>
                <p className="text-xs text-muted-foreground">4. Physical Changeout</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step5.png" alt="Capture New ID" className="w-full" data-testid="img-wizard-step-5" />
                </div>
                <p className="text-xs text-muted-foreground">5. Scan New ID</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step6.png" alt="Capture New Reading" className="w-full" data-testid="img-wizard-step-6" />
                </div>
                <p className="text-xs text-muted-foreground">6. New Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step7.png" alt="After Photos" className="w-full" data-testid="img-wizard-step-7" />
                </div>
                <p className="text-xs text-muted-foreground">7. After Photos</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step8.png" alt="Notes" className="w-full" data-testid="img-wizard-step-8" />
                </div>
                <p className="text-xs text-muted-foreground">8. Notes</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step9.png" alt="Signature" className="w-full" data-testid="img-wizard-step-9" />
                </div>
                <p className="text-xs text-muted-foreground">9. Signature</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wizard-step10.png" alt="Review & Submit" className="w-full" data-testid="img-wizard-step-10" />
                </div>
                <p className="text-xs text-muted-foreground">10. Review & Submit</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Completed Work Order Detail</h2>
            <p className="text-muted-foreground mb-6">View comprehensive details on completed work orders with all captured data.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/completed-detail1.png" alt="Completed Work Order Overview" className="w-full" data-testid="img-completed-wo-1" />
                </div>
                <p className="text-sm text-muted-foreground">Completed Overview</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/completed-detail2.png" alt="Completed Work Order Details" className="w-full" data-testid="img-completed-wo-2" />
                </div>
                <p className="text-sm text-muted-foreground">System/Module Details</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Trouble Events</h2>
            <p className="text-muted-foreground mb-6">Create a Trouble Event on a Work Order when a changeout cannot proceed. Capture trouble codes, notes, and photos.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/trouble-wo1.png" alt="Report Trouble" className="w-full" data-testid="img-trouble-wo-1" />
                </div>
                <p className="text-sm text-muted-foreground">Report Issue</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/trouble-wo2.png" alt="Submit Trouble" className="w-full" data-testid="img-trouble-wo-2" />
                </div>
                <p className="text-sm text-muted-foreground">Review & Submit</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Filter and Sort Work Orders</h2>
            <p className="text-muted-foreground mb-6">Quickly find work orders using status filters and multi-field sorting options.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-xs mx-auto">
              <img src="/screenshots/mobile/filter-sort.png" alt="Filter and Sort" className="w-full" data-testid="img-filter-sort" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Account Tab</h2>
            <p className="text-muted-foreground mb-6">Switch Projects, check the server status, app information, and check for the latest updates in the Account tab.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/accounts-tab1.png" alt="Account - Project Info" className="w-full" data-testid="img-account-tab-1" />
                </div>
                <p className="text-sm text-muted-foreground">Project & Server Info</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/accounts-tab2.png" alt="Account - App Info" className="w-full" data-testid="img-account-tab-2" />
                </div>
                <p className="text-sm text-muted-foreground">App Info & Updates</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Sync Tab</h2>
            <p className="text-muted-foreground mb-6">Do a full Sync, check upload status, clear and refresh data, and take a data and photos backup from the Sync tab. Upload backups to the server, or send to operations support in an email.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/sync-tab1.png" alt="Sync Status Connected" className="w-full" data-testid="img-sync-tab-1" />
                </div>
                <p className="text-sm text-muted-foreground">Sync Status</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/sync-tab2.png" alt="Pending Actions" className="w-full" data-testid="img-sync-tab-2" />
                </div>
                <p className="text-sm text-muted-foreground">Pending Actions</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/backup-data.png" alt="Backup Files" className="w-full" data-testid="img-backup-data" />
                </div>
                <p className="text-sm text-muted-foreground">Backup Files</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Offline Mode</h2>
            <p className="text-muted-foreground mb-6">Process work orders offline without an internet connection. When the device has an internet connection again, work orders will automatically sync to the server. If a field tech doesn't have a work order on their device, they can create an offline work order, and when the device connects to the internet, the sync process will match the work order on the meter/module id captured and update the work order.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/offline-wo.png" alt="Offline Mode Banner" className="w-full" data-testid="img-offline-wo" />
                </div>
                <p className="text-xs text-muted-foreground">Offline Mode</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wo-search1.png" alt="Found on Server" className="w-full" data-testid="img-wo-search-1" />
                </div>
                <p className="text-xs text-muted-foreground">Found on Server</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wo-search2.png" alt="Search Failed" className="w-full" data-testid="img-wo-search-2" />
                </div>
                <p className="text-xs text-muted-foreground">Search Failed</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src="/screenshots/mobile/wo-search3.png" alt="Already Completed" className="w-full" data-testid="img-wo-search-3" />
                </div>
                <p className="text-xs text-muted-foreground">Already Completed</p>
              </div>
            </div>
          </section>

          <section className="mb-12 text-center">
            <p className="text-xl text-muted-foreground mb-8">...and more!</p>
            <Link href="/">
              <Button size="lg" data-testid="button-get-started">
                Get Started
              </Button>
            </Link>
          </section>
        </div>
      </main>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span>MeterFlo</span>
          </div>
          <p>MeterFlo - All Rights Reserved</p>
        </div>
      </footer>
    </div>
  );
}
