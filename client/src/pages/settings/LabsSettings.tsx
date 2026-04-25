import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";

interface Lab {
  id: string;
  name: string;
  address: string | null;
  type: "IN_HOUSE" | "THIRD_PARTY";
  status: "ACTIVE" | "INACTIVE" | "DISQUALIFIED";
  createdAt: string;
}

interface QualificationEvent {
  id: string;
  labId: string;
  eventType: "QUALIFIED" | "DISQUALIFIED";
  performedByUserId: string;
  performedAt: string;
  qualificationMethod: string | null;
  requalificationFrequencyMonths: number | null;
  nextRequalificationDue: string | null;
  notes: string | null;
  performedByName: string;
}

type QualStatus = "NOT_QUALIFIED" | "QUALIFIED" | "OVERDUE";

function getQualStatus(latest: QualificationEvent | undefined): QualStatus {
  if (!latest || latest.eventType !== "QUALIFIED") return "NOT_QUALIFIED";
  if (!latest.nextRequalificationDue) return "QUALIFIED";
  const today = new Date().toISOString().slice(0, 10);
  return latest.nextRequalificationDue < today ? "OVERDUE" : "QUALIFIED";
}

function QualBadge({ status, nextDue }: { status: QualStatus; nextDue?: string | null }) {
  if (status === "QUALIFIED") {
    const due = nextDue ? nextDue.slice(0, 7) : null;
    return (
      <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">
        <ShieldCheck className="h-2.5 w-2.5 mr-1" />
        {due ? `Qualified · due ${due}` : "Qualified"}
      </Badge>
    );
  }
  if (status === "OVERDUE") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <ShieldAlert className="h-2.5 w-2.5 mr-1" />
        Overdue
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-yellow-700 border-yellow-300 bg-yellow-50">
      <ShieldOff className="h-2.5 w-2.5 mr-1" />
      Not Qualified
    </Badge>
  );
}

