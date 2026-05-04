import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProtocolAttribute {
  id: string;
  analyteName: string;
  unit: string | null;
  minSpec: string | null;
  maxSpec: string | null;
  testMethod: string | null;
}

interface Protocol {
  id: string;
  name: string;
  productId: string | null;
  productName: string | null;
  description: string | null;
  storageCondition: string;
  testIntervalsMonths: number[];
  isActive: boolean;
  attributes?: ProtocolAttribute[];
}

interface StabilityResult {
  id: string;
  attributeId: string;
  reportedValue: string;
  reportedUnit: string;
  passFail: string;
  notes: string | null;
}

interface Timepoint {
  id: string;
  batchId: string;
  intervalMonths: number;
  scheduledAt: string;
  completedAt: string | null;
  results: StabilityResult[];
}

interface Conclusion {
  id: string;
  supportedShelfLifeMonths: number;
  basis: string;
  outcome: string;
  signatureId: string | null;
}

interface Batch {
  id: string;
  protocolId: string;
  protocolName: string;
  bprId: string;
  enrolledAt: string;
  status: string;
  timepoints: Timepoint[];
  conclusion: Conclusion | null;
  overdueCount: number;
  upcomingCount: number;
}

interface OverdueItem {
  timepoint: Timepoint;
  batchId: string;
  bprId: string;
  protocolName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ONGOING:   "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    CONCLUDED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

// ─── Protocol Create Modal ────────────────────────────────────────────────────

function CreateProtocolModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [storageCondition, setStorageCondition] = useState("");
  const [description, setDescription] = useState("");
  const [intervals, setIntervals] = useState("3, 6, 12, 24");
  const [attributes, setAttributes] = useState([
    { analyteName: "", unit: "", minSpec: "", maxSpec: "", testMethod: "" },
  ]);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/stability/protocols", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stability/protocols"] });
      onClose();
    },
    onError: async (e: unknown) => {
      const msg = e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error";
      setError(msg);
    },
  });

  function addAttribute() {
    setAttributes((prev) => [...prev, { analyteName: "", unit: "", minSpec: "", maxSpec: "", testMethod: "" }]);
  }

  function updateAttribute(i: number, field: string, value: string) {
    setAttributes((prev) => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  }

  function removeAttribute(i: number) {
    setAttributes((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    setError("");
    const parsedIntervals = intervals
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (!parsedIntervals.length) { setError("Enter at least one valid test interval"); return; }
    const validAttrs = attributes.filter((a) => a.analyteName.trim());
    if (!validAttrs.length) { setError("Add at least one analyte"); return; }
    mutation.mutate({
      name,
      storageCondition,
      description: description || null,
      testIntervalsMonths: parsedIntervals,
      attributes: validAttrs.map((a) => ({
        analyteName: a.analyteName,
        unit: a.unit || null,
        minSpec: a.minSpec || null,
        maxSpec: a.maxSpec || null,
        testMethod: a.testMethod || null,
      })),
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Stability Protocol</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Protocol Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CBD 25mg Softgel Stability" />
            </div>
            <div className="space-y-1">
              <Label>Storage Condition *</Label>
              <Input value={storageCondition} onChange={(e) => setStorageCondition(e.target.value)} placeholder="e.g. 25°C / 60% RH" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Test Intervals (months, comma-separated) *</Label>
            <Input value={intervals} onChange={(e) => setIntervals(e.target.value)} placeholder="3, 6, 12, 24" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Analytes / Attributes *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addAttribute}>+ Add analyte</Button>
            </div>
            {attributes.map((a, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-end border rounded p-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Analyte name</Label>
                  <Input value={a.analyteName} onChange={(e) => updateAttribute(i, "analyteName", e.target.value)} placeholder="e.g. CBD potency" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Input value={a.unit} onChange={(e) => updateAttribute(i, "unit", e.target.value)} placeholder="mg/g" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Min spec</Label>
                  <Input value={a.minSpec} onChange={(e) => updateAttribute(i, "minSpec", e.target.value)} placeholder="22.5" />
                </div>
                <div className="flex gap-1 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Max spec</Label>
                    <Input value={a.maxSpec} onChange={(e) => updateAttribute(i, "maxSpec", e.target.value)} placeholder="27.5" />
                  </div>
                  {attributes.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeAttribute(i)}>×</Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending || !name || !storageCondition}>
              {mutation.isPending ? "Creating…" : "Create Protocol"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Protocols List ───────────────────────────────────────────────────────────

function ProtocolsView() {
  const { user } = useAuth();
  const isQA = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: protocols = [], isLoading } = useQuery<Protocol[]>({
    queryKey: ["/api/stability/protocols"],
    queryFn: async () => (await apiRequest("GET", "/api/stability/protocols")).json(),
  });

  const { data: detail } = useQuery<Protocol>({
    queryKey: ["/api/stability/protocols", selectedId],
    queryFn: async () => (await apiRequest("GET", `/api/stability/protocols/${selectedId}`)).json(),
    enabled: !!selectedId,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Stability Protocols</h2>
        {isQA && <Button size="sm" onClick={() => setShowCreate(true)}>+ New Protocol</Button>}
      </div>

      <div className="border rounded-md overflow-hidden" data-tour="stability-protocols-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Storage Condition</th>
              <th className="text-left px-4 py-2 font-medium">Intervals (mo)</th>
              <th className="text-left px-4 py-2 font-medium">Product</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {protocols.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No protocols yet</td></tr>
            )}
            {protocols.map((p) => (
              <tr
                key={p.id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
              >
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{p.storageCondition}</td>
                <td className="px-4 py-2">{p.testIntervalsMonths.join(", ")}</td>
                <td className="px-4 py-2">{p.productName ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2">
                  <Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && detail && (
        <div className="border rounded-md p-4 space-y-3">
          <h3 className="font-medium">{detail.name} — Analytes</h3>
          {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Analyte</th>
                <th className="text-left px-3 py-1.5 font-medium">Unit</th>
                <th className="text-left px-3 py-1.5 font-medium">Min Spec</th>
                <th className="text-left px-3 py-1.5 font-medium">Max Spec</th>
                <th className="text-left px-3 py-1.5 font-medium">Test Method</th>
              </tr>
            </thead>
            <tbody>
              {(detail.attributes ?? []).map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-1.5">{a.analyteName}</td>
                  <td className="px-3 py-1.5">{a.unit ?? "—"}</td>
                  <td className="px-3 py-1.5">{a.minSpec ?? "—"}</td>
                  <td className="px-3 py-1.5">{a.maxSpec ?? "—"}</td>
                  <td className="px-3 py-1.5">{a.testMethod ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateProtocolModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ─── Enter Results Modal ──────────────────────────────────────────────────────

function EnterResultsModal({
  timepoint,
  attributes,
  onClose,
}: {
  timepoint: Timepoint;
  attributes: ProtocolAttribute[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, { value: string; unit: string; passFail: string; notes: string }>>(
    Object.fromEntries(attributes.map((a) => [a.id, { value: "", unit: a.unit ?? "", passFail: "PASS", notes: "" }])),
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", `/api/stability/timepoints/${timepoint.id}/results`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stability/batches"] });
      onClose();
    },
    onError: async (e: unknown) => {
      const msg = e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error";
      setError(msg);
    },
  });

  function submit() {
    setError("");
    const results = attributes.map((a) => ({
      attributeId:   a.id,
      reportedValue: values[a.id]?.value ?? "",
      reportedUnit:  values[a.id]?.unit ?? "",
      passFail:      values[a.id]?.passFail ?? "PASS",
      notes:         values[a.id]?.notes || null,
    }));
    if (results.some((r) => !r.reportedValue)) { setError("Enter a value for all analytes"); return; }
    mutation.mutate({ results });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enter Results — {timepoint.intervalMonths}m timepoint (due {fmt(timepoint.scheduledAt)})</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {attributes.map((a) => (
            <div key={a.id} className="grid grid-cols-4 gap-2 items-end border rounded p-3">
              <div className="col-span-4 text-sm font-medium">{a.analyteName}</div>
              <div className="space-y-1">
                <Label className="text-xs">Value *</Label>
                <Input
                  value={values[a.id]?.value ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id]!, value: e.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit</Label>
                <Input
                  value={values[a.id]?.unit ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id]!, unit: e.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pass/Fail</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={values[a.id]?.passFail ?? "PASS"}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id]!, passFail: e.target.value } }))}
                >
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input
                  value={values[a.id]?.notes ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id]!, notes: e.target.value } }))}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save Results"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Conclude Batch Modal (Part-11 signed) ────────────────────────────────────

function ConcludeBatchModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [shelfLife, setShelfLife] = useState("");
  const [basis, setBasis] = useState("");
  const [outcome, setOutcome] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/stability/batches/${batchId}/conclude`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stability/batches"] });
      onClose();
    },
    onError: async (e: unknown) => {
      const msg = e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error";
      setError(msg);
    },
  });

  function submit() {
    setError("");
    const months = parseInt(shelfLife, 10);
    if (isNaN(months) || months <= 0) { setError("Enter a valid shelf-life in months"); return; }
    if (!basis.trim()) { setError("Basis is required"); return; }
    if (!outcome.trim()) { setError("Outcome is required"); return; }
    if (!password) { setError("Password is required for electronic signature"); return; }
    mutation.mutate({ supportedShelfLifeMonths: months, basis, outcome, password });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Shelf-Life Conclusion</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-1">
            <Label>Supported Shelf Life (months) *</Label>
            <Input type="number" min={1} value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Basis *</Label>
            <Textarea rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Data analysis supporting the shelf-life determination…" />
          </div>
          <div className="space-y-1">
            <Label>Outcome *</Label>
            <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Product meets stability requirements at all timepoints tested." />
          </div>
          <div className="space-y-1 border-t pt-3">
            <Label>Electronic Signature — Password *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">Re-enter your password to sign this record (21 CFR Part 11 §11.200).</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Signing…" : "Sign & Conclude"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enroll Batch Modal ───────────────────────────────────────────────────────

function EnrollBatchModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [protocolId, setProtocolId] = useState("");
  const [bprId, setBprId] = useState("");
  const [enrolledAt, setEnrolledAt] = useState(new Date().toISOString().split("T")[0]!);
  const [error, setError] = useState("");

  const { data: protocols = [] } = useQuery<Protocol[]>({
    queryKey: ["/api/stability/protocols"],
    queryFn: async () => (await apiRequest("GET", "/api/stability/protocols")).json(),
  });

  const mutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/stability/batches", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/stability/batches"] });
      onClose();
    },
    onError: async (e: unknown) => {
      const msg = e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error";
      setError(msg);
    },
  });

  function submit() {
    setError("");
    if (!protocolId) { setError("Select a protocol"); return; }
    if (!bprId.trim()) { setError("Enter a BPR ID"); return; }
    mutation.mutate({ protocolId, bprId, enrolledAt: new Date(enrolledAt).toISOString() });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll Batch in Stability Program</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-1">
            <Label>Protocol *</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={protocolId}
              onChange={(e) => setProtocolId(e.target.value)}
            >
              <option value="">Select protocol…</option>
              {protocols.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>BPR / Batch Number *</Label>
            <Input value={bprId} onChange={(e) => setBprId(e.target.value)} placeholder="e.g. BPR-2024-001" />
          </div>
          <div className="space-y-1">
            <Label>Enrollment Date *</Label>
            <Input type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Enrolling…" : "Enroll Batch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Batch Detail View ────────────────────────────────────────────────────────

function BatchDetailView({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const { user } = useAuth();
  const isQA = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;
  const [enterResultsFor, setEnterResultsFor] = useState<Timepoint | null>(null);
  const [showConclude, setShowConclude] = useState(false);

  const { data: batch, isLoading } = useQuery<Batch>({
    queryKey: ["/api/stability/batches", batchId],
    queryFn: async () => (await apiRequest("GET", `/api/stability/batches/${batchId}`)).json(),
  });

  const { data: protocol } = useQuery<Protocol>({
    queryKey: ["/api/stability/protocols", batch?.protocolId],
    queryFn: async () => (await apiRequest("GET", `/api/stability/protocols/${batch!.protocolId}`)).json(),
    enabled: !!batch?.protocolId,
  });

  if (isLoading || !batch) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const attributes = protocol?.attributes ?? [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div>
          <h2 className="text-base font-semibold">{batch.protocolName}</h2>
          <p className="text-sm text-muted-foreground">BPR: {batch.bprId} · Enrolled: {fmt(batch.enrolledAt)}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge status={batch.status} />
          {isQA && batch.status === "ONGOING" && batch.timepoints.some((tp) => !!tp.completedAt) && !batch.conclusion && (
            <Button size="sm" onClick={() => setShowConclude(true)}>Issue Conclusion</Button>
          )}
        </div>
      </div>

      {batch.conclusion && (
        <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800 p-4 space-y-1" data-tour="stability-conclusion">
          <p className="text-sm font-semibold text-green-800 dark:text-green-200">Shelf-Life Conclusion</p>
          <p className="text-sm"><span className="font-medium">Supported shelf life:</span> {batch.conclusion.supportedShelfLifeMonths} months</p>
          <p className="text-sm"><span className="font-medium">Outcome:</span> {batch.conclusion.outcome}</p>
          <p className="text-sm text-muted-foreground">{batch.conclusion.basis}</p>
          {batch.conclusion.signatureId && (
            <Badge className="text-xs">Electronically signed</Badge>
          )}
        </div>
      )}

      <div className="space-y-3" data-tour="stability-timepoint-results">
        <h3 className="text-sm font-semibold">Timepoints</h3>
        {batch.timepoints.map((tp) => {
          const isOverdue = !tp.completedAt && new Date(tp.scheduledAt) < new Date();
          const isUpcoming = !tp.completedAt && !isOverdue;
          return (
            <div key={tp.id} className="border rounded-md">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{tp.intervalMonths}m</span>
                  <span className="text-xs text-muted-foreground">Due {fmt(tp.scheduledAt)}</span>
                  {tp.completedAt && <Badge className="text-xs bg-green-100 text-green-800">Completed {fmt(tp.completedAt)}</Badge>}
                  {isOverdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                  {isUpcoming && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                </div>
                {!tp.completedAt && isQA && attributes.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setEnterResultsFor(tp)}>
                    Enter Results
                  </Button>
                )}
              </div>
              {tp.results.length > 0 && (
                <div className="px-4 pb-3 pt-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs">
                        <th className="text-left font-medium pb-1">Analyte</th>
                        <th className="text-left font-medium pb-1">Value</th>
                        <th className="text-left font-medium pb-1">Unit</th>
                        <th className="text-left font-medium pb-1">Result</th>
                        <th className="text-left font-medium pb-1">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tp.results.map((r) => {
                        const attr = attributes.find((a) => a.id === r.attributeId);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="py-1">{attr?.analyteName ?? r.attributeId}</td>
                            <td className="py-1">{r.reportedValue}</td>
                            <td className="py-1">{r.reportedUnit}</td>
                            <td className="py-1">
                              <span className={r.passFail === "PASS" ? "text-green-600" : "text-red-600"}>
                                {r.passFail}
                              </span>
                            </td>
                            <td className="py-1 text-muted-foreground">{r.notes ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {enterResultsFor && (
        <EnterResultsModal
          timepoint={enterResultsFor}
          attributes={attributes}
          onClose={() => setEnterResultsFor(null)}
        />
      )}
      {showConclude && <ConcludeBatchModal batchId={batch.id} onClose={() => setShowConclude(false)} />}
    </div>
  );
}

// ─── Batches List ─────────────────────────────────────────────────────────────

function BatchesView() {
  const { user } = useAuth();
  const isQA = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;
  const [showEnroll, setShowEnroll] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ["/api/stability/batches"],
    queryFn: async () => (await apiRequest("GET", "/api/stability/batches")).json(),
  });

  if (selectedBatchId) {
    return <BatchDetailView batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />;
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Enrolled Batches</h2>
        {isQA && <Button size="sm" onClick={() => setShowEnroll(true)}>+ Enroll Batch</Button>}
      </div>

      <div className="border rounded-md overflow-hidden" data-tour="stability-batches-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">BPR / Batch</th>
              <th className="text-left px-4 py-2 font-medium">Protocol</th>
              <th className="text-left px-4 py-2 font-medium">Enrolled</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No batches enrolled yet</td></tr>
            )}
            {batches.map((b) => (
              <tr
                key={b.id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => setSelectedBatchId(b.id)}
              >
                <td className="px-4 py-2 font-medium">{b.bprId}</td>
                <td className="px-4 py-2">{b.protocolName}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmt(b.enrolledAt)}</td>
                <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEnroll && <EnrollBatchModal onClose={() => setShowEnroll(false)} />}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView() {
  const { data: overdue = [], isLoading: loadingOverdue } = useQuery<OverdueItem[]>({
    queryKey: ["/api/stability/dashboard/overdue"],
    queryFn: async () => (await apiRequest("GET", "/api/stability/dashboard/overdue")).json(),
  });

  const { data: upcoming = [], isLoading: loadingUpcoming } = useQuery<OverdueItem[]>({
    queryKey: ["/api/stability/dashboard/upcoming"],
    queryFn: async () => (await apiRequest("GET", "/api/stability/dashboard/upcoming")).json(),
  });

  if (loadingOverdue || loadingUpcoming) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-base font-semibold">Stability Dashboard</h2>

      {overdue.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Overdue Timepoints ({overdue.length})
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-50 dark:bg-red-950">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Protocol</th>
                  <th className="text-left px-4 py-2 font-medium">BPR</th>
                  <th className="text-left px-4 py-2 font-medium">Interval</th>
                  <th className="text-left px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((item) => (
                  <tr key={item.timepoint.id} className="border-t">
                    <td className="px-4 py-2">{item.protocolName}</td>
                    <td className="px-4 py-2">{item.bprId}</td>
                    <td className="px-4 py-2">{item.timepoint.intervalMonths}m</td>
                    <td className="px-4 py-2 text-red-600 font-medium">{fmt(item.timepoint.scheduledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            Upcoming (next 14 days) ({upcoming.length})
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-yellow-50 dark:bg-yellow-950">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Protocol</th>
                  <th className="text-left px-4 py-2 font-medium">BPR</th>
                  <th className="text-left px-4 py-2 font-medium">Interval</th>
                  <th className="text-left px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((item) => (
                  <tr key={item.timepoint.id} className="border-t">
                    <td className="px-4 py-2">{item.protocolName}</td>
                    <td className="px-4 py-2">{item.bprId}</td>
                    <td className="px-4 py-2">{item.timepoint.intervalMonths}m</td>
                    <td className="px-4 py-2 text-yellow-700">{fmt(item.timepoint.scheduledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {overdue.length === 0 && upcoming.length === 0 && (
        <p className="text-sm text-muted-foreground">No overdue or upcoming timepoints.</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type StabilityTab = "dashboard" | "batches" | "protocols";

export default function StabilityPage() {
  const [activeTab, setActiveTab] = useState<StabilityTab>("dashboard");

  const tabs: { id: StabilityTab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "batches", label: "Enrolled Batches" },
    { id: "protocols", label: "Protocols" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 flex gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === "dashboard" && <DashboardView />}
        {activeTab === "batches" && <BatchesView />}
        {activeTab === "protocols" && <ProtocolsView />}
      </div>
    </div>
  );
}
