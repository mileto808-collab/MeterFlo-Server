import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { 
  ClipboardList, 
  Menu, 
  Mail, 
  Layers, 
  Server,
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

import multipleProjectsImg from "@assets/multiple-projects_1769306371116.png";
import manageWorkordersImg from "@assets/manage-workorders_1769306371116.png";
import scheduleWorkOrder1Img from "@assets/schedule_work_order1_1769306371115.png";
import scheduleWorkOrder2Img from "@assets/schedule_work_order2_1769306371115.png";
import workOrderDetails1Img from "@assets/work_order_details1_1769306371115.png";
import workOrderDetails2Img from "@assets/work_order_details2_1769306371115.png";
import assignWorkOrders1Img from "@assets/assign-work-orders1_1769306371115.png";
import assignWorkOrders2Img from "@assets/assign-work-orders2_1769306371115.png";
import barcodesImg from "@assets/barcodes_1769306371114.png";
import qrCodesImg from "@assets/qr-codes_1769306371114.png";
import workOrderReportImg from "@assets/work-order-report_1769306371114.png";
import processWorkOrder1Img from "@assets/process-work-order1_1769306333367.png";
import processWorkOrder2Img from "@assets/process-work-order2_1769306333367.png";
import processWorkOrder3Img from "@assets/process-work-order3_1769306333366.png";
import processWorkOrder4Img from "@assets/process-work-order4_1769306333366.png";
import processWorkOrder5Img from "@assets/process-work-order5_1769306333366.png";
import processWorkOrder6Img from "@assets/process-work-order6_1769306333366.png";
import processWorkOrder7Img from "@assets/process-work-order7_1769306333366.png";
import processWorkOrder8Img from "@assets/process-work-order8_1769306333366.png";
import troubleWorkOrderImg from "@assets/trouble-work-order_1769306333365.png";
import completedWorkOrderImg from "@assets/completed-work-order_1769306333365.png";
import projectSettings1Img from "@assets/project-settings1_1769306333365.png";
import projectSettings2Img from "@assets/project-settings2_1769306333365.png";
import projectSettings3Img from "@assets/project-settings3_1769306333365.png";
import importWorkOrders1Img from "@assets/import-work-orders1_1769306333365.png";
import importWorkOrders2Img from "@assets/import-work-orders2_1769306333364.png";
import roleBasedPermissionsImg from "@assets/role-based-permissions_1769306333364.png";

export default function MeterFloServerFeatures() {
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
            <h1 className="text-4xl font-bold tracking-tight mb-4">MeterFlo Server Features</h1>
          </div>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Supports Multiple Projects</h2>
            <p className="text-muted-foreground mb-6">Each project has its own database.</p>
            <div className="rounded-lg overflow-hidden border border-border">
              <img src={multipleProjectsImg} alt="Multiple Projects Dashboard" className="w-full" data-testid="img-multiple-projects" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Manage Work Orders Per Project</h2>
            <p className="text-muted-foreground mb-6">Effectively manage all work orders within each project.</p>
            <div className="rounded-lg overflow-hidden border border-border">
              <img src={manageWorkordersImg} alt="Manage Work Orders" className="w-full" data-testid="img-manage-workorders" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Schedule Work Orders</h2>
            <p className="text-muted-foreground mb-6">Drag and drop scheduling and rescheduling.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={scheduleWorkOrder1Img} alt="Schedule Work Order Calendar" className="w-full" data-testid="img-schedule-wo-1" />
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={scheduleWorkOrder2Img} alt="Schedule Work Order Dialog" className="w-full" data-testid="img-schedule-wo-2" />
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Work Order Details</h2>
            <p className="text-muted-foreground mb-6">View comprehensive details on completed work orders.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={workOrderDetails1Img} alt="Work Order Details View 1" className="w-full" data-testid="img-wo-details-1" />
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={workOrderDetails2Img} alt="Work Order Details View 2" className="w-full" data-testid="img-wo-details-2" />
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Assign and Unassign Work Orders</h2>
            <p className="text-muted-foreground mb-6">Assign work orders to an individual user or an entire group. Field technicians will only see work orders assigned to them or to their group.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={assignWorkOrders1Img} alt="Assign Work Orders" className="w-full" data-testid="img-assign-wo-1" />
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={assignWorkOrders2Img} alt="Unassign Work Orders" className="w-full" data-testid="img-assign-wo-2" />
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Create Barcode or QR Code Route Sheets</h2>
            <p className="text-muted-foreground mb-6">Generate printable route sheets with barcodes or QR codes for efficient field operations.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={barcodesImg} alt="Barcode Route Sheet" className="w-full" data-testid="img-barcodes" />
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={qrCodesImg} alt="QR Code Route Sheet" className="w-full" data-testid="img-qr-codes" />
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Create Work Order Reports</h2>
            <p className="text-muted-foreground mb-6">Generate comprehensive PDF reports for completed work orders.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-2xl mx-auto">
              <img src={workOrderReportImg} alt="Work Order Report" className="w-full" data-testid="img-wo-report" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Process Meter and Module Changeouts from the Web Application</h2>
            <p className="text-muted-foreground mb-6">If your installers are working in an area that has a stable internet connection, process meter and/or module changeouts and readings directly from the MeterFlo Server web application.</p>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder1Img} alt="Work Orders List" className="w-full" data-testid="img-process-wo-1" />
                </div>
                <p className="text-sm text-muted-foreground">Work Orders List</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder2Img} alt="Can The Changeout Proceed?" className="w-full" data-testid="img-process-wo-2" />
                </div>
                <p className="text-sm text-muted-foreground">Confirm Proceed</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder3Img} alt="Capture Old Reading" className="w-full" data-testid="img-process-wo-3" />
                </div>
                <p className="text-sm text-muted-foreground">Capture Old Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder4Img} alt="Capture New System ID" className="w-full" data-testid="img-process-wo-4" />
                </div>
                <p className="text-sm text-muted-foreground">Scan New ID (HID/Camera)</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder5Img} alt="Capture New Reading" className="w-full" data-testid="img-process-wo-5" />
                </div>
                <p className="text-sm text-muted-foreground">Capture New Reading</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder6Img} alt="Optional Notes" className="w-full" data-testid="img-process-wo-6" />
                </div>
                <p className="text-sm text-muted-foreground">Optional Notes</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder7Img} alt="Capture Signature" className="w-full" data-testid="img-process-wo-7" />
                </div>
                <p className="text-sm text-muted-foreground">Capture Signature</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={processWorkOrder8Img} alt="Review & Submit" className="w-full" data-testid="img-process-wo-8" />
                </div>
                <p className="text-sm text-muted-foreground">Review & Submit</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Create Trouble Events and View Completed Work Orders</h2>
            <p className="text-muted-foreground mb-6">Report issues with trouble codes and photos, then view completed work order details.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={troubleWorkOrderImg} alt="Report Trouble Issue" className="w-full" data-testid="img-trouble-wo" />
                </div>
                <p className="text-sm text-muted-foreground">Create Trouble Events</p>
              </div>
              <div className="text-center">
                <div className="rounded-lg overflow-hidden border border-border mb-2">
                  <img src={completedWorkOrderImg} alt="Completed Work Order" className="w-full" data-testid="img-completed-wo" />
                </div>
                <p className="text-sm text-muted-foreground">View Completed Work Order</p>
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Project Settings</h2>
            <p className="text-muted-foreground mb-6">Configure the project to changeout or read meters and/or modules. Control which steps you want in the capture wizard workflow per project. Configure whether GPS capture is done in the background, or if you want the user to capture GPS coordinates manually.</p>
            <div className="rounded-lg overflow-hidden border border-border mb-6">
              <img src={projectSettings1Img} alt="Project Settings - Wizard Configuration" className="w-full" data-testid="img-project-settings-1" />
            </div>
            
            <p className="text-muted-foreground mb-6">Configure the methods and tools that will be used to search for work orders and scan meter and module IDs.</p>
            <div className="rounded-lg overflow-hidden border border-border mb-6 max-w-2xl mx-auto">
              <img src={projectSettings2Img} alt="Search Method Configuration" className="w-full" data-testid="img-project-settings-2" />
            </div>

            <p className="text-muted-foreground mb-6">Set operational hours, operational days, local time zone, and holidays per project. Scheduling work orders will abide by the rules defined here.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-2xl mx-auto">
              <img src={projectSettings3Img} alt="Operational Hours Configuration" className="w-full" data-testid="img-project-settings-3" />
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Import Work Orders</h2>
            <p className="text-muted-foreground mb-6">Manually import work orders in CSV, Excel, and JSON formats. Or, configure scheduled imports that run at specified times to automatically update project work orders.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={importWorkOrders1Img} alt="Import Work Orders - Upload" className="w-full" data-testid="img-import-wo-1" />
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={importWorkOrders2Img} alt="Import Work Orders - Column Mapping" className="w-full" data-testid="img-import-wo-2" />
              </div>
            </div>
          </section>

          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-4">Role-Based Permissions Management</h2>
            <p className="text-muted-foreground mb-6">Robust role-based permissions to control access levels and capabilities across your organization.</p>
            <div className="rounded-lg overflow-hidden border border-border max-w-3xl mx-auto">
              <img src={roleBasedPermissionsImg} alt="Role-Based Permissions" className="w-full" data-testid="img-permissions" />
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
