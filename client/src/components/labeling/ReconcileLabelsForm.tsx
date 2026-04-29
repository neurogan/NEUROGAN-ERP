import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import type { BprDeviation } from "@shared/schema";

export interface ReconcileLabelsFormProps {
  bprId: string;
  qtyIssued: number;
  deviations: BprDeviation[];
  onReconciled: () => void;
}

export function ReconcileLabelsForm({
  bprId,
  qtyIssued,
  deviations,
  onReconciled,
}: ReconcileLabelsFormProps) {
  const { toast } = useToast();
  const [qtyApplied, setQtyApplied] = useState("");
  const [qtyDestroyed, setQtyDestroyed] = useState("");
  const [qtyReturned, setQtyReturned] = useState("");
  const [deviationId, setDeviationId] = useState<string>("");
  const [proofFileData, setProofFileData] = useState<string | null>(null);
  const [proofMimeType, setProofMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const applied = parseInt(qtyApplied, 10) || 0;
  const destroyed = parseInt(qtyDestroyed, 10) || 0;
  const returned = parseInt(qtyReturned, 10) || 0;
  const accounted = applied + destroyed + returned;
  const variance = qtyIssued - accounted;
  const showDeviationPicker = variance !== 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      setProofFileData(base64);
      setProofMimeType(file.type);
    };
    reader.readAsDataURL(file);
  }

  const reconMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", `/api/bpr/${bprId}/label-reconciliation`, {
        password,
        qtyApplied: applied,
        qtyDestroyed: destroyed,
        qtyReturned: returned,
        deviationId: deviationId || null,
        proofFileData: proofFileData ?? null,
        proofMimeType: proofMimeType ?? null,
      });
      if (!res.ok) {
        const body = await res.json() as { message?: string; code?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? "Reconciliation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bpr/${bprId}/label-reconciliation`] });
      toast({ title: "Reconciliation submitted", description: "Label reconciliation recorded." });
      onReconciled();
    },
    onError: (err: Error) => {
      setError(err.message);
      setSigOpen(false);
    },
  });

  const isFormValid =
    qtyApplied !== "" && qtyDestroyed !== "" && qtyReturned !== "" &&
    applied >= 0 && destroyed >= 0 && returned >= 0;

  return (
    <>
      <div className="space-y-4 rounded-md border p-4" data-testid="form-reconcile-labels">
        <h4 className="text-sm font-semibold">Label Reconciliation</h4>
        <p className="text-xs text-muted-foreground">
          Total issued: <span className="font-mono font-medium">{qtyIssued}</span>
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Applied</Label>
            <Input
              type="number"
              min={0}
              value={qtyApplied}
              onChange={(e) => { setQtyApplied(e.target.value); setError(null); }}
              placeholder="0"
              data-testid="input-recon-applied"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Destroyed</Label>
            <Input
              type="number"
              min={0}
              value={qtyDestroyed}
              onChange={(e) => { setQtyDestroyed(e.target.value); setError(null); }}
              placeholder="0"
              data-testid="input-recon-destroyed"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Returned</Label>
            <Input
              type="number"
              min={0}
              value={qtyReturned}
              onChange={(e) => { setQtyReturned(e.target.value); setError(null); }}
              placeholder="0"
              data-testid="input-recon-returned"
            />
          </div>
        </div>

        <div className="text-xs flex items-center gap-2">
          <span className="text-muted-foreground">Variance:</span>
          <span
            className={`font-mono font-semibold ${variance === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
            data-testid="text-recon-variance"
          >
            {variance > 0 ? `+${variance}` : variance}
          </span>
          {variance !== 0 && (
            <span className="text-muted-foreground">({accounted} accounted of {qtyIssued} issued)</span>
          )}
        </div>

        {showDeviationPicker && (
          <div className="space-y-1.5">
            <Label className="text-xs">Link deviation (required if out-of-tolerance)</Label>
            <Select value={deviationId} onValueChange={setDeviationId}>
              <SelectTrigger data-testid="select-recon-deviation">
                <SelectValue placeholder="Select deviation…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {deviations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.deviationDescription.slice(0, 60)}{d.deviationDescription.length > 60 ? "…" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Proof attachment (optional)</Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-recon-proof"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            data-testid="button-recon-attach"
          >
            {proofFileData ? "File attached ✓" : "Attach file"}
          </Button>
          {proofFileData && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 text-xs text-muted-foreground"
              onClick={() => { setProofFileData(null); setProofMimeType(null); if (fileRef.current) fileRef.current.value = ""; }}
            >
              Remove
            </Button>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive" data-testid="text-recon-error">{error}</p>
        )}

        <Button
          onClick={() => { setError(null); setSigOpen(true); }}
          disabled={!isFormValid || reconMutation.isPending}
          data-testid="button-recon-submit"
        >
          Submit Reconciliation
        </Button>
      </div>

      <SignatureCeremony
        open={sigOpen}
        onOpenChange={(next) => { if (!next) setSigOpen(false); }}
        entityDescription={`label reconciliation for BPR (variance: ${variance})`}
        meaning="LABEL_RECONCILED"
        onSign={async (password) => reconMutation.mutateAsync(password)}
        isPending={reconMutation.isPending}
      />
    </>
  );
}
