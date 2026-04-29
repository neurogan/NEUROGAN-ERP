import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface Complaint {
  id: string;
  helpcoreRef: string;
  status: string;
  source: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  complaintText: string;
  lotCodeRaw: string;
  lotId: string | null;
  severity: string | null;
  defectCategory: string | null;
  aeFlag: boolean;
  intakeAt: string;
  triagedAt: string | null;
  investigatedAt: string | null;
  dispositionedAt: string | null;
  closedAt: string | null;
  dispositionSummary: string | null;
  capaRequired: boolean | null;
  capaRef: string | null;
}

interface ComplaintDetailData {
  complaint: Complaint;
  triage: Record<string, unknown> | null;
  investigation: Record<string, unknown> | null;
  labRetests: Record<string, unknown>[];
  adverseEvent: Record<string, unknown> | null;
  saer: Record<string, unknown> | null;
}

const STATUS_LABELS: Record<string, string> = {
  TRIAGE: "Triage",
  LOT_UNRESOLVED: "Lot Unresolved",
  INVESTIGATION: "Investigation",
  AE_URGENT_REVIEW: "AE Urgent Review",
  AWAITING_DISPOSITION: "Awaiting Disposition",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export default function ComplaintDetail() {
  const [, params] = useRoute<{ id: string }>("/quality/complaints/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = params?.id ?? "";

  const { data, isLoading } = useQuery<ComplaintDetailData>({
    queryKey: [`/api/complaints/${id}`],
    queryFn: () => apiRequest("GET", `/api/complaints/${id}`).then((r) => r.json()),
    enabled: !!id,
  });

  const complaint = data?.complaint;

  // ─── Lot link form ────────────────────────────────────────────────────────
  const [lotIdInput, setLotIdInput] = useState("");
  const linkLotMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/complaints/${id}/lot-link`, { lotId: lotIdInput }).then((r) => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] }); },
  });

  // ─── Triage form ─────────────────────────────────────────────────────────
  const [triageForm, setTriageForm] = useState({ severity: "LOW", defectCategory: "OTHER", aeFlag: false, batchLinkConfirmed: false, notes: "" });
  const triageMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/complaints/${id}/triage`, triageForm).then((r) => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] }); },
  });

  // ─── Investigation form ───────────────────────────────────────────────────
  const [invForm, setInvForm] = useState({ rootCause: "", scope: "", retestRequired: false, summaryForReview: "" });
  const invMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/complaints/${id}/investigation`, invForm).then((r) => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] }); },
  });

  // ─── Disposition ceremony ─────────────────────────────────────────────────
  const [dispForm, setDispForm] = useState({ dispositionSummary: "", capaRequired: false, capaRef: "" });
  const [showDispositionCeremony, setShowDispositionCeremony] = useState(false);

  const dispositionMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/complaints/${id}/disposition`, { ...dispForm, password }).then((r) => r.json()),
    onSuccess: () => {
      setShowDispositionCeremony(false);
      void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] });
    },
  });

  if (isLoading || !complaint) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/complaints")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-semibold">{complaint.helpcoreRef}</h1>
        <Badge variant="secondary">{STATUS_LABELS[complaint.status] ?? complaint.status}</Badge>
        {complaint.aeFlag && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> AE
          </Badge>
        )}
      </div>

      {/* ── Intake ── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Intake</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Customer:</span> {complaint.customerName} · {complaint.customerEmail}</div>
          <div><span className="text-muted-foreground">Lot code (raw):</span> <span className="font-mono">{complaint.lotCodeRaw}</span></div>
          <div><span className="text-muted-foreground">Source:</span> {complaint.source}</div>
          <div><span className="text-muted-foreground">Intake at:</span> {new Date(complaint.intakeAt).toLocaleString()}</div>
          <div className="mt-2 p-2 bg-muted rounded text-xs">{complaint.complaintText}</div>
        </CardContent>
      </Card>

      {/* ── Lot unresolved action ── */}
      {complaint.status === "LOT_UNRESOLVED" && (
        <Card className="border-destructive">
          <CardHeader><CardTitle className="text-sm text-destructive">Resolve Lot</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs text-muted-foreground">Lot code "{complaint.lotCodeRaw}" did not match any lot at intake. Enter the matching lot UUID to proceed.</div>
            <div className="flex gap-2">
              <Input placeholder="Lot UUID" value={lotIdInput} onChange={(e) => setLotIdInput(e.target.value)} className="font-mono" />
              <Button size="sm" onClick={() => linkLotMutation.mutate()} disabled={!lotIdInput || linkLotMutation.isPending}>
                Link lot
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Triage action ── */}
      {complaint.status === "TRIAGE" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Triage</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Severity</Label>
                <Select value={triageForm.severity} onValueChange={(v) => setTriageForm((f) => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Defect category</Label>
                <Select value={triageForm.defectCategory} onValueChange={(v) => setTriageForm((f) => ({ ...f, defectCategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["FOREIGN_MATTER","LABEL","POTENCY","TASTE_SMELL","PACKAGE","CUSTOMER_USE_ERROR","OTHER"].map((c) => (
                      <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={triageForm.aeFlag} onCheckedChange={(v) => setTriageForm((f) => ({ ...f, aeFlag: !!v }))} />
                Adverse event flag
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={triageForm.batchLinkConfirmed} onCheckedChange={(v) => setTriageForm((f) => ({ ...f, batchLinkConfirmed: !!v }))} />
                Batch link confirmed
              </label>
            </div>
            <Textarea placeholder="Notes (optional)" value={triageForm.notes} onChange={(e) => setTriageForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            <Button size="sm" onClick={() => triageMutation.mutate()} disabled={triageMutation.isPending}>
              Submit triage
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── AE urgent review ── */}
      {complaint.status === "AE_URGENT_REVIEW" && (
        <Card className="border-destructive">
          <CardHeader><CardTitle className="text-sm text-destructive">Adverse Event — Urgent Review</CardTitle></CardHeader>
          <CardContent>
            <Button size="sm" onClick={() => navigate(`/quality/complaints/${id}/ae`)}>
              Open AE review panel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Investigation ── */}
      {complaint.status === "INVESTIGATION" && !data?.investigation && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Investigation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Root cause</Label>
              <Textarea value={invForm.rootCause} onChange={(e) => setInvForm((f) => ({ ...f, rootCause: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Scope</Label>
              <Textarea value={invForm.scope} onChange={(e) => setInvForm((f) => ({ ...f, scope: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Summary for review</Label>
              <Textarea value={invForm.summaryForReview} onChange={(e) => setInvForm((f) => ({ ...f, summaryForReview: e.target.value }))} rows={3} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={invForm.retestRequired} onCheckedChange={(v) => setInvForm((f) => ({ ...f, retestRequired: !!v }))} />
              Lab retest required
            </label>
            <Button size="sm" onClick={() => invMutation.mutate()} disabled={invMutation.isPending || !invForm.rootCause || !invForm.scope || !invForm.summaryForReview}>
              Submit investigation
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Existing investigation + package button ── */}
      {data?.investigation && complaint.status === "INVESTIGATION" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Investigation (submitted)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Root cause:</span> {String((data.investigation as Record<string, unknown>).rootCause ?? "")}</div>
            <div><span className="text-muted-foreground">Scope:</span> {String((data.investigation as Record<string, unknown>).scope ?? "")}</div>
            {!(data.investigation as Record<string, unknown>).packagedAt && (
              <Button
                size="sm"
                onClick={() => {
                  const inv = data.investigation as Record<string, unknown>;
                  void apiRequest("POST", `/api/complaints/${id}/investigation/package`, { investigationId: inv.id })
                    .then(() => qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] }));
                }}
              >
                Package investigation
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── AE link if aeFlag ── */}
      {complaint.aeFlag && complaint.status !== "AE_URGENT_REVIEW" && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" /> Adverse Event</CardTitle></CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" onClick={() => navigate(`/quality/complaints/${id}/ae`)}>
              Open AE / SAER panel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Disposition ── */}
      {complaint.status === "AWAITING_DISPOSITION" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Disposition</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Disposition summary</Label>
              <Textarea value={dispForm.dispositionSummary} onChange={(e) => setDispForm((f) => ({ ...f, dispositionSummary: e.target.value }))} rows={3} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={dispForm.capaRequired} onCheckedChange={(v) => setDispForm((f) => ({ ...f, capaRequired: !!v }))} />
              CAPA required
            </label>
            {dispForm.capaRequired && (
              <div>
                <Label className="text-xs">CAPA reference</Label>
                <Input value={dispForm.capaRef} onChange={(e) => setDispForm((f) => ({ ...f, capaRef: e.target.value }))} />
              </div>
            )}
            <Button
              size="sm"
              onClick={() => setShowDispositionCeremony(true)}
              disabled={!dispForm.dispositionSummary}
            >
              Sign disposition (F-04)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Closed summary ── */}
      {complaint.status === "CLOSED" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Disposition (signed)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>{complaint.dispositionSummary}</div>
            <div><span className="text-muted-foreground">CAPA required:</span> {complaint.capaRequired ? "Yes" : "No"}</div>
            {complaint.capaRef && <div><span className="text-muted-foreground">CAPA ref:</span> {complaint.capaRef}</div>}
            <div><span className="text-muted-foreground">Closed at:</span> {complaint.closedAt ? new Date(complaint.closedAt).toLocaleString() : ""}</div>
          </CardContent>
        </Card>
      )}

      {/* ── Lab retests ── */}
      {(data?.labRetests?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Lab Retests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.labRetests.map((r) => (
                <div key={String(r.id)} className="text-xs border rounded p-2">
                  <span className="font-medium">{String(r.method)}</span>
                  <span className="ml-2 text-muted-foreground">{r.completedAt ? "Completed" : "Pending"}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── F-04 Signature ceremony ── */}
      <SignatureCeremony
        open={showDispositionCeremony}
        onOpenChange={setShowDispositionCeremony}
        entityDescription={`complaint ${complaint.helpcoreRef} disposition`}
        meaning="COMPLAINT_REVIEW"
        isPending={dispositionMutation.isPending}
        onSign={async (password) => { dispositionMutation.mutate(password); }}
      />
    </div>
  );
}
