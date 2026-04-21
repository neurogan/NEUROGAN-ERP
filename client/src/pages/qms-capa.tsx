import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClipboardList,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ExternalLink,
  CalendarDays,
} from "lucide-react";

// ─── Mock data ────────────────────────────────────────

interface Capa {
  number: string;
  title: string;
  source: string;
  fdaObs: string;
  owner: string;
  targetDate: string;
  daysLeft: number;
  phase: "30d" | "90d" | "180d";
  status: "open" | "in_progress" | "closed" | "verified";
  asanaUrl: string;
  description: string;
  rootCause?: string;
  actionPlan?: string;
}

const capas: Capa[] = [
  {
    number: "CAPA-2026-0001",
    title: "Implement QC lot release gate — no lot ships without QC approval",
    source: "fda_observation",
    fdaObs: "Obs 5",
    owner: "Carrie (QC)",
    targetDate: "2026-05-06",
    daysLeft: 15,
    phase: "30d",
    status: "in_progress",
    asanaUrl: "#",
    description: "FDA observed that lots were shipped without formal QC review. The release queue and database gate now enforce QC sign-off before any shipment endpoint will accept a lot code.",
    actionPlan: "Deploy qms.release table + shipment guard. Train QC on release workflow. Validate on LOT-2026-0401 (Urolithin A) before FDA response.",
  },
  {
    number: "CAPA-2026-0002",
    title: "Separate weigher and verifier roles — enforced at DB level",
    source: "fda_observation",
    fdaObs: "Obs 3",
    owner: "Engineering",
    targetDate: "2026-05-06",
    daysLeft: 15,
    phase: "30d",
    status: "in_progress",
    asanaUrl: "#",
    description: "FDA observed the same employee acted as both weigher and verifier on NMN 500mg batch LOT-2025-1102. A database CHECK constraint now rejects BPRs where production_lead_id = verifier_id.",
    rootCause: "No system control enforcing two-person integrity. Verbal policy was insufficient.",
    actionPlan: "DB constraint deployed. BPR form UI shows warning if same person selects both roles. Retrain Production Leads and Warehouse Leads on two-person rule.",
  },
  {
    number: "CAPA-2026-0003",
    title: "COA review workflow — all incoming COAs reviewed by Chief Chemist",
    source: "fda_observation",
    fdaObs: "Obs 4",
    owner: "Carrie (QC)",
    targetDate: "2026-05-06",
    daysLeft: 15,
    phase: "30d",
    status: "in_progress",
    asanaUrl: "#",
    description: "FDA observed that Certificates of Analysis for incoming Urolithin A and NMN raw materials were not reviewed by QC before materials were used in production.",
    rootCause: "COAs were filed in Dropbox without a formal review workflow. No system tracked who reviewed what.",
    actionPlan: "COA inbox built in ERP. Chief Chemist reviews and signs each COA before status changes from pending to accepted. Materials cannot enter production with pending COAs.",
  },
  {
    number: "CAPA-2026-0004",
    title: "Label reconciliation added to all BPRs as a required signed step",
    source: "fda_observation",
    fdaObs: "Obs 2",
    owner: "Marcus R. (Production)",
    targetDate: "2026-05-20",
    daysLeft: 29,
    phase: "30d",
    status: "open",
    asanaUrl: "#",
    description: "FDA found no records of label issue, usage, and destruction reconciliation for NMN and Urolithin A runs. Every BPR must now include a label reconciliation step signed by the Production Lead.",
    actionPlan: "Add label reconciliation step to all MMR templates. Update BPR form. Train all Production Leads. First compliant run target: LOT-2026-0420.",
  },
  {
    number: "CAPA-2026-0005",
    title: "OOS investigation SOP written and deployed for all finished goods testing",
    source: "fda_observation",
    fdaObs: "Obs 7",
    owner: "Carrie (QC)",
    targetDate: "2026-05-20",
    daysLeft: 29,
    phase: "30d",
    status: "open",
    asanaUrl: "#",
    description: "FDA observed that two out-of-specification results on Urolithin A were not formally investigated. A two-phase OOS SOP (SOP-QC-008) and workflow is being implemented.",
    actionPlan: "Draft SOP-QC-008. Build OOS two-phase workflow in ERP. Train Chief Chemist and QC on Phase 1 (lab) and Phase 2 (production) investigation requirements.",
  },
  {
    number: "CAPA-2026-0006",
    title: "Complaint lot-linkage enforced — Gorgias macro requires lot code",
    source: "fda_observation",
    fdaObs: "Obs 8",
    owner: "CS Manager",
    targetDate: "2026-06-15",
    daysLeft: 55,
    phase: "90d",
    status: "open",
    asanaUrl: "#",
    description: "Complaints received via Gorgias were not tied to specific lot codes, making it impossible to assess scope of quality issues. Gorgias intake macro now requires lot code and SKU.",
    actionPlan: "Update Gorgias macro. Build Gorgias → ERP webhook. Test with 5 synthetic complaints. 30-day grace period for legacy tickets, then enforce NOT NULL constraint on lot_code.",
  },
  {
    number: "CAPA-2026-0007",
    title: "Adverse event escalation procedure to co-founder and FDA (21 CFR 111.570)",
    source: "fda_observation",
    fdaObs: "Obs 10",
    owner: "Carrie (QC)",
    targetDate: "2026-06-15",
    daysLeft: 55,
    phase: "90d",
    status: "open",
    asanaUrl: "#",
    description: "FDA found no evidence that serious adverse events were escalated to leadership or evaluated against 21 CFR 111.570 reporting requirements.",
    actionPlan: "Build SAE category in complaint workflow. Automatic Slack alert to QC Manager + co-founder on any complaint categorised as serious_adverse_event. Log FDA-reportable flag.",
  },
  {
    number: "CAPA-2026-0008",
    title: "Supplier qualification — Symbio Labs COA method validation review",
    source: "fda_observation",
    fdaObs: "Obs 6",
    owner: "Carrie (QC)",
    targetDate: "2026-07-19",
    daysLeft: 89,
    phase: "90d",
    status: "open",
    asanaUrl: "#",
    description: "FDA flagged that COAs using 'Confirm by Input' and 'Input from Supplier' test methods are not validated methods. Symbio Labs and all suppliers must provide validated method documentation.",
    actionPlan: "Flag all existing COAs with invalid methods. Contact Symbio Labs for validated HPLC method documentation. Disqualify suppliers unable to provide by 2026-07-01.",
  },
  {
    number: "CAPA-2026-0009",
    title: "Annual cleaning SOP and training records for all production personnel",
    source: "fda_observation",
    fdaObs: "Obs 13",
    owner: "Marcus R. (Production)",
    targetDate: "2026-07-19",
    daysLeft: 89,
    phase: "90d",
    status: "open",
    asanaUrl: "#",
    description: "No formal cleaning SOP or training records existed for production and encapsulation equipment. SOP-QC-014 (Equipment Cleaning) is being drafted and all relevant personnel will be trained.",
    actionPlan: "Draft SOP-QC-014. Schedule hands-on demonstration training. Capture evidence (photos + sign-off form) per employee. Store in Dropbox under /QMS/Training/.",
  },
];

