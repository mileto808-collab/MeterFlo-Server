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

import mobileLoginImg from "@assets/meterflo-mobile-login-screen_1769310534833.png";
import selectProjectImg from "@assets/select-project_1769310534833.png";
import workOrdersScreenImg from "@assets/work-orders-screen_1769310534833.png";
import workOrderDetail1Img from "@assets/work-order-detail1_1769310534833.png";
import workOrderDetail2Img from "@assets/work-order-detail2_1769310534833.png";
import wizardStep1Img from "@assets/capture-wizard-step1_1769310516259.png";
import wizardStep2Img from "@assets/capture-wizard-step2_1769310516259.png";
import wizardStep3Img from "@assets/capture-wizard-step3_1769310516259.png";
import wizardStep4Img from "@assets/capture-wizard-step4_1769310516259.png";
import wizardStep5Img from "@assets/capture-wizard-step5_1769310516259.png";
import wizardStep6Img from "@assets/capture-wizard-step6_1769310516259.png";
import wizardStep7Img from "@assets/capture-wizard-step7_1769310516258.png";
import wizardStep8Img from "@assets/capture-wizard-step8_1769310516258.png";
import wizardStep9Img from "@assets/capture-wizard-step9_1769310516258.png";
import wizardStep10Img from "@assets/capture-wizard-step10_1769310516258.png";
import completedDetail1Img from "@assets/completed-work-order-detail1_1769310516258.png";
import completedDetail2Img from "@assets/completed-work-order-detail2_1769310516258.png";
import troubleWo1Img from "@assets/trouble-work-order1_1769310516257.png";
import troubleWo2Img from "@assets/trouble-work-order2_1769310516257.png";
import filterSortImg from "@assets/filter-and-sort-work-orders_1769310516257.png";
import accountsTab1Img from "@assets/accounts-tab1_1769310516257.png";
import accountsTab2Img from "@assets/accounts-tab2_1769310516257.png";
import syncTab1Img from "@assets/sync-tab1_1769310516257.png";
import syncTab2Img from "@assets/sync-tab2_1769310516256.png";
import backupDataImg from "@assets/backup-data_1769310516256.png";
import offlineWoImg from "@assets/offline-work-orders1_1769311345359.png";
import woSearch1Img from "@assets/work-order-search1_1769311345359.png";
import woSearch2Img from "@assets/work-order-search2_1769311345359.png";
import woSearch3Img from "@assets/work-order-search3_1769311345358.png";

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
              <img src={mobileLoginImg} alt="Mobile Login Screen" className="w-full" data-testid="img-mobile-login" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Project Selection</h2>
            <p className="text-muted-foreground mb-6">A field tech can be a member of multiple projects. When they log in to the mobile app, they will select a project.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-xs mx-auto">
              <img src={selectProjectImg} alt="Select Project Screen" className="w-full" data-testid="img-select-project" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Work Orders Screen</h2>
            <p className="text-muted-foreground mb-6">The main Work Orders screen displays all assigned work orders with key information at a glance.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={workOrdersScreenImg} alt="Work Orders List" className="w-full" data-testid="img-work-orders-screen" />
                </div>
                <p className="text-sm text-muted-foreground">Work Orders List</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={workOrderDetail1Img} alt="Work Order Detail" className="w-full" data-testid="img-wo-detail-1" />
                </div>
                <p className="text-sm text-muted-foreground">Work Order Detail</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={workOrderDetail2Img} alt="Work Order Detail Expanded" className="w-full" data-testid="img-wo-detail-2" />
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
                  <img src={wizardStep1Img} alt="Can The Changeout Proceed?" className="w-full" data-testid="img-wizard-step-1" />
                </div>
                <p className="text-xs text-muted-foreground">1. Confirm Proceed</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep2Img} alt="Capture Old Reading" className="w-full" data-testid="img-wizard-step-2" />
                </div>
                <p className="text-xs text-muted-foreground">2. Old Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep3Img} alt="Before Photos" className="w-full" data-testid="img-wizard-step-3" />
                </div>
                <p className="text-xs text-muted-foreground">3. Before Photos</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep4Img} alt="Physical Changeout" className="w-full" data-testid="img-wizard-step-4" />
                </div>
                <p className="text-xs text-muted-foreground">4. Physical Changeout</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep5Img} alt="Capture New ID" className="w-full" data-testid="img-wizard-step-5" />
                </div>
                <p className="text-xs text-muted-foreground">5. Scan New ID</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep6Img} alt="Capture New Reading" className="w-full" data-testid="img-wizard-step-6" />
                </div>
                <p className="text-xs text-muted-foreground">6. New Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep7Img} alt="After Photos" className="w-full" data-testid="img-wizard-step-7" />
                </div>
                <p className="text-xs text-muted-foreground">7. After Photos</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep8Img} alt="Notes" className="w-full" data-testid="img-wizard-step-8" />
                </div>
                <p className="text-xs text-muted-foreground">8. Notes</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep9Img} alt="Signature" className="w-full" data-testid="img-wizard-step-9" />
                </div>
                <p className="text-xs text-muted-foreground">9. Signature</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={wizardStep10Img} alt="Review & Submit" className="w-full" data-testid="img-wizard-step-10" />
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
                  <img src={completedDetail1Img} alt="Completed Work Order Overview" className="w-full" data-testid="img-completed-wo-1" />
                </div>
                <p className="text-sm text-muted-foreground">Completed Overview</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={completedDetail2Img} alt="Completed Work Order Details" className="w-full" data-testid="img-completed-wo-2" />
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
                  <img src={troubleWo1Img} alt="Report Trouble" className="w-full" data-testid="img-trouble-wo-1" />
                </div>
                <p className="text-sm text-muted-foreground">Report Issue</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={troubleWo2Img} alt="Submit Trouble" className="w-full" data-testid="img-trouble-wo-2" />
                </div>
                <p className="text-sm text-muted-foreground">Review & Submit</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Filter and Sort Work Orders</h2>
            <p className="text-muted-foreground mb-6">Quickly find work orders using status filters and multi-field sorting options.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-xs mx-auto">
              <img src={filterSortImg} alt="Filter and Sort" className="w-full" data-testid="img-filter-sort" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Account Tab</h2>
            <p className="text-muted-foreground mb-6">Switch Projects, check the server status, app information, and check for the latest updates in the Account tab.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={accountsTab1Img} alt="Account - Project Info" className="w-full" data-testid="img-account-tab-1" />
                </div>
                <p className="text-sm text-muted-foreground">Project & Server Info</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={accountsTab2Img} alt="Account - App Info" className="w-full" data-testid="img-account-tab-2" />
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
                  <img src={syncTab1Img} alt="Sync Status Connected" className="w-full" data-testid="img-sync-tab-1" />
                </div>
                <p className="text-sm text-muted-foreground">Sync Status</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={syncTab2Img} alt="Pending Actions" className="w-full" data-testid="img-sync-tab-2" />
                </div>
                <p className="text-sm text-muted-foreground">Pending Actions</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={backupDataImg} alt="Backup Files" className="w-full" data-testid="img-backup-data" />
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
                  <img src={offlineWoImg} alt="Offline Mode Banner" className="w-full" data-testid="img-offline-wo" />
                </div>
                <p className="text-xs text-muted-foreground">Offline Mode</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={woSearch1Img} alt="Found on Server" className="w-full" data-testid="img-wo-search-1" />
                </div>
                <p className="text-xs text-muted-foreground">Found on Server</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={woSearch2Img} alt="Search Failed" className="w-full" data-testid="img-wo-search-2" />
                </div>
                <p className="text-xs text-muted-foreground">Search Failed</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={woSearch3Img} alt="Already Completed" className="w-full" data-testid="img-wo-search-3" />
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
