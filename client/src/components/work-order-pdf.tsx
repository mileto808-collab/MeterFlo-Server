import { useRef, useState } from "react";
import html2pdf from "html2pdf.js";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";

interface WorkOrderPdfProps {
  workOrder: any;
  projectId: string | number;
  workOrderFiles: string[];
  formatDateTime: (date: string | Date) => string;
  getAssignedUserName: (userId: string | null | undefined) => string | null;
  serviceTypes: Array<{ id: number; code: string; label: string }>;
  troubleCodes: Array<{ id: number; code: string; label: string }>;
}

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
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleGeneratePdf = async () => {
    if (!contentRef.current) return;

    setIsGenerating(true);
    try {
      const woId = workOrder.customerWoId || `WO-${workOrder.id}`;
      const filename = `WorkOrder_${woId}.pdf`;

      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename,
        image: { type: "jpeg" as const, quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };

      await html2pdf().set(opt).from(contentRef.current).save();
    } catch (err) {
      console.error("PDF generation error:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleGeneratePdf}
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

      <div
        ref={contentRef}
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          width: "210mm",
          padding: "10mm",
          backgroundColor: "white",
          color: "black",
          fontFamily: "Arial, sans-serif",
          fontSize: "11px",
          lineHeight: "1.4",
        }}
      >
        <div style={{ marginBottom: "20px", borderBottom: "2px solid #333", paddingBottom: "10px" }}>
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: "bold" }}>Work Order Report</h1>
          <p style={{ margin: "5px 0 0 0", color: "#666" }}>
            {workOrder.customerWoId || `WO-${workOrder.id}`} | Generated: {new Date().toLocaleString()}
          </p>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px" }}>
          <tbody>
            <tr>
              <td style={{ width: "50%", verticalAlign: "top", paddingRight: "10px" }}>
                <div style={{ backgroundColor: "#f5f5f5", padding: "10px", borderRadius: "4px", marginBottom: "10px" }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Customer Information</h3>
                  <table style={{ width: "100%", fontSize: "11px" }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: "bold", width: "100px", padding: "2px 0" }}>Customer ID:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.customerId || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Name:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.customerName || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Address:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.address || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>City/State/Zip:</td>
                        <td style={{ padding: "2px 0" }}>
                          {[workOrder.city, workOrder.state, workOrder.zip].filter(Boolean).join(", ") || "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Phone:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.phone || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Email:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.email || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Route:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.route || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Zone:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.zone || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td style={{ width: "50%", verticalAlign: "top", paddingLeft: "10px" }}>
                <div style={{ backgroundColor: "#f5f5f5", padding: "10px", borderRadius: "4px", marginBottom: "10px" }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Work Order Details</h3>
                  <table style={{ width: "100%", fontSize: "11px" }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: "bold", width: "100px", padding: "2px 0" }}>Status:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.status || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Service Type:</td>
                        <td style={{ padding: "2px 0" }}>{getServiceTypeLabel(workOrder.serviceType)}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Priority:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.priority || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Trouble Code:</td>
                        <td style={{ padding: "2px 0" }}>{getTroubleLabel(workOrder.trouble)}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Assigned To:</td>
                        <td style={{ padding: "2px 0" }}>
                          {(workOrder as any).assignedUserDisplay || getAssignedUserName(workOrder.assignedUserId) || "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Scheduled:</td>
                        <td style={{ padding: "2px 0" }}>
                          {workOrder.scheduledAt ? formatDateTime(workOrder.scheduledAt) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Completed:</td>
                        <td style={{ padding: "2px 0" }}>
                          {workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "-"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Completed By:</td>
                        <td style={{ padding: "2px 0" }}>
                          {(workOrder as any).completedByDisplay || getAssignedUserName((workOrder as any).completedBy) || "-"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px" }}>
          <tbody>
            <tr>
              <td style={{ width: "50%", verticalAlign: "top", paddingRight: "10px" }}>
                <div style={{ backgroundColor: "#e8f4f8", padding: "10px", borderRadius: "4px" }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Old System</h3>
                  <table style={{ width: "100%", fontSize: "11px" }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: "bold", width: "100px", padding: "2px 0" }}>System ID:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.oldSystemId || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Reading:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.oldSystemReading ?? "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Type:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.oldSystemType || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>GPS:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.oldGps || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
              <td style={{ width: "50%", verticalAlign: "top", paddingLeft: "10px" }}>
                <div style={{ backgroundColor: "#e8f8e8", padding: "10px", borderRadius: "4px" }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>New System</h3>
                  <table style={{ width: "100%", fontSize: "11px" }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: "bold", width: "100px", padding: "2px 0" }}>System ID:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.newSystemId || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Reading:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.newSystemReading ?? "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>Type:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.newSystemType || "-"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", padding: "2px 0" }}>GPS:</td>
                        <td style={{ padding: "2px 0" }}>{workOrder.newGps || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {workOrder.notes && (
          <div style={{ backgroundColor: "#fff9e6", padding: "10px", borderRadius: "4px", marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Notes</h3>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "11px" }}>{workOrder.notes}</p>
          </div>
        )}

        {(workOrder.signatureData || workOrder.signatureName) && (
          <div style={{ backgroundColor: "#f5f5f5", padding: "10px", borderRadius: "4px", marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Signature</h3>
            {workOrder.signatureData && (
              <div style={{ marginBottom: "8px" }}>
                <img
                  src={workOrder.signatureData}
                  alt="Signature"
                  style={{ maxWidth: "200px", maxHeight: "80px", border: "1px solid #ccc" }}
                  crossOrigin="anonymous"
                />
              </div>
            )}
            {workOrder.signatureName && (
              <p style={{ margin: 0, fontSize: "11px" }}>
                <strong>Signed by:</strong> {workOrder.signatureName}
              </p>
            )}
          </div>
        )}

        {imageFiles.length > 0 && (
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: "bold", color: "#333" }}>Captured Photos</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {imageFiles.slice(0, 6).map((filename, index) => (
                <div key={index} style={{ textAlign: "center" }}>
                  <img
                    src={`/api/projects/${projectId}/work-orders/${workOrder.id}/files/${encodeURIComponent(filename)}/download?mode=view`}
                    alt={filename}
                    style={{
                      width: "120px",
                      height: "90px",
                      objectFit: "cover",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
                    crossOrigin="anonymous"
                  />
                  <p style={{ margin: "4px 0 0 0", fontSize: "9px", color: "#666", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {filename}
                  </p>
                </div>
              ))}
              {imageFiles.length > 6 && (
                <p style={{ fontSize: "10px", color: "#666", alignSelf: "center" }}>
                  +{imageFiles.length - 6} more photos
                </p>
              )}
            </div>
          </div>
        )}

        <div style={{ borderTop: "1px solid #ccc", paddingTop: "10px", marginTop: "15px" }}>
          <table style={{ width: "100%", fontSize: "10px", color: "#666" }}>
            <tbody>
              <tr>
                <td>Created: {workOrder.createdAt ? formatDateTime(workOrder.createdAt) : "-"} by {workOrder.createdBy || "-"}</td>
                <td style={{ textAlign: "right" }}>
                  Last Updated: {workOrder.updatedAt ? formatDateTime(workOrder.updatedAt) : "-"} by {workOrder.updatedBy || "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
