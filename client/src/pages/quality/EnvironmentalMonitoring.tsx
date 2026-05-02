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
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmSiteType = "AIR" | "SURFACE_NON_CONTACT" | "SURFACE_CONTACT";
type EmFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY";

interface EmSite {
  id: string;
  name: string;
  area: string;
  siteType: EmSiteType;
  isActive: boolean;
}

interface EmSiteDetail extends EmSite {
  schedule: { frequency: EmFrequency; organismTargets: string[] } | null;
  limits: { organism: string; alertLimit: string | null; actionLimit: string | null; unit: string }[];
  lastResult: { sampledAt: string; organism: string; cfuCount: string | null } | null;
}

interface EmResult {
  id: string;
  siteId: string;
  siteName: string;
  sampledAt: string;
  organism: string;
  cfuCount: string | null;
  isBelowLod: boolean;
  testedByLab: string | null;
  notes: string | null;
  status: "PASS" | "ALERT" | "ACTION" | "BELOW_LOD";
  excursion: { limitType: string; limitValue: string; ncId: string | null } | null;
}

interface DueSite {
  site: EmSite;
  schedule: { frequency: EmFrequency; organismTargets: string[] };
  nextDue: string;
  daysUntilDue: number;
  isOverdue: boolean;
}

interface Excursion {
  excursion: { id: string; organism: string; limitType: string; cfuCount: string; limitValue: string; ncId: string | null };
  siteName: string;
}

