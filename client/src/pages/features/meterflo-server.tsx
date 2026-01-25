import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  ClipboardList, 
  Menu, 
  Mail, 
  Layers, 
  Server,
  Database,
  Calendar,
  FileText,
  QrCode,
  BarChart3,
  Smartphone,
  Gauge,
  Scan,
  StickyNote,
  PenTool,
  CheckCircle,
  AlertTriangle,
  Settings,
  Search,
  Clock,
  Upload,
  Shield,
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

export default function MeterFloServerFeatures() {
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const features = [
    {
      icon: Database,
      title: "Multiple Projects",
      description: "Supports multiple projects. Each project has its own database for complete data isolation and organization.",
    },
    {
      icon: ClipboardList,
      title: "Work Order Management",
      description: "Manage work orders per project effectively. Create, edit, track, and organize all your field work in one place.",
    },
    {
      icon: Calendar,
      title: "Drag & Drop Scheduling",
      description: "Schedule work orders with intuitive drag and drop functionality. Easily reschedule as needed.",
    },
    {
      icon: FileText,
      title: "Work Order Details",
      description: "View comprehensive details on completed work orders including all captured data, photos, and signatures.",
    },
    {
      icon: Server,
      title: "Assignment Management",
      description: "Assign and unassign work orders to individual users or entire groups. Field technicians only see work orders assigned to them or their group.",
    },
    {
      icon: QrCode,
      title: "Route Sheets",
      description: "Create barcode or QR code route sheets for efficient field operations and scanning.",
    },
    {
      icon: BarChart3,
      title: "Work Order Reports",
      description: "Generate comprehensive work order reports with filtering, sorting, and export capabilities.",
    },
    {
      icon: Smartphone,
      title: "Web Application Processing",
      description: "If your installers work in an area with stable internet, process meter and/or module changeouts and readings directly from the MeterFlo Server web application.",
    },
    {
      icon: Gauge,
      title: "Meter & Module Readings",
      description: "Capture current meter and module readings with support for HID scan devices or device camera to read barcodes and QR codes.",
    },
    {
      icon: Scan,
      title: "New Meter & Module Capture",
      description: "Capture new meter and module readings with flexible input methods including barcode scanning and manual entry.",
    },
    {
      icon: StickyNote,
      title: "Optional Notes",
      description: "Capture optional notes during the changeout process for additional documentation and context.",
    },
    {
      icon: PenTool,
      title: "Signature Capture",
      description: "Require signatures for completed work orders to ensure proper verification and accountability.",
    },
    {
      icon: CheckCircle,
      title: "Review & Submit",
      description: "Review all captured data before submission to ensure accuracy and completeness.",
    },
    {
      icon: AlertTriangle,
      title: "Trouble Events",
      description: "Create trouble events on work orders to document issues encountered in the field.",
    },
    {
      icon: Settings,
      title: "Project Settings",
      description: "Configure each project to changeout or read meters and/or modules. Control which steps appear in the capture wizard workflow. Configure GPS capture options.",
    },
    {
      icon: Search,
      title: "Search Method Configuration",
      description: "Configure the methods and tools used to search for work orders and scan meter and module IDs.",
    },
    {
      icon: Clock,
      title: "Operational Hours",
      description: "Set operational hours, operational days, local time zone, and holidays per project. Work order scheduling follows the rules defined here.",
    },
    {
      icon: Upload,
      title: "Data Import",
      description: "Manually import work orders in CSV, Excel, and JSON formats. Or configure scheduled imports that run at specified times to automatically update project work orders.",
    },
    {
      icon: Shield,
      title: "Role-Based Permissions",
      description: "Robust role-based permissions management to control access and capabilities across your organization.",
    },
  ];

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
      
      <main>
        <section className="py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <Link href="/">
                <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-home">
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back to Home
                </Button>
              </Link>
              <h1 className="text-4xl font-bold tracking-tight mb-4">MeterFlo Server Features</h1>
              <p className="text-lg text-muted-foreground max-w-3xl">
                Comprehensive work order management for utility meter changeout projects. 
                From scheduling to reporting, MeterFlo Server provides all the tools you need 
                to manage your field operations efficiently.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature) => (
                <Card key={feature.title} className="hover-elevate">
                  <CardHeader className="pb-3">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-12 text-center">
              <p className="text-lg text-muted-foreground mb-6">
                ...and more!
              </p>
              <Link href="/">
                <Button size="lg" data-testid="button-get-started">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </section>
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
