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
      setDetecting(false);
    });
  }, [open]);

  async function retryDetect() {
    setDetecting(true);
    setPrinter(null);
    const device = await getZebraPrinter();
    setPrinter(device);
    setDetecting(false);
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
        <SheetHeader>
          <SheetTitle>
            Print Labels — {totalLabels} label{totalLabels > 1 ? "s" : ""}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Printer status */}
          <div className="flex items-center gap-2 min-h-[28px]">
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
            <p className="text-xs text-muted-foreground">
              Run the <strong>Zebra Browser Print</strong> app on the warehouse
              workstation, then{" "}
              <button
                className="underline text-primary"
                onClick={retryDetect}
                data-testid="button-retry-detect"
              >
                retry detection
              </button>
              .
            </p>
          )}

          {/* Job summary */}
          <div className="space-y-2">
            {jobs.map((job, i) => (
              <div
                key={i}
                className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm"
              >
                <div className="font-medium">{job.componentName}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {job.boxes[0]?.boxLabel} …{" "}
                  {job.boxes[job.boxes.length - 1]?.boxLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  {job.boxes.length} label{job.boxes.length > 1 ? "s" : ""} ·
                  Supplier lot: {job.supplierLotNumber}
                </div>
              </div>
            ))}
          </div>

          {/* Progress */}
          {printing && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-print-progress"
            >
              Printing label {progress} of {totalLabels}…
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={printing}
          >
            Close
          </Button>
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
