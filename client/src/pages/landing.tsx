import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchTurnstileStatus } from "@/lib/login-security";
import {
  ClipboardList,
  Users,
  Shield,
  Smartphone,
  FileUp,
  BarChart3,
  Menu,
  Mail,
  Layers,
  Server,
  ArrowRight,
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
import { Link } from "wouter";

export default function Landing() {
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [loginCheckError, setLoginCheckError] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const checkSignInRoute = async () => {
    if (checkingLogin) return;
    setCheckingLogin(true);
    setLoginCheckError(null);
    try {
      const status = await fetchTurnstileStatus();
      setLocation(status.required && !status.verified ? "/turnstile" : "/login");
    } catch (failure) {
      setLoginCheckError(failure instanceof Error ? failure.message : "Could not confirm sign-in security. Please try again.");
    } finally {
      setCheckingLogin(false);
    }
  };

  const handleLoginClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Preserve the native link for keyboard activation and modified/new-tab clicks.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void checkSignInRoute();
  };

  const features = [
    {
      icon: ClipboardList,
      title: "Work Order Management",
      description: "Create, schedule, assign, and track work orders with real-time status updates. Manage multiple projects.",
    },
    {
      icon: Smartphone,
      title: "Mobile Integration",
      description: "Work orders assigned to individual meter installers, or groups of installers have their work orders AutoSynced to their mobile devices. Works offline. Data is saved persistently. Work orders are AutoSync when the device is back online.",
    },
    {
      icon: Shield,
      title: "Role-Based Access",
      description: "Control who can view, edit work orders, manage projects, or run reports.",
    },
    {
      icon: FileUp,
      title: "Data Import",
      description: "Import work orders from CSV, Excel, or JSON files. REST API capable. Automated imports/exports. Backend data integration.",
    },
    {
      icon: Users,
      title: "Customer Portal",
      description: "Customers can view work orders, check work order status, resolve trouble work orders, upload or retrieve data files, and track the progress of projects by running reports.",
    },
    {
      icon: BarChart3,
      title: "Admin Dashboard",
      description: "Comprehensive tools for user and system management. Configure scheduled imports per project. Backup and Restore tools. And, more...",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" aria-label="MeterFlo home" className="flex items-center shrink-0">
            <img
              src="/meterflo-logo.png"
              alt="MeterFlo"
              className="h-16 sm:h-20 w-auto object-contain"
              data-testid="img-meterflo-logo"
            />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Button asChild className="hidden sm:inline-flex gap-2" aria-busy={checkingLogin}>
              <Link
                href="/login"
                onClick={handleLoginClick}
                aria-disabled={checkingLogin}
                tabIndex={checkingLogin ? -1 : undefined}
                data-testid="link-login-desktop"
              >
                {checkingLogin ? "Checking…" : "Log In"} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-menu" aria-label="Open menu">
                  <Menu className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Menu</span>
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
                <DropdownMenuItem onClick={() => setContactFormOpen(true)} data-testid="menu-item-contact-us">
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
        <section className="relative overflow-hidden py-16 sm:py-24 px-6">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-primary/[0.035] -skew-x-12 translate-x-1/4 pointer-events-none" />
          <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-12 items-center">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-[0.16em] uppercase text-primary mb-5">Field work, in sync</p>
              <h1 className="text-4xl md:text-5xl lg:text-[3.4rem] font-bold tracking-tight leading-[1.08] mb-6">
                The work behind a smarter meter network.
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                MeterFlo keeps utility meter and AMI module changeout projects moving—from a clean work order at the office to a reliable sync in the field.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="w-full sm:w-auto gap-2" aria-busy={checkingLogin}>
                  <Link
                    href="/login"
                    onClick={handleLoginClick}
                    aria-disabled={checkingLogin}
                    tabIndex={checkingLogin ? -1 : undefined}
                    data-testid="link-login-phone"
                  >
                    {checkingLogin ? "Checking…" : "Log In to MeterFlo"} <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" onClick={() => setContactFormOpen(true)}>
                  Talk to our team
                </Button>
              </div>
              {loginCheckError && (
                <Alert variant="destructive" className="mt-5" role="alert">
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>Sign-in security could not be checked: {loginCheckError}</span>
                    <Button variant="ghost" className="h-auto p-0 text-destructive" onClick={() => void checkSignInRoute()} disabled={checkingLogin}>
                      Retry check
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <Card className="border-primary/15 shadow-lg shadow-primary/5 overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Built for the whole crew</CardTitle>
                    <CardDescription>One steady view from dispatch to closeout</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {[
                  ["01", "Plan the work", "Organize projects, routes, assignments, and deadlines."],
                  ["02", "Keep crews moving", "Sync work to mobile teams—even when coverage drops."],
                  ["03", "See what’s done", "Follow progress and bring field updates back together."],
                ].map(([number, title, description]) => (
                  <div key={number} className="flex gap-4">
                    <span className="font-mono text-xs text-primary pt-1">{number}</span>
                    <div>
                      <p className="font-semibold">{title}</p>
                      <p className="text-sm text-muted-foreground mt-1">{description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="py-16 px-6 bg-muted/30 border-y border-border/70">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mb-10">
              <p className="text-sm font-semibold tracking-[0.14em] uppercase text-primary mb-3">A connected operation</p>
              <h2 className="text-3xl font-bold tracking-tight mb-3">Smart utility. Seamless changeout.</h2>
              <p className="text-muted-foreground">Practical tools for the people planning, completing, and supporting every meter change.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {features.map((feature, index) => (
                <Card key={feature.title} className={`hover-elevate ${index === 0 ? "lg:row-span-2" : ""}`}>
                  <CardHeader className="pb-3">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-2">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">{feature.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span>MeterFlo©</span>
          </div>
          <p>MeterFlo© all Rights Reserved</p>
        </div>
      </footer>
    </div>
  );
}
