import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import html2pdf from "html2pdf.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Server, Smartphone, ChevronLeft, Download, Globe } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

type DocType = "windows-deployment" | "mobile-api" | "customer-api" | null;

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
  {
    id: "customer-api" as DocType,
    title: "Customer API Integration",
    description: "Configure outbound API calls to push work order data to customer backend systems.",
    icon: Globe,
  },
];

export default function Documentation() {
  const [selectedDoc, setSelectedDoc] = useState<DocType>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: docContent, isLoading, error } = useQuery<string>({
    queryKey: [`/api/documentation/${selectedDoc}`],
    enabled: !!selectedDoc,
  });

  const handleDownloadPdf = async () => {
    if (!contentRef.current || !selectedDoc) return;
    
    setIsDownloading(true);
    try {
      const selectedDocInfo = docOptions.find((d) => d.id === selectedDoc);
      const filename = `${selectedDocInfo?.title || "Documentation"}.pdf`;
      
      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
      };
      
      await html2pdf().set(opt).from(contentRef.current).save();
      
      toast({
        title: "PDF Downloaded",
        description: `${filename} has been saved to your downloads.`,
      });
    } catch (err) {
      console.error("PDF download error:", err);
      toast({
        title: "Download Failed",
        description: "Failed to generate PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

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
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
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
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadPdf}
          disabled={isDownloading || isLoading || !!error}
          data-testid="button-download-pdf"
        >
          <Download className="h-4 w-4 mr-2" />
          {isDownloading ? "Generating PDF..." : "Download PDF"}
        </Button>
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
              <div ref={contentRef}>
                <article className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-doc-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {docContent || ""}
                  </ReactMarkdown>
                </article>
              </div>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  );
}
