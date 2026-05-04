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

type TrainingStatus = "CURRENT" | "EXPIRING_SOON" | "EXPIRED" | "NEVER_TRAINED";

interface TrainingProgram {
  id: string;
  name: string;
  version: string;
  description: string | null;
  validityDays: number;
  requiredForRoles: string[];
  documentUrl: string | null;
  isActive: boolean;
}

interface TrainingAssignment {
  id: string;
  userId: string;
  programId: string;
  programName: string;
  dueAt: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
}

interface ComplianceRow {
  programId: string;
  programName: string;
  version: string;
  status: TrainingStatus;
  expiresAt: string | null;
  completedAt: string | null;
}

interface UserCompliance {
  userId: string;
  userName: string;
  programs: ComplianceRow[];
}

interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function TrainingStatusBadge({ status }: { status: TrainingStatus }) {
  const map: Record<TrainingStatus, { label: string; className: string }> = {
    CURRENT:       { label: "Current",        className: "bg-green-100 text-green-800" },
    EXPIRING_SOON: { label: "Expiring Soon",  className: "bg-yellow-100 text-yellow-800" },
    EXPIRED:       { label: "Expired",        className: "bg-red-100 text-red-800" },
    NEVER_TRAINED: { label: "Not Completed",  className: "bg-gray-100 text-gray-600" },
  };
  const { label, className } = map[status];
  return <Badge className={`text-xs font-medium ${className}`}>{label}</Badge>;
}

function AssignmentStatusBadge({ status }: { status: "PENDING" | "COMPLETED" | "OVERDUE" }) {
  const map = {
    PENDING:   { label: "Pending",   className: "bg-blue-100 text-blue-800" },
    COMPLETED: { label: "Completed", className: "bg-green-100 text-green-800" },
    OVERDUE:   { label: "Overdue",   className: "bg-red-100 text-red-800" },
  };
  const { label, className } = map[status];
  return <Badge className={`text-xs font-medium ${className}`}>{label}</Badge>;
}

// ─── Programs view ────────────────────────────────────────────────────────────

