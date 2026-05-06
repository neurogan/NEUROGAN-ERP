import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Download,
  AlertTriangle,
  Package,
  Plus,
  Pencil,
  Trash2,
  X,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { formatQty } from "@/lib/formatQty";
import { formatDate } from "@/lib/formatDate";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { LocationSelectWithAdd } from "@/components/LocationSelectWithAdd";
import type {
  InventoryGrouped,
  Product,
  ProductWithCategories,
  ProductCategory,
  Location,
  Lot,
} from "@shared/schema";

// ─── Helpers ───────────────────────────────────────────────

function exportCSV(data: InventoryGrouped[]) {
  const rows: string[] = [
    "Material,SKU,Category,Lot Number,Supplier,Status,Available Qty,Quarantine Qty,UOM,Location,Expiration Date",
  ];
  for (const product of data) {
    for (const lot of product.lots) {
      for (const loc of lot.locations) {
        rows.push(
          [
            `"${product.productName}"`,
            product.sku,
            product.category,
            lot.lotNumber,
            lot.supplierName ?? "",
            lot.quarantineStatus,
            lot.availableQuantity,
            lot.quarantineQuantity,
            loc.uom,
            `"${loc.locationName}"`,
            lot.expirationDate ?? "",
          ].join(",")
        );
      }
    }
  }
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const MATERIAL_CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "ACTIVE_INGREDIENT", label: "Active Ingredient" },
  { value: "SUPPORTING_INGREDIENT", label: "Supporting Ingredient" },
  { value: "PRIMARY_PACKAGING", label: "Primary Packaging" },
  { value: "SECONDARY_PACKAGING", label: "Secondary Packaging" },
];

function formatCategory(cat: string) {
  switch (cat) {
    case "ACTIVE_INGREDIENT":
      return "Active Ingredient";
    case "SUPPORTING_INGREDIENT":
      return "Supporting Ingredient";
    case "PRIMARY_PACKAGING":
      return "Primary Packaging";
    case "SECONDARY_PACKAGING":
      return "Secondary Packaging";
    case "FINISHED_GOOD":
      return "Finished Good";
    default:
      return cat;
  }
}

// ─── Shared Lot Table ──────────────────────────────────────

