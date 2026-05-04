import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

type SampleStatus = "active" | "due" | "destroyed" | "all";

interface RetainedSample {
  id: string;
  bprId: string;
  batchNumber: string;
  productName: string;
  sampledAt: string;
  pulledQty: string;
  qtyUnit: string;
  retentionLocation: string;
  retentionExpiresAt: string;
  destroyedAt: string | null;
  createdByName: string;
  destroyedByName: string | null;
}

interface BprOption {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
}

function sampleStatus(s: RetainedSample): SampleStatus {
  if (s.destroyedAt) return "destroyed";
  if (new Date(s.retentionExpiresAt) <= new Date()) return "due";
  return "active";
}

function StatusBadge({ sample }: { sample: RetainedSample }) {
  const st = sampleStatus(sample);
  if (st === "destroyed") return <Badge className="bg-muted text-muted-foreground border-0">Destroyed</Badge>;
  if (st === "due") return <Badge className="bg-amber-500/20 text-amber-500 border-0">Due for destruction</Badge>;
  return <Badge className="bg-green-500/20 text-green-600 border-0">Active</Badge>;
}

export default function RetainedSamplesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SampleStatus>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [destroyConfirmId, setDestroyConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canMutate = user?.roles.includes("QA") || user?.roles.includes("ADMIN");

  const { data: samples = [], isLoading } = useQuery<RetainedSample[]>({
    queryKey: ["/api/quality/retained-samples", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/quality/retained-samples?status=${statusFilter}`);
      return res.json();
    },
  });

  const { data: bprs = [] } = useQuery<BprOption[]>({
    queryKey: ["/api/batch-production-records"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/batch-production-records");
      return res.json();
    },
    enabled: showAddModal,
  });

  const emptyForm = {
    bprId: "",
    sampledAt: new Date().toISOString().slice(0, 10),
    pulledQty: "",
    qtyUnit: "g",
    retentionLocation: "",
    retentionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const [form, setForm] = useState(emptyForm);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/quality/retained-samples", {
        bprId: form.bprId,
        sampledAt: new Date(form.sampledAt).toISOString(),
        pulledQty: form.pulledQty,
        qtyUnit: form.qtyUnit,
        retentionLocation: form.retentionLocation,
        retentionExpiresAt: new Date(form.retentionExpiresAt).toISOString(),
      }).then((r) => r.json()),
    onSuccess: () => {
      setShowAddModal(false);
      setForm(emptyForm);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["/api/quality/retained-samples"] });
    },
    onError: (err: Error & { status?: number }) => {
      setError(err.message ?? "Failed to add sample");
    },
  });

  const destroyMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/quality/retained-samples/${id}/destroy`).then((r) => r.json()),
    onSuccess: () => {
      setDestroyConfirmId(null);
      void qc.invalidateQueries({ queryKey: ["/api/quality/retained-samples"] });
    },
  });

  const STATUS_TABS: { value: SampleStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "due", label: "Due for destruction" },
    { value: "destroyed", label: "Destroyed" },
  ];

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map((t) => (
            <Button
              key={t.value}
              size="sm"
              variant={statusFilter === t.value ? "default" : "outline"}
              onClick={() => setStatusFilter(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {canMutate && (
          <Button size="sm" onClick={() => { setError(null); setShowAddModal(true); }} data-tour="retained-samples-add-button">
            + Add sample
          </Button>
        )}
      </div>

      <div className="border rounded-md overflow-hidden" data-tour="retained-samples-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">BPR / Batch</th>
              <th className="text-left p-3 font-medium">Product</th>
              <th className="text-left p-3 font-medium">Sampled</th>
              <th className="text-left p-3 font-medium">Qty</th>
              <th className="text-left p-3 font-medium">Location</th>
              <th className="text-left p-3 font-medium">Expires</th>
              <th className="text-left p-3 font-medium">Status</th>
              {canMutate && <th className="text-left p-3 font-medium">Action</th>}
            </tr>
          </thead>
          <tbody>
            {samples.length === 0 && (
              <tr>
                <td colSpan={canMutate ? 8 : 7} className="p-4 text-center text-muted-foreground">
                  No retained samples found.
                </td>
              </tr>
            )}
            {samples.map((s) => {
              const st = sampleStatus(s);
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{s.batchNumber}</td>
                  <td className="p-3">{s.productName}</td>
                  <td className="p-3 text-xs">{new Date(s.sampledAt).toLocaleDateString()}</td>
                  <td className="p-3 text-xs">{s.pulledQty} {s.qtyUnit}</td>
                  <td className="p-3 text-xs">{s.retentionLocation}</td>
                  <td className="p-3 text-xs">{new Date(s.retentionExpiresAt).toLocaleDateString()}</td>
                  <td className="p-3"><StatusBadge sample={s} /></td>
                  {canMutate && (
                    <td className="p-3">
                      {st !== "destroyed" ? (
                        destroyConfirmId === s.id ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={destroyMutation.isPending}
                              onClick={() => destroyMutation.mutate(s.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDestroyConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDestroyConfirmId(s.id)}
                            data-tour="retained-samples-destroy-button"
                          >
                            Mark destroyed
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {s.destroyedAt ? new Date(s.destroyedAt).toLocaleDateString() : "—"}
                          {s.destroyedByName ? ` by ${s.destroyedByName}` : ""}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={showAddModal} onOpenChange={(open) => { setShowAddModal(open); if (!open) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add retained sample</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs">Batch (BPR)</Label>
              <Select value={form.bprId} onValueChange={(v) => setForm((f) => ({ ...f, bprId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select batch…" />
                </SelectTrigger>
                <SelectContent>
                  {bprs.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batchNumber} — {b.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Sampled at</Label>
                <Input
                  type="date"
                  value={form.sampledAt}
                  onChange={(e) => {
                    const d = e.target.value;
                    const expires = new Date(new Date(d).getTime() + 365 * 24 * 60 * 60 * 1000)
                      .toISOString().slice(0, 10);
                    setForm((f) => ({ ...f, sampledAt: d, retentionExpiresAt: expires }));
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Retention expires</Label>
                <Input
                  type="date"
                  value={form.retentionExpiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, retentionExpiresAt: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Qty pulled</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.pulledQty}
                  onChange={(e) => setForm((f) => ({ ...f, pulledQty: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select value={form.qtyUnit} onValueChange={(v) => setForm((f) => ({ ...f, qtyUnit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="mL">mL</SelectItem>
                    <SelectItem value="units">units</SelectItem>
                    <SelectItem value="tablets">tablets</SelectItem>
                    <SelectItem value="capsules">capsules</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Retention location</Label>
              <Input
                placeholder="e.g. Shelf A3 — Freezer 2"
                value={form.retentionLocation}
                onChange={(e) => setForm((f) => ({ ...f, retentionLocation: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button
                disabled={
                  createMutation.isPending ||
                  !form.bprId ||
                  !form.pulledQty ||
                  !form.retentionLocation
                }
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Saving…" : "Add sample"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
