import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Pencil, Trash2, Package, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";
import type { Product } from "@shared/schema";

const CATEGORY_LABELS: Record<string, string> = {
  ACTIVE_INGREDIENT: "Active Ingredient",
  SUPPORTING_INGREDIENT: "Supporting Ingredient",
  PRIMARY_PACKAGING: "Primary Packaging",
  SECONDARY_PACKAGING: "Secondary Packaging",
  FINISHED_GOOD: "Finished Good",
};

const ALL_CATEGORIES = [
  "ACTIVE_INGREDIENT",
  "SUPPORTING_INGREDIENT",
  "PRIMARY_PACKAGING",
  "SECONDARY_PACKAGING",
  "FINISHED_GOOD",
];

const UOM_OPTIONS = ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"];

const isMaterial = (category: string) => category !== "FINISHED_GOOD";

type SortKey = "name" | "sku" | "category" | "createdAt";
type FilterType = "all" | "materials" | "finished";

export default function SkuManager() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  // Edit dialog state
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ name: "", sku: "", category: "", defaultUom: "", status: "" });

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", sku: "", category: "ACTIVE_INGREDIENT", defaultUom: "g" });

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...products];

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (CATEGORY_LABELS[p.category] ?? p.category).toLowerCase().includes(q)
      );
    }

    // Filter
    if (filter === "materials") {
      list = list.filter(p => isMaterial(p.category));
    } else if (filter === "finished") {
      list = list.filter(p => !isMaterial(p.category));
    }

    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case "sku":
          return a.sku.localeCompare(b.sku);
        case "category":
          return a.category.localeCompare(b.category);
        case "createdAt": {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db - da;
        }
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return list;
  }, [products, search, filter, sortBy]);

  // ─── Edit mutation ──────────────────────────────────────

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      return apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Product updated", description: `${editForm.name} has been updated.` });
      setEditProduct(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleEditOpen = (p: Product) => {
    setEditProduct(p);
    setEditForm({
      name: p.name,
      sku: p.sku,
      category: p.category,
      defaultUom: p.defaultUom,
      status: p.status,
    });
  };

  const handleEditSave = () => {
    if (!editProduct) return;
    editMutation.mutate({ id: editProduct.id, data: editForm });
  };

  // ─── Create mutation ────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      return apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "SKU created", description: `${createForm.name} has been created.` });
      setCreateOpen(false);
      setCreateForm({ name: "", sku: "", category: "ACTIVE_INGREDIENT", defaultUom: "g" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!createForm.name || !createForm.sku) {
      toast({ title: "Validation error", description: "Name and SKU are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(createForm);
  };

  // ─── Delete mutation ────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Product deleted", description: `${deleteTarget?.name} has been deleted.` });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">SKU Manager</h1>
          <Badge variant="secondary" className="text-xs font-normal" data-testid="badge-count">
            {products.length} SKUs
          </Badge>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-new-sku" data-tour="sku-new-button">
          <Plus className="h-4 w-4 mr-1" />
          New SKU
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0 bg-muted/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, or category..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[160px] h-9" data-testid="select-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="materials">Materials Only</SelectItem>
            <SelectItem value="finished">Finished Goods</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
          <SelectTrigger className="w-[150px] h-9" data-testid="select-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="sku">Sort: SKU</SelectItem>
            <SelectItem value="category">Sort: Category</SelectItem>
            <SelectItem value="createdAt">Sort: Date Created</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" data-tour="sku-list">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">UOM</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                    <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    {search || filter !== "all" ? "No SKUs match your filters." : "No SKUs found. Create one to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(p => (
                  <TableRow key={p.id} data-testid={`row-sku-${p.id}`}>
                    <TableCell className="font-mono text-sm" data-testid={`cell-sku-${p.id}`}>
                      {p.sku}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{p.name}</TableCell>
                    <TableCell>
                      {isMaterial(p.category) ? (
                        <Badge variant="outline" className="text-[11px] font-normal border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
                          Material
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[11px] font-normal border-green-300 text-green-700 dark:border-green-700 dark:text-green-400">
                          Finished Good
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {CATEGORY_LABELS[p.category] ?? p.category}
                    </TableCell>
                    <TableCell className="text-sm">{p.defaultUom}</TableCell>
                    <TableCell>
                      {p.status === "ACTIVE" ? (
                        <Badge variant="outline" className="text-[11px] font-normal border-green-300 text-green-700 dark:border-green-700 dark:text-green-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleEditOpen(p)}
                          data-testid={`button-edit-sku-${p.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(p)}
                          data-testid={`button-delete-sku-${p.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ─── Edit Dialog ──────────────────────────────────── */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit SKU</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">SKU</Label>
              <Input
                value={editForm.sku}
                onChange={e => setEditForm(prev => ({ ...prev, sku: e.target.value }))}
                className="font-mono"
                data-testid="input-edit-sku"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Category</Label>
              <Select value={editForm.category} onValueChange={v => setEditForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger className="h-9" data-testid="select-edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Default UOM</Label>
              <Select value={editForm.defaultUom} onValueChange={v => setEditForm(prev => ({ ...prev, defaultUom: v }))}>
                <SelectTrigger className="h-9" data-testid="select-edit-uom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Status</Label>
              <Select value={editForm.status} onValueChange={v => setEditForm(prev => ({ ...prev, status: v }))}>
                <SelectTrigger className="h-9" data-testid="select-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="DISCONTINUED">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)} data-testid="button-edit-cancel">
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editMutation.isPending} data-testid="button-edit-save">
              {editMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Create Dialog ────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New SKU</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input
                value={createForm.name}
                onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. GHK-Cu Powder"
                data-testid="input-create-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">SKU</Label>
              <Input
                value={createForm.sku}
                onChange={e => setCreateForm(prev => ({ ...prev, sku: e.target.value }))}
                placeholder="e.g. RA-GHKCU"
                className="font-mono"
                data-testid="input-create-sku"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Category</Label>
              <Select value={createForm.category} onValueChange={v => setCreateForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger className="h-9" data-testid="select-create-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Default UOM</Label>
              <Select value={createForm.defaultUom} onValueChange={v => setCreateForm(prev => ({ ...prev, defaultUom: v }))}>
                <SelectTrigger className="h-9" data-testid="select-create-uom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-create-cancel">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-save">
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ──────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SKU?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.sku})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 px-1 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>This SKU may have associated inventory data. Deleting it may cause issues with lots, transactions, or recipes.</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
