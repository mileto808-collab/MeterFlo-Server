import { useState } from "react";
import html2pdf from "html2pdf.js";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface WorkOrderPdfProps {
  workOrder: any;
  projectId: string | number;
  workOrderFiles: string[];
  formatDateTime: (date: string | Date) => string;
  getAssignedUserName: (userId: string | null | undefined) => string | null;
  serviceTypes: Array<{ id: number; code: string; label: string }>;
  troubleCodes: Array<{ id: number; code: string; label: string }>;
}

type PhotoOption = "thumbnails" | "list" | "none";

export function WorkOrderPdf({
  workOrder,
  projectId,
  workOrderFiles,
  formatDateTime,
  getAssignedUserName,
  serviceTypes,
  troubleCodes,
}: WorkOrderPdfProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [photoOption, setPhotoOption] = useState<PhotoOption>("thumbnails");

  const getServiceTypeLabel = (code: string | null | undefined) => {
    if (!code) return "-";
    const st = serviceTypes.find((s) => s.code === code);
    return st ? st.label : code;
  };

  const getTroubleLabel = (code: string | null | undefined) => {
    if (!code) return "-";
    const tc = troubleCodes.find((t) => t.code === code);
    return tc ? `${tc.code} - ${tc.label}` : code;
  };

  const imageFiles = workOrderFiles.filter((f) => {
    const ext = f.toLowerCase().split(".").pop();
    return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext || "");
  });

  const buildPdfContent = (selectedPhotoOption: PhotoOption): string => {
    const woId = workOrder.customerWoId || `WO-${workOrder.id}`;
    
    let photosHtml = "";
    if (selectedPhotoOption === "thumbnails" && imageFiles.length > 0) {
      const thumbnailsHtml = imageFiles.slice(0, 6).map((filename) => `
        <div style="text-align: center; display: inline-block; margin: 5px;">
          <img
            src="${window.location.origin}/api/projects/${projectId}/work-orders/${workOrder.id}/files/${encodeURIComponent(filename)}/download?mode=view"
            alt="${filename}"
            style="width: 120px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid #ccc;"
            crossorigin="anonymous"
          />
          <p style="margin: 4px 0 0 0; font-size: 9px; color: #666; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${filename}
          </p>
        </div>
      `).join("");
      
      const moreText = imageFiles.length > 6 ? `<p style="font-size: 10px; color: #666; margin-top: 10px;">+${imageFiles.length - 6} more photos</p>` : "";
      
      photosHtml = `
        <div style="margin-bottom: 15px;">
          <h3 style="margin: 0 0 10px 0; font-size: 13px; font-weight: bold; color: #333;">Captured Photos</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${thumbnailsHtml}
          </div>
          ${moreText}
        </div>
      `;
    } else if (selectedPhotoOption === "list" && imageFiles.length > 0) {
      const listHtml = imageFiles.map((filename, index) => `
        <li style="margin: 2px 0; font-size: 11px;">${index + 1}. ${filename}</li>
      `).join("");
      
      photosHtml = `
        <div style="margin-bottom: 15px;">
          <h3 style="margin: 0 0 10px 0; font-size: 13px; font-weight: bold; color: #333;">Attached Photos (${imageFiles.length})</h3>
          <ul style="margin: 0; padding-left: 20px;">
            ${listHtml}
          </ul>
        </div>
      `;
    }

    const signatureHtml = (workOrder.signatureData || workOrder.signatureName) ? `
      <div style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">Signature</h3>
        ${workOrder.signatureData ? `
          <div style="margin-bottom: 8px;">
            <img
              src="${workOrder.signatureData}"
              alt="Signature"
              style="max-width: 200px; max-height: 80px; border: 1px solid #ccc;"
            />
          </div>
        ` : ""}
        ${workOrder.signatureName ? `
          <p style="margin: 0; font-size: 11px;">
            <strong>Signed by:</strong> ${workOrder.signatureName}
          </p>
        ` : ""}
      </div>
    ` : "";

    const notesHtml = workOrder.notes ? `
      <div style="background-color: #fff9e6; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">Notes</h3>
        <p style="margin: 0; white-space: pre-wrap; font-size: 11px;">${workOrder.notes}</p>
      </div>
    ` : "";

    return `
      <div id="pdf-content" style="width: 190mm; padding: 10mm; background-color: white; color: black; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.4;">
        <div style="margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
          <h1 style="margin: 0; font-size: 22px; font-weight: bold;">Work Order Report</h1>
          <p style="margin: 5px 0 0 0; color: #666;">
            ${woId} | Generated: ${new Date().toLocaleString()}
          </p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
          <tbody>
            <tr>
              <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                <div style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
                  <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">Customer Information</h3>
                  <table style="width: 100%; font-size: 11px;">
                    <tbody>
                      <tr>
                        <td style="font-weight: bold; width: 100px; padding: 2px 0;">Customer ID:</td>
                        <td style="padding: 2px 0;">${workOrder.customerId || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Name:</td>
                        <td style="padding: 2px 0;">${workOrder.customerName || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Address:</td>
                        <td style="padding: 2px 0;">${workOrder.address || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">City/State/Zip:</td>
                        <td style="padding: 2px 0;">
                          ${[workOrder.city, workOrder.state, workOrder.zip].filter(Boolean).join(", ") || "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Phone:</td>
                        <td style="padding: 2px 0;">${workOrder.phone || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Email:</td>
                        <td style="padding: 2px 0;">${workOrder.email || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Route:</td>
                        <td style="padding: 2px 0;">${workOrder.route || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Zone:</td>
                        <td style="padding: 2px 0;">${workOrder.zone || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td style="width: 50%; vertical-align: top; padding-left: 10px;">
                <div style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
                  <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">Work Order Details</h3>
                  <table style="width: 100%; font-size: 11px;">
                    <tbody>
                      <tr>
                        <td style="font-weight: bold; width: 100px; padding: 2px 0;">Status:</td>
                        <td style="padding: 2px 0;">${workOrder.status || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Service Type:</td>
                        <td style="padding: 2px 0;">${getServiceTypeLabel(workOrder.serviceType)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Priority:</td>
                        <td style="padding: 2px 0;">${workOrder.priority || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Trouble Code:</td>
                        <td style="padding: 2px 0;">${getTroubleLabel(workOrder.trouble)}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Assigned To:</td>
                        <td style="padding: 2px 0;">
                          ${(workOrder as any).assignedUserDisplay || getAssignedUserName(workOrder.assignedUserId) || "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Scheduled:</td>
                        <td style="padding: 2px 0;">
                          ${workOrder.scheduledAt ? formatDateTime(workOrder.scheduledAt) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Completed:</td>
                        <td style="padding: 2px 0;">
                          ${workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Completed By:</td>
                        <td style="padding: 2px 0;">
                          ${(workOrder as any).completedByDisplay || getAssignedUserName((workOrder as any).completedBy) || "-"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
          <tbody>
            <tr>
              <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                <div style="background-color: #e8f4f8; padding: 10px; border-radius: 4px;">
                  <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">Old System</h3>
                  <table style="width: 100%; font-size: 11px;">
                    <tbody>
                      <tr>
                        <td style="font-weight: bold; width: 100px; padding: 2px 0;">System ID:</td>
                        <td style="padding: 2px 0;">${workOrder.oldSystemId || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Reading:</td>
                        <td style="padding: 2px 0;">${workOrder.oldSystemReading ?? "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Type:</td>
                        <td style="padding: 2px 0;">${workOrder.oldSystemType || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">GPS:</td>
                        <td style="padding: 2px 0;">${workOrder.oldGps || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td style="width: 50%; vertical-align: top; padding-left: 10px;">
                <div style="background-color: #e8f8e8; padding: 10px; border-radius: 4px;">
                  <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #333;">New System</h3>
                  <table style="width: 100%; font-size: 11px;">
                    <tbody>
                      <tr>
                        <td style="font-weight: bold; width: 100px; padding: 2px 0;">System ID:</td>
                        <td style="padding: 2px 0;">${workOrder.newSystemId || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Reading:</td>
                        <td style="padding: 2px 0;">${workOrder.newSystemReading ?? "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">Type:</td>
                        <td style="padding: 2px 0;">${workOrder.newSystemType || "-"}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: bold; padding: 2px 0;">GPS:</td>
                        <td style="padding: 2px 0;">${workOrder.newGps || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        ${notesHtml}
        ${signatureHtml}
        ${photosHtml}

        <div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 15px;">
          <table style="width: 100%; font-size: 10px; color: #666;">
            <tbody>
              <tr>
                <td>Created: ${workOrder.createdAt ? formatDateTime(workOrder.createdAt) : "-"} by ${workOrder.createdBy || "-"}</td>
                <td style="text-align: right;">
                  Last Updated: ${workOrder.updatedAt ? formatDateTime(workOrder.updatedAt) : "-"} by ${workOrder.updatedBy || "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  const renderPdfInIframe = async (htmlContent: string, filename: string): Promise<void> => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-pdf-overlay", "true");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.95);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: Arial, sans-serif;
      font-size: 16px;
    `;
    overlay.innerHTML = `
      <div style="text-align: center;">
        <div style="margin-bottom: 12px;">
          <svg style="animation: spin 1s linear infinite; width: 32px; height: 32px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
          </svg>
        </div>
        <div>Generating PDF...</div>
      </div>
      <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-pdf-iframe", "true");
    iframe.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 210mm;
      height: 297mm;
      border: 0;
      background: white;
      z-index: 2147483645;
      pointer-events: none;
    `;
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error("Could not access iframe document");
      }

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              * { box-sizing: border-box; }
              body { margin: 0; padding: 0; background: white; }
            </style>
          </head>
          <body>${htmlContent}</body>
        </html>
      `);
      iframeDoc.close();

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      if (iframeDoc.fonts) {
        await iframeDoc.fonts.ready;
      }

      const images = iframeDoc.querySelectorAll("img");
      if (images.length > 0) {
        await Promise.all(
          Array.from(images).map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) {
                  resolve();
                } else {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                }
              })
          )
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      const contentElement = iframeDoc.getElementById("pdf-content");
      if (!contentElement) {
        throw new Error("PDF content element not found in iframe");
      }

      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename,
        image: { type: "jpeg" as const, quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };

      await html2pdf().set(opt).from(contentElement).save();
    } finally {
      const existingOverlay = document.body.querySelector('[data-pdf-overlay]');
      const existingIframe = document.body.querySelector('[data-pdf-iframe]');
      if (existingOverlay) document.body.removeChild(existingOverlay);
      if (existingIframe) document.body.removeChild(existingIframe);
    }
  };

  const handleGeneratePdf = async () => {
    setIsGenerating(true);
    setShowDialog(false);

    try {
      const woId = workOrder.customerWoId || `WO-${workOrder.id}`;
      const filename = `WorkOrder_${woId}.pdf`;
      const htmlContent = buildPdfContent(photoOption);
      
      await renderPdfInIframe(htmlContent, filename);
    } catch (err) {
      console.error("PDF generation error:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenDialog = () => {
    setShowDialog(true);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleOpenDialog}
        disabled={isGenerating}
        data-testid="button-print-pdf"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Printer className="mr-2 h-4 w-4" />
            Print PDF
          </>
        )}
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PDF Options</DialogTitle>
            <DialogDescription>
              Choose how photos should be included in the PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <RadioGroup
              value={photoOption}
              onValueChange={(value) => setPhotoOption(value as PhotoOption)}
              className="space-y-3"
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="thumbnails" id="thumbnails" data-testid="radio-thumbnails" />
                <Label htmlFor="thumbnails" className="cursor-pointer">
                  Include photo thumbnails (up to 6 images embedded)
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="list" id="list" data-testid="radio-list" />
                <Label htmlFor="list" className="cursor-pointer">
                  Include photo list only (filenames listed)
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="none" id="none" data-testid="radio-none" />
                <Label htmlFor="none" className="cursor-pointer">
                  Exclude photos
                </Label>
              </div>
            </RadioGroup>

            {imageFiles.length > 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                This work order has {imageFiles.length} photo{imageFiles.length !== 1 ? "s" : ""} attached.
              </p>
            )}
            {imageFiles.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No photos are attached to this work order.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-pdf">
              Cancel
            </Button>
            <Button type="button" onClick={handleGeneratePdf} data-testid="button-generate-pdf">
              <Printer className="mr-2 h-4 w-4" />
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
