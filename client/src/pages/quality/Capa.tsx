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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ─── Types ────────────────────────────────────────────────────────────────────

type NcStatus = "OPEN" | "UNDER_INVESTIGATION" | "CAPA_OPEN" | "CLOSED";
type NcType = "OOS" | "COMPLAINT" | "RETURN" | "DEVIATION" | "EM_EXCURSION" | "AUDIT_FINDING" | "OTHER";
type NcSeverity = "CRITICAL" | "MAJOR" | "MINOR";
type CapaStatus = "OPEN" | "EFFECTIVENESS_PENDING" | "CLOSED";

interface Capa {
  id: string;
  capaNumber: string;
  ncId: string;
  ncNumber: string;
  capaType: "CORRECTIVE" | "PREVENTIVE" | "BOTH";
  rootCause: string;
  status: CapaStatus;
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  actions: CapaAction[];
  effectivenessChecks: EffectivenessCheck[];
}

interface CapaAction {
  id: string;
  capaId: string;
  description: string;
  assignedToUserId: string | null;
  dueAt: string | null;
  completedAt: string | null;
}

interface EffectivenessCheck {
  id: string;
  capaId: string;
  scheduledAt: string;
  result: "EFFECTIVE" | "NOT_EFFECTIVE" | "PENDING";
  performedAt: string | null;
  notes: string | null;
}

