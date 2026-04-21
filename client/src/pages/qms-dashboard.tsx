import { Link } from "wouter";
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
  ShieldCheck,
  AlertTriangle,
  ClipboardList,
  GraduationCap,
  FileCheck,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
} from "lucide-react";

// ─── Mock data ────────────────────────────────────────

const pendingReleases = [
  { lotCode: "LOT-2026-0412", sku: "UA-60CT-500MG",   product: "Urolithin A 500mg", submittedAt: "2026-04-20", bpr: true, coa: true },
  { lotCode: "LOT-2026-0408", sku: "NMN-60CT-500MG",  product: "NMN 500mg",          submittedAt: "2026-04-19", bpr: true, coa: false },
  { lotCode: "LOT-2026-0401", sku: "OMGA-60CT-1000MG", product: "Omega-3 1000mg",    submittedAt: "2026-04-18", bpr: true, coa: true },
];

const openCapas = [
  { number: "CAPA-2026-0002", title: "Weigher/verifier separation enforcement", source: "fda_observation", targetDate: "2026-05-06", daysLeft: 15, status: "in_progress" },
  { number: "CAPA-2026-0003", title: "COA review workflow — Urolithin A & NMN raw materials", source: "fda_observation", targetDate: "2026-05-06", daysLeft: 15, status: "in_progress" },
  { number: "CAPA-2026-0004", title: "Label reconciliation added to all BPRs", source: "fda_observation", targetDate: "2026-05-20", daysLeft: 29, status: "open" },
  { number: "CAPA-2026-0005", title: "OOS investigation SOP for finished goods testing", source: "fda_observation", targetDate: "2026-05-20", daysLeft: 29, status: "open" },
];

const openComplaints = [
  { number: "CMP-2026-0021", category: "adverse_event", sku: "UA-60CT-500MG",    receivedAt: "2026-04-19", status: "under_investigation" },
  { number: "CMP-2026-0020", category: "quality",        sku: "NMN-60CT-500MG",  receivedAt: "2026-04-17", status: "open" },
  { number: "CMP-2026-0018", category: "quality",        sku: "OMGA-60CT-1000MG", receivedAt: "2026-04-14", status: "open" },
];

const trainingGaps = [
  { name: "Marcus R.",  role: "Production Lead", sop: "SOP-QC-005 — In-Process Checks", dueDate: "2026-04-28" },
  { name: "Diane P.",   role: "Warehouse Lead",  sop: "SOP-WH-002 — Label Reconciliation", dueDate: "2026-04-28" },
  { name: "Tom K.",     role: "Production Lead", sop: "SOP-QC-012 — Deviation Reporting", dueDate: "2026-05-05" },
];

// ─── Helpers ─────────────────────────────────────────

function categoryBadge(cat: string) {
  if (cat === "adverse_event")
    return <Badge variant="destructive" className="text-xs">Adverse Event</Badge>;
  return <Badge variant="secondary" className="text-xs">Quality</Badge>;
}

function capaStatusBadge(status: string) {
  if (status === "in_progress")
    return <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">In Progress</Badge>;
  return <Badge variant="outline" className="text-xs">Open</Badge>;
}

function daysLeftBadge(days: number) {
  if (days <= 7) return <span className="text-xs font-medium text-destructive">{days}d left</span>;
  if (days <= 21) return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{days}d left</span>;
  return <span className="text-xs text-muted-foreground">{days}d left</span>;
}

function coaIcon(ok: boolean) {
  return ok
    ? <CheckCircle2 className="h-4 w-4 text-green-600" />
    : <AlertCircle className="h-4 w-4 text-amber-500" />;
}

// ─── Stat card ────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  urgent?: boolean;
}
function StatCard({ icon, label, value, sub, urgent }: StatCardProps) {
  return (
    <Card className={urgent ? "border-destructive/50" : ""}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className={`p-2 rounded-lg ${urgent ? "bg-destructive/10" : "bg-muted"}`}>
            {icon}
          </div>
          <span className={`text-3xl font-bold tracking-tight ${urgent ? "text-destructive" : "text-foreground"}`}>
            {value}
          </span>
        </div>
        <div className="mt-3">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────

export default function QmsDashboard() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">QMS Dashboard</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            21 CFR 111 compliance — FDA response deadline <span className="font-medium text-foreground">2026-05-06</span>
          </p>
        </div>
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 font-medium px-3 py-1 text-sm">
          Phase 0 — Emergency Scaffold
        </Badge>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="Lots awaiting release"
          value={pendingReleases.length}
          sub="QC signature required"
          urgent={false}
        />
        <StatCard
          icon={<ClipboardList className="h-4 w-4 text-blue-600" />}
          label="Open CAPAs"
          value={openCapas.length}
          sub="4 FDA observations"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          label="Open complaints"
          value={openComplaints.length}
          sub="1 adverse event"
          urgent
        />
        <StatCard
          icon={<GraduationCap className="h-4 w-4 text-purple-600" />}
          label="Training gaps"
          value={trainingGaps.length}
          sub="Due within 7 days"
        />
      </div>

      {/* Release queue + CAPAs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending releases */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-primary" />
                Pending Releases
              </CardTitle>
              <Link href="/qms/release-queue">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 gap-1">
                  View queue <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 text-xs">Lot code</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs text-center">BPR</TableHead>
                  <TableHead className="text-xs text-center pr-6">COA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingReleases.map((r) => (
                  <TableRow key={r.lotCode}>
                    <TableCell className="pl-6 font-mono text-xs">{r.lotCode}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium">{r.product}</div>
                      <div className="text-xs text-muted-foreground">{r.sku}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                    </TableCell>
                    <TableCell className="text-center pr-6">
                      {coaIcon(r.coa)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Open CAPAs */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                Open CAPAs
              </CardTitle>
              <Link href="/qms/capa">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 text-xs">CAPA #</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs text-right pr-6">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openCapas.map((c) => (
                  <TableRow key={c.number}>
                    <TableCell className="pl-6 font-mono text-xs whitespace-nowrap">{c.number}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium leading-tight">{c.title}</div>
                      <div className="mt-0.5">{capaStatusBadge(c.status)}</div>
                    </TableCell>
                    <TableCell className="text-right pr-6">{daysLeftBadge(c.daysLeft)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Complaints + Training gaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Complaints */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Open Complaints
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 text-xs">Complaint #</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs pr-6">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openComplaints.map((c) => (
                  <TableRow key={c.number}>
                    <TableCell className="pl-6 font-mono text-xs">{c.number}</TableCell>
                    <TableCell>{categoryBadge(c.category)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.sku}</TableCell>
                    <TableCell className="text-xs text-muted-foreground pr-6">{c.receivedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Training gaps */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-purple-600" />
              Training Gaps
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 text-xs">Person</TableHead>
                  <TableHead className="text-xs">SOP</TableHead>
                  <TableHead className="text-xs text-right pr-6">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainingGaps.map((t) => (
                  <TableRow key={`${t.name}-${t.sop}`}>
                    <TableCell className="pl-6">
                      <div className="text-xs font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.role}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{t.sop}</TableCell>
                    <TableCell className="text-right text-xs font-medium text-destructive pr-6">{t.dueDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
