import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Server, Smartphone, ChevronLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type DocType = "windows-deployment" | "mobile-api" | null;

const docOptions = [
  {
    id: "windows-deployment" as DocType,
    title: "Windows Deployment Guide",
    description: "Complete guide for deploying MeterFlo on a Windows server with XAMPP, PostgreSQL, and PM2.",
    icon: Server,
  },
  {
    id: "mobile-api" as DocType,
    title: "Mobile API Documentation",
    description: "REST API reference for mobile app integration, work order sync, and offline support.",
    icon: Smartphone,
  },
];

export default function Documentation() {
  const [selectedDoc, setSelectedDoc] = useState<DocType>(null);

  const { data: docContent, isLoading, error } = useQuery<string>({
    queryKey: [`/api/documentation/${selectedDoc}`],
    enabled: !!selectedDoc,
  });

  if (!selectedDoc) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" data-testid="text-documentation-title">Documentation</h1>
          <p className="text-muted-foreground">Access system documentation and technical guides.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
          {docOptions.map((doc) => (
            <Card
              key={doc.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedDoc(doc.id)}
              data-testid={`card-doc-${doc.id}`}
            >
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <doc.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{doc.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{doc.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const selectedDocInfo = docOptions.find((d) => d.id === selectedDoc);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4 flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedDoc(null)}
          data-testid="button-back-to-docs"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="text-doc-title">
            {selectedDocInfo?.title}
          </h1>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-[calc(100vh-200px)]">
          <CardContent className="p-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : error ? (
              <div className="text-destructive" data-testid="text-doc-error">
                Failed to load documentation. Please try again.
              </div>
            ) : (
              <article className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-doc-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {docContent || ""}
                </ReactMarkdown>
              </article>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  );
}