function LotTable({ lots, highlightLotId }: { lots: InventoryGrouped["lots"]; highlightLotId?: string | null }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Lot #</TableHead>
              <TableHead className="text-xs">Supplier</TableHead>
              <TableHead className="text-xs text-right">Available</TableHead>
              <TableHead className="text-xs text-right">Quarantine</TableHead>
              <TableHead className="text-xs">Location</TableHead>
              <TableHead className="text-xs">Expiration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground py-6"
                >
                  No lots on hand.
                </TableCell>
              </TableRow>
            ) : (
              lots.map((lot) => (
                <TableRow
                  key={lot.lotId}
                  data-testid={`row-lot-${lot.lotId}`}
                  className={highlightLotId === lot.lotId ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}
                >
                  <TableCell className="text-sm font-mono whitespace-nowrap font-medium">
                    {lot.lotNumber}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lot.supplierName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {lot.availableQuantity > 0 ? formatQty(lot.availableQuantity) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {lot.quarantineQuantity > 0 ? formatQty(lot.quarantineQuantity) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {lot.locations.map((l) => (
                      <div
                        key={l.locationId}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>{l.locationName}</span>
                        {lot.locations.length > 1 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatQty(l.quantity)} {l.uom}
                          </span>
                        )}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(lot.expirationDate)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
//  MATERIALS SUB-TAB
// ═══════════════════════════════════════════════════════════

function MaterialListItem({
  item,
  isSelected,
  onClick,
}: {
  item: InventoryGrouped;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isLowStock =
    item.lowStockThreshold !== null &&
    item.totalQuantity <= item.lowStockThreshold;

  return (
    <button
      onClick={onClick}
      data-testid={`item-material-${item.productId}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">
              {item.productName}
            </span>
            {isLowStock && (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {item.sku}
          </span>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
              isLowStock ? "text-amber-600 dark:text-amber-400" : ""
            }`}
          >
            {formatQty(item.totalQuantity)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {item.defaultUom}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Edit Material Dialog ─────────────────────────────────

function EditMaterialDialog({
  open,
  onOpenChange,
  productId,
  initialName,
  initialSku,
  initialCategory,
  initialUom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  initialName: string;
  initialSku: string;
  initialCategory: string;
  initialUom: string;
}) {
  const [name, setName] = useState(initialName);
  const [sku, setSku] = useState(initialSku);
  const [category, setCategory] = useState(initialCategory);
  const [uom, setUom] = useState(initialUom);
  const { toast } = useToast();

  // Sync when dialog reopens with different product
  const [prevId, setPrevId] = useState(productId);
  if (productId !== prevId) {
    setPrevId(productId);
    setName(initialName);
    setSku(initialSku);
    setCategory(initialCategory);
    setUom(initialUom);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/products/${productId}`, {
        name,
        sku,
        category,
        defaultUom: uom,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Material updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-edit-material">
        <DialogHeader>
          <DialogTitle>Edit Material</DialogTitle>
          <DialogDescription>Update material details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-material-name">Name</Label>
            <Input
              id="edit-material-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-material-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-material-sku">SKU</Label>
            <Input
              id="edit-material-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              data-testid="input-edit-material-sku"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-edit-material-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE_INGREDIENT">Active Ingredient</SelectItem>
                <SelectItem value="SUPPORTING_INGREDIENT">Supporting Ingredient</SelectItem>
                <SelectItem value="PRIMARY_PACKAGING">Primary Packaging</SelectItem>
                <SelectItem value="SECONDARY_PACKAGING">Secondary Packaging</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default UOM</Label>
            <Select value={uom} onValueChange={setUom}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-edit-material-uom">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"].map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit-material">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !sku.trim() || mutation.isPending}
            data-testid="button-submit-edit-material"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Material Confirmation ─────────────────────────

function DeleteMaterialDialog({
  open,
  onOpenChange,
  productId,
  productName,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/products/${productId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Material deleted" });
      onOpenChange(false);
      onDeleted();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-delete-material">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Material</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{productName}</strong>? This will also remove all associated lots and transactions. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-material">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete-material"
          >
            {mutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Material Detail Panel ────────────────────────────────

function MaterialDetailPanel({
  item,
  onDeleted,
  highlightLotId,
}: {
  item: InventoryGrouped;
  onDeleted: () => void;
  highlightLotId?: string | null;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const isLowStock =
    item.lowStockThreshold !== null &&
    item.totalQuantity <= item.lowStockThreshold;

  return (
    <div className="space-y-4" data-testid="detail-panel-material">
      <EditMaterialDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        productId={item.productId}
        initialName={item.productName}
        initialSku={item.sku}
        initialCategory={item.category}
        initialUom={item.defaultUom}
      />
      <DeleteMaterialDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        productId={item.productId}
        productName={item.productName}
        onDeleted={onDeleted}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{item.productName}</h2>
            <button
              onClick={() => setShowEdit(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-edit-material"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className="text-muted-foreground hover:text-destructive transition-colors"
              data-testid="button-delete-material"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => {
              window.location.hash = `#/suppliers?tab=purchase-orders&openCreate=true&material=${item.productId}`;
            }}
            data-testid="button-create-po"
          >
            <ShoppingCart className="h-4 w-4 mr-1" />
            Create PO
          </Button>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-mono text-muted-foreground">
              {item.sku}
            </span>
            <Badge variant="outline" className="text-xs">
              {formatCategory(item.category)}
            </Badge>
          </div>
        </div>
        <div className="text-right space-y-0.5">
          <div
            className={`text-2xl font-bold tabular-nums ${
              isLowStock ? "text-amber-400" : ""
            }`}
          >
            {formatQty(item.totalQuantity)}
          </div>
          <div className="text-sm text-muted-foreground">{item.defaultUom} total</div>
          {item.totalQuarantineQuantity > 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400 tabular-nums">
              {formatQty(item.totalAvailableQuantity)} avail · {formatQty(item.totalQuarantineQuantity)} quar.
            </div>
          )}
        </div>
      </div>

      {isLowStock && (
        <div className="flex items-center gap-2 rounded-md bg-amber-900/20 border border-amber-800 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">
            Below threshold of {formatQty(item.lowStockThreshold ?? 0)}{" "}
            {item.defaultUom}
          </span>
        </div>
      )}

      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Lots ({item.lots.length})
        </h3>
        {item.lots.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No stock on hand</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Receive items via a Purchase Order to add stock.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LotTable lots={item.lots} highlightLotId={highlightLotId} />
        )}
      </div>
    </div>
  );
}

function MaterialsTab({ initialSelectedId, initialHighlightLotId }: { initialSelectedId?: string | null; initialHighlightLotId?: string | null }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showCreateMaterial, setShowCreateMaterial] = useState(false);

  const { data: inventoryData = [], isLoading: invLoading } = useQuery<InventoryGrouped[]>({
    queryKey: ["/api/inventory"],
  });

  const { data: allProducts = [], isLoading: prodLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const isLoading = invLoading || prodLoading;

  // Merge: all non-FINISHED_GOOD products, enriched with inventory data if available
  const data = useMemo(() => {
    const materialCategories = ["ACTIVE_INGREDIENT", "SUPPORTING_INGREDIENT", "PRIMARY_PACKAGING", "SECONDARY_PACKAGING"];
    const allMaterials = allProducts.filter(p => materialCategories.includes(p.category));
    const invMap = new Map(inventoryData.map(i => [i.productId, i]));

    return allMaterials.map(product => {
      if (invMap.has(product.id)) {
        return invMap.get(product.id)!;
      }
      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        category: product.category,
        defaultUom: product.defaultUom,
        totalQuantity: 0,
        totalAvailableQuantity: 0,
        totalQuarantineQuantity: 0,
        lowStockThreshold: product.lowStockThreshold ? parseFloat(product.lowStockThreshold) : null,
        lots: [],
      } as InventoryGrouped;
    }).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [inventoryData, allProducts]);

  useEffect(() => {
    if (initialSelectedId && data.length > 0) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-testid="item-material-${initialSelectedId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [initialSelectedId, data]);

  useEffect(() => {
    if (initialHighlightLotId && data.length > 0) {
      const ownerProduct = data.find(p => p.lots.some(l => l.lotId === initialHighlightLotId));
      if (ownerProduct) {
        setSelectedId(ownerProduct.productId);
        const timer = setTimeout(() => {
          const el = document.querySelector(`[data-testid="row-lot-${initialHighlightLotId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 400);
        return () => clearTimeout(timer);
      }
    }
  }, [initialHighlightLotId, data]);

  const filtered = useMemo(() => {
    let result = data;
    if (categoryFilter && categoryFilter !== "all") {
      result = result.filter((item) => item.category === categoryFilter);
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
    if (!selectedId) return null;
    return data.find((item) => item.productId === selectedId) ?? null;
  }, [selectedId, data]);

  return (
    <div className="flex flex-1 min-h-0">
      <CreateMaterialDialog open={showCreateMaterial} onOpenChange={setShowCreateMaterial} />
      {/* Left panel */}
      <div className="w-80 xl:w-96 border-r flex flex-col shrink-0">
        <div className="p-3 border-b shrink-0 space-y-2">
          <Button
            className="w-full"
            onClick={() => setShowCreateMaterial(true)}
            data-testid="button-new-material"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Material
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search materials..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              data-testid="input-search-materials"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger
              className="h-9 text-sm"
              data-testid="filter-material-category"
            >
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              {MATERIAL_CATEGORIES.map((cat) => (
                <SelectItem
                  key={cat.value}
                  value={cat.value}
                  data-testid={`filter-material-category-option-${cat.value}`}
                >
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {filtered.length} material{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" data-tour="inventory-materials-list">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {search || categoryFilter !== "all" ? "No matching materials." : "No materials found."}
            </div>
          ) : (
            filtered.map((item) => (
              <MaterialListItem
                key={item.productId}
                item={item}
                isSelected={selectedId === item.productId}
                onClick={() => setSelectedId(item.productId)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-auto" data-tour="inventory-lot-quantities">
        {selectedItem ? (
          <div className="p-6">
            <MaterialDetailPanel item={selectedItem} onDeleted={() => setSelectedId(null)} highlightLotId={initialHighlightLotId} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 px-8">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium mb-1">Select a material</h3>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              Click on a material from the list to view lot details, locations,
              and stock levels.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Material Dialog ──────────────────────────────

const NEW_MATERIAL_CATEGORIES = [
  { value: "ACTIVE_INGREDIENT", label: "Active Ingredient" },
  { value: "SUPPORTING_INGREDIENT", label: "Supporting Ingredient" },
  { value: "PRIMARY_PACKAGING", label: "Primary Packaging" },
  { value: "SECONDARY_PACKAGING", label: "Secondary Packaging" },
];

const UOMS_MATERIAL = ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"];

function CreateMaterialDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (productId: string) => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("ACTIVE_INGREDIENT");
  const [uom, setUom] = useState("g");
  const [lotNumber, setLotNumber] = useState("");
  const [addStock, setAddStock] = useState(false);
  const [stockQty, setStockQty] = useState("");
  const [stockLocationId, setStockLocationId] = useState("");
  const { toast } = useToast();

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const lotRequired = ["ACTIVE_INGREDIENT", "SUPPORTING_INGREDIENT", "PRIMARY_PACKAGING"].includes(category);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/products", {
        name,
        sku,
        category,
        defaultUom: uom,
        status: "ACTIVE",
      });
      const product = await res.json();
      // Create lot if lotNumber is provided
      let lot: Lot | null = null;
      if (lotNumber.trim()) {
        const lotRes = await apiRequest("POST", "/api/lots", {
          productId: product.id,
          lotNumber: lotNumber.trim(),
        });
        lot = await lotRes.json();
      }
      // Create stock adjustment if requested
      if (addStock && stockQty && parseFloat(stockQty) > 0 && stockLocationId && lot) {
        await apiRequest("POST", "/api/transactions", {
          lotId: lot.id,
          locationId: stockLocationId,
          type: "ADJUSTMENT",
          quantity: stockQty,
          uom,
          notes: "Initial stock on material creation",
        });
      }
      return product;
    },
    onSuccess: (product) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Material created" });
      setName("");
      setSku("");
      setCategory("ACTIVE_INGREDIENT");
      setUom("g");
      setLotNumber("");
      setAddStock(false);
      setStockQty("");
      setStockLocationId("");
      onCreated?.(product.id);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const stockValid = !addStock || (stockQty && parseFloat(stockQty) > 0 && stockLocationId && lotNumber.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-material">
        <DialogHeader>
          <DialogTitle>New Material</DialogTitle>
          <DialogDescription>Add a new raw material or packaging item.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="material-name">Name</Label>
            <Input
              id="material-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Material name"
              data-testid="input-material-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-sku">SKU</Label>
            <Input
              id="material-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. RA-XXXXX"
              data-testid="input-material-sku"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-material-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NEW_MATERIAL_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-number" className="text-sm">
              Lot Number {lotRequired || addStock ? <span className="text-red-500">*</span> : "(optional)"}
            </Label>
            <Input
              id="lot-number"
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder="e.g., 20250101"
              data-testid="input-material-lot"
            />
          </div>
          <div className="space-y-2">
            <Label>Default UOM</Label>
            <Select value={uom} onValueChange={setUom}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-material-uom">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UOMS_MATERIAL.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Add existing stock section */}
          <div className="border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-stock"
                checked={addStock}
                onCheckedChange={(c) => setAddStock(c === true)}
                data-testid="checkbox-add-stock"
              />
              <Label htmlFor="add-stock" className="text-sm cursor-pointer font-medium">
                Add existing stock
              </Label>
            </div>
            {addStock && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label className="text-sm">Quantity</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    placeholder={`Amount in ${uom}`}
                    data-testid="input-stock-qty"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Location</Label>
                  <LocationSelectWithAdd
                    locations={locations}
                    value={stockLocationId}
                    onValueChange={setStockLocationId}
                    data-testid="select-stock-location"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-create-material"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !sku.trim() || (lotRequired && !lotNumber.trim()) || !stockValid || mutation.isPending}
            data-testid="button-submit-create-material"
          >
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════
//  PRODUCTS SUB-TAB
// ═══════════════════════════════════════════════════════════

// ─── Product CRUD Dialogs ──────────────────────────────────

function CreateProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/products", {
        name,
        sku,
        category: "FINISHED_GOOD",
        defaultUom: "pcs",
        status: "ACTIVE",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products-with-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Product created" });
      setName("");
      setSku("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-product">
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
          <DialogDescription>Create a new finished goods product.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="product-name">Name</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product name"
              data-testid="input-product-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. US-0001"
              data-testid="input-product-sku"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-create-product"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !sku.trim() || mutation.isPending}
            data-testid="button-submit-create-product"
          >
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductWithCategories;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/products/${product.id}`, {
        name,
        sku,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products-with-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Product updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-edit-product">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription>Update product details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-product-name">Name</Label>
            <Input
              id="edit-product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-product-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-product-sku">SKU</Label>
            <Input
              id="edit-product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              data-testid="input-edit-product-sku"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-edit-product"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !sku.trim() || mutation.isPending}
            data-testid="button-submit-edit-product"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProductDialog({
  open,
  onOpenChange,
  product,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductWithCategories;
  onDeleted: () => void;
}) {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/products/${product.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products-with-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Product deleted" });
      onDeleted();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-delete-product">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Product</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{product.name}"? This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-product">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete-product"
          >
            {mutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Category Management ───────────────────────────────────

function CategoryManager({
  product,
}: {
  product: ProductWithCategories;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();

  const { data: allCategories } = useQuery<ProductCategory[]>({
    queryKey: ["/api/product-categories"],
  });

  const assignedIds = new Set(product.categories.map((c) => c.id));

  const availableCategories = useMemo(
    () => (allCategories ?? []).filter((c) => !assignedIds.has(c.id)),
    [allCategories, assignedIds]
  );

  const filteredCategories = useMemo(() => {
    if (!searchValue.trim()) return availableCategories;
    const q = searchValue.toLowerCase();
    return availableCategories.filter((c) =>
      c.name.toLowerCase().includes(q)
    );
  }, [availableCategories, searchValue]);

  const showCreateOption =
    searchValue.trim() &&
    !(allCategories ?? []).some(
      (c) => c.name.toLowerCase() === searchValue.trim().toLowerCase()
    );

  const assignMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      await apiRequest("POST", "/api/product-category-assignments", {
        productId: product.id,
        categoryId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-categories"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/products-with-categories"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/product-category-assignments"],
      });
      setPopoverOpen(false);
      setSearchValue("");
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      await apiRequest("DELETE", "/api/product-category-assignments", {
        productId: product.id,
        categoryId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-categories"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/products-with-categories"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/product-category-assignments"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const createAndAssignMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/product-categories", { name });
      const newCat: ProductCategory = await res.json();
      await apiRequest("POST", "/api/product-category-assignments", {
        productId: product.id,
        categoryId: newCat.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-categories"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/products-with-categories"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/product-category-assignments"],
      });
      setPopoverOpen(false);
      setSearchValue("");
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {product.categories.map((cat) => (
        <Badge
          key={cat.id}
          variant="secondary"
          className="text-xs gap-1 pr-1"
          data-testid={`badge-category-${cat.id}`}
        >
          {cat.name}
          <button
            onClick={() => unassignMutation.mutate(cat.id)}
            className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
            data-testid={`button-remove-category-${cat.id}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-6 w-6 p-0 rounded-full"
            data-testid="button-add-category"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-56" align="start">
          <Command>
            <CommandInput
              placeholder="Search categories..."
              value={searchValue}
              onValueChange={setSearchValue}
              data-testid="input-search-categories"
            />
            <CommandList>
              <CommandEmpty>
                {showCreateOption ? null : "No categories found."}
              </CommandEmpty>
              <CommandGroup>
                {filteredCategories.map((cat) => (
                  <CommandItem
                    key={cat.id}
                    value={cat.name}
                    onSelect={() => assignMutation.mutate(cat.id)}
                    data-testid={`option-category-${cat.id}`}
                  >
                    {cat.name}
                  </CommandItem>
                ))}
                {showCreateOption && (
                  <CommandItem
                    value={`create-${searchValue}`}
                    onSelect={() =>
                      createAndAssignMutation.mutate(searchValue.trim())
                    }
                    data-testid="option-create-category"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Create "{searchValue.trim()}"
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Product Detail Panel ──────────────────────────────────

function ProductDetailPanel({
  product,
  onDeleted,
}: {
  product: ProductWithCategories;
  onDeleted: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Fetch finished goods lots for this product
  const { data: inventoryData } = useQuery<InventoryGrouped[]>({
    queryKey: ["/api/inventory"],
  });

  const productInventory = useMemo(() => {
    if (!inventoryData) return null;
    return inventoryData.find(
      (item) =>
        item.productId === product.id && item.category === "FINISHED_GOOD"
    );
  }, [inventoryData, product.id]);

  return (
    <div className="space-y-6" data-testid="detail-panel-product">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setEditOpen(true)}
              data-testid="button-edit-product"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              data-testid="button-delete-product"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-mono text-muted-foreground">
              {product.sku}
            </span>
          </div>
          <div className="mt-2">
            <CategoryManager product={product} />
          </div>
        </div>
      </div>

      {/* MMR Section */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Master Manufacturing Record
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            window.location.hash = `#/manufacturing/mmr?productId=${product.id}`;
          }}
          data-testid="button-view-mmr"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          View / Create MMR
        </Button>
      </div>

      {/* Finished Goods Lots */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Finished Goods Lots
          {productInventory && ` (${productInventory.lots.length})`}
        </h3>
        {productInventory ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xl font-bold tabular-nums">
                {formatQty(productInventory.totalQuantity)}
              </div>
              <div className="text-sm text-muted-foreground">
                {productInventory.defaultUom} total
              </div>
            </div>
            <LotTable lots={productInventory.lots} />
          </>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No finished goods lots on hand.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialogs */}
      {editOpen && (
        <EditProductDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          product={product}
        />
      )}
      {deleteOpen && (
        <DeleteProductDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          product={product}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

// ─── Product List Item ─────────────────────────────────────

function ProductListItem({
  product,
  isSelected,
  onClick,
}: {
  product: ProductWithCategories;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`item-product-${product.id}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{product.name}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {product.sku}
        </div>
        {product.categories.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {product.categories.map((cat) => (
              <span
                key={cat.id}
                className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {cat.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Products Tab ──────────────────────────────────────────

function ProductsTab({ initialSelectedId }: { initialSelectedId?: string | null }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: productsWithCats, isLoading } = useQuery<
    ProductWithCategories[]
  >({
    queryKey: ["/api/products-with-categories"],
  });

  const { data: allProductCategories } = useQuery<ProductCategory[]>({
    queryKey: ["/api/product-categories"],
  });

  useEffect(() => {
    if (initialSelectedId && productsWithCats) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-testid="item-product-${initialSelectedId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [initialSelectedId, productsWithCats]);

  // Filter to finished goods only
  const finishedGoods = useMemo(
    () =>
      (productsWithCats ?? []).filter((p) => p.category === "FINISHED_GOOD"),
    [productsWithCats]
  );

  const filtered = useMemo(() => {
    let result = finishedGoods;
    if (categoryFilter && categoryFilter !== "all") {
      result = result.filter((p) =>
        p.categories.some((c) => c.id === categoryFilter)
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      );
    }
    return result;
  }, [finishedGoods, search, categoryFilter]);

  const selectedProduct = useMemo(() => {
    if (!selectedId || !finishedGoods) return null;
    return finishedGoods.find((p) => p.id === selectedId) ?? null;
  }, [selectedId, finishedGoods]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <div className="w-80 xl:w-96 border-r flex flex-col shrink-0">
        <div className="p-3 border-b shrink-0 space-y-2">
          <Button
            size="sm"
            className="w-full"
            onClick={() => setCreateOpen(true)}
            data-testid="button-new-product"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Product
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              data-testid="input-search-products"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger
              className="h-9 text-sm"
              data-testid="filter-product-category"
            >
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(allProductCategories ?? []).map((cat) => (
                <SelectItem
                  key={cat.id}
                  value={cat.id}
                  data-testid={`filter-product-category-option-${cat.id}`}
                >
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
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {search ? "No matching products." : "No products yet."}
            </div>
          ) : (
            filtered.map((p) => (
              <ProductListItem
                key={p.id}
                product={p}
                isSelected={selectedId === p.id}
                onClick={() => setSelectedId(p.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-auto">
        {selectedProduct ? (
          <div className="p-6">
            <ProductDetailPanel
              key={selectedProduct.id}
              product={selectedProduct}
              onDeleted={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 px-8">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ShoppingBag className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium mb-1">Select a product</h3>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              Click on a product from the list to view recipes, categories, and
              finished goods lots.
            </p>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <CreateProductDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN INVENTORY PAGE
// ═══════════════════════════════════════════════════════════

export default function Inventory() {
  // Read URL params for pre-selection (hash routing: /#/inventory?material=xxx or ?product=xxx or ?lot=xxx)
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const urlMaterial = searchParams.get("material");
  const urlProduct = searchParams.get("product");
  const urlLot = searchParams.get("lot");

  const [activeTab, setActiveTab] = useState<"materials" | "products">(
    urlProduct ? "products" : "materials"
  );

  const { data: inventoryData } = useQuery<InventoryGrouped[]>({
    queryKey: ["/api/inventory"],
  });

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">
          Inventory
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inventoryData && exportCSV(inventoryData)}
          disabled={!inventoryData}
          data-testid="button-export-csv"
          data-tour="inventory-export"
        >
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Browser-style tabs */}
      <div className="px-6 pt-2 shrink-0 bg-muted/30 border-b" data-tour="inventory-tabs">
        <div className="flex gap-0 -mb-px">
          <button
            onClick={() => setActiveTab("materials")}
            data-testid="tab-materials"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "materials"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Materials
          </button>
          <button
            onClick={() => setActiveTab("products")}
            data-testid="tab-products"
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
              activeTab === "products"
                ? "bg-background text-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
            }`}
          >
            Products
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "materials" ? <MaterialsTab initialSelectedId={urlMaterial} initialHighlightLotId={urlLot} /> : <ProductsTab initialSelectedId={urlProduct} />}
    </div>
  );
}
