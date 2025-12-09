import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Users, Shield, Smartphone, FileUp, BarChart3, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast({
        title: "Error",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/local/login", { username, password });
      window.location.href = "/";
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

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
          <ThemeToggle />
        </div>
      </header>

      <main>
        <section className="py-16 px-6">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                Streamline Your Field Operations
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                Manage work orders efficiently with our comprehensive platform. 
                Track progress, assign tasks, and sync with mobile teams seamlessly.
              </p>
            </div>
            
            <Card className="max-w-md mx-auto w-full">
              <CardHeader>
                <CardTitle>Sign In</CardTitle>
                <CardDescription>
                  Enter your credentials to access the system
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Enter username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      data-testid="input-username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-password"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                    data-testid="button-login-submit"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>
                
                <a href="/api/login" className="block">
                  <Button variant="outline" className="w-full" data-testid="button-login-replit">
                    Sign in with Replit
                  </Button>
                </a>
              </CardContent>
            </Card>
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
