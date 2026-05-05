import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  getZebraPrinter,
  printLabels,
  type ZebraDevice,
  type BoxLabelData,
} from "@/lib/zebra-print";
import { useToast } from "@/hooks/use-toast";

const labelPrintStyles = `
  @page {
    size: 5in 7in;
    margin: 10mm;
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
`;

export interface PrintJob {
  componentName: string;
  supplierLotNumber: string;
  supplierName: string;
  poNumber: string;
  dateReceived: string;
  receivingUniqueId: string;
  boxes: { boxLabel: string; boxNumber: number }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: PrintJob[];
}

export function ReceivingLabelDrawer({ open, onOpenChange, jobs }: Props) {
  const { toast } = useToast();
  const [printer, setPrinter] = useState<ZebraDevice | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);

  const totalLabels = jobs.reduce((sum, j) => sum + j.boxes.length, 0);

  useEffect(() => {
    if (!open || jobs.length === 0) return;
    setDetecting(true);
    setPrinter(null);
    setProgress(0);
    getZebraPrinter().then((device) => {
      setPrinter(device);
    }).catch(() => {
      // BrowserPrint SDK error — remain in not-detected state
    }).finally(() => {
      setDetecting(false);
    });
  }, [open]);

  async function retryDetect() {
    setDetecting(true);
    setPrinter(null);
    try {
      const device = await getZebraPrinter();
      setPrinter(device);
    } finally {
      setDetecting(false);
    }
  }

  async function handlePrint() {
    if (!printer || jobs.length === 0) return;
    setPrinting(true);
    setProgress(0);

    const allLabels: BoxLabelData[] = jobs.flatMap((job) =>
      job.boxes.map((box) => ({
        ...box,
        boxCount: job.boxes.length,
        componentName: job.componentName,
        supplierLotNumber: job.supplierLotNumber,
        supplierName: job.supplierName,
        poNumber: job.poNumber,
        dateReceived: job.dateReceived,
        receivingUniqueId: job.receivingUniqueId,
      }))
    );

    try {
      await printLabels(printer, allLabels, (n) => setProgress(n));
      toast({
        title: `${totalLabels} label${totalLabels > 1 ? "s" : ""} printed`,
      });
      onOpenChange(false);
    } catch {
      toast({
        title: "Print failed",
        description:
          "Check that the Zebra Browser Print app is running on the workstation.",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  if (jobs.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <style>{labelPrintStyles}</style>
        <SheetHeader className="no-print">
          <SheetTitle>
            Print Labels — {totalLabels} label{totalLabels > 1 ? "s" : ""}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Printer status */}
          <div className="no-print flex items-center gap-2 min-h-[28px]">
            {detecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Detecting printer…
                </span>
              </>
            ) : printer ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <Badge
                  variant="outline"
                  className="text-green-700 border-green-300"
                >
                  {printer.name}
                </Badge>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive">
                  Printer not detected
                </span>
              </>
            )}
          </div>

          {!printer && !detecting && (
            <p className="no-print text-xs text-muted-foreground">
              Run the <strong>Zebra Browser Print</strong> app on the warehouse
              workstation, then{" "}
              <button
                className="underline text-primary"
                onClick={retryDetect}
                data-testid="button-retry-detect"
              >
                retry detection
              </button>
              .{" "}
              <a
                href="https://www.zebra.com/us/en/support-downloads/printer-software/browser-print.html"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-primary"
              >
                Download Zebra Browser Print
              </a>
            </p>
          )}

          {/* Label previews */}
          <div className="space-y-3">
            {jobs.map((job, i) => {
              const firstBox = job.boxes[0];
              return (
                <div
                  key={i}
                  className="rounded border border-border bg-white p-3 text-xs space-y-1 shadow-sm"
                  style={{ fontFamily: "monospace" }}
                >
                  <div className="font-bold text-sm">{job.componentName}</div>
                  <div>Lot: {job.receivingUniqueId}</div>
                  <div>Supplier lot: {job.supplierLotNumber}</div>
                  <div>Supplier: {job.supplierName}</div>
                  <div>PO: {job.poNumber}</div>
                  <div>Received: {job.dateReceived}</div>
                  {firstBox && (
                    <div className="mt-1 rounded bg-muted px-2 py-1 font-mono tracking-widest text-center">
                      {firstBox.boxLabel}
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    Box 1 of {job.boxes.length}
                  </div>

                </div>
              );
            })}
          </div>

          {/* Progress */}
          {printing && (
            <p
              className="no-print text-sm text-muted-foreground"
              data-testid="text-print-progress"
            >
              Printing label {progress} of {totalLabels}…
            </p>
          )}
        </div>

        <div className="no-print flex justify-end gap-2 mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={printing}
          >
            Done
          </Button>
          {!printer && !detecting && (
            <Button
              variant="secondary"
              onClick={() => window.print()}
              data-testid="button-print-as-pdf"
            >
              Print as PDF
            </Button>
          )}
          <Button
            onClick={handlePrint}
            disabled={!printer || printing || detecting}
            data-testid="button-print-labels"
          >
            {printing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Printing…
              </>
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Print {totalLabels} Label{totalLabels > 1 ? "s" : ""}
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