interface TrendData {
  site: EmSite;
  limits: { organism: string; alertLimit: string | null; actionLimit: string | null; unit: string }[];
  results: { id: string; sampledAt: string; organism: string; cfuCount: string | null; isBelowLod: boolean }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const SITE_TYPE_LABELS: Record<EmSiteType, string> = {
  AIR:                  "Air",
  SURFACE_NON_CONTACT:  "Surface (non-contact)",
  SURFACE_CONTACT:      "Surface (product-contact)",
};

function StatusBadge({ status }: { status: EmResult["status"] }) {
  const map: Record<string, string> = {
    PASS:      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    ALERT:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    ACTION:    "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    BELOW_LOD: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = { PASS: "Pass", ALERT: "Alert", ACTION: "Action", BELOW_LOD: "<LOD" };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

// ─── Create Site Modal ────────────────────────────────────────────────────────

function CreateSiteModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [siteType, setSiteType] = useState<EmSiteType>("AIR");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/em/sites", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/em/sites"] }); onClose(); },
    onError: async (e: unknown) => {
      setError(e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error");
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create EM Site</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-1">
            <Label>Site Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Filling Area Air 1" />
          </div>
          <div className="space-y-1">
            <Label>Area / Room *</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Production Room A" />
          </div>
          <div className="space-y-1">
            <Label>Type *</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={siteType}
              onChange={(e) => setSiteType(e.target.value as EmSiteType)}
            >
              {(Object.keys(SITE_TYPE_LABELS) as EmSiteType[]).map((t) => (
                <option key={t} value={t}>{SITE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => { setError(""); mutation.mutate({ name, area, siteType }); }} disabled={mutation.isPending || !name || !area}>
              {mutation.isPending ? "Creating…" : "Create Site"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Configure Site Modal (schedule + limits) ─────────────────────────────────

function ConfigureSiteModal({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: site } = useQuery<EmSiteDetail>({
    queryKey: ["/api/em/sites", siteId],
    queryFn: async () => (await apiRequest("GET", `/api/em/sites/${siteId}`)).json(),
  });

  const [frequency, setFrequency] = useState<EmFrequency>("MONTHLY");
  const [organisms, setOrganisms] = useState("TPC, Yeast/Mould");
  const [limitOrganism, setLimitOrganism] = useState("TPC");
  const [alertLimit, setAlertLimit] = useState("");
  const [actionLimit, setActionLimit] = useState("");
  const [unit, setUnit] = useState("CFU/m³");
  const [scheduleError, setScheduleError] = useState("");
  const [limitError, setLimitError] = useState("");

  const scheduleMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/em/sites/${siteId}/schedule`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/em/sites", siteId] }); setScheduleError(""); },
    onError: async (e: unknown) => {
      setScheduleError(e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error");
    },
  });

  const limitMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/em/sites/${siteId}/limits`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/em/sites", siteId] }); setLimitError(""); },
    onError: async (e: unknown) => {
      setLimitError(e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error");
    },
  });

  if (!site) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Configure — {site.name}</DialogTitle></DialogHeader>
        <div className="space-y-6">
          {/* Current limits */}
          {site.limits.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Current Limits</p>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Organism</th>
                    <th className="text-left px-3 py-1.5 font-medium">Alert</th>
                    <th className="text-left px-3 py-1.5 font-medium">Action</th>
                    <th className="text-left px-3 py-1.5 font-medium">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {site.limits.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{l.organism}</td>
                      <td className="px-3 py-1.5">{l.alertLimit ?? "—"}</td>
                      <td className="px-3 py-1.5">{l.actionLimit ?? "—"}</td>
                      <td className="px-3 py-1.5">{l.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Schedule */}
          <div className="space-y-3 border rounded-md p-4">
            <p className="text-sm font-medium">Sampling Schedule</p>
            {site.schedule && (
              <p className="text-xs text-muted-foreground">
                Current: {site.schedule.frequency} — {site.schedule.organismTargets.join(", ")}
              </p>
            )}
            {scheduleError && <Alert variant="destructive"><AlertDescription>{scheduleError}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Frequency</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as EmFrequency)}
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Organisms (comma-separated)</Label>
                <Input value={organisms} onChange={(e) => setOrganisms(e.target.value)} />
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                const targets = organisms.split(",").map((s) => s.trim()).filter(Boolean);
                scheduleMutation.mutate({ frequency, organismTargets: targets });
              }}
              disabled={scheduleMutation.isPending}
            >
              {scheduleMutation.isPending ? "Saving…" : "Save Schedule"}
            </Button>
          </div>

          {/* Add limit */}
          <div className="space-y-3 border rounded-md p-4">
            <p className="text-sm font-medium">Add / Update Limit</p>
            {limitError && <Alert variant="destructive"><AlertDescription>{limitError}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Organism</Label>
                <Input value={limitOrganism} onChange={(e) => setLimitOrganism(e.target.value)} placeholder="TPC" />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Alert Limit</Label>
                <Input type="number" value={alertLimit} onChange={(e) => setAlertLimit(e.target.value)} placeholder="50" />
              </div>
              <div className="space-y-1">
                <Label>Action Limit</Label>
                <Input type="number" value={actionLimit} onChange={(e) => setActionLimit(e.target.value)} placeholder="100" />
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                limitMutation.mutate({
                  organism: limitOrganism,
                  alertLimit: alertLimit || null,
                  actionLimit: actionLimit || null,
                  unit,
                });
              }}
              disabled={limitMutation.isPending || !limitOrganism}
            >
              {limitMutation.isPending ? "Saving…" : "Save Limit"}
            </Button>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enter Result Modal ───────────────────────────────────────────────────────

function EnterResultModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState("");
  const [sampledAt, setSampledAt] = useState(new Date().toISOString().slice(0, 16));
  const [organism, setOrganism] = useState("TPC");
  const [isBelowLod, setIsBelowLod] = useState(false);
  const [cfuCount, setCfuCount] = useState("");
  const [testedByLab, setTestedByLab] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data: sites = [] } = useQuery<EmSite[]>({
    queryKey: ["/api/em/sites"],
    queryFn: async () => (await apiRequest("GET", "/api/em/sites")).json(),
  });

  const mutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/em/results", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/em/results"] });
      qc.invalidateQueries({ queryKey: ["/api/em/dashboard/due"] });
      qc.invalidateQueries({ queryKey: ["/api/em/dashboard/excursions"] });
      onClose();
    },
    onError: async (e: unknown) => {
      setError(e instanceof Response ? await e.json().then((d: { message?: string }) => d.message ?? "Error") : "Error");
    },
  });

  function submit() {
    setError("");
    if (!siteId) { setError("Select a site"); return; }
    if (!isBelowLod && !cfuCount) { setError("Enter a CFU count or mark as below LOD"); return; }
    mutation.mutate({
      siteId,
      sampledAt: new Date(sampledAt).toISOString(),
      organism,
      cfuCount: isBelowLod ? null : cfuCount,
      isBelowLod,
      testedByLab: testedByLab || null,
      notes: notes || null,
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Enter EM Result</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-1">
            <Label>Site *</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">Select site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.area})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Sample Date/Time *</Label>
              <Input type="datetime-local" value={sampledAt} onChange={(e) => setSampledAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Organism *</Label>
              <Input value={organism} onChange={(e) => setOrganism(e.target.value)} placeholder="TPC" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="belowLod"
              checked={isBelowLod}
              onChange={(e) => setIsBelowLod(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="belowLod" className="text-sm">Below limit of detection (&lt;LOD)</label>
          </div>
          {!isBelowLod && (
            <div className="space-y-1">
              <Label>CFU Count *</Label>
              <Input type="number" min={0} value={cfuCount} onChange={(e) => setCfuCount(e.target.value)} placeholder="0" />
            </div>
          )}
          <div className="space-y-1">
            <Label>Tested By Lab</Label>
            <Input value={testedByLab} onChange={(e) => setTestedByLab(e.target.value)} placeholder="e.g. Eurofins" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Submit Result"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ onEnterResult }: { onEnterResult: () => void }) {
  const { data: due = [], isLoading: loadingDue } = useQuery<DueSite[]>({
    queryKey: ["/api/em/dashboard/due"],
    queryFn: async () => (await apiRequest("GET", "/api/em/dashboard/due")).json(),
  });

  const { data: excursions = [] } = useQuery<Excursion[]>({
    queryKey: ["/api/em/dashboard/excursions"],
    queryFn: async () => (await apiRequest("GET", "/api/em/dashboard/excursions")).json(),
  });

  const overdue  = due.filter((d) => d.isOverdue);
  const upcoming = due.filter((d) => !d.isOverdue);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Environmental Monitoring Dashboard</h2>
        <Button size="sm" onClick={onEnterResult}>+ Enter Result</Button>
      </div>

      {overdue.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Overdue ({overdue.length})
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-50 dark:bg-red-950">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Site</th>
                  <th className="text-left px-4 py-2 font-medium">Area</th>
                  <th className="text-left px-4 py-2 font-medium">Frequency</th>
                  <th className="text-left px-4 py-2 font-medium">Was Due</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((d) => (
                  <tr key={d.site.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{d.site.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{d.site.area}</td>
                    <td className="px-4 py-2">{d.schedule.frequency.toLowerCase()}</td>
                    <td className="px-4 py-2 text-red-600 font-medium">{fmt(d.nextDue)} ({Math.abs(d.daysUntilDue)}d ago)</td>
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
            Due This Week ({upcoming.length})
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-yellow-50 dark:bg-yellow-950">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Site</th>
                  <th className="text-left px-4 py-2 font-medium">Area</th>
                  <th className="text-left px-4 py-2 font-medium">Due</th>
                  <th className="text-left px-4 py-2 font-medium">Organisms</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((d) => (
                  <tr key={d.site.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{d.site.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{d.site.area}</td>
                    <td className="px-4 py-2">{fmt(d.nextDue)} (in {d.daysUntilDue}d)</td>
                    <td className="px-4 py-2 text-muted-foreground">{d.schedule.organismTargets.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {overdue.length === 0 && upcoming.length === 0 && !loadingDue && (
        <p className="text-sm text-muted-foreground">No sampling events due in the next 7 days.</p>
      )}

      {excursions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Recent Excursions
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Site</th>
                  <th className="text-left px-4 py-2 font-medium">Organism</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">CFU</th>
                  <th className="text-left px-4 py-2 font-medium">Limit</th>
                  <th className="text-left px-4 py-2 font-medium">CAPA</th>
                </tr>
              </thead>
              <tbody>
                {excursions.map((e) => (
                  <tr key={e.excursion.id} className="border-t">
                    <td className="px-4 py-2">{e.siteName}</td>
                    <td className="px-4 py-2">{e.excursion.organism}</td>
                    <td className="px-4 py-2">
                      <span className={e.excursion.limitType === "ACTION"
                        ? "text-red-600 font-medium"
                        : "text-yellow-600 font-medium"}>
                        {e.excursion.limitType}
                      </span>
                    </td>
                    <td className="px-4 py-2">{e.excursion.cfuCount}</td>
                    <td className="px-4 py-2">{e.excursion.limitValue}</td>
                    <td className="px-4 py-2">
                      {e.excursion.ncId
                        ? <Badge variant="secondary" className="text-xs">NC opened</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Results View ─────────────────────────────────────────────────────────────

function ResultsView({ onEnterResult }: { onEnterResult: () => void }) {
  const [siteFilter, setSiteFilter] = useState("");

  const { data: sites = [] } = useQuery<EmSite[]>({
    queryKey: ["/api/em/sites"],
    queryFn: async () => (await apiRequest("GET", "/api/em/sites")).json(),
  });

  const { data: results = [], isLoading } = useQuery<EmResult[]>({
    queryKey: ["/api/em/results", siteFilter],
    queryFn: async () => {
      const url = siteFilter ? `/api/em/results?siteId=${siteFilter}` : "/api/em/results";
      return (await apiRequest("GET", url)).json();
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Results</h2>
        <div className="flex items-center gap-2">
          <select
            className="flex h-8 rounded-md border border-input bg-background px-2 py-0 text-sm"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
          >
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" onClick={onEnterResult}>+ Enter Result</Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Site</th>
              <th className="text-left px-4 py-2 font-medium">Sampled</th>
              <th className="text-left px-4 py-2 font-medium">Organism</th>
              <th className="text-left px-4 py-2 font-medium">CFU</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Lab</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && results.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No results yet</td></tr>
            )}
            {results.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2 font-medium">{r.siteName}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmt(r.sampledAt)}</td>
                <td className="px-4 py-2">{r.organism}</td>
                <td className="px-4 py-2">{r.isBelowLod ? "<LOD" : r.cfuCount ?? "—"}</td>
                <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-2 text-muted-foreground">{r.testedByLab ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Trend View ───────────────────────────────────────────────────────────────

function TrendView() {
  const { data: sites = [] } = useQuery<EmSite[]>({
    queryKey: ["/api/em/sites"],
    queryFn: async () => (await apiRequest("GET", "/api/em/sites")).json(),
  });

  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedOrganism, setSelectedOrganism] = useState("TPC");

  const { data: trend } = useQuery<TrendData>({
    queryKey: ["/api/em/sites", selectedSiteId, "trend"],
    queryFn: async () => (await apiRequest("GET", `/api/em/sites/${selectedSiteId}/trend`)).json(),
    enabled: !!selectedSiteId,
  });

  const chartData = (trend?.results ?? [])
    .filter((r) => r.organism === selectedOrganism)
    .map((r) => ({
      date: new Date(r.sampledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      cfu: r.isBelowLod ? 0 : r.cfuCount ? parseFloat(r.cfuCount) : null,
      isBelowLod: r.isBelowLod,
    }))
    .filter((r) => r.cfu !== null);

  const limit = trend?.limits.find((l) => l.organism === selectedOrganism);
  const alertVal  = limit?.alertLimit  ? parseFloat(limit.alertLimit)  : null;
  const actionVal = limit?.actionLimit ? parseFloat(limit.actionLimit) : null;
  const unit = limit?.unit ?? "CFU/m³";

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold">Trend Analysis</h2>
      <div className="flex gap-3">
        <select
          className="flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={selectedSiteId}
          onChange={(e) => setSelectedSiteId(e.target.value)}
        >
          <option value="">Select site…</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.area})</option>)}
        </select>
        {trend && (
          <select
            className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={selectedOrganism}
            onChange={(e) => setSelectedOrganism(e.target.value)}
          >
            {Array.from(new Set(trend.results.map((r) => r.organism))).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
      </div>

      {selectedSiteId && !trend && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!selectedSiteId && (
        <p className="text-sm text-muted-foreground">Select a site to view trend data.</p>
      )}

      {trend && chartData.length === 0 && (
        <p className="text-sm text-muted-foreground">No results recorded for {selectedOrganism} at this site.</p>
      )}

      {trend && chartData.length > 0 && (
        <div className="border rounded-md p-4">
          <p className="text-sm font-medium mb-3">{trend.site.name} — {selectedOrganism} (12 months)</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="cfu"
                name="CFU"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              {alertVal !== null && (
                <ReferenceLine y={alertVal} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: `Alert: ${alertVal}`, fontSize: 10, fill: "#f59e0b" }} />
              )}
              {actionVal !== null && (
                <ReferenceLine y={actionVal} stroke="#ef4444" strokeDasharray="6 3" label={{ value: `Action: ${actionVal}`, fontSize: 10, fill: "#ef4444" }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Sites View ───────────────────────────────────────────────────────────────

function SitesView() {
  const { user } = useAuth();
  const isQA = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;
  const [showCreate, setShowCreate] = useState(false);
  const [configureSiteId, setConfigureSiteId] = useState<string | null>(null);

  const { data: sites = [], isLoading } = useQuery<EmSite[]>({
    queryKey: ["/api/em/sites"],
    queryFn: async () => (await apiRequest("GET", "/api/em/sites")).json(),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Sampling Sites</h2>
        {isQA && <Button size="sm" onClick={() => setShowCreate(true)}>+ New Site</Button>}
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Area</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              {isQA && <th className="text-left px-4 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && sites.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No sites configured yet</td></tr>
            )}
            {sites.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{s.area}</td>
                <td className="px-4 py-2">{SITE_TYPE_LABELS[s.siteType]}</td>
                <td className="px-4 py-2">
                  <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                </td>
                {isQA && (
                  <td className="px-4 py-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfigureSiteId(s.id)}>Configure</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateSiteModal onClose={() => setShowCreate(false)} />}
      {configureSiteId && <ConfigureSiteModal siteId={configureSiteId} onClose={() => setConfigureSiteId(null)} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type EmTab = "dashboard" | "results" | "sites" | "trend";

export default function EnvironmentalMonitoringPage() {
  const [activeTab, setActiveTab] = useState<EmTab>("dashboard");
  const [showEnterResult, setShowEnterResult] = useState(false);

  const tabs: { id: EmTab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "results",   label: "Results" },
    { id: "sites",     label: "Sites" },
    { id: "trend",     label: "Trend" },
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
        {activeTab === "dashboard" && <DashboardView onEnterResult={() => setShowEnterResult(true)} />}
        {activeTab === "results"   && <ResultsView onEnterResult={() => setShowEnterResult(true)} />}
        {activeTab === "sites"     && <SitesView />}
        {activeTab === "trend"     && <TrendView />}
      </div>
      {showEnterResult && <EnterResultModal onClose={() => setShowEnterResult(false)} />}
    </div>
  );
}
