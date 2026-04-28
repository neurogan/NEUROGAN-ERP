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
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Clock, AlertOctagon } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface AdverseEvent {
  id: string;
  complaintId: string;
  serious: boolean;
  seriousCriteria: Record<string, boolean>;
  urgentReviewedAt: string;
  medwatchRequired: boolean;
  clockStartedAt: string;
  dueAt: string;
  status: string;
}

interface SaerSubmission {
  id: string;
  adverseEventId: string;
  draftJson: Record<string, unknown>;
  submittedAt: string | null;
  acknowledgmentRef: string | null;
  submissionProofPath: string | null;
}

interface AEData {
  adverseEvent: AdverseEvent;
  saer: SaerSubmission | null;
}

const SERIOUS_CRITERIA_LABELS: Record<string, string> = {
  death: "Death",
  life_threatening: "Life-threatening",
  hospitalization: "Hospitalization",
  disability: "Disability / permanent damage",
  birth_defect: "Birth defect",
  other: "Other serious",
};

// Complaint data needed for MedWatch auto-population (loaded separately)
interface ComplaintSnapshot {
  complaint: {
    helpcoreRef: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    complaintText: string;
    lotCodeRaw: string;
  };
}

export default function ComplaintAE() {
  const [, params] = useRoute<{ id: string }>("/quality/complaints/:id/ae");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = params?.id ?? "";

  const { data: aeData, isLoading: aeLoading } = useQuery<AEData>({
    queryKey: [`/api/complaints/${id}/ae`],
    queryFn: () => apiRequest("GET", `/api/complaints/${id}/ae`).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: complaintData } = useQuery<ComplaintSnapshot>({
    queryKey: [`/api/complaints/${id}`],
    queryFn: () => apiRequest("GET", `/api/complaints/${id}`).then((r) => r.json()),
    enabled: !!id,
  });

  // Urgent review form (shown when AE endpoint 404s — complaint in AE_URGENT_REVIEW)
  const [urgentForm, setUrgentForm] = useState({
    serious: false,
    seriousCriteria: {} as Record<string, boolean>,
    medwatchRequired: false,
  });
  const urgentReviewMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/complaints/${id}/urgent-review`, urgentForm).then((r) => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}/ae`] });
      void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}`] });
    },
  });

  // MedWatch draft
  const ae = aeData?.adverseEvent;
  const saer = aeData?.saer;
  const complaint = complaintData?.complaint;

  const defaultDraft = {
    patientName: complaint?.customerName ?? "",
    patientPhone: complaint?.customerPhone ?? "",
    eventNarrative: complaint?.complaintText ?? "",
    seriousCriteria: ae?.seriousCriteria ?? {},
    suspectProductName: "",
    suspectLotNumber: complaint?.lotCodeRaw ?? "",
    facilityName: "",
    facilityAddress: "",
    facilityPhone: "",
    historySection: "",
  };

  const [draftJson, setDraftJson] = useState<Record<string, unknown>>(defaultDraft);
  const [showSaerCeremony, setShowSaerCeremony] = useState(false);

  const saveDraftMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/complaints/${id}/ae/draft`, { draftJson }).then((r) => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}/ae`] }); },
  });

  const submitSaerMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/complaints/${id}/ae/submit`, { password, draftJson }).then((r) => r.json()),
    onSuccess: () => {
      setShowSaerCeremony(false);
      void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}/ae`] });
    },
  });

  // Acknowledgment capture
  const [ackForm, setAckForm] = useState({ acknowledgmentRef: "", submissionProofPath: "" });
  const ackMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/complaints/${id}/ae/acknowledge`, ackForm).then((r) => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/complaints/${id}/ae`] }); },
  });

  if (aeLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  // SAER clock display
  const now = new Date();
  const dueAt = ae ? new Date(ae.dueAt) : null;
  const msLeft = dueAt ? dueAt.getTime() - now.getTime() : 0;
  const daysLeft = dueAt ? Math.ceil(msLeft / 86_400_000) : 0;
  const isOverdue = dueAt ? dueAt < now : false;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/quality/complaints/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to complaint
        </Button>
        <h1 className="text-xl font-semibold">Adverse Event / SAER</h1>
      </div>

      {/* ── Urgent review form (pre-AE creation) ── */}
      {!ae && (
        <Card className="border-destructive">
          <CardHeader><CardTitle className="text-sm text-destructive">Urgent Review Required</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={urgentForm.serious} onCheckedChange={(v) => setUrgentForm((f) => ({ ...f, serious: !!v }))} />
              Serious adverse event
            </label>
            {urgentForm.serious && (
              <div className="space-y-1 pl-6">
                {Object.entries(SERIOUS_CRITERIA_LABELS).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={!!urgentForm.seriousCriteria[k]}
                      onCheckedChange={(v) => setUrgentForm((f) => ({ ...f, seriousCriteria: { ...f.seriousCriteria, [k]: !!v } }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={urgentForm.medwatchRequired} onCheckedChange={(v) => setUrgentForm((f) => ({ ...f, medwatchRequired: !!v }))} />
              MedWatch / SAER required
            </label>
            <Button size="sm" onClick={() => urgentReviewMutation.mutate()} disabled={urgentReviewMutation.isPending}>
              Submit urgent review
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── AE record ── */}
      {ae && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                {isOverdue ? <AlertOctagon className="h-4 w-4 text-destructive" /> : <Clock className="h-4 w-4 text-amber-400" />}
                SAER Clock
                <Badge variant={isOverdue ? "destructive" : daysLeft <= 2 ? "secondary" : "outline"}>
                  {isOverdue ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days remaining`}
                </Badge>
                <Badge variant={ae.status === "SUBMITTED" ? "outline" : "secondary"}>{ae.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Clock started:</span> {new Date(ae.clockStartedAt).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Due at:</span> {new Date(ae.dueAt).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Serious:</span> {ae.serious ? "Yes" : "No"}</div>
              <div><span className="text-muted-foreground">MedWatch required:</span> {ae.medwatchRequired ? "Yes" : "No"}</div>
            </CardContent>
          </Card>

          {/* ── MedWatch 3500A Draft ── */}
          {ae.medwatchRequired && ae.status === "OPEN" && (
            <Card>
              <CardHeader><CardTitle className="text-sm">MedWatch 3500A Draft</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Patient name</Label>
                    <Input value={String(draftJson.patientName ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, patientName: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Patient phone</Label>
                    <Input value={String(draftJson.patientPhone ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, patientPhone: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Event narrative (Section A)</Label>
                  <Textarea rows={4} value={String(draftJson.eventNarrative ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, eventNarrative: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Suspect product name</Label>
                    <Input value={String(draftJson.suspectProductName ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, suspectProductName: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Lot number</Label>
                    <Input value={String(draftJson.suspectLotNumber ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, suspectLotNumber: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">History / relevant info (Section D)</Label>
                  <Textarea rows={3} value={String(draftJson.historySection ?? "")} onChange={(e) => setDraftJson((d) => ({ ...d, historySection: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending}>
                    Save draft
                  </Button>
                  <Button size="sm" onClick={() => setShowSaerCeremony(true)}>
                    Submit MedWatch (F-04)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── SAER submitted — acknowledgment ── */}
          {saer?.submittedAt && !saer.acknowledgmentRef && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Capture FDA Acknowledgment</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">Upload the printable form to the FDA portal manually, then enter the acknowledgment reference here.</div>
                <div>
                  <Label className="text-xs">FDA portal acknowledgment ref</Label>
                  <Input value={ackForm.acknowledgmentRef} onChange={(e) => setAckForm((f) => ({ ...f, acknowledgmentRef: e.target.value }))} />
                </div>
                <Button size="sm" onClick={() => ackMutation.mutate()} disabled={!ackForm.acknowledgmentRef || ackMutation.isPending}>
                  Save acknowledgment
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Final ack captured ── */}
          {saer?.acknowledgmentRef && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Submission complete</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Submitted at:</span> {saer.submittedAt ? new Date(saer.submittedAt).toLocaleString() : ""}</div>
                <div><span className="text-muted-foreground">FDA acknowledgment:</span> {saer.acknowledgmentRef}</div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <SignatureCeremony
        open={showSaerCeremony}
        onOpenChange={setShowSaerCeremony}
        entityDescription={`SAER for complaint ${complaint?.helpcoreRef ?? id}`}
        meaning="SAER_SUBMIT"
        isPending={submitSaerMutation.isPending}
        onSign={async (password) => { submitSaerMutation.mutate(password); }}
      />
    </div>
  );
}
