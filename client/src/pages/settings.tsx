import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Moon, Sun, User, Shield, FolderOpen, Save, FileUp } from "lucide-react";

interface FileSettings {
  maxFileSizeMB: number;
  allowedExtensions: string;
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { toast } = useToast();
  const [projectFilesPath, setProjectFilesPath] = useState("");
  const [maxFileSizeMB, setMaxFileSizeMB] = useState("100");
  const [allowedExtensions, setAllowedExtensions] = useState("");

  const { data: pathData } = useQuery<{ path: string }>({
    queryKey: ["/api/settings/project-files-path"],
    enabled: user?.role === "admin",
  });

  const { data: fileSettingsData } = useQuery<FileSettings>({
    queryKey: ["/api/settings/file-settings"],
    enabled: user?.role === "admin",
  });

  useEffect(() => {
    if (pathData?.path) {
      setProjectFilesPath(pathData.path);
    }
  }, [pathData]);

  useEffect(() => {
    if (fileSettingsData) {
      setMaxFileSizeMB(String(fileSettingsData.maxFileSizeMB || 100));
      setAllowedExtensions(fileSettingsData.allowedExtensions || "");
    }
  }, [fileSettingsData]);

  const updatePathMutation = useMutation({
    mutationFn: async (path: string) => {
      return apiRequest("PUT", "/api/settings/project-files-path", { path });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/project-files-path"] });
      toast({ title: "Project files path updated" });
    },
    onError: () => {
      toast({ title: "Failed to update path", variant: "destructive" });
    },
  });

  const updateFileSettingsMutation = useMutation({
    mutationFn: async (data: { maxFileSizeMB: number; allowedExtensions: string }) => {
      return apiRequest("PUT", "/api/settings/file-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/file-settings"] });
      toast({ title: "File settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update file settings", variant: "destructive" });
    },
  });

  const getInitials = () => {
    if (user?.firstName && user?.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    if (user?.username) return user.username[0].toUpperCase();
    if (user?.email) return user.email[0].toUpperCase();
    return "U";
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.profileImageUrl || undefined} className="object-cover" />
                <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-lg" data-testid="text-user-name">
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}` 
                    : user?.username || "User"}
                </p>
                <p className="text-muted-foreground" data-testid="text-user-email">{user?.email || "No email"}</p>
                <Badge variant="secondary" className="mt-2 capitalize" data-testid="badge-role">{user?.role || "user"}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sun className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Appearance</CardTitle>
            </div>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => setTheme("light")}
                className="flex-1"
                data-testid="button-theme-light"
              >
                <Sun className="h-4 w-4 mr-2" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => setTheme("dark")}
                className="flex-1"
                data-testid="button-theme-dark"
              >
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </Button>
            </div>
          </CardContent>
        </Card>

        {user?.role === "admin" && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Project Files Directory</CardTitle>
                </div>
                <CardDescription>Configure the root directory where project files are stored</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="project-files-path">Current Path</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      id="project-files-path"
                      value={projectFilesPath}
                      onChange={(e) => setProjectFilesPath(e.target.value)}
                      placeholder="Project Files"
                      className="flex-1"
                      data-testid="input-project-files-path"
                    />
                    <Button
                      onClick={() => updatePathMutation.mutate(projectFilesPath)}
                      disabled={!projectFilesPath.trim() || updatePathMutation.isPending || projectFilesPath === pathData?.path}
                      data-testid="button-save-path"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Files will be stored in: <code className="bg-muted px-1 rounded">{projectFilesPath || "Project Files"}/[project_name]_[id]/[work_order_id]/</code>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileUp className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>File Upload Settings</CardTitle>
                </div>
                <CardDescription>Configure file upload limits and allowed file types</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="max-file-size">Maximum File Size</Label>
                  <div className="flex gap-2 mt-2 items-center">
                    <Select
                      value={maxFileSizeMB}
                      onValueChange={setMaxFileSizeMB}
                    >
                      <SelectTrigger className="w-48" data-testid="select-max-file-size">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 MB</SelectItem>
                        <SelectItem value="25">25 MB</SelectItem>
                        <SelectItem value="50">50 MB</SelectItem>
                        <SelectItem value="100">100 MB</SelectItem>
                        <SelectItem value="250">250 MB</SelectItem>
                        <SelectItem value="500">500 MB</SelectItem>
                        <SelectItem value="1024">1 GB</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">per file</span>
                  </div>
                </div>

                <div>
                  <Label htmlFor="allowed-extensions">Allowed File Extensions</Label>
                  <Textarea
                    id="allowed-extensions"
                    value={allowedExtensions}
                    onChange={(e) => setAllowedExtensions(e.target.value)}
                    placeholder=".pdf, .doc, .docx, .xls, .xlsx, .jpg, .jpeg, .png, .gif, .txt, .csv"
                    className="mt-2"
                    rows={3}
                    data-testid="input-allowed-extensions"
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    Enter file extensions separated by commas. Leave empty to allow all file types.
                  </p>
                </div>

                <Button
                  onClick={() => updateFileSettingsMutation.mutate({
                    maxFileSizeMB: parseInt(maxFileSizeMB),
                    allowedExtensions: allowedExtensions.trim(),
                  })}
                  disabled={updateFileSettingsMutation.isPending}
                  data-testid="button-save-file-settings"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save File Settings
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium">Session</p>
                <p className="text-sm text-muted-foreground">You are currently logged in</p>
              </div>
              <a href="/api/logout">
                <Button variant="destructive" data-testid="button-logout-settings">Log Out</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
