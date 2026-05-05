import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Beaker,
  Truck,
  Clock,
  ArrowRight,
  TrendingUp,
  AlertTriangle as AlertTriangleIcon,
  Wrench,
  BadgeCheck,
  Tag,
  AlertOctagon,
} from "lucide-react";
import { formatQty } from "@/lib/formatQty";
import { formatDate } from "@/lib/formatDate";
import { Link } from "wouter";
import { DashboardTasks } from "@/components/DashboardTasks";
import { QcQueueCard } from "@/components/QcQueueCard";
import type {
  Equipment,
  CalibrationSchedule,
  EquipmentQualification,
  LabelArtwork,
  LabelReconciliation,
} from "@shared/schema";

// ─── Types ───────────────────────────────────────────

interface ActiveBatchDetail {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
  status: string;
  plannedQuantity: string;
  outputUom: string;
  startedAt: string | null;
  createdAt: string;
}

interface OpenPODetail {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  expectedDeliveryDate: string | null;
  materials: { name: string; sku: string; qtyOrdered: number; qtyReceived: number; uom: string }[];
  totalOrdered: number;
  totalReceived: number;
}

interface LowStockItem {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  defaultUom: string;
  totalQuantity: number;
  threshold: number;
}

interface TransactionWithDetails {
  id: string;
  lotId: string;
  locationId: string;
  type: string;
  quantity: string;
  uom: string;
  productionBatchId: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  productName: string;
  lotNumber: string;
  locationName: string;
}

interface DashboardStats {
  activeBatches: ActiveBatchDetail[];
  openPOs: OpenPODetail[];
  lowStockItems: LowStockItem[];
  recentTransactions: TransactionWithDetails[];
}

interface BottleneckMaterial {
  materialId: string;
  materialName: string;
  materialSku: string;
  productCount: number;
  inStock: number;
  uom: string;
}

interface LowestCapacityProduct {
  productId: string;
  productName: string;
  productSku: string;
  totalPotential: number;
  bottleneckMaterial: string | null;
}

interface DashboardSupplyChain {
  topBottleneckMaterials: BottleneckMaterial[];
  lowestCapacityProducts: LowestCapacityProduct[];
}