// ─── Helpers ─────────────────────────────────────────

function statusBadge(status: Capa["status"]) {
  const map: Record<Capa["status"], JSX.Element> = {
    open:        <Badge variant="outline" className="text-xs">Open</Badge>,
    in_progress: <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">In Progress</Badge>,
    closed:      <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Closed</Badge>,
    verified:    <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Verified</Badge>,
  };
  return map[status];
}

function phaseBadge(phase: Capa["phase"]) {
  const map: Record<Capa["phase"], JSX.Element> = {
    "30d":  <Badge className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">30-day</Badge>,
    "90d":  <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">90-day</Badge>,
    "180d": <Badge variant="secondary" className="text-xs">180-day</Badge>,
  };
  return map[phase];
}

function daysLeftColor(days: number) {
  if (days <= 15) return "text-destructive font-semibold";
  if (days <= 30) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

// ─── Phase section ────────────────────────────────────

function PhaseSection({ phase, items }: { phase: "30d" | "90d" | "180d"; items: Capa[] }) {
  const titles = { "30d": "30-day immediate actions (by 2026-05-20)", "90d": "90-day systemic actions (by 2026-07-19)", "180d": "180-day preventive actions (by 2026-10-17)" };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          {titles[phase]}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-xs w-36">CAPA #</TableHead>
              <TableHead className="text-xs">Title</TableHead>
              <TableHead className="text-xs">FDA obs</TableHead>
              <TableHead className="text-xs">Owner</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Target</TableHead>
              <TableHead className="text-xs w-12 pr-6"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((c) => (
              <TableRow key={c.number}>
                <TableCell className="pl-6 font-mono text-xs">{c.number}</TableCell>
                <TableCell>
                  <div className="text-xs font-medium leading-snug max-w-xs">{c.title}</div>
                  {c.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xs line-clamp-2">{c.description}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs font-mono">{c.fdaObs}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{c.owner}</TableCell>
                <TableCell>{statusBadge(c.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="text-xs">{c.targetDate}</div>
                  <div className={`text-xs ${daysLeftColor(c.daysLeft)}`}>{c.daysLeft}d left</div>
                </TableCell>
                <TableCell className="pr-6">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                    <a href={c.asanaUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="sr-only">Open in Asana</span>
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────

export default function QmsCapa() {
  const byPhase = (phase: "30d" | "90d" | "180d") => capas.filter((c) => c.phase === phase);
  const inProgress = capas.filter((c) => c.status === "in_progress").length;
  const open = capas.filter((c) => c.status === "open").length;
  const closed = capas.filter((c) => c.status === "closed" || c.status === "verified").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">CAPA Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Corrective and Preventive Actions — FDA 483 response program
            </p>
          </div>
        </div>
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-3 py-1 text-sm">
          FDA deadline: 2026-05-06
        </Badge>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">In progress</div>
              <div className="text-xs text-muted-foreground">Active work</div>
            </div>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Open</div>
              <div className="text-xs text-muted-foreground">Not yet started</div>
            </div>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{open}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Closed</div>
              <div className="text-xs text-muted-foreground">Complete &amp; verified</div>
            </div>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">{closed}</div>
          </CardContent>
        </Card>
      </div>

      {/* FDA observation map note */}
      <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <span>
          Each CAPA maps directly to a named FDA 483 observation. The FDA response package references these CAPA numbers as the evidence that each observation has been remediated. CAPAs are mirrored to Asana (interim) and will migrate to the Launch Dashboard in 2026-10.
        </span>
      </div>

      {/* Phase sections */}
      <PhaseSection phase="30d" items={byPhase("30d")} />
      <PhaseSection phase="90d" items={byPhase("90d")} />
    </div>
  );
}
