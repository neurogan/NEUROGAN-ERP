import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ArrowUp, ArrowDown, ExternalLink, Pencil } from "lucide-react";
import type { MmrWithSteps, MmrComponentWithDetails, Product, Equipment } from "@shared/schema";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "APPROVED" ? "default"
    : status === "DRAFT" ? "secondary"
    : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

// ── Create MMR dialog ─────────────────────────────────────────────────────────

function CreateMmrDialog({
  open,
  onOpenChange,
  productId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId?: string;
  onCreated: (mmr: MmrWithSteps) => void;
}) {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState(productId ?? "");
  const [notes, setNotes] = useState("");

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const finishedGoods = (products ?? []).filter((p) => p.category === "FINISHED_GOOD");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mmrs", {
        productId: selectedProductId,
        notes: notes || undefined,
      });
      return res.json() as Promise<MmrWithSteps>;
    },
    onSuccess: (mmr) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      onCreated(mmr);
      onOpenChange(false);
      setSelectedProductId(productId ?? "");
      setNotes("");
    },
    onError: (err) => {
      toast({ title: "Failed to create MMR", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New MMR</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Product</label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select finished good..." />
              </SelectTrigger>
              <SelectContent>
                {finishedGoods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this MMR..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selectedProductId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Creating…" : "Create MMR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Formula tab ───────────────────────────────────────────────────────────────

function AddComponentDialog({
  open,
  onOpenChange,
  mmrId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mmrId: string;
}) {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [uom, setUom] = useState("g");
  const [notes, setNotes] = useState("");

  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const rawMaterials = (products ?? []).filter((p) => p.category !== "FINISHED_GOOD");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mmrs/${mmrId}/components`, {
        productId: selectedProductId,
        quantity,
        uom,
        notes: notes || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmrId] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      onOpenChange(false);
      setSelectedProductId("");
      setQuantity("");
      setUom("g");
      setNotes("");
    },
    onError: (err) => {
      toast({ title: "Failed to add ingredient", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Ingredient</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Ingredient *</label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger><SelectValue placeholder="Select material…" /></SelectTrigger>
              <SelectContent>
                {rawMaterials.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Quantity per unit *</label>
              <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 10.5" />
            </div>
            <div>
              <label className="text-sm font-medium">UOM *</label>
              <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="g, mg, mL…" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!selectedProductId || !quantity || !uom || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Adding…" : "Add Ingredient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormulaTab({ mmr }: { mmr: MmrWithSteps }) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUom, setEditUom] = useState("");
  const isDraft = mmr.status === "DRAFT";

  const deleteMutation = useMutation({
    mutationFn: async (componentId: string) => {
      await apiRequest("DELETE", `/api/mmrs/${mmr.id}/components/${componentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
    },
    onError: (err) => {
      toast({ title: "Failed to remove ingredient", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, quantity, uom }: { id: string; quantity: string; uom: string }) => {
      const res = await apiRequest("PATCH", `/api/mmrs/${mmr.id}/components/${id}`, { quantity, uom });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      setEditingId(null);
    },
    onError: (err) => {
      toast({ title: "Failed to update ingredient", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  function startEdit(c: MmrComponentWithDetails) {
    setEditingId(c.id);
    setEditQty(c.quantity);
    setEditUom(c.uom);
  }

  return (
    <div className="space-y-3">
      {!isDraft && (
        <p className="text-xs text-muted-foreground italic">
          Formula locked — MMR is {mmr.status.toLowerCase()}. Click Revise to make changes.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground text-xs border-b">
            <th className="py-1 pr-4 font-medium">Ingredient</th>
            <th className="py-1 pr-4 font-medium w-28">Qty / unit</th>
            <th className="py-1 pr-3 font-medium w-16">UOM</th>
            {isDraft && <th className="py-1 w-16" />}
          </tr>
        </thead>
        <tbody>
          {mmr.components.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <div className="font-medium">{c.productName}</div>
                <div className="text-xs text-muted-foreground font-mono">{c.productSku}</div>
              </td>
              {editingId === c.id ? (
                <>
                  <td className="py-2 pr-3">
                    <Input type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="h-7 w-24 text-xs" />
                  </td>
                  <td className="py-2 pr-3">
                    <Input value={editUom} onChange={(e) => setEditUom(e.target.value)} className="h-7 w-16 text-xs" />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 px-2 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: c.id, quantity: editQty, uom: editUom })}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingId(null)}>✕</Button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-3 font-mono">{c.quantity}</td>
                  <td className="py-2 pr-3">{c.uom}</td>
                  {isDraft && (
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(c)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
          {mmr.components.length === 0 && (
            <tr><td colSpan={isDraft ? 4 : 3} className="py-4 text-center text-muted-foreground text-xs">No ingredients defined yet.</td></tr>
          )}
        </tbody>
      </table>
      {isDraft && (
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Ingredient
        </Button>
      )}
      <AddComponentDialog open={addOpen} onOpenChange={setAddOpen} mmrId={mmr.id} />
    </div>
  );
}

// ── Process Steps tab ─────────────────────────────────────────────────────────

function AddStepDialog({
  open,
  onOpenChange,
  mmrId,
  nextStepNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mmrId: string;
  nextStepNumber: number;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [criticalParams, setCriticalParams] = useState("");
  const [sopReference, setSopReference] = useState("");
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);

  const { data: allEquipment } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mmrs/${mmrId}/steps`, {
        stepNumber: nextStepNumber,
        description,
        equipmentIds: selectedEquipmentIds,
        criticalParams: criticalParams || null,
        sopReference: sopReference || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmrId] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      onOpenChange(false);
      setDescription("");
      setCriticalParams("");
      setSopReference("");
      setSelectedEquipmentIds([]);
    },
    onError: (err) => {
      toast({ title: "Failed to add step", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const toggleEquipment = (id: string) => {
    setSelectedEquipmentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Process Step {nextStepNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Description *</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe this step…" rows={3} />
          </div>
          <div>
            <label className="text-sm font-medium">Critical Parameters</label>
            <Input value={criticalParams} onChange={(e) => setCriticalParams(e.target.value)} placeholder="e.g. Temperature ≤ 25°C, pH 6.8–7.2" />
          </div>
          <div>
            <label className="text-sm font-medium">SOP Reference</label>
            <Input value={sopReference} onChange={(e) => setSopReference(e.target.value)} placeholder="e.g. SOP-MFG-001 v2.0" />
          </div>
          {(allEquipment ?? []).length > 0 && (
            <div>
              <label className="text-sm font-medium">Equipment Required</label>
              <div className="mt-1 space-y-1 max-h-32 overflow-y-auto border rounded p-2">
                {(allEquipment ?? []).map((eq) => (
                  <label key={eq.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEquipmentIds.includes(eq.id)}
                      onChange={() => toggleEquipment(eq.id)}
                    />
                    {eq.name} ({eq.assetTag})
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!description.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Adding…" : "Add Step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProcessStepsTab({ mmr }: { mmr: MmrWithSteps }) {
  const { toast } = useToast();
  const [addingStep, setAddingStep] = useState(false);
  const isDraft = mmr.status === "DRAFT";

  const { data: allEquipment } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const equipmentMap = new Map((allEquipment ?? []).map((e) => [e.id, e]));

  const deleteStep = useMutation({
    mutationFn: async (stepId: string) => {
      await apiRequest("DELETE", `/api/mmrs/${mmr.id}/steps/${stepId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
    },
    onError: (err) => {
      toast({ title: "Failed to delete step", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const moveStep = useMutation({
    mutationFn: async ({ direction, stepId }: { direction: "up" | "down"; stepId: string }) => {
      const steps = [...mmr.steps].sort((a, b) => a.stepNumber - b.stepNumber);
      const idx = steps.findIndex((s) => s.id === stepId);
      if (direction === "up" && idx === 0) return;
      if (direction === "down" && idx === steps.length - 1) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      const newOrder = [...steps];
      [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx]!, newOrder[idx]!];
      await apiRequest("POST", `/api/mmrs/${mmr.id}/steps/reorder`, {
        stepIds: newOrder.map((s) => s.id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
    },
    onError: (err) => {
      toast({ title: "Failed to reorder steps", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const sortedSteps = [...mmr.steps].sort((a, b) => a.stepNumber - b.stepNumber);

  return (
    <div className="space-y-3">
      {!isDraft && (
        <p className="text-xs text-muted-foreground italic">
          Steps locked — MMR is {mmr.status.toLowerCase()}. Click Revise to make changes.
        </p>
      )}
      {sortedSteps.map((step, idx) => (
        <div key={step.id} className="border rounded p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <span className="text-xs font-semibold text-muted-foreground">Step {step.stepNumber}</span>
              <p className="text-sm mt-0.5">{step.description}</p>
              {step.criticalParams && (
                <p className="text-xs text-amber-700 mt-1">Critical: {step.criticalParams}</p>
              )}
              {step.sopReference && (
                <p className="text-xs text-muted-foreground mt-0.5">SOP: {step.sopReference}</p>
              )}
              {step.equipmentIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Equipment: {step.equipmentIds.map((id) => equipmentMap.get(id)?.name ?? id).join(", ")}
                </p>
              )}
            </div>
            {isDraft && (
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  disabled={idx === 0}
                  onClick={() => moveStep.mutate({ direction: "up", stepId: step.id })}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  disabled={idx === sortedSteps.length - 1}
                  onClick={() => moveStep.mutate({ direction: "down", stepId: step.id })}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive"
                  onClick={() => deleteStep.mutate(step.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}
      {sortedSteps.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No steps defined yet.</p>
      )}
      {isDraft && (
        <Button variant="outline" size="sm" onClick={() => setAddingStep(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Step
        </Button>
      )}
      <AddStepDialog
        open={addingStep}
        onOpenChange={setAddingStep}
        mmrId={mmr.id}
        nextStepNumber={sortedSteps.length + 1}
      />
    </div>
  );
}

// ── Yield tab ─────────────────────────────────────────────────────────────────

function YieldTab({ mmr }: { mmr: MmrWithSteps }) {
  const { toast } = useToast();
  const isDraft = mmr.status === "DRAFT";
  const [minVal, setMinVal] = useState(mmr.yieldMinThreshold ?? "");
  const [maxVal, setMaxVal] = useState(mmr.yieldMaxThreshold ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/mmrs/${mmr.id}`, {
        yieldMinThreshold: minVal || null,
        yieldMaxThreshold: maxVal || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      toast({ title: "Yield thresholds saved" });
    },
    onError: (err) => {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-sm">
      {!isDraft && (
        <p className="text-xs text-muted-foreground italic">
          Yield thresholds locked — MMR is {mmr.status.toLowerCase()}.
        </p>
      )}
      <div>
        <label className="text-sm font-medium">Minimum Acceptable Yield (%)</label>
        <Input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={minVal}
          onChange={(e) => setMinVal(e.target.value)}
          disabled={!isDraft}
          placeholder="e.g. 95.0"
          className="mt-1"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Maximum Acceptable Yield (%)</label>
        <Input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={maxVal}
          onChange={(e) => setMaxVal(e.target.value)}
          disabled={!isDraft}
          placeholder="e.g. 105.0"
          className="mt-1"
        />
      </div>
      {isDraft && (
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}

// ── Approval tab ──────────────────────────────────────────────────────────────

function ApprovalTab({ mmr, onRevised }: { mmr: MmrWithSteps; onRevised: (newMmr: MmrWithSteps) => void }) {
  const { toast } = useToast();
  const [sigOpen, setSigOpen] = useState(false);

  const approveMutation = useMutation({
    mutationFn: async ({ password, commentary }: { password: string; commentary: string }) => {
      const res = await apiRequest("POST", `/api/mmrs/${mmr.id}/approve`, { password, commentary });
      return res.json() as Promise<MmrWithSteps>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs", mmr.id] });
      setSigOpen(false);
      toast({ title: "MMR approved", description: `MMR v${mmr.version} is now APPROVED.` });
    },
    onError: (err) => {
      throw err; // Let SignatureCeremony show the error
    },
  });

  const reviseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mmrs/${mmr.id}/revise`);
      return res.json() as Promise<MmrWithSteps>;
    },
    onSuccess: (newMmr) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mmrs"] });
      toast({ title: `MMR v${newMmr.version} created`, description: "A new DRAFT has been created." });
      onRevised(newMmr);
    },
    onError: (err) => {
      toast({ title: "Failed to revise MMR", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="text-sm space-y-1">
        <div><span className="text-muted-foreground">Created by:</span> {mmr.createdByName}</div>
        {mmr.approvedByName && (
          <>
            <div><span className="text-muted-foreground">Approved by:</span> {mmr.approvedByName}</div>
            {mmr.approvedAt && (
              <div><span className="text-muted-foreground">Approved at:</span> {new Date(mmr.approvedAt).toLocaleString()}</div>
            )}
          </>
        )}
        <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={mmr.status} /></div>
      </div>

      {mmr.status === "DRAFT" && (
        <div>
          <Button onClick={() => setSigOpen(true)}>Submit for Approval</Button>
          <p className="text-xs text-muted-foreground mt-2">
            Requires QA signature. The approver must be a different person from the creator (21 CFR Part 111 §111.260).
          </p>
        </div>
      )}

      {mmr.status === "APPROVED" && (
        <Button
          variant="outline"
          disabled={reviseMutation.isPending}
          onClick={() => reviseMutation.mutate()}
        >
          {reviseMutation.isPending ? "Creating revision…" : "Revise"}
        </Button>
      )}

      <SignatureCeremony
        open={sigOpen}
        onOpenChange={setSigOpen}
        entityDescription={`MMR v${mmr.version} — ${mmr.productName}`}
        meaning="MMR_APPROVAL"
        isPending={approveMutation.isPending}
        onSign={async (password, commentary) => {
          await approveMutation.mutateAsync({ password, commentary });
        }}
      />
    </div>
  );
}

// ── MMR Detail panel ──────────────────────────────────────────────────────────

function MmrDetail({
  mmr,
  onRevised,
}: {
  mmr: MmrWithSteps;
  onRevised: (newMmr: MmrWithSteps) => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{mmr.productName}</h2>
          <p className="text-sm text-muted-foreground" data-tour="mmr-version-badge">
            Version {mmr.version} · <StatusBadge status={mmr.status} />
            {mmr.approvedByName && ` · Approved by ${mmr.approvedByName}`}
          </p>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
            onClick={() => setLocation(`/inventory?product=${mmr.productId}`)}
            data-tour="mmr-inventory-link"
          >
            <ExternalLink className="h-3 w-3" />
            View Product in Inventory
          </button>
        </div>
      </div>

      <Tabs defaultValue="formula" data-tour="mmr-steps">
        <TabsList>
          <TabsTrigger value="formula">Formula</TabsTrigger>
          <TabsTrigger value="steps">Process Steps</TabsTrigger>
          <TabsTrigger value="yield">Yield</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>
        <TabsContent value="formula" className="mt-4">
          <FormulaTab mmr={mmr} />
        </TabsContent>
        <TabsContent value="steps" className="mt-4">
          <ProcessStepsTab mmr={mmr} />
        </TabsContent>
        <TabsContent value="yield" className="mt-4">
          <YieldTab mmr={mmr} />
        </TabsContent>
        <TabsContent value="approval" className="mt-4">
          <ApprovalTab mmr={mmr} onRevised={onRevised} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main MMR page ─────────────────────────────────────────────────────────────

export default function MmrPage() {
  const [selectedMmrId, setSelectedMmrId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForProductId, setCreateForProductId] = useState<string | undefined>();

  // Read URL params: ?mmrId= selects a specific MMR; ?productId= selects the MMR for that product
  const urlParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const urlMmrId = urlParams.get("mmrId");
  const urlProductId = urlParams.get("productId");

  const { data: allMmrs, isLoading: mmrsLoading } = useQuery<MmrWithSteps[]>({
    queryKey: ["/api/mmrs"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Pre-select from URL params once data loads
  useEffect(() => {
    if (!allMmrs || selectedMmrId) return;
    if (urlMmrId) {
      const mmr = allMmrs.find(m => m.id === urlMmrId);
      if (mmr) setSelectedMmrId(mmr.id);
    } else if (urlProductId) {
      // Pick the best MMR for the product (APPROVED > DRAFT > SUPERSEDED, then highest version)
      const productMmrs = allMmrs.filter(m => m.productId === urlProductId);
      const statusPriority = (s: string) => s === "APPROVED" ? 2 : s === "DRAFT" ? 1 : 0;
      const best = productMmrs.sort((a, b) => {
        const pd = statusPriority(b.status) - statusPriority(a.status);
        return pd !== 0 ? pd : b.version - a.version;
      })[0];
      if (best) setSelectedMmrId(best.id);
    }
  }, [allMmrs, urlMmrId, urlProductId]);

  const finishedGoods = (products ?? []).filter((p) => p.category === "FINISHED_GOOD");

  // For each FINISHED_GOOD product, find their current MMR (highest version, non-superseded preferred)
  const productMmrMap = new Map<string, MmrWithSteps>();
  for (const mmr of allMmrs ?? []) {
    const existing = productMmrMap.get(mmr.productId);
    // Prefer APPROVED > DRAFT > SUPERSEDED, then higher version
    if (!existing) {
      productMmrMap.set(mmr.productId, mmr);
    } else {
      const statusPriority = (s: string) => s === "APPROVED" ? 2 : s === "DRAFT" ? 1 : 0;
      if (statusPriority(mmr.status) > statusPriority(existing.status) ||
          (statusPriority(mmr.status) === statusPriority(existing.status) && mmr.version > existing.version)) {
        productMmrMap.set(mmr.productId, mmr);
      }
    }
  }

  const selectedMmr = selectedMmrId ? (allMmrs ?? []).find((m) => m.id === selectedMmrId) : null;

  const handleRevised = (newMmr: MmrWithSteps) => {
    setSelectedMmrId(newMmr.id);
  };

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-64 border-r flex flex-col shrink-0">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">MMR Library</p>
        </div>
        <div className="flex-1 overflow-y-auto" data-tour="mmr-list">
          {mmrsLoading && (
            <div className="p-3 text-sm text-muted-foreground">Loading…</div>
          )}
          {finishedGoods.map((product) => {
            const mmr = productMmrMap.get(product.id);
            const isSelected = mmr ? selectedMmrId === mmr.id : false;
            return (
              <div
                key={product.id}
                className={`px-3 py-2 cursor-pointer hover:bg-muted/50 ${isSelected ? "bg-muted border-l-2 border-l-primary" : ""}`}
                onClick={() => {
                  if (mmr) {
                    setSelectedMmrId(mmr.id);
                  } else {
                    setCreateForProductId(product.id);
                    setCreateOpen(true);
                  }
                }}
              >
                <div className="text-sm font-medium truncate">{product.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {mmr ? `v${mmr.version} · ${mmr.status}` : "— No MMR yet"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setCreateForProductId(undefined);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> New MMR
          </Button>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-hidden flex">
        {selectedMmr ? (
          <MmrDetail mmr={selectedMmr} onRevised={handleRevised} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a product to view its MMR
          </div>
        )}
      </div>

      <CreateMmrDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        productId={createForProductId}
        onCreated={(mmr) => setSelectedMmrId(mmr.id)}
      />
    </div>
  );
}