interface NC {
  id: string;
  ncNumber: string;
  type: NcType;
  severity: NcSeverity;
  status: NcStatus;
  title: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdByName: string;
  createdAt: string;
  capa: Capa | null;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

const NC_STATUS_BADGE: Record<NcStatus, string> = {
  OPEN: "bg-blue-500/20 text-blue-600 border-0",
  UNDER_INVESTIGATION: "bg-amber-500/20 text-amber-600 border-0",
  CAPA_OPEN: "bg-purple-500/20 text-purple-600 border-0",
  CLOSED: "bg-muted text-muted-foreground border-0",
};

const CAPA_STATUS_BADGE: Record<CapaStatus, string> = {
  OPEN: "bg-purple-500/20 text-purple-600 border-0",
  EFFECTIVENESS_PENDING: "bg-amber-500/20 text-amber-600 border-0",
  CLOSED: "bg-muted text-muted-foreground border-0",
};

const SEVERITY_BADGE: Record<NcSeverity, string> = {
  CRITICAL: "bg-destructive/20 text-destructive border-0",
  MAJOR: "bg-amber-500/20 text-amber-600 border-0",
  MINOR: "bg-muted text-muted-foreground border-0",
};

const NC_TYPE_LABELS: Record<NcType, string> = {
  OOS: "OOS", COMPLAINT: "Complaint", RETURN: "Return", DEVIATION: "Deviation",
  EM_EXCURSION: "EM Excursion", AUDIT_FINDING: "Audit Finding", OTHER: "Other",
};

// ─── NC Detail ────────────────────────────────────────────────────────────────

function NcDetail({ nc, onBack, canMutate }: { nc: NC; onBack: () => void; canMutate: boolean }) {
  const qc = useQueryClient();
  const [showOpenCapa, setShowOpenCapa] = useState(false);
  const [showCapaDetail, setShowCapaDetail] = useState(false);
  const [capaForm, setCapaForm] = useState({ capaType: "CORRECTIVE" as const, rootCause: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: freshNc } = useQuery<NC>({
    queryKey: ["/api/quality/capa/nonconformances", nc.id],
    queryFn: async () => (await apiRequest("GET", `/api/quality/capa/nonconformances/${nc.id}`)).json(),
    initialData: nc,
  });
  const data = freshNc ?? nc;

  const statusMutation = useMutation({
    mutationFn: (status: NcStatus) =>
      apiRequest("PATCH", `/api/quality/capa/nonconformances/${nc.id}/status`, { status }).then((r) => r.json()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/quality/capa/nonconformances"] }),
  });

  const openCapaMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/quality/capa/capas", {
        ncId: nc.id, capaType: capaForm.capaType, rootCause: capaForm.rootCause, password: capaForm.password,
      }).then((r) => r.json()),
    onSuccess: () => {
      setShowOpenCapa(false);
      setCapaForm({ capaType: "CORRECTIVE", rootCause: "", password: "" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["/api/quality/capa/nonconformances"] });
      void qc.invalidateQueries({ queryKey: ["/api/quality/capa/capas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const nextStatuses: Record<NcStatus, NcStatus | null> = {
    OPEN: "UNDER_INVESTIGATION",
    UNDER_INVESTIGATION: null,
    CAPA_OPEN: null,
    CLOSED: null,
  };
  const nextStatus = nextStatuses[data.status];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">{data.ncNumber}</span>
            <Badge className={NC_STATUS_BADGE[data.status]}>{data.status.replace("_", " ")}</Badge>
            <Badge className={SEVERITY_BADGE[data.severity]}>{data.severity}</Badge>
            <Badge variant="outline" className="text-xs">{NC_TYPE_LABELS[data.type]}</Badge>
          </div>
          <h2 className="text-base font-semibold mt-1">{data.title}</h2>
          {data.description && <p className="text-sm text-muted-foreground mt-1">{data.description}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Opened by {data.createdByName} · {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {canMutate && nextStatus && (
          <Button size="sm" variant="outline" disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate(nextStatus)}>
            Mark {nextStatus.replace("_", " ").toLowerCase()}
          </Button>
        )}
      </div>

      <div className="border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">CAPA</h3>
          {canMutate && !data.capa && data.status !== "CLOSED" && (
            <Button size="sm" onClick={() => setShowOpenCapa(true)}>Open CAPA</Button>
          )}
        </div>

        {data.capa ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm">{data.capa.capaNumber}</span>
            <Badge className={CAPA_STATUS_BADGE[data.capa.status]}>{data.capa.status.replace("_", " ")}</Badge>
            <Button size="sm" variant="outline" onClick={() => setShowCapaDetail(true)}>View CAPA</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No CAPA opened yet.</p>
        )}
      </div>

      {showCapaDetail && data.capa && (
        <CapaDetail capaId={data.capa.id} onBack={() => setShowCapaDetail(false)} canMutate={canMutate} />
      )}

      <Dialog open={showOpenCapa} onOpenChange={(o) => { setShowOpenCapa(o); if (!o) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Open CAPA</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription className="text-sm">{error}</AlertDescription></Alert>}
            <div>
              <Label className="text-xs">CAPA type</Label>
              <Select value={capaForm.capaType} onValueChange={(v) => setCapaForm((f) => ({ ...f, capaType: v as typeof capaForm.capaType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CORRECTIVE">Corrective</SelectItem>
                  <SelectItem value="PREVENTIVE">Preventive</SelectItem>
                  <SelectItem value="BOTH">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Root cause</Label>
              <Textarea value={capaForm.rootCause} onChange={(e) => setCapaForm((f) => ({ ...f, rootCause: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label className="text-xs">Your password (electronic signature)</Label>
              <Input type="password" value={capaForm.password} onChange={(e) => setCapaForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowOpenCapa(false)}>Cancel</Button>
              <Button disabled={openCapaMutation.isPending || !capaForm.rootCause || !capaForm.password}
                onClick={() => openCapaMutation.mutate()}>
                {openCapaMutation.isPending ? "Opening…" : "Open CAPA"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── CAPA Detail ──────────────────────────────────────────────────────────────

function CapaDetail({ capaId, onBack, canMutate }: { capaId: string; onBack: () => void; canMutate: boolean }) {
  const qc = useQueryClient();
  const [showAddAction, setShowAddAction] = useState(false);
  const [showAddCheck, setShowAddCheck] = useState(false);
  const [showRecordResult, setShowRecordResult] = useState<string | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [actionForm, setActionForm] = useState({ description: "", dueAt: "" });
  const [checkForm, setCheckForm] = useState({ scheduledAt: "" });
  const [resultForm, setResultForm] = useState({ result: "EFFECTIVE" as const, notes: "", password: "" });
  const [closeForm, setCloseForm] = useState({ password: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: capa, isLoading } = useQuery<Capa>({
    queryKey: ["/api/quality/capa/capas", capaId],
    queryFn: async () => (await apiRequest("GET", `/api/quality/capa/capas/${capaId}`)).json(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/api/quality/capa/capas", capaId] });
    void qc.invalidateQueries({ queryKey: ["/api/quality/capa/nonconformances"] });
  };

  const addActionMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/quality/capa/capas/${capaId}/actions`, {
      description: actionForm.description,
      dueAt: actionForm.dueAt ? new Date(actionForm.dueAt).toISOString() : undefined,
    }).then((r) => r.json()),
    onSuccess: () => { setShowAddAction(false); setActionForm({ description: "", dueAt: "" }); invalidate(); },
  });

  const completeActionMutation = useMutation({
    mutationFn: (actionId: string) =>
      apiRequest("PATCH", `/api/quality/capa/capas/${capaId}/actions/${actionId}/complete`).then((r) => r.json()),
    onSuccess: () => invalidate(),
  });

  const scheduleCheckMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/quality/capa/capas/${capaId}/effectiveness-checks`, {
      scheduledAt: new Date(checkForm.scheduledAt).toISOString(),
    }).then((r) => r.json()),
    onSuccess: () => { setShowAddCheck(false); setCheckForm({ scheduledAt: "" }); invalidate(); },
  });

  const recordResultMutation = useMutation({
    mutationFn: (checkId: string) =>
      apiRequest("PATCH", `/api/quality/capa/capas/${capaId}/effectiveness-checks/${checkId}`, {
        result: resultForm.result, notes: resultForm.notes || undefined, password: resultForm.password,
      }).then((r) => r.json()),
    onSuccess: () => { setShowRecordResult(null); setResultForm({ result: "EFFECTIVE", notes: "", password: "" }); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/quality/capa/capas/${capaId}/close`, { password: closeForm.password }).then((r) => r.json()),
    onSuccess: () => { setShowClose(false); setCloseForm({ password: "" }); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !capa) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const allActionsComplete = capa.actions.length > 0 && capa.actions.every((a) => a.completedAt);
  const hasCompletedCheck = capa.effectivenessChecks.some((c) => c.result !== "PENDING");
  const canClose = canMutate && capa.status !== "CLOSED" && hasCompletedCheck;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{capa.capaNumber}</span>
            <Badge className={CAPA_STATUS_BADGE[capa.status]}>{capa.status.replace("_", " ")}</Badge>
            <Badge variant="outline" className="text-xs">{capa.capaType}</Badge>
          </div>
          <p className="text-sm mt-1"><span className="text-muted-foreground">Root cause:</span> {capa.rootCause}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Opened by {capa.openedByName} · {new Date(capa.openedAt).toLocaleDateString()}</p>
        </div>
        {canClose && (
          <Button size="sm" variant="destructive" onClick={() => setShowClose(true)}>Close CAPA</Button>
        )}
      </div>

      {/* Actions */}
      <div className="border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Actions</h3>
          {canMutate && capa.status !== "CLOSED" && (
            <Button size="sm" variant="outline" onClick={() => setShowAddAction(true)}>+ Add action</Button>
          )}
        </div>
        {capa.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions added yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">Description</th>
                <th className="text-left p-2 font-medium">Due</th>
                <th className="text-left p-2 font-medium">Status</th>
                {canMutate && <th className="p-2" />}
              </tr>
            </thead>
            <tbody>
              {capa.actions.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-2">{a.description}</td>
                  <td className="p-2 text-xs">{a.dueAt ? new Date(a.dueAt).toLocaleDateString() : "—"}</td>
                  <td className="p-2">
                    {a.completedAt
                      ? <Badge className="bg-green-500/20 text-green-600 border-0">Done</Badge>
                      : <Badge className="bg-muted text-muted-foreground border-0">Pending</Badge>}
                  </td>
                  {canMutate && (
                    <td className="p-2">
                      {!a.completedAt && capa.status !== "CLOSED" && (
                        <Button size="sm" variant="ghost" onClick={() => completeActionMutation.mutate(a.id)}>
                          Mark done
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Effectiveness checks */}
      <div className="border rounded-md p-4 space-y-3" data-tour="capa-effectiveness-check">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Effectiveness Check</h3>
          {canMutate && capa.status !== "CLOSED" && allActionsComplete && capa.effectivenessChecks.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowAddCheck(true)}>Schedule check</Button>
          )}
        </div>
        {capa.effectivenessChecks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {allActionsComplete ? "Schedule an effectiveness check once the 30-day window passes." : "Complete all actions before scheduling an effectiveness check."}
          </p>
        ) : (
          capa.effectivenessChecks.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm">Scheduled: {new Date(c.scheduledAt).toLocaleDateString()}</p>
                {c.performedAt && <p className="text-xs text-muted-foreground">Performed: {new Date(c.performedAt).toLocaleDateString()}</p>}
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                {c.result === "PENDING" ? (
                  <Badge className="bg-muted text-muted-foreground border-0">Pending</Badge>
                ) : c.result === "EFFECTIVE" ? (
                  <Badge className="bg-green-500/20 text-green-600 border-0">Effective</Badge>
                ) : (
                  <Badge className="bg-destructive/20 text-destructive border-0">Not effective</Badge>
                )}
                {canMutate && c.result === "PENDING" && capa.status !== "CLOSED" && (
                  <Button size="sm" variant="outline" onClick={() => setShowRecordResult(c.id)}>Record result</Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add action dialog */}
      <Dialog open={showAddAction} onOpenChange={setShowAddAction}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add action</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea value={actionForm.description} onChange={(e) => setActionForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Due date (optional)</Label>
              <Input type="date" value={actionForm.dueAt} onChange={(e) => setActionForm((f) => ({ ...f, dueAt: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddAction(false)}>Cancel</Button>
              <Button disabled={addActionMutation.isPending || !actionForm.description} onClick={() => addActionMutation.mutate()}>
                {addActionMutation.isPending ? "Saving…" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule check dialog */}
      <Dialog open={showAddCheck} onOpenChange={setShowAddCheck}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule effectiveness check</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Must be at least 30 days after the last action was completed.</p>
            <div>
              <Label className="text-xs">Scheduled date</Label>
              <Input type="date" value={checkForm.scheduledAt} onChange={(e) => setCheckForm({ scheduledAt: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddCheck(false)}>Cancel</Button>
              <Button disabled={scheduleCheckMutation.isPending || !checkForm.scheduledAt} onClick={() => scheduleCheckMutation.mutate()}>
                {scheduleCheckMutation.isPending ? "Saving…" : "Schedule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record result dialog */}
      <Dialog open={!!showRecordResult} onOpenChange={(o) => { if (!o) { setShowRecordResult(null); setError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record effectiveness result</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription className="text-sm">{error}</AlertDescription></Alert>}
            <div>
              <Label className="text-xs">Result</Label>
              <Select value={resultForm.result} onValueChange={(v) => setResultForm((f) => ({ ...f, result: v as typeof resultForm.result }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFFECTIVE">Effective</SelectItem>
                  <SelectItem value="NOT_EFFECTIVE">Not effective</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={resultForm.notes} onChange={(e) => setResultForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Your password (electronic signature)</Label>
              <Input type="password" value={resultForm.password} onChange={(e) => setResultForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowRecordResult(null)}>Cancel</Button>
              <Button disabled={recordResultMutation.isPending || !resultForm.password}
                onClick={() => showRecordResult && recordResultMutation.mutate(showRecordResult)}>
                {recordResultMutation.isPending ? "Saving…" : "Save result"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close CAPA dialog */}
      <Dialog open={showClose} onOpenChange={(o) => { setShowClose(o); if (!o) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Close CAPA</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription className="text-sm">{error}</AlertDescription></Alert>}
            <p className="text-sm text-muted-foreground">Closing this CAPA will also close the linked nonconformance. This requires a Part-11 electronic signature.</p>
            <div>
              <Label className="text-xs">Your password</Label>
              <Input type="password" value={closeForm.password} onChange={(e) => setCloseForm({ password: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowClose(false)}>Cancel</Button>
              <Button variant="destructive" disabled={closeMutation.isPending || !closeForm.password} onClick={() => closeMutation.mutate()}>
                {closeMutation.isPending ? "Closing…" : "Close CAPA"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Management Reviews ───────────────────────────────────────────────────────

interface ManagementReview {
  id: string;
  reviewNumber: string;
  period: string;
  reviewedAt: string;
  outcome: "SATISFACTORY" | "REQUIRES_ACTION";
  summary: string;
  capaIds?: string[];
}

function ManagementReviewsView({ canMutate }: { canMutate: boolean }) {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ period: "", reviewedAt: new Date().toISOString().slice(0, 10), summary: "", outcome: "SATISFACTORY" as const, capaIds: [] as string[], password: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: reviews = [] } = useQuery<ManagementReview[]>({
    queryKey: ["/api/quality/capa/management-reviews"],
    queryFn: async () => (await apiRequest("GET", "/api/quality/capa/management-reviews")).json(),
  });

  const { data: capas = [] } = useQuery<Capa[]>({
    queryKey: ["/api/quality/capa/capas"],
    queryFn: async () => (await apiRequest("GET", "/api/quality/capa/capas")).json(),
    enabled: showNew,
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/quality/capa/management-reviews", {
      ...form, reviewedAt: new Date(form.reviewedAt).toISOString(),
    }).then((r) => r.json()),
    onSuccess: () => {
      setShowNew(false);
      setForm({ period: "", reviewedAt: new Date().toISOString().slice(0, 10), summary: "", outcome: "SATISFACTORY", capaIds: [], password: "" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["/api/quality/capa/management-reviews"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{reviews.length} management review{reviews.length !== 1 ? "s" : ""}</p>
        {canMutate && <Button size="sm" onClick={() => setShowNew(true)}>+ New review</Button>}
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Ref</th>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No management reviews yet.</td></tr>
            )}
            {reviews.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono text-xs">{r.reviewNumber}</td>
                <td className="p-3">{r.period}</td>
                <td className="p-3 text-xs">{new Date(r.reviewedAt).toLocaleDateString()}</td>
                <td className="p-3">
                  {r.outcome === "SATISFACTORY"
                    ? <Badge className="bg-green-500/20 text-green-600 border-0">Satisfactory</Badge>
                    : <Badge className="bg-amber-500/20 text-amber-600 border-0">Requires action</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showNew} onOpenChange={(o) => { setShowNew(o); if (!o) setError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New management review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription className="text-sm">{error}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Period (e.g. Q1 2026)</Label>
                <Input value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} placeholder="Q2 2026" />
              </div>
              <div>
                <Label className="text-xs">Reviewed at</Label>
                <Input type="date" value={form.reviewedAt} onChange={(e) => setForm((f) => ({ ...f, reviewedAt: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Summary</Label>
              <Textarea value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label className="text-xs">Outcome</Label>
              <Select value={form.outcome} onValueChange={(v) => setForm((f) => ({ ...f, outcome: v as typeof form.outcome }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SATISFACTORY">Satisfactory</SelectItem>
                  <SelectItem value="REQUIRES_ACTION">Requires action</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {capas.length > 0 && (
              <div>
                <Label className="text-xs">CAPAs reviewed (optional)</Label>
                <div className="max-h-32 overflow-y-auto border rounded p-2 space-y-1">
                  {capas.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.capaIds.includes(c.id)}
                        onChange={(e) => setForm((f) => ({ ...f, capaIds: e.target.checked ? [...f.capaIds, c.id] : f.capaIds.filter((id) => id !== c.id) }))} />
                      {c.capaNumber} — {c.rootCause.slice(0, 50)}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Your password (electronic signature)</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button disabled={createMutation.isPending || !form.period || !form.summary || !form.password}
                onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "Saving…" : "Sign & save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main CAPA page ───────────────────────────────────────────────────────────

type View = "nc-list" | "nc-detail" | "capa-list" | "management-reviews";

export default function CapaPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canMutate = !!(user?.roles.includes("QA") || user?.roles.includes("ADMIN"));

  const [view, setView] = useState<View>("nc-list");
  const [selectedNc, setSelectedNc] = useState<NC | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [showNewNc, setShowNewNc] = useState(false);
  const [ncForm, setNcForm] = useState({ type: "OOS" as NcType, severity: "MAJOR" as NcSeverity, title: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: ncs = [], isLoading } = useQuery<NC[]>({
    queryKey: ["/api/quality/capa/nonconformances", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return (await apiRequest("GET", `/api/quality/capa/nonconformances?${params}`)).json();
    },
  });

  const { data: capas = [] } = useQuery<Capa[]>({
    queryKey: ["/api/quality/capa/capas"],
    queryFn: async () => (await apiRequest("GET", "/api/quality/capa/capas")).json(),
    enabled: view === "capa-list",
  });

  const createNcMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/quality/capa/nonconformances", ncForm).then((r) => r.json()),
    onSuccess: () => {
      setShowNewNc(false);
      setNcForm({ type: "OOS", severity: "MAJOR", title: "", description: "" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["/api/quality/capa/nonconformances"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (selectedNc && view === "nc-detail") {
    return <NcDetail nc={selectedNc} onBack={() => { setSelectedNc(null); setView("nc-list"); }} canMutate={canMutate} />;
  }

  const STATUS_FILTERS = [
    { value: "", label: "All" },
    { value: "OPEN", label: "Open" },
    { value: "UNDER_INVESTIGATION", label: "Under investigation" },
    { value: "CAPA_OPEN", label: "CAPA open" },
    { value: "CLOSED", label: "Closed" },
  ];

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {([
            { v: "nc-list", label: "Nonconformances" },
            { v: "capa-list", label: "CAPAs" },
            { v: "management-reviews", label: "Management Reviews" },
          ] as { v: View; label: string }[]).map(({ v, label }) => (
            <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>
              {label}
            </Button>
          ))}
        </div>
        {view === "nc-list" && (
          <Button size="sm" onClick={() => { setError(null); setShowNewNc(true); }} data-tour="capa-new-nc-button">+ Open NC</Button>
        )}
      </div>

      {/* NC List */}
      {view === "nc-list" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <Button key={f.value} size="sm" variant={statusFilter === f.value ? "default" : "outline"}
                onClick={() => setStatusFilter(f.value)}>
                {f.label}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="border rounded-md overflow-hidden" data-tour="capa-nc-list">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">NC#</th>
                    <th className="text-left p-3 font-medium">Title</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="text-left p-3 font-medium">Severity</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">CAPA</th>
                    <th className="text-left p-3 font-medium">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {ncs.length === 0 && (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No nonconformances found.</td></tr>
                  )}
                  {ncs.map((nc) => (
                    <tr key={nc.id} className="border-t cursor-pointer hover:bg-muted/30"
                      onClick={() => { setSelectedNc(nc); setView("nc-detail"); }}>
                      <td className="p-3 font-mono text-xs">{nc.ncNumber}</td>
                      <td className="p-3 max-w-[200px] truncate">{nc.title}</td>
                      <td className="p-3 text-xs">{NC_TYPE_LABELS[nc.type]}</td>
                      <td className="p-3"><Badge className={`text-xs ${SEVERITY_BADGE[nc.severity]}`}>{nc.severity}</Badge></td>
                      <td className="p-3"><Badge className={`text-xs ${NC_STATUS_BADGE[nc.status]}`}>{nc.status.replace("_", " ")}</Badge></td>
                      <td className="p-3 font-mono text-xs">{nc.capa?.capaNumber ?? "—"}</td>
                      <td className="p-3 text-xs">{new Date(nc.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* CAPA List */}
      {view === "capa-list" && (
        <div className="border rounded-md overflow-hidden" data-tour="capa-capa-list">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">CAPA#</th>
                <th className="text-left p-3 font-medium">NC#</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Root cause</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {capas.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No CAPAs found.</td></tr>
              )}
              {capas.map((c) => (
                <tr key={c.id} className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => {
                    const nc = ncs.find((n) => n.id === c.ncId);
                    if (nc) { setSelectedNc(nc); setView("nc-detail"); }
                  }}>
                  <td className="p-3 font-mono text-xs">{c.capaNumber}</td>
                  <td className="p-3 font-mono text-xs">{c.ncNumber}</td>
                  <td className="p-3 text-xs">{c.capaType}</td>
                  <td className="p-3 text-xs max-w-[200px] truncate">{c.rootCause}</td>
                  <td className="p-3"><Badge className={`text-xs ${CAPA_STATUS_BADGE[c.status]}`}>{c.status.replace("_", " ")}</Badge></td>
                  <td className="p-3 text-xs">{new Date(c.openedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Management Reviews */}
      {view === "management-reviews" && <ManagementReviewsView canMutate={canMutate} />}

      {/* New NC dialog */}
      <Dialog open={showNewNc} onOpenChange={(o) => { setShowNewNc(o); if (!o) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Open nonconformance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {error && <Alert variant="destructive"><AlertDescription className="text-sm">{error}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={ncForm.type} onValueChange={(v) => setNcForm((f) => ({ ...f, type: v as NcType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(NC_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Severity</Label>
                <Select value={ncForm.severity} onValueChange={(v) => setNcForm((f) => ({ ...f, severity: v as NcSeverity }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                    <SelectItem value="MAJOR">Major</SelectItem>
                    <SelectItem value="MINOR">Minor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={ncForm.title} onChange={(e) => setNcForm((f) => ({ ...f, title: e.target.value }))} placeholder="Brief description" />
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea value={ncForm.description} onChange={(e) => setNcForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowNewNc(false)}>Cancel</Button>
              <Button disabled={createNcMutation.isPending || !ncForm.title} onClick={() => createNcMutation.mutate()}>
                {createNcMutation.isPending ? "Saving…" : "Open NC"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
