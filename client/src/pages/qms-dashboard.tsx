import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
  AlertCircle,
  Loader2,
} from "lucide-react";
import { QmsComplianceBanner } from "@/components/qms-compliance-banner";

// ─── Types ────────────────────────────────────────────

interface LotRelease {
  id: string;
  lotNumber: string;
  productName: string;
  productSku: string;
  bprId: string | null;
  coaId: string | null;
  status: string;
}

interface Capa {
  id: string;
  number: string;
  title: string;
  daysLeft: string | null;
  status: string;
  targetDate: string;
}

interface Complaint {
  id: string;
  number: string;
  category: string;
  sku: string | null;
  receivedAt: string | null;
  status: string;
}

interface DashboardStats {
  pendingReleases: number;
  openCapas: number;
  openComplaints: number;
  trainingGaps: number;
}

// ─── Helpers ─────────────────────────────────────────

function categoryBadge(cat: string) {
  if (cat === "adverse_event" || cat === "serious_adverse_event")
    return <Badge variant="destructive" className="text-xs">Adverse Event</Badge>;
  return <Badge variant="secondary" className="text-xs">Quality</Badge>;
}

function capaStatusBadge(status: string) {
  if (status === "in_progress")
    return <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">In Progress</Badge>;
  return <Badge variant="outline" className="text-xs">Open</Badge>;
}

function daysLeftBadge(days: string | null) {
  const n = days ? parseFloat(days) : null;
  if (n === null) return null;
  if (n <= 7) return <span className="text-xs font-medium text-destructive">{n}d left</span>;
  if (n <= 21) return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{n}d left</span>;
  return <span className="text-xs text-muted-foreground">{n}d left</span>;
}

// ─── Stat card ────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  urgent?: boolean;
  loading?: boolean;
}
function StatCard({ icon, label, value, sub, urgent, loading }: StatCardProps) {
  return (
    <Card className={urgent ? "border-destructive/50" : ""}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className={`p-2 rounded-lg ${urgent ? "bg-destructive/10" : "bg-muted"}`}>
            {icon}
          </div>
          {loading
            ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            : <span className={`text-3xl font-bold tracking-tight ${urgent ? "text-destructive" : "text-foreground"}`}>{value}</span>
          }
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
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/qms/dashboard"],
    refetchInterval: 30_000,
  });

  const { data: pendingReleases = [], isLoading: releasesLoading } = useQuery<LotRelease[]>({
    queryKey: ["/api/qms/lot-releases", "PENDING_QC_REVIEW"],
    queryFn: () => fetch("/api/qms/lot-releases?status=PENDING_QC_REVIEW").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: openCapas = [], isLoading: capasLoading } = useQuery<Capa[]>({
    queryKey: ["/api/qms/capas", "open"],
    queryFn: () => fetch("/api/qms/capas").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: openComplaints = [], isLoading: complaintsLoading } = useQuery<Complaint[]>({
    queryKey: ["/api/qms/complaints", "open"],
    queryFn: () => fetch("/api/qms/complaints").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const activeCapas = openCapas.filter(c =>
    ["open", "in_progress", "pending_effectiveness", "on_hold"].includes(c.status)
  ).slice(0, 4);

  const activeComplaints = openComplaints.filter(c =>
    ["open", "under_investigation", "pending_qc_review"].includes(c.status)
  ).slice(0, 3);

  return (
    <div className="p-6 space-y-6">
      {/* Compliance banner */}
      <QmsComplianceBanner />

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
          value={stats?.pendingReleases ?? 0}
          sub="QC signature required"
          loading={statsLoading}
        />
        <StatCard
          icon={<ClipboardList className="h-4 w-4 text-blue-600" />}
          label="Open CAPAs"
          value={stats?.openCapas ?? 0}
          sub="FDA observations"
          loading={statsLoading}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          label="Open complaints"
          value={stats?.openComplaints ?? 0}
          sub="incl. adverse events"
          urgent={!!(stats && stats.openComplaints > 0)}
          loading={statsLoading}
        />
        <StatCard
          icon={<GraduationCap className="h-4 w-4 text-purple-600" />}
          label="Training gaps"
          value={stats?.trainingGaps ?? 0}
          sub="Phase 2 — coming soon"
          loading={statsLoading}
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
            {releasesLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : pendingReleases.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-muted-foreground">No lots pending QC release</div>
            ) : (
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
                  {pendingReleases.slice(0, 5).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6 font-mono text-xs">{r.lotNumber}</TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{r.productName}</div>
                        <div className="text-xs text-muted-foreground">{r.productSku}</div>
                      </TableCell>
                      <TableCell className="text-center">
                        {r.bprId
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                          : <AlertCircle className="h-4 w-4 text-amber-500 mx-auto" />
                        }
                      </TableCell>
                      <TableCell className="text-center pr-6">
                        {r.coaId
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                          : <AlertCircle className="h-4 w-4 text-amber-500 mx-auto" />
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
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
            {capasLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : activeCapas.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-muted-foreground">No open CAPAs</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 text-xs">CAPA #</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs text-right pr-6">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeCapas.map((c) => (
                    <TableRow key={c.id}>
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Complaints */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Open Complaints
              </CardTitle>
              <Link href="/qms/complaints">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {complaintsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : activeComplaints.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-muted-foreground">No open complaints</div>
            ) : (
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
                  {activeComplaints.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6 font-mono text-xs">{c.number}</TableCell>
                      <TableCell>{categoryBadge(c.category)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.sku ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground pr-6">
                        {c.receivedAt ? new Date(c.receivedAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Training gaps placeholder */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-purple-600" />
              Training Gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground text-center py-4">
              Training records module launches in Phase 2 (by 2026-05-20).
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