function ProgramsView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", version: "1.0", description: "", validityDays: "365", documentUrl: "" });
  const [formErr, setFormErr] = useState("");

  const isQaAdmin = user?.roles?.some((r: string) => r === "QA" || r === "ADMIN");

  const { data: programs = [] } = useQuery<TrainingProgram[]>({
    queryKey: ["/api/training/programs"],
    queryFn: async () => (await apiRequest("GET", "/api/training/programs")).json(),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/training/programs", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/training/programs"] });
      setCreateOpen(false);
      setForm({ name: "", version: "1.0", description: "", validityDays: "365", documentUrl: "" });
      setFormErr("");
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Training programs define the curriculum. Assigning a program to a user creates a training obligation.
        </p>
        {isQaAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>+ New Program</Button>
        )}
      </div>

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Version</th>
              <th className="text-left px-3 py-2 font-medium">Validity</th>
              <th className="text-left px-3 py-2 font-medium">Required Roles</th>
              <th className="text-left px-3 py-2 font-medium">Materials</th>
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No training programs defined yet.
                </td>
              </tr>
            )}
            {programs.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  {p.name}
                  {p.description && (
                    <p className="text-xs text-muted-foreground font-normal">{p.description}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.version}</td>
                <td className="px-3 py-2">{p.validityDays} days</td>
                <td className="px-3 py-2">
                  {p.requiredForRoles.length > 0
                    ? p.requiredForRoles.join(", ")
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-3 py-2">
                  {p.documentUrl
                    ? <a href={p.documentUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">View</a>
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create program dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Training Program</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Version</Label>
                <Input value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} />
              </div>
              <div>
                <Label>Validity (days) *</Label>
                <Input type="number" min={1} value={form.validityDays} onChange={(e) => setForm((f) => ({ ...f, validityDays: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Training Material URL</Label>
              <Input placeholder="https://..." value={form.documentUrl} onChange={(e) => setForm((f) => ({ ...f, documentUrl: e.target.value }))} />
            </div>
            {formErr && <Alert variant="destructive"><AlertDescription>{formErr}</AlertDescription></Alert>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                disabled={createMutation.isPending || !form.name}
                onClick={() => createMutation.mutate({
                  name: form.name,
                  version: form.version || "1.0",
                  description: form.description || undefined,
                  validityDays: parseInt(form.validityDays, 10),
                  documentUrl: form.documentUrl || undefined,
                })}
              >
                {createMutation.isPending ? "Creating…" : "Create Program"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── My Training view ─────────────────────────────────────────────────────────

function MyTrainingView() {
  useAuth();
  const qc = useQueryClient();
  const [recordOpen, setRecordOpen] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<TrainingProgram | null>(null);
  const [form, setForm] = useState({ completedAt: new Date().toISOString().slice(0, 10), trainedByExternal: "", notes: "", password: "", commentary: "" });
  const [formErr, setFormErr] = useState("");

  const { data: compliance } = useQuery<UserCompliance>({
    queryKey: ["/api/training/compliance", "me"],
    queryFn: async () => (await apiRequest("GET", "/api/training/compliance")).json(),
  });

  const { data: programs = [] } = useQuery<TrainingProgram[]>({
    queryKey: ["/api/training/programs"],
    queryFn: async () => (await apiRequest("GET", "/api/training/programs")).json(),
  });

  const { data: assignments = [] } = useQuery<TrainingAssignment[]>({
    queryKey: ["/api/training/assignments", "me"],
    queryFn: async () => (await apiRequest("GET", "/api/training/assignments")).json(),
  });

  const recordMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/training/records", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/training/compliance"] });
      qc.invalidateQueries({ queryKey: ["/api/training/assignments"] });
      setRecordOpen(false);
      setSelectedProgram(null);
      setForm({ completedAt: new Date().toISOString().slice(0, 10), trainedByExternal: "", notes: "", password: "", commentary: "" });
      setFormErr("");
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const openRecord = (programId: string) => {
    const prog = programs.find((p) => p.id === programId);
    if (prog) { setSelectedProgram(prog); setRecordOpen(true); }
  };

  const pendingAssignments = assignments.filter((a) => a.status === "PENDING" || a.status === "OVERDUE");

  return (
    <div className="space-y-6">
      {/* Pending assignments alert */}
      {pendingAssignments.length > 0 && (
        <Alert>
          <AlertDescription>
            You have {pendingAssignments.length} pending training assignment{pendingAssignments.length > 1 ? "s" : ""}.
          </AlertDescription>
        </Alert>
      )}

      {/* Compliance table */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Training Compliance</h3>
        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Program</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Completed</th>
                <th className="text-left px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(!compliance || compliance.programs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No training programs defined.</td>
                </tr>
              )}
              {compliance?.programs.map((row) => (
                <tr key={row.programId} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.programName}</span>
                    <span className="text-xs text-muted-foreground ml-1">v{row.version}</span>
                  </td>
                  <td className="px-3 py-2"><TrainingStatusBadge status={row.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.completedAt ? new Date(row.completedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => openRecord(row.programId)}>
                      {row.status === "NEVER_TRAINED" ? "Record Training" : "Re-record"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assignments */}
      {pendingAssignments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Open Assignments</h3>
          <div className="rounded border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Program</th>
                  <th className="text-left px-3 py-2 font-medium">Due</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pendingAssignments.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{a.programName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(a.dueAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><AssignmentStatusBadge status={a.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openRecord(a.programId)}>Record Training</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record training dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Training — {selectedProgram?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              By signing, you acknowledge that you have read and understood the training materials and are qualified to perform tasks covered by this program.
            </p>
            <div>
              <Label>Completion Date *</Label>
              <Input type="date" value={form.completedAt} onChange={(e) => setForm((f) => ({ ...f, completedAt: e.target.value }))} />
            </div>
            <div>
              <Label>Trainer (external name, if applicable)</Label>
              <Input value={form.trainedByExternal} onChange={(e) => setForm((f) => ({ ...f, trainedByExternal: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div>
              <Label>Signature Commentary</Label>
              <Input placeholder="Optional" value={form.commentary} onChange={(e) => setForm((f) => ({ ...f, commentary: e.target.value }))} />
            </div>
            <div>
              <Label>Password (electronic signature) *</Label>
              <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            {formErr && <Alert variant="destructive"><AlertDescription>{formErr}</AlertDescription></Alert>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
              <Button
                disabled={recordMutation.isPending || !form.password || !form.completedAt || !selectedProgram}
                onClick={() => {
                  if (!selectedProgram) return;
                  recordMutation.mutate({
                    programId:         selectedProgram.id,
                    completedAt:       new Date(form.completedAt).toISOString(),
                    trainedByExternal: form.trainedByExternal || undefined,
                    notes:             form.notes || undefined,
                    password:          form.password,
                    commentary:        form.commentary || undefined,
                  });
                }}
              >
                {recordMutation.isPending ? "Signing…" : "Sign & Record"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── All Users compliance view (QA/ADMIN) ─────────────────────────────────────

function AllUsersView() {
  const { data: programs = [] } = useQuery<TrainingProgram[]>({
    queryKey: ["/api/training/programs"],
    queryFn: async () => (await apiRequest("GET", "/api/training/programs")).json(),
  });

  const { data: allCompliance = [] } = useQuery<UserCompliance[]>({
    queryKey: ["/api/training/compliance", "all"],
    queryFn: async () => (await apiRequest("GET", "/api/training/compliance?userId=all")).json(),
  });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: "", programId: "", dueAt: "" });
  const [assignErr, setAssignErr] = useState("");
  const qc = useQueryClient();

  const { data: users = [] } = useQuery<DirectoryUser[]>({
    queryKey: ["/api/users/directory"],
    queryFn: async () => (await apiRequest("GET", "/api/users/directory")).json(),
  });

  const assignMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/training/assignments", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/training/compliance"] });
      setAssignOpen(false);
      setAssignForm({ userId: "", programId: "", dueAt: "" });
      setAssignErr("");
    },
    onError: (e: Error) => setAssignErr(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Training compliance status for all active users across all programs.
        </p>
        <Button size="sm" onClick={() => setAssignOpen(true)}>+ Assign Training</Button>
      </div>

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">User</th>
              {programs.map((p) => (
                <th key={p.id} className="text-left px-3 py-2 font-medium whitespace-nowrap">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allCompliance.length === 0 && (
              <tr>
                <td colSpan={programs.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  No compliance data yet.
                </td>
              </tr>
            )}
            {allCompliance.map((uc) => (
              <tr key={uc.userId} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{uc.userName}</td>
                {programs.map((p) => {
                  const row = uc.programs.find((r) => r.programId === p.id);
                  return (
                    <td key={p.id} className="px-3 py-2">
                      {row ? <TrainingStatusBadge status={row.status} /> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign training dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Training</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>User *</Label>
              <Select value={assignForm.userId} onValueChange={(v) => setAssignForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName} — {u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Program *</Label>
              <Select value={assignForm.programId} onValueChange={(v) => setAssignForm((f) => ({ ...f, programId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select program" /></SelectTrigger>
                <SelectContent>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} v{p.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due Date *</Label>
              <Input type="date" value={assignForm.dueAt} onChange={(e) => setAssignForm((f) => ({ ...f, dueAt: e.target.value }))} />
            </div>
            {assignErr && <Alert variant="destructive"><AlertDescription>{assignErr}</AlertDescription></Alert>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                disabled={assignMutation.isPending || !assignForm.userId || !assignForm.programId || !assignForm.dueAt}
                onClick={() => assignMutation.mutate({
                  userId:    assignForm.userId,
                  programId: assignForm.programId,
                  dueAt:     new Date(assignForm.dueAt).toISOString(),
                })}
              >
                {assignMutation.isPending ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Training Page ─────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const { user } = useAuth();
  const isQaAdmin = user?.roles?.some((r: string) => r === "QA" || r === "ADMIN");
  type Tab = "my-training" | "programs" | "all-users";
  const [tab, setTab] = useState<Tab>("my-training");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {(["my-training", "programs", ...(isQaAdmin ? ["all-users"] : [])] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "my-training" ? "My Training" : t === "programs" ? "Programs" : "All Users"}
          </button>
        ))}
      </div>

      {tab === "my-training" && <MyTrainingView />}
      {tab === "programs" && <ProgramsView />}
      {tab === "all-users" && isQaAdmin && <AllUsersView />}
    </div>
  );
}
