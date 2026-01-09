import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Barcode, QrCode, FileDown, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import bwipjs from "bwip-js";

export interface WorkOrderData {
  customerWoId: string;
  address: string;
  oldSystemNumber: string | null;
  newSystemNumber?: string | null;
  oldModuleId?: string | null;
  newModuleId?: string | null;
}

const escapeHtml = (text: string): string => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

interface RouteSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrders: WorkOrderData[];
  projectName?: string;
}

export function RouteSheetDialog({
  open,
  onOpenChange,
  workOrders,
  projectName,
}: RouteSheetDialogProps) {
  const [codeType, setCodeType] = useState<"barcode" | "qrcode">("barcode");
  const [systemIdField, setSystemIdField] = useState<"old" | "new" | "oldModule" | "newModule">("old");
  const [isGenerating, setIsGenerating] = useState(false);

  const generateBarcode = async (text: string): Promise<string> => {
    if (!text) return "";
    try {
      const canvas = document.createElement("canvas");
      bwipjs.toCanvas(canvas, {
        bcid: "code128",
        text: text,
        scale: 2,
        height: 8,
        includetext: true,
        textxalign: "center",
        textsize: 8,
      });
      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Error generating barcode:", error);
      return "";
    }
  };

  const generateQRCode = async (text: string): Promise<string> => {
    if (!text) return "";
    try {
      return await QRCode.toDataURL(text, {
        width: 80,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    } catch (error) {
      console.error("Error generating QR code:", error);
      return "";
    }
  };

  const generateRouteSheetPDF = async () => {
    if (workOrders.length === 0) return;

    setIsGenerating(true);

    try {
      const codeImages: { wo: WorkOrderData; codeImage: string }[] = [];

      for (const wo of workOrders) {
        let idValue: string;
        if (systemIdField === "old") {
          idValue = wo.oldSystemNumber || "N/A";
        } else if (systemIdField === "new") {
          idValue = wo.newSystemNumber || "N/A";
        } else if (systemIdField === "oldModule") {
          idValue = wo.oldModuleId || "N/A";
        } else {
          idValue = wo.newModuleId || "N/A";
        }
        const codeImage =
          codeType === "barcode"
            ? await generateBarcode(idValue !== "N/A" ? idValue : "")
            : await generateQRCode(idValue !== "N/A" ? idValue : "");
        codeImages.push({ wo, codeImage });
      }

      const columnsPerRow = 3;
      const cellWidth = 240;
      const cellHeight = codeType === "barcode" ? 120 : 140;
      const cellPadding = 10;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        throw new Error("Could not open print window");
      }

      const rows: string[] = [];
      const systemIdLabel = systemIdField === "old" ? "Old System ID" 
        : systemIdField === "new" ? "New System ID"
        : systemIdField === "oldModule" ? "Old Module ID"
        : "New Module ID";
      for (let i = 0; i < codeImages.length; i += columnsPerRow) {
        const rowItems = codeImages.slice(i, i + columnsPerRow);
        const cells = rowItems
          .map(({ wo, codeImage }) => {
            let idValue: string | null | undefined;
            if (systemIdField === "old") {
              idValue = wo.oldSystemNumber;
            } else if (systemIdField === "new") {
              idValue = wo.newSystemNumber;
            } else if (systemIdField === "oldModule") {
              idValue = wo.oldModuleId;
            } else {
              idValue = wo.newModuleId;
            }
            const idDisplay = escapeHtml(idValue || "N/A");
            const escapedWoId = escapeHtml(wo.customerWoId);
            const escapedAddress = escapeHtml(wo.address || "No address");
            return `
            <td style="width: ${cellWidth}px; height: ${cellHeight}px; padding: ${cellPadding}px; border: 1px solid #ddd; vertical-align: top; text-align: center;">
              <div style="font-weight: bold; font-size: 12px; margin-bottom: 4px;">WO ID: ${escapedWoId}</div>
              <div style="font-size: 11px; color: #333; margin-bottom: 4px; min-height: 14px;">${escapedAddress}</div>
              ${
                codeImage
                  ? `<img src="${codeImage}" style="max-width: ${cellWidth - 20}px; max-height: ${codeType === "barcode" ? 50 : 70}px;" />`
                  : `<div style="font-size: 10px; color: #999; padding: 10px;">No ${systemIdField.includes("Module") ? "module" : "system"} ID</div>`
              }
              ${codeType === "qrcode" && idValue ? `<div style="font-size: 9px; color: #666; margin-top: 2px;">${idDisplay}</div>` : ""}
            </td>
          `;
          })
          .join("");

        const emptyCells = Array(columnsPerRow - rowItems.length)
          .fill(`<td style="width: ${cellWidth}px; height: ${cellHeight}px; border: 1px solid transparent;"></td>`)
          .join("");

        rows.push(`<tr>${cells}${emptyCells}</tr>`);
      }

      const dateStr = new Date().toLocaleDateString();
      const escapedProjectName = projectName ? escapeHtml(projectName) : "";
      const projectTitle = escapedProjectName ? ` - ${escapedProjectName}` : "";

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Route Sheet${projectTitle}</title>
            <style>
              @media print {
                body { margin: 0; padding: 10px; }
                .no-print { display: none !important; }
                table { page-break-inside: auto; }
                tr { page-break-inside: avoid; page-break-after: auto; }
              }
              body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
                background: white;
              }
              .header {
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid #333;
              }
              .header h1 {
                margin: 0 0 5px 0;
                font-size: 24px;
              }
              .header p {
                margin: 0;
                color: #666;
                font-size: 12px;
              }
              table {
                border-collapse: collapse;
                width: 100%;
                margin: 0 auto;
              }
              .print-btn {
                position: fixed;
                top: 10px;
                right: 10px;
                padding: 10px 20px;
                background: #0066cc;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
              }
              .print-btn:hover {
                background: #0055aa;
              }
            </style>
          </head>
          <body>
            <button class="print-btn no-print" onclick="window.print()">Print Route Sheet</button>
            <div class="header">
              <h1>Route Sheet${projectTitle}</h1>
              <p>Generated: ${dateStr} | Total Work Orders: ${workOrders.length} | Code Type: ${codeType === "barcode" ? "Barcode" : "QR Code"} | System ID: ${systemIdLabel}</p>
            </div>
            <table>
              ${rows.join("")}
            </table>
          </body>
        </html>
      `);

      printWindow.document.close();
      onOpenChange(false);
    } catch (error) {
      console.error("Error generating route sheet:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Route Sheet</DialogTitle>
          <DialogDescription>
            Choose the system ID field and code type. The route sheet will include 
            {workOrders.length} work order{workOrders.length !== 1 ? "s" : ""} with WO ID, address, and 
            your selected system ID encoded as barcodes or QR codes.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">System ID Field</Label>
            <RadioGroup
              value={systemIdField}
              onValueChange={(value) => setSystemIdField(value as "old" | "new" | "oldModule" | "newModule")}
              className="grid grid-cols-2 gap-2"
            >
              <div>
                <RadioGroupItem
                  value="old"
                  id="system-old"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="system-old"
                  className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-system-old"
                >
                  <span className="font-medium text-sm">Old System ID</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="new"
                  id="system-new"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="system-new"
                  className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-system-new"
                >
                  <span className="font-medium text-sm">New System ID</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="oldModule"
                  id="system-old-module"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="system-old-module"
                  className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-module-old"
                >
                  <span className="font-medium text-sm">Old Module ID</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="newModule"
                  id="system-new-module"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="system-new-module"
                  className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-module-new"
                >
                  <span className="font-medium text-sm">New Module ID</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Code Type</Label>
            <RadioGroup
              value={codeType}
              onValueChange={(value) => setCodeType(value as "barcode" | "qrcode")}
              className="grid grid-cols-2 gap-4"
            >
              <div>
                <RadioGroupItem
                  value="barcode"
                  id="barcode"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="barcode"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-barcode"
                >
                  <Barcode className="mb-3 h-8 w-8" />
                  <span className="font-medium">Barcodes</span>
                  <span className="text-xs text-muted-foreground mt-1">Code 128 format</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="qrcode"
                  id="qrcode"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="qrcode"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="radio-qrcode"
                >
                  <QrCode className="mb-3 h-8 w-8" />
                  <span className="font-medium">QR Codes</span>
                  <span className="text-xs text-muted-foreground mt-1">Scannable squares</span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
            data-testid="button-cancel-route-sheet"
          >
            Cancel
          </Button>
          <Button
            onClick={generateRouteSheetPDF}
            disabled={isGenerating || workOrders.length === 0}
            data-testid="button-generate-route-sheet"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileDown className="mr-2 h-4 w-4" />
                Generate PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
