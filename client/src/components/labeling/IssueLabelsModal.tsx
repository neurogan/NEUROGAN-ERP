import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { LabelArtwork, LabelSpool } from "@shared/schema";

export interface IssueLabelsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bprId: string;
  productId: string;
  onIssued: () => void;
}

export function IssueLabelsModal({
  open,
  onOpenChange,
  bprId,
  productId,
  onIssued,
}: IssueLabelsModalProps) {
  const { toast } = useToast();
  const [artworkId, setArtworkId] = useState("");
  const [spoolId, setSpoolId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const { data: artworks } = useQuery<LabelArtwork[]>({
    queryKey: ["/api/label-artwork", productId],
    queryFn: async () => (await apiRequest("GET", `/api/label-artwork?productId=${productId}`)).json(),
    enabled: open && !!productId,
  });

  const { data: spools } = useQuery<LabelSpool[]>({
    queryKey: ["/api/label-spools", artworkId],
    queryFn: async () => (await apiRequest("GET", `/api/label-spools?artworkId=${artworkId}`)).json(),
    enabled: open && !!artworkId,
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bpr/${bprId}/label-issuance`, {
        spoolId,
        qty: parseInt(qty, 10),
      });
      if (!res.ok) {
        const body = await res.json() as { message?: string };
        throw new Error(body.message ?? "Failed to issue labels");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bpr/${bprId}/label-issuance`] });
      toast({ title: "Labels issued", description: `${qty} labels issued to BPR.` });
      handleReset();
      onIssued();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleReset() {
    setArtworkId("");
    setSpoolId("");
    setQty("1");
    setError(null);
  }

  const activeSpools = (spools ?? []).filter((s) => s.status === "ACTIVE");
  const approvedArtworks = (artworks ?? []).filter((a) => a.status === "APPROVED");
  const isValid = !!spoolId && parseInt(qty, 10) > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleReset(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Issue Labels</DialogTitle>
          <DialogDescription className="text-xs">
            Check out a spool of labels for this batch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3" data-testid="form-issue-labels">
          <div className="space-y-1.5">
            <Label>Artwork</Label>
            <Select value={artworkId} onValueChange={(v) => { setArtworkId(v); setSpoolId(""); }}>
              <SelectTrigger data-testid="select-issue-artwork">
                <SelectValue placeholder="Select approved artwork…" />
              </SelectTrigger>
              <SelectContent>
                {approvedArtworks.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Spool</Label>
            <Select value={spoolId} onValueChange={setSpoolId} disabled={!artworkId}>
              <SelectTrigger data-testid="select-issue-spool">
                <SelectValue placeholder="Select active spool…" />
              </SelectTrigger>
              <SelectContent>
                {activeSpools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.spoolNumber} — {s.qtyOnHand} left
                  </SelectItem>
                ))}
                {artworkId && activeSpools.length === 0 && (
                  <SelectItem value="__none" disabled>No active spools</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              data-testid="input-issue-qty"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="text-issue-error">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { handleReset(); onOpenChange(false); }} disabled={issueMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => issueMutation.mutate()}
            disabled={!isValid || issueMutation.isPending}
            data-testid="button-submit-issue"
          >
            {issueMutation.isPending ? "Issuing…" : "Issue labels"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
