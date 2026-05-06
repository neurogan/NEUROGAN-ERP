import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatQty } from "@/lib/formatQty";
import { formatDate } from "@/lib/formatDate";
import type {
  ProductionBatchWithDetails,
  MmrWithSteps,
} from "@shared/schema";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatPerUnit(total: number, units: number): string {
  if (units === 0) return "0";
  const perUnit = total / units;
  return formatQty(perUnit);
}

export default function BatchPrint() {
  const [, params] = useRoute("/production/print/:id");
  const batchId = params?.id;

  const {
    data: batch,
    isLoading: batchLoading,
    error: batchError,
  } = useQuery<ProductionBatchWithDetails>({
    queryKey: ["/api/production-batches", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/production-batches/${batchId}`);
      return res.json();
    },
  });

  const {
    data: mmrs,
    isLoading: mmrsLoading,
  } = useQuery<MmrWithSteps[]>({
    queryKey: ["/api/mmrs", { productId: batch?.productId, status: "APPROVED" }],
    enabled: !!batch?.productId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mmrs?productId=${batch!.productId}&status=APPROVED`);
      return res.json();
    },
  });

  const mmr = mmrs && mmrs.length > 0 ? mmrs[0] : null;
  const isLoading = batchLoading || mmrsLoading;

  const triggerPrint = () => {
    // Clone the print content and open in a new window to bypass iframe restrictions
    const printContent = document.getElementById('print-content');
    if (!printContent) return;
    const printWindow = window.open('', '_blank', 'width=800,height=1100');
    if (!printWindow) {
      // Fallback: try window.print() directly
      try { window.print(); } catch(e) { alert('Please use Ctrl+P / Cmd+P to print.'); }
      return;
    }
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Batch ${batch?.batchNumber || ''}</title><style>@page{size:A4;margin:15mm}body{font-family:Inter,system-ui,sans-serif;color:#111;margin:0;padding:20px}</style></head><body>`);
    printWindow.document.write(printContent.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 400);
  };

  if (!batchId) {
    return (
      <div style={styles.errorContainer}>
        <p style={{ fontSize: "18px", color: "#333" }}>Batch not found</p>
        <button onClick={() => window.history.back()} style={styles.backBtn}>
          &larr; Go Back
        </button>
      </div>
    );
  }

  if (batchError) {
    return (
      <div style={styles.errorContainer}>
        <p style={{ fontSize: "18px", color: "#333" }}>Batch not found</p>
        <button onClick={() => window.history.back()} style={styles.backBtn}>
          &larr; Go Back
        </button>
      </div>
    );
  }

  if (isLoading || !batch) {
    return (
      <div style={styles.loadingContainer}>
        <p style={{ fontSize: "16px", color: "#666" }}>Loading batch data...</p>
      </div>
    );
  }

  const plannedQty = Number(batch.plannedQuantity) || 0;
  const recipeLines = mmr?.components ?? [];
  const notesLines = batch.notes
    ? batch.notes.split("\n").filter((line: string) => line.trim() !== "")
    : [];

  const today = formatDate(new Date());

  return (
    <>
      <style>{printStyles}</style>
      <div style={styles.page}>
        {/* No-print toolbar */}
        <div className="no-print" style={styles.toolbar}>
          <button onClick={() => window.history.back()} style={styles.toolbarBtn}>
            &larr; Back
          </button>
          <button onClick={triggerPrint} style={styles.toolbarPrintBtn}>
            Print
          </button>
        </div>

        {/* Printable content */}
        <div id="print-content">
        {/* Section 1: Header */}
        <div style={styles.headerBorder}>
          <h1 style={styles.productTitle}>{batch.productName}</h1>
        </div>
        <div style={styles.headerInfo}>
          <div style={styles.batchInfo}>
            Neurogan Health Batch#{batch.batchNumber} {formatDate(batch.startDate)}
          </div>
          <div style={styles.unitsLine}>
            For {formatNumber(plannedQty)} units
          </div>
        </div>

        {/* Section 2: Notes + LOT/EXP */}
        {(notesLines.length > 0 || batch.outputLotNumber) && (
          <div style={styles.notesSection}>
            {notesLines.length > 0 && (
              <ul style={styles.notesList}>
                {notesLines.map((line: string, i: number) => (
                  <li key={i} style={styles.notesItem}>{line.trim()}</li>
                ))}
              </ul>
            )}
            {batch.outputLotNumber && (
              <div style={styles.lotExpLine}>
                LOT#{batch.outputLotNumber}{" "}
                EXP:{batch.outputExpirationDate ?? "N/A"}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Materials (two-column) */}
        {recipeLines.length > 0 && (
          <div style={styles.materialsSection}>
            <h2 style={styles.sectionHeading}>Materials</h2>
            <table style={styles.materialsTable}>
              <thead>
                <tr>
                  <th style={styles.materialThLeft}>#</th>
                  <th style={styles.materialThLeft}>Material</th>
                  <th style={{ ...styles.materialThLeft, textAlign: "right" as const }}>Qty Needed</th>
                  <th style={styles.materialThLeft}>LOT#</th>
                </tr>
              </thead>
              <tbody>
                {recipeLines.map((line, idx) => {
                  const totalQty = Number(line.quantity) * plannedQty;
                  const matchingInput = batch.inputs.find(
                    (inp) => inp.productId === line.productId
                  );
                  return (
                    <tr key={line.productId + idx}>
                      <td style={styles.materialTd}>{idx + 1}.</td>
                      <td style={styles.materialTd}>
                        {line.productName}{" "}
                        <span style={{ color: "#888", fontSize: "12px" }}>
                          = {formatQty(totalQty)} {line.uom}
                        </span>
                      </td>
                      <td style={{ ...styles.materialTd, textAlign: "right" as const, fontFamily: "monospace" }}>
                        {formatQty(totalQty)} {line.uom}
                      </td>
                      <td style={styles.materialTd}>
                        {matchingInput
                          ? `LOT# ${matchingInput.lotNumber}`
                          : "LOT# _________________"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 4: Signature Lines */}
        <div style={styles.signaturesSection}>
          <div style={styles.signatureLine}>
            <strong>Prepared By:</strong> ________________________________
          </div>
          <div style={styles.signatureLine}>
            <strong>Validated By:</strong> ________________________________
          </div>
          <div style={styles.signatureLine}>
            <strong>Approved By (QC):</strong> ________________________________
          </div>
        </div>

        {/* Section 5: Per-Unit Calculation */}
        {recipeLines.length > 0 && plannedQty > 0 && (
          <div style={styles.perUnitSection}>
            <div style={styles.perUnitHeading}>Per-unit breakdown:</div>
            {recipeLines.map((line, idx) => {
              const totalQty = Number(line.quantity) * plannedQty;
              const perUnit = totalQty / plannedQty;
              const perUnitFormatted = formatPerUnit(totalQty, plannedQty);
              const uomLower = line.uom.toLowerCase();
              const showMg = uomLower === "g";
              const mgPerUnit = showMg ? perUnit * 1000 : null;
              return (
                <div key={line.productId + idx} style={styles.perUnitLine}>
                  &bull; {line.productName} = {formatQty(totalQty)} {line.uom} &divide; {formatNumber(plannedQty)} = {perUnitFormatted} {line.uom}/unit
                  {showMg && mgPerUnit !== null && (
                    <span> ({formatQty(mgPerUnit)} mg/unit)</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Section 6: Footer */}
        <div style={styles.footer}>
          Generated from Neurogan Inventory System &middot; {today}
        </div>
        </div>{/* end print-content */}
      </div>
    </>
  );
}

const printStyles = `
  @page {
    size: A4;
    margin: 15mm;
  }
  @media print {
    .no-print {
      display: none !important;
    }
    body {
      background: #fff !important;
      color: #000 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
  /* Force light mode for the print page */
  html, body {
    background: #fff !important;
  }
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: "210mm",
    margin: "0 auto",
    padding: "20px 24px",
    fontFamily: "Inter, -apple-system, sans-serif",
    color: "#000",
    backgroundColor: "#fff",
    minHeight: "100vh",
    fontSize: "14px",
    lineHeight: "1.5",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "24px",
    paddingBottom: "12px",
    borderBottom: "1px solid #eee",
  },
  toolbarBtn: {
    padding: "8px 16px",
    fontSize: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    backgroundColor: "#fff",
    color: "#333",
    cursor: "pointer",
  },
  toolbarPrintBtn: {
    padding: "8px 20px",
    fontSize: "14px",
    border: "none",
    borderRadius: "6px",
    backgroundColor: "#4a7c3f",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  headerBorder: {
    textAlign: "center" as const,
    borderBottom: "1px solid #333",
    paddingBottom: "12px",
  },
  productTitle: {
    fontFamily: "Georgia, serif",
    fontStyle: "italic",
    fontSize: "22px",
    margin: 0,
    color: "#000",
    fontWeight: "normal",
  },
  headerInfo: {
    textAlign: "center" as const,
    marginTop: "16px",
  },
  batchInfo: {
    fontSize: "16px",
    color: "#000",
  },
  unitsLine: {
    fontSize: "28px",
    fontWeight: "bold",
    color: "#4a7c3f",
    marginTop: "8px",
  },
  notesSection: {
    marginTop: "24px",
    padding: "12px 16px",
    backgroundColor: "#f9f9f9",
    borderRadius: "4px",
    border: "1px solid #e5e5e5",
  },
  notesList: {
    margin: "0 0 8px 0",
    paddingLeft: "20px",
    color: "#000",
  },
  notesItem: {
    marginBottom: "4px",
    fontSize: "13px",
    color: "#000",
  },
  lotExpLine: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#000",
    marginTop: "4px",
  },
  materialsSection: {
    marginTop: "24px",
  },
  sectionHeading: {
    fontSize: "16px",
    fontWeight: 600,
    marginBottom: "8px",
    color: "#000",
    borderBottom: "1px solid #ddd",
    paddingBottom: "4px",
  },
  materialsTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
  },
  materialThLeft: {
    textAlign: "left" as const,
    padding: "6px 8px",
    borderBottom: "2px solid #333",
    fontWeight: 600,
    color: "#000",
    fontSize: "12px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  materialTd: {
    padding: "6px 8px",
    borderBottom: "1px solid #e5e5e5",
    color: "#000",
    verticalAlign: "top" as const,
  },
  signaturesSection: {
    marginTop: "32px",
  },
  signatureLine: {
    marginBottom: "16px",
    fontSize: "14px",
    color: "#000",
  },
  perUnitSection: {
    marginTop: "28px",
    padding: "12px 16px",
    backgroundColor: "#f5f5f5",
    borderRadius: "4px",
    border: "1px solid #e5e5e5",
  },
  perUnitHeading: {
    fontSize: "12px",
    fontWeight: 600,
    marginBottom: "6px",
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  perUnitLine: {
    fontSize: "12px",
    color: "#333",
    lineHeight: "1.6",
  },
  footer: {
    marginTop: "24px",
    textAlign: "center" as const,
    fontSize: "10px",
    color: "#999",
    borderTop: "1px solid #ddd",
    paddingTop: "8px",
  },
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#fff",
  },
  errorContainer: {
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#fff",
    gap: "16px",
  },
  backBtn: {
    padding: "8px 16px",
    fontSize: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    backgroundColor: "#fff",
    color: "#333",
    cursor: "pointer",
  },
};