// ─── Helpers ─────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function batchStatusBadge(status: string) {
  switch (status) {
    case "IN_PROGRESS":
      return <Badge className="bg-blue-500/20 text-blue-300 border-0 text-xs">In Progress</Badge>;
    case "ON_HOLD":
      return <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">On Hold</Badge>;
    case "DRAFT":
      return <Badge className="bg-neutral-500/20 text-neutral-400 border-0 text-xs">Draft</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function poStatusBadge(status: string) {
  switch (status) {
    case "SUBMITTED":
      return <Badge className="bg-blue-500/20 text-blue-300 border-0 text-xs">Submitted</Badge>;
    case "PARTIALLY_RECEIVED":
      return <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">Partial</Badge>;
    case "DRAFT":
      return <Badge className="bg-neutral-500/20 text-neutral-400 border-0 text-xs">Draft</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function typeBadge(type: string) {
  switch (type) {
    case "PO_RECEIPT":
      return <Badge className="bg-emerald-500/20 text-emerald-300 border-0 text-xs">PO Receipt</Badge>;
    case "PRODUCTION_CONSUMPTION":
      return <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">Production</Badge>;
    case "PRODUCTION_OUTPUT":
      return <Badge className="bg-purple-500/20 text-purple-300 border-0 text-xs">Output</Badge>;
    case "COUNT_ADJUSTMENT":
      return <Badge className="bg-blue-500/20 text-blue-300 border-0 text-xs">Adjustment</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{type}</Badge>;
  }
}

// ─── Glow animation style ────────────────────────────

const pulseGlowStyle = `
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
  50% { box-shadow: 0 0 15px 2px hsl(var(--primary) / 0.15); }
}
`;

// ─── Loading skeleton ────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent><Skeleton className="h-32 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
  });

  const { data: supplyChainData } = useQuery<DashboardSupplyChain>({
    queryKey: ["/api/dashboard/supply-chain"],
  });

  // ─── R-03 Equipment & Cleaning: dashboard cards ────────────────
  const { data: equipmentList = [] } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  // ─── R-05 Complaints: dashboard cards ──────────────────────────
  const { data: complaintsSummary } = useQuery<{
    awaitingTriage: number;
    triageOverdue: number;
    aeDueSoon: number;
    awaitingDisposition: number;
    dispositionOverdue: number;
    callbackFailures: number;
  }>({
    queryKey: ["/api/complaints/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/complaints/summary")).json(),
    staleTime: 60_000,
  });

  // ─── R-06 Returns: dashboard cards ─────────────────────────────
  const { data: returnsSummary } = useQuery<{
    awaitingDisposition: number;
    openInvestigations: number;
  }>({
    queryKey: ["/api/returned-products/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/returned-products/summary")).json(),
    staleTime: 60_000,
  });

  // ─── R-04 Label cage: dashboard cards ──────────────────────────
  const { data: draftArtworks = [] } = useQuery<LabelArtwork[]>({
    queryKey: ["/api/label-artwork/drafts"],
    queryFn: async () => (await apiRequest("GET", "/api/label-artwork/drafts")).json(),
  });

  const { data: outOfToleranceRecons = [] } = useQuery<LabelReconciliation[]>({
    queryKey: ["/api/label-reconciliations/out-of-tolerance"],
    queryFn: async () => (await apiRequest("GET", "/api/label-reconciliations/out-of-tolerance")).json(),
  });

  // Filter to non-RETIRED first to keep fan-out small.
  const activeEquipment = useMemo(
    () => equipmentList.filter((e) => e.status !== "RETIRED"),
    [equipmentList],
  );

  const calibrationQueries = useQueries({
    queries: activeEquipment.map((e) => ({
      queryKey: [`/api/equipment/${e.id}/calibration`],
      enabled: !!e.id,
    })),
  });

  const qualificationQueries = useQueries({
    queries: activeEquipment.map((e) => ({
      queryKey: [`/api/equipment/${e.id}/qualifications`],
      enabled: !!e.id,
    })),
  });

  const DAY_MS = 86_400_000;
  const now = Date.now();

  const calibrationsDue = useMemo(() => {
    const out: { equipment: Equipment; nextDueAt: Date; daysUntil: number }[] = [];
    activeEquipment.forEach((e, i) => {
      const result = calibrationQueries[i]?.data as
        | { schedule: CalibrationSchedule | null }
        | undefined;
      if (!result?.schedule) return;
      const due = new Date(result.schedule.nextDueAt).getTime();
      const days = (due - now) / DAY_MS;
      if (days <= 7) {
        out.push({
          equipment: e,
          nextDueAt: new Date(result.schedule.nextDueAt),
          daysUntil: days,
        });
      }
    });
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [activeEquipment, calibrationQueries]);

  const qualificationsExpiring = useMemo(() => {
    const out: {
      equipment: Equipment;
      type: string;
      validUntil: Date;
      daysUntil: number;
    }[] = [];
    activeEquipment.forEach((e, i) => {
      const quals = qualificationQueries[i]?.data as
        | EquipmentQualification[]
        | undefined;
      if (!quals) return;
      quals.forEach((q) => {
        if (!q.validUntil) return;
        if (q.status !== "QUALIFIED") return;
        const until = new Date(q.validUntil).getTime();
        const days = (until - now) / DAY_MS;
        if (days <= 30) {
          out.push({
            equipment: e,
            type: q.type,
            validUntil: new Date(q.validUntil),
            daysUntil: days,
          });
        }
      });
    });
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [activeEquipment, qualificationQueries]);

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;

  const hasActiveBatches = data.activeBatches.length > 0;
  const hasOpenPOs = data.openPOs.length > 0;
  const hasInProgress = data.activeBatches.some(b => b.status === "IN_PROGRESS");
  const bottleneckCount = supplyChainData?.topBottleneckMaterials.length ?? 0;
  const hasBottlenecks = bottleneckCount > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Inject glow keyframe animation */}
      <style>{pulseGlowStyle}</style>

      <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>

      {/* Summary strip */}
      <div className="flex flex-wrap gap-3">
        <Link href="/production">
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors" data-testid="summary-batches">
            <Beaker className={`h-4 w-4 ${hasActiveBatches ? "text-blue-400" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">Active Batches</span>
            <span className="font-semibold">{data.activeBatches.length}</span>
          </div>
        </Link>
        <Link href="/suppliers">
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors" data-testid="summary-pos">
            <Truck className={`h-4 w-4 ${hasOpenPOs ? "text-blue-400" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">Open POs</span>
            <span className="font-semibold">{data.openPOs.length}</span>
          </div>
        </Link>
        <Link href="/supply-chain">
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors" data-testid="summary-supply-chain">
            <TrendingUp className={`h-4 w-4 ${hasBottlenecks ? "text-amber-400" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">Bottlenecks</span>
            <span className={`font-semibold ${hasBottlenecks ? "text-amber-400" : ""}`}>{bottleneckCount}</span>
          </div>
        </Link>
      </div>

      {/* Tasks widget */}
      <DashboardTasks />

      {/* Top row: Production Batches + Open POs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Active Production Batches */}
        <Card
          data-testid="card-active-batches"
          className={hasInProgress ? "border-primary/30" : ""}
          style={hasInProgress ? { animation: "pulse-glow 3s ease-in-out infinite" } : undefined}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Beaker className="h-4 w-4 text-blue-400" />
                Active Production Batches
                {hasInProgress && (
                  <Badge
                    className="bg-emerald-500/20 text-emerald-400 border-0 text-[10px] px-1.5 py-0 h-4 ml-1 gap-1"
                    data-testid="badge-live"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                    LIVE
                  </Badge>
                )}
              </CardTitle>
              <Link href="/production">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!hasActiveBatches ? (
              <p className="text-sm text-muted-foreground px-6 pb-4">No active production batches.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Batch</TableHead>
                    <TableHead className="text-xs">Product</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Qty</TableHead>
                    <TableHead className="text-xs">
                      <Clock className="h-3 w-3 inline mr-1" />Started
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.activeBatches.map((batch) => (
                    <TableRow
                      key={batch.id}
                      className={`cursor-pointer hover:bg-muted/50 ${batch.status === "IN_PROGRESS" ? "border-l-2 border-l-primary" : ""}`}
                      onClick={() => { window.location.hash = `#/production?batch=${batch.id}`; }}
                      data-testid={`row-batch-${batch.id}`}
                    >
                      <TableCell className="text-sm font-mono font-medium">{batch.batchNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-xs font-medium truncate max-w-[160px]">{batch.productName}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{batch.productSku}</p>
                        </div>
                      </TableCell>
                      <TableCell>{batchStatusBadge(batch.status)}</TableCell>
                      <TableCell className="text-xs tabular-nums">{formatQty(parseFloat(batch.plannedQuantity))} {batch.outputUom}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(batch.startedAt ?? batch.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Open Purchase Orders */}
        <Card data-testid="card-open-pos">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-blue-400" />
                Open Purchase Orders
              </CardTitle>
              <Link href="/suppliers">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!hasOpenPOs ? (
              <p className="text-sm text-muted-foreground px-6 pb-4">No open purchase orders.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.openPOs.map((po) => {
                  const pct = po.totalOrdered > 0 ? (po.totalReceived / po.totalOrdered) * 100 : 0;
                  return (
                    <div
                      key={po.id}
                      className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => { window.location.hash = `#/procurement/receiving?po=${po.id}`; }}
                      data-testid={`row-po-${po.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium">{po.poNumber}</span>
                          {poStatusBadge(po.status)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {po.expectedDeliveryDate
                            ? `ETA: ${formatDate(po.expectedDeliveryDate)}`
                            : "No ETA"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-1.5">{po.supplierName}</div>
                      <div className="space-y-1 mb-2">
                        {po.materials.map((mat, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="truncate max-w-[200px]">{mat.name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatQty(mat.qtyReceived)} / {formatQty(mat.qtyOrdered)} {mat.uom}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QC Queue — incoming materials pipeline */}
      <QcQueueCard />

      {/* Bottom row: Supply Chain + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Supply Chain Bottlenecks */}
        <Card data-testid="card-supply-chain" className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className={`h-4 w-4 ${hasBottlenecks ? "text-amber-400" : "text-muted-foreground"}`} />
                Supply Chain
                {hasBottlenecks && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs ml-1">
                    {bottleneckCount}
                  </Badge>
                )}
              </CardTitle>
              <Link href="/supply-chain">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 relative min-h-0">
            {!supplyChainData || (!hasBottlenecks && supplyChainData.lowestCapacityProducts.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-6 text-center px-6">
                <TrendingUp className="h-8 w-8 text-emerald-400 mb-2" />
                <p className="text-sm font-medium text-emerald-400">No bottlenecks detected</p>
                <p className="text-xs text-muted-foreground mt-1">All products have capacity</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {/* Section A: Top Bottleneck Materials */}
                {supplyChainData.topBottleneckMaterials.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Top Bottlenecks</p>
                    <div className="space-y-2">
                      {supplyChainData.topBottleneckMaterials.map((mat) => {
                        const isZeroStock = mat.inStock === 0;
                        return (
                          <Link key={mat.materialId} href={`/inventory?material=${mat.materialId}`}>
                            <div
                              className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-muted/50 rounded-sm px-1 -mx-1 transition-colors"
                              data-testid={`bottleneck-${mat.materialId}`}
                            >
                              <div className="min-w-0 flex-1 mr-3">
                                <p className="text-sm font-medium truncate">{mat.materialName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] font-mono text-muted-foreground">{mat.materialSku}</span>
                                  <span className={`text-[10px] ${isZeroStock ? "text-amber-400" : "text-muted-foreground"}`}>
                                    {isZeroStock && <AlertTriangleIcon className="h-2.5 w-2.5 inline mr-0.5" />}
                                    {formatQty(mat.inStock)} {mat.uom} in stock
                                  </span>
                                </div>
                              </div>
                              <Badge className={`border-0 text-xs shrink-0 ${isZeroStock ? "bg-amber-500/20 text-amber-300" : "bg-neutral-500/20 text-neutral-400"}`}>
                                Limits {mat.productCount} product{mat.productCount !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Section B: Lowest Capacity Products */}
                {supplyChainData.lowestCapacityProducts.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Lowest Capacity</p>
                    <div className="space-y-2">
                      {supplyChainData.lowestCapacityProducts.map((prod) => (
                        <Link key={prod.productId} href={`/supply-chain?product=${prod.productId}`}>
                          <div
                            className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-muted/50 rounded-sm px-1 -mx-1 transition-colors"
                            data-testid={`low-capacity-${prod.productId}`}
                          >
                            <div className="min-w-0 flex-1 mr-3">
                              <p className="text-sm font-medium truncate">{prod.productName}</p>
                              <span className="text-[10px] font-mono text-muted-foreground">{prod.productSku}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-mono font-bold tabular-nums">{formatQty(prod.totalPotential)}</p>
                              {prod.bottleneckMaterial && (
                                <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                  Limited by {prod.bottleneckMaterial}
                                </p>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card data-testid="card-recent-transactions">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
              <Link href="/transactions">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-4">No transactions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Material</TableHead>
                    <TableHead className="text-xs">Lot</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentTransactions.map((tx) => {
                    const qty = parseFloat(tx.quantity);
                    // Navigate to transactions tab on click
                    return (
                      <TableRow
                        key={tx.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => window.location.hash = "#/transactions"}
                        data-testid={`row-transaction-${tx.id}`}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(tx.createdAt)}
                        </TableCell>
                        <TableCell>{typeBadge(tx.type)}</TableCell>
                        <TableCell className="text-xs truncate max-w-[120px]">{tx.productName}</TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{tx.lotNumber}</TableCell>
                        <TableCell className={`text-xs text-right font-mono whitespace-nowrap ${qty > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {qty > 0 ? "+" : ""}{formatQty(qty)} {tx.uom}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Equipment row: Calibrations Due + Qualifications Expiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Calibrations Due This Week */}
        <Card data-testid="card-calibrations-due">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Wrench className="h-4 w-4 text-amber-400" />
                Calibrations Due This Week
                {calibrationsDue.length > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs ml-1">
                    {calibrationsDue.length}
                  </Badge>
                )}
              </CardTitle>
              <Link href="/equipment/calibration">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {calibrationsDue.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-4">
                All calibrations current.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {calibrationsDue.map((row) => {
                  const isOverdue = row.daysUntil < 0;
                  const focusHref = row.equipment.assetTag
                    ? `/equipment/calibration?focus=${encodeURIComponent(row.equipment.assetTag)}`
                    : `/equipment/calibration`;
                  return (
                    <Link key={row.equipment.id} href={focusHref}>
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        data-testid={`row-cal-due-${row.equipment.id}`}
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-sm font-medium font-mono truncate">
                            {row.equipment.assetTag}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {row.equipment.name}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {isOverdue ? (
                            <Badge variant="destructive" className="text-xs">
                              Overdue
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                              {Math.max(0, Math.ceil(row.daysUntil))}d
                            </Badge>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDate(row.nextDueAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Qualifications Expiring in 30 Days */}
        <Card data-testid="card-qualifications-expiring">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-amber-400" />
                Qualifications Expiring in 30d
                {qualificationsExpiring.length > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs ml-1">
                    {qualificationsExpiring.length}
                  </Badge>
                )}
              </CardTitle>
              <Link href="/equipment">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {qualificationsExpiring.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-4">
                All qualifications current.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {qualificationsExpiring.map((row, idx) => {
                  const isExpired = row.daysUntil < 0;
                  return (
                    <Link
                      key={`${row.equipment.id}-${row.type}-${idx}`}
                      href={`/equipment/${row.equipment.id}`}
                    >
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        data-testid={`row-qual-expiring-${row.equipment.id}-${row.type}`}
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-sm font-medium font-mono truncate">
                            {row.equipment.assetTag}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {row.equipment.name}{" "}
                            <span className="font-mono text-[10px]">({row.type})</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {isExpired ? (
                            <Badge variant="destructive" className="text-xs">
                              Expired
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                              {Math.max(0, Math.ceil(row.daysUntil))}d
                            </Badge>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDate(row.validUntil)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* R-04 Label cage cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Label artwork pending QA */}
        <Card data-testid="card-artwork-pending-qa">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-400" />
                Label Artwork Pending QA
                {draftArtworks.length > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs ml-1">
                    {draftArtworks.length}
                  </Badge>
                )}
              </CardTitle>
              <Link href="/quality/labeling/artwork">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {draftArtworks.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-4" data-testid="text-artwork-all-approved">
                All artwork approved.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {draftArtworks.slice(0, 5).map((a) => (
                  <Link key={a.id} href="/quality/labeling/artwork">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      data-testid={`row-artwork-pending-${a.id}`}
                    >
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-sm font-medium font-mono truncate">{a.version}</p>
                        <p className="text-xs text-muted-foreground truncate">Product: {a.productId}</p>
                      </div>
                      <Badge className="bg-yellow-500/20 text-yellow-300 border-0 text-xs shrink-0">
                        DRAFT
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reconciliations out-of-tolerance */}
        <Card data-testid="card-recons-out-of-tolerance">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertOctagon className="h-4 w-4 text-amber-400" />
                Reconciliations Out-of-Tolerance
                {outOfToleranceRecons.length > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs ml-1">
                    {outOfToleranceRecons.length}
                  </Badge>
                )}
              </CardTitle>
              <Link href="/production">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {outOfToleranceRecons.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-4" data-testid="text-recons-all-ok">
                All reconciliations within tolerance.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {outOfToleranceRecons.slice(0, 5).map((r) => (
                  <Link key={r.id} href="/production">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      data-testid={`row-recon-oot-${r.id}`}
                    >
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-sm font-medium font-mono truncate">{r.bprId}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Variance: {r.variance} — deviation required
                        </p>
                      </div>
                      <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs shrink-0">
                        OOT
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* R-05 Complaint tiles */}
        {complaintsSummary && (
          <>
            <Link href="/quality/complaints">
              <Card data-testid="card-complaints-triage" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Complaints awaiting triage
                    {complaintsSummary.awaitingTriage > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                        {complaintsSummary.awaitingTriage}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {complaintsSummary.awaitingTriage === 0
                      ? "No complaints awaiting triage."
                      : `${complaintsSummary.awaitingTriage} awaiting triage${complaintsSummary.triageOverdue > 0 ? ` (${complaintsSummary.triageOverdue} overdue)` : ""}.`}
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/quality/complaints">
              <Card data-testid="card-ae-due-soon" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    AE clocks due ≤2 BD
                    {complaintsSummary.aeDueSoon > 0 && (
                      <Badge className="bg-destructive/20 text-destructive border-0 text-xs">
                        {complaintsSummary.aeDueSoon}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {complaintsSummary.aeDueSoon === 0
                      ? "No SAER clocks due soon."
                      : `${complaintsSummary.aeDueSoon} SAER clock${complaintsSummary.aeDueSoon > 1 ? "s" : ""} due within 2 business days.`}
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/quality/complaints">
              <Card data-testid="card-complaints-disposition" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Dispositions awaiting signature
                    {complaintsSummary.awaitingDisposition > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                        {complaintsSummary.awaitingDisposition}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {complaintsSummary.awaitingDisposition === 0
                      ? "No complaints awaiting disposition."
                      : `${complaintsSummary.awaitingDisposition} awaiting disposition${complaintsSummary.dispositionOverdue > 0 ? ` (${complaintsSummary.dispositionOverdue} overdue)` : ""}.`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </>
        )}

        {/* R-06 Return tiles */}
        {returnsSummary && (
          <>
            <Link href="/quality/returns">
              <Card data-testid="card-returns-disposition" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Returns awaiting disposition
                    {returnsSummary.awaitingDisposition > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                        {returnsSummary.awaitingDisposition}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {returnsSummary.awaitingDisposition === 0
                      ? "No returns in quarantine."
                      : `${returnsSummary.awaitingDisposition} return${returnsSummary.awaitingDisposition > 1 ? "s" : ""} awaiting QA disposition.`}
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/quality/return-investigations">
              <Card data-testid="card-returns-investigations" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Open return investigations
                    {returnsSummary.openInvestigations > 0 && (
                      <Badge className="bg-destructive/20 text-destructive border-0 text-xs">
                        {returnsSummary.openInvestigations}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {returnsSummary.openInvestigations === 0
                      ? "No open return investigations."
                      : `${returnsSummary.openInvestigations} lot${returnsSummary.openInvestigations > 1 ? "s" : ""} with open return investigation.`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </>
        )}

      </div>
    </div>
  );
}
