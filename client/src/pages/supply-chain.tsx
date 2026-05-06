import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Search, Package, AlertTriangle, FlaskConical, TrendingUp, Truck, Beaker, ArrowRight, Zap } from "lucide-react";
import { formatQty } from "@/lib/formatQty";
import { Link } from "wouter";
import type { ProductCapacity, ProductCategory } from "@shared/schema";

// ── Category badge color palette ────────────────────────

const CATEGORY_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300" },
  { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function CategoryBadge({ name }: { name: string }) {
  const idx = hashString(name) % CATEGORY_COLORS.length;
  const color = CATEGORY_COLORS[idx];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${color.bg} ${color.text}`}>
      {name}
    </span>
  );
}

// ── Left panel list item ────────────────────────────────

function ProductListItem({
  item,
  isSelected,
  onClick,
}: {
  item: ProductCapacity;
  isSelected: boolean;
  onClick: () => void;
}) {
  const hasNoMmr = !item.hasMmr;

  return (
    <button
      onClick={onClick}
      data-testid={`item-product-${item.productId}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{item.productName}</span>
            {hasNoMmr && <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          </div>
          <span className="text-xs text-muted-foreground font-mono">{item.sku}</span>
          {item.categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.categories.map((cat) => (
                <CategoryBadge key={cat.id} name={cat.name} />
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums whitespace-nowrap">
            {formatQty(item.totalPotential)} <span className="text-xs font-normal text-muted-foreground">pcs</span>
          </div>
          <span className="text-[10px] text-muted-foreground">total potential</span>
          {item.inProductionUnits > 0 && (
            <div className="flex items-center justify-end gap-1 mt-0.5" data-testid={`production-indicator-${item.productId}`}>
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-primary font-medium tabular-nums">
                {formatQty(item.inProductionUnits)} in production
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Right panel detail view ─────────────────────────────

function DetailPanel({ item }: { item: ProductCapacity }) {
  return (
    <div className="space-y-5" data-testid="detail-panel">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{item.productName}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-mono text-muted-foreground">{item.sku}</span>
          </div>
          {item.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {item.categories.map((cat) => (
                <CategoryBadge key={cat.id} name={cat.name} />
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-default" data-testid="total-potential-display">
                  <div className="text-2xl font-bold tabular-nums text-primary">
                    {formatQty(item.totalPotential)}
                  </div>
                  <div className="text-sm text-muted-foreground">pcs total potential</div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                <p className="font-medium mb-1">Total Potential Breakdown</p>
                <div className="space-y-0.5 tabular-nums">
                  <div className="flex justify-between gap-4"><span>FG Stock</span><span>{formatQty(item.currentFGStock)}</span></div>
                  <div className="flex justify-between gap-4"><span>Producible</span><span>{formatQty(item.producibleUnits)}</span></div>
                  <div className="flex justify-between gap-4"><span>Inbound</span><span>{formatQty(item.inboundProducibleUnits)}</span></div>
                  <div className="flex justify-between gap-4"><span>In Production</span><span>{formatQty(item.inProductionUnits)}</span></div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Capacity Summary Cards */}
      <div className="grid grid-cols-4 gap-3" data-testid="summary-cards">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">FG Stock</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{formatQty(item.currentFGStock)}</div>
            <div className="text-[10px] text-muted-foreground">units on hand</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Producible</span>
            </div>
            <div className={`text-xl font-bold tabular-nums ${item.hasMmr && item.producibleUnits === 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {formatQty(item.producibleUnits)}
            </div>
            <div className="text-[10px] text-muted-foreground">from uncommitted stock</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inbound</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{formatQty(item.inboundProducibleUnits)}</div>
            <div className="text-[10px] text-muted-foreground">from pending POs</div>
          </CardContent>
        </Card>
        <Card className={item.activeBatchCount > 0 ? "border-primary/30" : ""} data-testid="card-in-production">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Beaker className={`h-3.5 w-3.5 ${item.activeBatchCount > 0 ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">In Production</span>
            </div>
            <div className={`text-xl font-bold tabular-nums ${item.activeBatchCount > 0 ? "text-primary" : ""}`}>
              {formatQty(item.inProductionUnits)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {item.activeBatchCount > 0
                ? `from ${item.activeBatchCount} active batch${item.activeBatchCount !== 1 ? "es" : ""}`
                : "no active batches"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottleneck alert */}
      {item.hasMmr && item.bottleneckMaterial && item.producibleUnits === 0 && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Production bottleneck: <strong
              className="cursor-pointer hover:underline text-primary"
              onClick={(e) => {
                e.stopPropagation();
                const mat = item.materials.find(m => m.productName === item.bottleneckMaterial);
                if (mat) window.location.hash = `#/inventory?material=${mat.productId}`;
              }}
            >{item.bottleneckMaterial}</strong> — no stock available
          </span>
        </div>
      )}
      {item.hasMmr && item.bottleneckMaterial && item.producibleUnits > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 border border-border px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">
            Limiting material: <strong
              className="cursor-pointer hover:underline text-primary"
              onClick={(e) => {
                e.stopPropagation();
                const mat = item.materials.find(m => m.productName === item.bottleneckMaterial);
                if (mat) window.location.hash = `#/inventory?material=${mat.productId}`;
              }}
            >{item.bottleneckMaterial}</strong> — constrains production to {formatQty(item.producibleUnits)} units
          </span>
        </div>
      )}

      {/* Materials breakdown table */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {item.hasMmr ? `Formula Breakdown (${item.materials.length} materials)` : "Formula"}
        </h3>
        {!item.hasMmr ? (
          <Card>
            <CardContent className="py-8 text-center">
              <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No MMR defined</p>
              <p className="text-xs text-muted-foreground mt-1">Create an approved MMR in Manufacturing → Master Manufacturing Records to see capacity breakdown</p>
            </CardContent>
          </Card>
        ) : item.materials.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">MMR has no formula components</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Material</TableHead>
                    <TableHead className="text-xs text-right">Req/Unit</TableHead>
                    <TableHead className="text-xs text-right">In Stock</TableHead>
                    <TableHead className="text-xs text-right">Supports</TableHead>
                    <TableHead className="text-xs text-right">Inbound (PO)</TableHead>
                    <TableHead className="text-xs text-right">Inbound Supports</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.materials.map((mat) => (
                    <TableRow
                      key={mat.productId}
                      className={mat.isBottleneck ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}
                      data-testid={`row-material-${mat.productId}`}
                    >
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium">
                              <span
                                className="cursor-pointer hover:underline text-primary"
                                onClick={(e) => { e.stopPropagation(); window.location.hash = `#/inventory?material=${mat.productId}`; }}
                              >
                                {mat.productName}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">{mat.sku}</div>
                          </div>
                          {mat.isBottleneck && (
                            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400">
                              bottleneck
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {formatQty(mat.requiredPerUnit)} <span className="text-xs text-muted-foreground">{mat.uom}</span>
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums font-medium">
                        {formatQty(mat.inStock)} <span className="text-xs text-muted-foreground">{mat.uom}</span>
                      </TableCell>
                      <TableCell className={`text-sm text-right tabular-nums font-semibold ${mat.isBottleneck ? "text-amber-600 dark:text-amber-400" : ""}`}>
                        {formatQty(mat.supportsUnits)} <span className="text-xs font-normal text-muted-foreground">pcs</span>
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {formatQty(mat.inboundFromPOs)} <span className="text-xs text-muted-foreground">{mat.uom}</span>
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {formatQty(mat.inboundSupportsUnits)} <span className="text-xs text-muted-foreground">pcs</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Active Batches section */}
      {item.activeBatchCount > 0 && (
        <div data-testid="section-active-batches">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Active Production</h3>
          <Card className="border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-2">
                    <Beaker className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {item.activeBatchCount} active batch{item.activeBatchCount !== 1 ? "es" : ""} producing {formatQty(item.inProductionUnits)} units
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      These units are currently being manufactured and will add to finished goods stock upon completion.
                    </p>
                  </div>
                </div>
                <Link href="/production">
                  <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1 shrink-0 ml-4" data-testid="link-view-production">
                    View in Production <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function EmptyDetailState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16 px-8">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Package className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium mb-1">Select a product</h3>
      <p className="text-xs text-muted-foreground max-w-[200px]">
        Click on a product from the list to view capacity breakdown, stock levels, and bottleneck analysis.
      </p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────

export default function SupplyChain() {
  const [search, setSearch] = useState("");

  // Read product ID from URL params (hash-based routing: /#/supply-chain?product=xxx)
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const preselectedProductId = searchParams.get("product");

  const [selectedId, setSelectedId] = useState<string | null>(preselectedProductId);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Watch for URL changes (e.g. navigating from dashboard while already on supply chain)
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const pid = params.get("product");
    if (pid) setSelectedId(pid);
  }, []);

  const { data, isLoading } = useQuery<ProductCapacity[]>({
    queryKey: ["/api/supply-chain/capacity"],
  });

  const { data: categories } = useQuery<ProductCategory[]>({
    queryKey: ["/api/product-categories"],
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let result = data;
    if (categoryFilter && categoryFilter !== "all") {
      result = result.filter(item =>
        item.categories.some(cat => cat.id === categoryFilter)
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.productName.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q)
      );
    }
    return result;
  }, [data, search, categoryFilter]);

  const selectedItem = useMemo(() => {
    if (!selectedId || !data) return null;
    return data.find((item) => item.productId === selectedId) ?? null;
  }, [selectedId, data]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Supply Chain</h1>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — product list */}
        <div className="w-80 xl:w-96 border-r flex flex-col shrink-0">
          <div className="p-3 border-b shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
                data-testid="input-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 text-sm" data-testid="filter-category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories?.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {filtered.length} product{filtered.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {search ? "No matching products." : "No finished goods products."}
              </div>
            ) : (
              filtered.map((item) => (
                <ProductListItem
                  key={item.productId}
                  item={item}
                  isSelected={selectedId === item.productId}
                  onClick={() => setSelectedId(item.productId)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel — detail view */}
        <div className="flex-1 min-w-0 overflow-auto">
          {selectedItem ? (
            <div className="p-6">
              <DetailPanel item={selectedItem} />
            </div>
          ) : (
            <EmptyDetailState />
          )}
        </div>
      </div>
    </div>
  );
}
