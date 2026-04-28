import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SignatureCeremony } from "@/components/SignatureCeremony";

export interface PrintLabelsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issuanceId: string;
  artworkId: string;
  bprId: string;
  onPrinted: () => void;
}

export function PrintLabelsModal({
  open,
  onOpenChange,
  issuanceId,
  artworkId,
  bprId,
  onPrinted,
}: PrintLabelsModalProps) {
  const { toast } = useToast();
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);

  function handleReset() {
    setLot("");
    setExpiry("");
    setQty("1");
    setError(null);
    setSigOpen(false);
  }

  const printMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", `/api/label-issuance/${issuanceId}/print`, {
        password,
        lot,
        expiry,
        qty: parseInt(qty, 10),
        artworkId,
      });
      if (!res.ok) {
        const body = await res.json() as { message?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? "Print failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bpr/${bprId}/label-issuance`] });
      toast({ title: "Labels printed", description: `${qty} labels printed.` });
      handleReset();
      onPrinted();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message);
      setSigOpen(false);
    },
  });

  const isFormValid = !!lot && !!expiry && parseInt(qty, 10) > 0;

  return (
    <>
      <Dialog open={open && !sigOpen} onOpenChange={(next) => { if (!next) { handleReset(); onOpenChange(false); } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Print Labels</DialogTitle>
            <DialogDescription className="text-xs">
              Enter lot, expiry, and quantity before signing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3" data-testid="form-print-labels">
            <div className="space-y-1.5">
              <Label>Lot number</Label>
              <Input
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                placeholder="e.g. 2025-001"
                data-testid="input-print-lot"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry date</Label>
              <Input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                data-testid="input-print-expiry"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                data-testid="input-print-qty"
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" data-testid="text-print-error">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { handleReset(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button
              onClick={() => setSigOpen(true)}
              disabled={!isFormValid}
              data-testid="button-print-sign"
            >
              Print & Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignatureCeremony
        open={sigOpen}
        onOpenChange={(next) => { if (!next) setSigOpen(false); }}
        entityDescription={`${qty} labels (lot ${lot}, exp ${expiry})`}
        meaning="LABEL_PRINT_BATCH"
        onSign={async (password) => printMutation.mutateAsync(password)}
        isPending={printMutation.isPending}
      />
    </>
  );
}
