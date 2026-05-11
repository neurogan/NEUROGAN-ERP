import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, CheckCircle2, AlertCircle, Loader2, Server } from "lucide-react";
import {
  getZebraPrinter,
  printLabels,
  type ZebraDevice,
  type BoxLabelData,
} from "@/lib/zebra-print";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
  expiryDate?: string;
  boxes: { boxLabel: string; boxNumber: number }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: PrintJob[];
  isReprint?: boolean;
}

export function ReceivingLabelDrawer({ open, onOpenChange, jobs, isReprint = false }: Props) {
  const { toast } = useToast();
  const [printer, setPrinter] = useState<ZebraDevice | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printingViaServer, setPrintingViaServer] = useState(false);
  const [progress, setProgress] = useState(0);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [hasPrinted, setHasPrinted] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const totalLabels = jobs.reduce((sum, j) => sum + j.boxes.length, 0);

  const { data: printStatus } = useQuery<{ adapter: string; configured: boolean }>({
    queryKey: ["/api/print/status"],
    staleTime: 60_000,
  });
  const serverConfigured = printStatus?.configured ?? false;

  useEffect(() => {
    if (!open) return;
    const allLabels = jobs.flatMap((j) => j.boxes.map((b) => b.boxLabel));
    Promise.all(
      allLabels.map((label) =>
        QRCode.toDataURL(label, { width: 100, margin: 1 }).then((url) => [label, url] as const),
      ),
    ).then((entries) => setQrUrls(Object.fromEntries(entries)));
  }, [open, jobs]);

  useEffect(() => {
    if (!open || jobs.length === 0) return;
    setHasPrinted(false);
    setDetecting(true);
    setPrinter(null);
    setProgress(0);
    getZebraPrinter().then((device) => {
      setPrinter(device);
    }).catch(() => {
      // BrowserPrint SDK not available — iPad/mobile or no bridge installed
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
        expiryDate: job.expiryDate,
      }))
    );

    try {
      await printLabels(printer, allLabels, (n) => setProgress(n));
      setHasPrinted(true);
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

  async function handlePrintViaServer() {
    if (jobs.length === 0) return;
    setPrintingViaServer(true);

    const allBoxes: BoxLabelData[] = jobs.flatMap((job) =>
      job.boxes.map((box) => ({
        ...box,
        boxCount: job.boxes.length,
        componentName: job.componentName,
        supplierLotNumber: job.supplierLotNumber,
        supplierName: job.supplierName,
        poNumber: job.poNumber,
        dateReceived: job.dateReceived,
        receivingUniqueId: job.receivingUniqueId,
        expiryDate: job.expiryDate,
      }))
    );

    try {
      const res = await apiRequest("POST", "/api/print/box-labels", { boxes: allBoxes });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(err.message);
      }
      setHasPrinted(true);
      toast({ title: `${totalLabels} label${totalLabels > 1 ? "s" : ""} sent to printer` });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Server print failed",
        description: err instanceof Error ? err.message : "Check printer connectivity",
        variant: "destructive",
      });
    } finally {
      setPrintingViaServer(false);
    }
  }

  function requestClose() {
    if (!hasPrinted && !isReprint) {
      setConfirmClose(true);
    } else {
      onOpenChange(false);
    }
  }

  if (jobs.length === 0) return null;

  return (
    <>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Labels not printed</AlertDialogTitle>
          <AlertDialogDescription>
            You haven't printed the labels yet. Box labels are required for quarantine
            tracking. Are you sure you want to close without printing?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => onOpenChange(false)}>
            Close without printing
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); else onOpenChange(true); }}>
      <SheetContent className="sm:max-w-md">
        <style>{labelPrintStyles}</style>
        <SheetHeader className="no-print">
          <SheetTitle>
            {isReprint ? "Reprint Labels" : "Print Labels"} — {totalLabels} label{totalLabels > 1 ? "s" : ""}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Printer status section */}
          <div className="no-print space-y-2">
            {/* Local (BrowserPrint) status */}
            <div className="flex items-center gap-2 min-h-[24px]">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Local printer</span>
              {detecting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">Detecting…</span></>
              ) : printer ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /><Badge variant="outline" className="text-green-700 border-green-300 text-xs">{printer.name}</Badge></>
              ) : (
                <><AlertCircle className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Not detected — requires Zebra Browser Print on this device</span></>
              )}
            </div>
            {/* Server print status */}
            <div className="flex items-center gap-2 min-h-[24px]">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Via server</span>
              {serverConfigured ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /><Badge variant="outline" className="text-green-700 border-green-300 text-xs">Ready</Badge></>
              ) : (
                <><AlertCircle className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Not configured</span></>
              )}
            </div>
          </div>

          {/* Setup help — only shown when neither path is available */}
          {!printer && !detecting && !serverConfigured && (
            <div className="no-print rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <p className="font-medium">No print path available</p>
              <p><strong>On iPad/mobile:</strong> Configure server-side printing in Settings → Printer (requires printer accessible from server).</p>
              <p><strong>On Mac/Windows:</strong> Run <strong>Zebra Browser Print</strong> on this device, then{" "}
                <button className="underline" onClick={retryDetect}>retry detection</button>.{" "}
                <a href="https://www.zebra.com/us/en/support-downloads/printer-software/browser-print.html" target="_blank" rel="noopener noreferrer" className="underline">Download</a>
              </p>
            </div>
          )}

          {/* Retry detect link — shown when not detected but could be (desktop) */}
          {!printer && !detecting && (
            <p className="no-print text-xs text-muted-foreground">
              On a workstation?{" "}
              <button className="underline text-primary" onClick={retryDetect} data-testid="button-retry-detect">
                Retry local detection
              </button>
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
                    <div className="mt-1 flex items-center gap-3">
                      {qrUrls[firstBox.boxLabel] && (
                        <img
                          src={qrUrls[firstBox.boxLabel]}
                          alt={`QR: ${firstBox.boxLabel}`}
                          className="w-20 h-20 border border-border rounded"
                        />
                      )}
                      <div>
                        <div className="rounded bg-muted px-2 py-1 font-mono tracking-widest text-center text-[10px]">
                          {firstBox.boxLabel}
                        </div>
                        <div className="text-muted-foreground mt-1">
                          Box 1 of {job.boxes.length}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress */}
          {printing && (
            <p className="no-print text-sm text-muted-foreground" data-testid="text-print-progress">
              Printing label {progress} of {totalLabels}…
            </p>
          )}
        </div>

        <div className="no-print flex flex-wrap justify-end gap-2 mt-6">
          <Button variant="outline" onClick={requestClose} disabled={printing || printingViaServer}>
            Done
          </Button>
          {serverConfigured && (
            <Button
              variant={printer ? "outline" : "default"}
              onClick={handlePrintViaServer}
              disabled={printingViaServer || printing}
              data-testid="button-print-via-server"
            >
              {printingViaServer ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Printing…</>
              ) : (
                <><Server className="h-4 w-4 mr-2" />Print via Server</>
              )}
            </Button>
          )}
          <Button
            onClick={handlePrint}
            disabled={!printer || printing || detecting}
            data-testid="button-print-labels"
          >
            {printing ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Printing…</>
            ) : (
              <><Printer className="h-4 w-4 mr-2" />Print {totalLabels} Label{totalLabels > 1 ? "s" : ""}</>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}