export function LabsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: labs = [], isLoading, isError } = useQuery<Lab[]>({ queryKey: ["/api/labs"] });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"IN_HOUSE" | "THIRD_PARTY">("THIRD_PARTY");
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const [qualifyLabId, setQualifyLabId] = useState<string | null>(null);
  const [qualMethod, setQualMethod] = useState("ACCREDITATION_REVIEW");
  const [qualFrequency, setQualFrequency] = useState("24");
  const [qualNotes, setQualNotes] = useState("");
  const [qualPassword, setQualPassword] = useState("");

  const [disqualifyLabId, setDisqualifyLabId] = useState<string | null>(null);
  const [disqualNotes, setDisqualNotes] = useState("");
  const [disqualPassword, setDisqualPassword] = useState("");

  const [expandedLabId, setExpandedLabId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; address: string | null; type: string }) =>
      apiRequest("POST", "/api/labs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      setName(""); setAddress(""); setType("THIRD_PARTY");
      toast({ title: "Lab added" });
    },
    onError: (err: Error) => toast({ title: "Failed to add lab", description: err.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Lab> }) =>
      apiRequest("PATCH", `/api/labs/${id}`, data),
    onMutate: ({ id }) => { setPatchingId(id); },
    onSettled: () => setPatchingId(null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/labs"] }); toast({ title: "Lab updated" }); },
    onError: (err: Error) => toast({ title: "Failed to update lab", description: err.message, variant: "destructive" }),
  });

  const qualifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiRequest("POST", `/api/labs/${id}/qualify`, body).then((r) => r.json()),
    onSuccess: (_: unknown, { id }: { id: string; body: object }) => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      qc.invalidateQueries({ queryKey: [`/api/labs/${id}/qualifications`] });
      setQualifyLabId(null);
      setQualPassword(""); setQualNotes(""); setQualMethod("ACCREDITATION_REVIEW"); setQualFrequency("24");
      toast({ title: "Lab qualified" });
    },
    onError: (err: Error) => toast({ title: "Qualification failed", description: err.message, variant: "destructive" }),
  });

  const disqualifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiRequest("POST", `/api/labs/${id}/disqualify`, body).then((r) => r.json()),
    onSuccess: (_: unknown, { id }: { id: string; body: object }) => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      qc.invalidateQueries({ queryKey: [`/api/labs/${id}/qualifications`] });
      setDisqualifyLabId(null);
      setDisqualPassword(""); setDisqualNotes("");
      toast({ title: "Lab disqualified" });
    },
    onError: (err: Error) => toast({ title: "Disqualification failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError) return <div className="p-6 text-sm text-destructive">Could not load labs. Refresh to try again.</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Testing Labs</h2>
        <p className="text-sm text-muted-foreground">
          Approved labs for COA testing. Third-party labs must be qualified before their COAs can be accepted (21 CFR §111.75(h)(2)).
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {labs.map((lab) => (
          <LabRow
            key={lab.id}
            lab={lab}
            patchingId={patchingId}
            expandedLabId={expandedLabId}
            onToggleExpand={() => setExpandedLabId(expandedLabId === lab.id ? null : lab.id)}
            onPatch={(data) => patchMutation.mutate({ id: lab.id, data })}
            onQualify={() => setQualifyLabId(lab.id)}
            onDisqualify={() => setDisqualifyLabId(lab.id)}
          />
        ))}
        {labs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No labs configured.</div>
        )}
      </div>

      {/* Qualify modal */}
      <Dialog open={qualifyLabId !== null} onOpenChange={(o) => { if (!o) { setQualifyLabId(null); setQualPassword(""); setQualNotes(""); setQualMethod("ACCREDITATION_REVIEW"); setQualFrequency("24"); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Qualify lab</DialogTitle>
            <DialogDescription className="text-xs">
              Records a formal qualification event per 21 CFR §111.75(h)(2). Your password is required as an electronic signature.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Qualification method</Label>
              <Select value={qualMethod} onValueChange={setQualMethod}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCREDITATION_REVIEW">Accreditation review</SelectItem>
                  <SelectItem value="SPLIT_SAMPLE_COMPARISON">Split-sample comparison</SelectItem>
                  <SelectItem value="ON_SITE_AUDIT">On-site audit</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Requalification frequency (months)</Label>
              <Input
                type="number"
                min={1}
                value={qualFrequency}
                onChange={(e) => setQualFrequency(e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={qualNotes} onChange={(e) => setQualNotes(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Your password (e-signature)</Label>
              <Input
                type="password"
                value={qualPassword}
                onChange={(e) => setQualPassword(e.target.value)}
                className="mt-1 h-8 text-sm"
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQualifyLabId(null)} disabled={qualifyMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => qualifyLabId && qualifyMutation.mutate({
                id: qualifyLabId,
                body: {
                  qualificationMethod: qualMethod,
                  requalificationFrequencyMonths: Number(qualFrequency),
                  notes: qualNotes || undefined,
                  signaturePassword: qualPassword,
                },
              })}
              disabled={!qualPassword || Number(qualFrequency) < 1 || qualifyMutation.isPending}
            >
              {qualifyMutation.isPending ? "Qualifying…" : "Qualify lab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disqualify modal */}
      <Dialog open={disqualifyLabId !== null} onOpenChange={(o) => { if (!o) { setDisqualifyLabId(null); setDisqualPassword(""); setDisqualNotes(""); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Disqualify lab</DialogTitle>
            <DialogDescription className="text-xs">
              The lab will be marked DISQUALIFIED. Future COAs from this lab will be blocked at Gate 3c until the lab is requalified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Reason / notes (optional)</Label>
              <Input value={disqualNotes} onChange={(e) => setDisqualNotes(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Your password (e-signature)</Label>
              <Input
                type="password"
                value={disqualPassword}
                onChange={(e) => setDisqualPassword(e.target.value)}
                className="mt-1 h-8 text-sm"
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisqualifyLabId(null)} disabled={disqualifyMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => disqualifyLabId && disqualifyMutation.mutate({
                id: disqualifyLabId,
                body: { notes: disqualNotes || undefined, signaturePassword: disqualPassword },
              })}
              disabled={!disqualPassword || disqualifyMutation.isPending}
            >
              {disqualifyMutation.isPending ? "Disqualifying…" : "Disqualify lab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add lab form */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Add lab</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="lab-name" className="text-xs">Name</Label>
            <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" className="mt-1 h-8 text-sm" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="lab-address" className="text-xs">Address</Label>
            <Input id="lab-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "IN_HOUSE" | "THIRD_PARTY")}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_HOUSE">In-House</SelectItem>
                <SelectItem value="THIRD_PARTY">Third Party</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate({ name: name.trim(), address: address.trim() || null, type })}
          disabled={!name.trim() || createMutation.isPending}
        >
          Add lab
        </Button>
      </div>
    </div>
  );
}

function LabRow({
  lab,
  patchingId,
  expandedLabId,
  onToggleExpand,
  onPatch,
  onQualify,
  onDisqualify,
}: {
  lab: Lab;
  patchingId: string | null;
  expandedLabId: string | null;
  onToggleExpand: () => void;
  onPatch: (data: Partial<Lab>) => void;
  onQualify: () => void;
  onDisqualify: () => void;
}) {
  const isExpanded = expandedLabId === lab.id;
  const isThirdParty = lab.type === "THIRD_PARTY";

  const { data: quals } = useQuery<QualificationEvent[]>({
    queryKey: [`/api/labs/${lab.id}/qualifications`],
    enabled: isThirdParty,
    queryFn: () => apiRequest("GET", `/api/labs/${lab.id}/qualifications`).then((r) => r.json()),
  });

  const latestQual = quals?.[0];
  const qualStatus = isThirdParty ? getQualStatus(latestQual) : null;

  const statusBadge = (status: Lab["status"]) => {
    if (status === "ACTIVE") return <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">Active</Badge>;
    if (status === "DISQUALIFIED") return <Badge variant="destructive" className="text-[10px]">Disqualified</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>;
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
            {lab.name}
            <Badge variant={lab.type === "IN_HOUSE" ? "default" : "secondary"} className="text-[10px]">
              {lab.type === "IN_HOUSE" ? "In-House" : "Third Party"}
            </Badge>
            {statusBadge(lab.status)}
            {isThirdParty && qualStatus && (
              <QualBadge status={qualStatus} nextDue={latestQual?.nextRequalificationDue} />
            )}
          </div>
          {lab.address && <div className="text-xs text-muted-foreground mt-0.5">{lab.address}</div>}
        </div>

        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isThirdParty && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onQualify}>
                Qualify
              </Button>
              {lab.status === "ACTIVE" && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={onDisqualify}>
                  Disqualify
                </Button>
              )}
            </>
          )}
          {!isThirdParty && (
            <Select
              value={lab.status}
              onValueChange={(val) => onPatch({ status: val as Lab["status"] })}
              disabled={patchingId === lab.id}
            >
              <SelectTrigger className="h-7 w-32 text-xs">{statusBadge(lab.status)}</SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="DISQUALIFIED">Disqualified</SelectItem>
              </SelectContent>
            </Select>
          )}
          {isThirdParty && (
            <button
              onClick={onToggleExpand}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Toggle qualification history"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {isExpanded && isThirdParty && (
        <div className="px-4 pb-3 bg-muted/30 border-t">
          <p className="text-xs font-medium text-muted-foreground mt-2 mb-1">Qualification history</p>
          {!quals || quals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No qualification events recorded.</p>
          ) : (
            <div className="space-y-1">
              {quals.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 text-xs py-1 border-b last:border-0">
                  <Badge
                    variant={ev.eventType === "QUALIFIED" ? "default" : "destructive"}
                    className="text-[10px] mt-0.5 shrink-0"
                  >
                    {ev.eventType === "QUALIFIED" ? "Qualified" : "Disqualified"}
                  </Badge>
                  <div>
                    <span className="font-medium">{ev.performedByName}</span>
                    {" · "}
                    {new Date(ev.performedAt).toLocaleDateString()}
                    {ev.qualificationMethod && (
                      <span className="text-muted-foreground"> · {ev.qualificationMethod.replace(/_/g, " ").toLowerCase()}</span>
                    )}
                    {ev.nextRequalificationDue && (
                      <span className="text-muted-foreground"> · next due {ev.nextRequalificationDue.slice(0, 7)}</span>
                    )}
                    {ev.notes && <div className="text-muted-foreground mt-0.5">{ev.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
