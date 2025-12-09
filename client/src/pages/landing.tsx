import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClipboardList, Users, Shield, Smartphone, FileUp, BarChart3 } from "lucide-react";

export default function Landing() {
  const features = [
    {
      icon: ClipboardList,
      title: "Work Order Management",
      description: "Create, assign, and track work orders with real-time status updates",
    },
    {
      icon: Smartphone,
      title: "Mobile Integration",
      description: "Sync work orders with mobile apps for field technicians",
    },
    {
      icon: Shield,
      title: "Role-Based Access",
      description: "Control who can view, edit, or manage work orders",
    },
    {
      icon: FileUp,
      title: "Data Import",
      description: "Import work orders from CSV or JSON files",
    },
    {
      icon: Users,
      title: "Customer Portal",
      description: "Customers can view completed work orders for their projects",
    },
    {
      icon: BarChart3,
      title: "Admin Dashboard",
      description: "Comprehensive tools for user and system management",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            <span className="text-xl font-semibold">WorkFlow Pro</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href="/api/login">
              <Button data-testid="button-login">Log In</Button>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
              Streamline Your Field Operations
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Manage work orders efficiently with our comprehensive platform. 
              Track progress, assign tasks, and sync with mobile teams seamlessly.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <a href="/api/login">
                <Button size="lg" data-testid="button-get-started">
                  Get Started
                </Button>
              </a>
              <Button variant="outline" size="lg" data-testid="button-learn-more">
                Learn More
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 px-6 bg-muted/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">
              Everything You Need
            </h2>
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
                    <CardDescription className="text-sm">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
            <p className="text-muted-foreground mb-8">
              Join thousands of teams already using WorkFlow Pro to manage their operations.
            </p>
            <a href="/api/login">
              <Button size="lg" data-testid="button-start-free">
                Start Free Trial
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span>WorkFlow Pro</span>
          </div>
          <p>Powered by enterprise-grade infrastructure</p>
        </div>
      </footer>
    </div>
  );
}
