import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface OosSummary {
  id: string;
  oosNumber: string;
  lotId: string;
  lotNumber: string | null;
  coaDocumentId: string;
  status: "OPEN" | "RETEST_PENDING" | "CLOSED";
  disposition: "APPROVED" | "REJECTED" | "RECALL" | "NO_INVESTIGATION_NEEDED" | null;
  autoCreatedAt: string;
  closedAt: string | null;
}

interface OosDetail extends OosSummary {
  dispositionReason: string | null;
  noInvestigationReason: string | null;
  recallClass: "I" | "II" | "III" | null;
  recallDistributionScope: string | null;
  recallFdaNotificationDate: string | null;
  recallCustomerNotificationDate: string | null;
  recallRecoveryTargetDate: string | null;
  recallAffectedLotIds: string[] | null;
  leadInvestigatorUserId: string | null;
  leadInvestigatorName: string | null;
  closedByUserId: string | null;
  closedByName: string | null;
  testResults: Array<{
    id: string;
    analyteName: string;
    resultValue: string;
    specMin: string | null;
    specMax: string | null;
    pass: boolean;
    testedAt: string;
    testedByName: string | null;
    notes: string | null;
  }>;
}

export default function OosInvestigations() {
  const { user } = useAuth();
  const isQc = user?.roles.includes("QA") || user?.roles.includes("ADMIN");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RETEST_PENDING" | "CLOSED" | "ALL">("OPEN");
  const [openInvestigationId, setOpenInvestigationId] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState<"none" | "close" | "no-investigation">("none");

  const { data: investigations = [] } = useQuery<OosSummary[]>({
    queryKey: ["/api/oos-investigations", { status: statusFilter }],
    queryFn: async () => {
      const params = statusFilter === "ALL" ? "" : `?status=${statusFilter}`;
      const res = await apiRequest("GET", `/api/oos-investigations${params}`);
      return res.json();
    },
  });

  const { data: detail } = useQuery<OosDetail | null>({
    queryKey: ["/api/oos-investigations", openInvestigationId],
    queryFn: async () => {
      if (!openInvestigationId) return null;
      const res = await apiRequest("GET", `/api/oos-investigations/${openInvestigationId}`);
      return res.json();
    },
    enabled: !!openInvestigationId,
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/oos-investigations"] });
  };

  // Mutations
  const assignLead = useMutation({
    mutationFn: ({ id, leadInvestigatorUserId }: { id: string; leadInvestigatorUserId: string }) =>
      apiRequest("POST", `/api/oos-investigations/${id}/assign-lead`, { leadInvestigatorUserId }).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Lead investigator assigned" }); },
  });

  const setRetestPending = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/oos-investigations/${id}/retest-pending`, {}).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Retest pending" }); },
  });

  const clearRetest = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/oos-investigations/${id}/clear-retest`, {}).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Retest cleared" }); },
  });

  const closeInvestigation = useMutation({
    mutationFn: (body: unknown) =>
      apiRequest("POST", `/api/oos-investigations/${openInvestigationId}/close`, body).then(r => r.json()),
    onSuccess: () => { refetchAll(); setCloseMode("none"); setOpenInvestigationId(null); toast({ title: "Investigation closed" }); },
  });

  const markNoInvestigation = useMutation({
    mutationFn: (body: unknown) =>
      apiRequest("POST", `/api/oos-investigations/${openInvestigationId}/mark-no-investigation-needed`, body).then(r => r.json()),
    onSuccess: () => { refetchAll(); setCloseMode("none"); setOpenInvestigationId(null); toast({ title: "Marked as no investigation needed" }); },
  });

  // Render filter bar + table
  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-semibold mb-4">OOS Investigations</h1>
      <div className="flex gap-4 mb-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "OPEN" | "RETEST_PENDING" | "CLOSED" | "ALL")}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="RETEST_PENDING">Retest Pending</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>OOS #</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead>Opened</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Disposition</TableHead>
            <TableHead>Days open</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {investigations.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No OOS investigations match the current filters.</TableCell></TableRow>
          )}
          {investigations.map((i) => {
            const opened = new Date(i.autoCreatedAt);
            const daysOpen = Math.floor((Date.now() - opened.getTime()) / 86400000);
            return (
              <TableRow key={i.id}>
                <TableCell>{i.oosNumber}</TableCell>
                <TableCell>{i.lotNumber ?? i.lotId.slice(0, 8)}</TableCell>
                <TableCell>{opened.toLocaleDateString()}</TableCell>
                <TableCell><Badge>{i.status}</Badge></TableCell>
                <TableCell>{i.disposition && <Badge variant="secondary">{i.disposition}</Badge>}</TableCell>
                <TableCell>{daysOpen}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setOpenInvestigationId(i.id)}>View</Button></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Detail dialog */}
      <Dialog open={!!openInvestigationId && closeMode === "none"} onOpenChange={(o) => !o && setOpenInvestigationId(null)}>
        <DialogContent className="max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.oosNumber}</DialogTitle>
                <DialogDescription>Lot {detail.lotNumber} · COA {detail.coaDocumentId.slice(0, 8)} · <Badge>{detail.status}</Badge></DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <section>
                  <h3 className="font-medium mb-2">Failing test results</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Analyte</TableHead><TableHead>Spec</TableHead><TableHead>Result</TableHead><TableHead>Tester</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.testResults.map(tr => (
                        <TableRow key={tr.id}>
                          <TableCell>{tr.analyteName}</TableCell>
                          <TableCell>{tr.specMin}–{tr.specMax}</TableCell>
                          <TableCell className={tr.pass ? "" : "text-red-600 font-medium"}>{tr.resultValue}</TableCell>
                          <TableCell>{tr.testedByName}</TableCell>
                          <TableCell>{new Date(tr.testedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>

                <section>
                  <h3 className="font-medium mb-2">Lead investigator</h3>
                  <p>{detail.leadInvestigatorName ?? <em>none assigned</em>}</p>
                  {isQc && detail.status !== "CLOSED" && detail.leadInvestigatorUserId !== user!.id && (
                    <Button size="sm" onClick={() => assignLead.mutate({ id: detail.id, leadInvestigatorUserId: user!.id })}>Assign me as lead investigator</Button>
                  )}
                </section>

                {isQc && detail.status !== "CLOSED" && (
                  <section className="space-x-2">
                    {detail.status === "OPEN" ? (
                      <Button variant="outline" onClick={() => setRetestPending.mutate(detail.id)}>Mark retest pending</Button>
                    ) : (
                      <Button variant="outline" onClick={() => clearRetest.mutate(detail.id)}>Clear retest pending</Button>
                    )}
                    <Button variant="outline" onClick={() => setCloseMode("no-investigation")}>Mark no investigation needed</Button>
                    <Button onClick={() => setCloseMode("close")}>Close investigation</Button>
                  </section>
                )}

                {detail.status === "CLOSED" && (
                  <section>
                    <h3 className="font-medium mb-2">Closure</h3>
                    <p>Disposition: <Badge>{detail.disposition}</Badge></p>
                    <p>Reason: {detail.dispositionReason}</p>
                    <p>Closed by: {detail.closedByName} · {detail.closedAt && new Date(detail.closedAt).toLocaleString()}</p>
                  </section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Close investigation modal */}
      <CloseInvestigationModal
        open={closeMode === "close"}
        onOpenChange={(o) => !o && setCloseMode("none")}
        leadUserId={detail?.leadInvestigatorUserId ?? null}
        onSubmit={(body) => closeInvestigation.mutate(body)}
        pending={closeInvestigation.isPending}
      />

      {/* No-investigation-needed modal */}
      <NoInvestigationNeededModal
        open={closeMode === "no-investigation"}
        onOpenChange={(o) => !o && setCloseMode("none")}
        leadUserId={detail?.leadInvestigatorUserId ?? user?.id ?? null}
        onSubmit={(body) => markNoInvestigation.mutate(body)}
        pending={markNoInvestigation.isPending}
      />
    </div>
  );
}

function CloseInvestigationModal({ open, onOpenChange, leadUserId, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  leadUserId: string | null;
  onSubmit: (body: unknown) => void; pending: boolean;
}) {
  const [disposition, setDisposition] = useState<"APPROVED" | "REJECTED" | "RECALL">("APPROVED");
  const [reason, setReason] = useState("");
  const [recallClass, setRecallClass] = useState<"I" | "II" | "III">("II");
  const [distributionScope, setDistributionScope] = useState("");
  const [fdaNot, setFdaNot] = useState("");
  const [custNot, setCustNot] = useState("");
  const [recovTarget, setRecovTarget] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close OOS Investigation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as "APPROVED" | "REJECTED" | "RECALL")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">APPROVED — release</SelectItem>
                <SelectItem value="REJECTED">REJECTED — fails spec</SelectItem>
                <SelectItem value="RECALL">RECALL — distributed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Disposition reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
          {disposition === "RECALL" && (
            <div className="space-y-2 border rounded p-3 bg-amber-50">
              <Label>Recall class</Label>
              <RadioGroup value={recallClass} onValueChange={(v) => setRecallClass(v as "I" | "II" | "III")}>
                <div className="flex items-center gap-2"><RadioGroupItem value="I" id="rc1" /><Label htmlFor="rc1">Class I</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="II" id="rc2" /><Label htmlFor="rc2">Class II</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="III" id="rc3" /><Label htmlFor="rc3">Class III</Label></div>
              </RadioGroup>
              <Label>Distribution scope</Label>
              <Textarea value={distributionScope} onChange={(e) => setDistributionScope(e.target.value)} required />
              <Label>FDA notification date</Label>
              <Input type="date" value={fdaNot} onChange={(e) => setFdaNot(e.target.value)} />
              <Label>Customer notification date</Label>
              <Input type="date" value={custNot} onChange={(e) => setCustNot(e.target.value)} />
              <Label>Recovery target date</Label>
              <Input type="date" value={recovTarget} onChange={(e) => setRecovTarget(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Your password (e-signature)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || !leadUserId || !reason || !password} onClick={() => onSubmit({
            disposition, dispositionReason: reason,
            leadInvestigatorUserId: leadUserId,
            recallDetails: disposition === "RECALL" ? {
              class: recallClass, distributionScope,
              fdaNotificationDate: fdaNot || undefined,
              customerNotificationDate: custNot || undefined,
              recoveryTargetDate: recovTarget || undefined,
            } : undefined,
            signaturePassword: password,
          })}>{pending ? "Closing…" : "Sign and close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoInvestigationNeededModal({ open, onOpenChange, leadUserId, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  leadUserId: string | null;
  onSubmit: (body: unknown) => void; pending: boolean;
}) {
  const [reason, setReason] = useState<"LAB_ERROR" | "SAMPLE_INVALID" | "INSTRUMENT_OUT_OF_CALIBRATION" | "OTHER">("LAB_ERROR");
  const [narrative, setNarrative] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark "No Investigation Needed"</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as "LAB_ERROR" | "SAMPLE_INVALID" | "INSTRUMENT_OUT_OF_CALIBRATION" | "OTHER")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LAB_ERROR">Lab error (sample prep, dilution, etc.)</SelectItem>
                <SelectItem value="SAMPLE_INVALID">Sample invalid</SelectItem>
                <SelectItem value="INSTRUMENT_OUT_OF_CALIBRATION">Instrument out of calibration</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Narrative (required)</Label>
            <Textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} required />
          </div>
          <div>
            <Label>Your password (e-signature)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || !leadUserId || !narrative || !password} onClick={() => onSubmit({
            reason, reasonNarrative: narrative,
            leadInvestigatorUserId: leadUserId,
            signaturePassword: password,
          })}>{pending ? "Submitting…" : "Sign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
