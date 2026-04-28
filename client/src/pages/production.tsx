import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Trash2, Beaker, Play, CheckCircle, Pause, RotateCcw, Pencil, XCircle, AlertTriangle, Info, MessageSquare, Send, ClipboardCheck, Printer } from "lucide-react";
import { LocationSelectWithAdd } from "@/components/LocationSelectWithAdd";
import { Link } from "wouter";
import { BprStartModal } from "./bpr/start-modal";
import { formatQty } from "@/lib/formatQty";
import { DateInput } from "@/components/ui/date-input";
import { formatDateTime } from "@/lib/formatDate";
import type {
  ProductionBatchWithDetails,
  Product,
  Location,
  InventoryGrouped,
  RecipeWithDetails,
} from "@shared/schema";

// Types for FIFO allocation API response
interface FIFOAllocation {
  lotId: string;
  lotNumber: string;
  locationId: string;
  locationName: string;
  quantity: number;
  expirationDate: string | null;
  uom: string;
}

// ── Status badge ──

function statusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary" className="text-xs" data-testid={`badge-status-${status}`}>Draft</Badge>;
    case "IN_PROGRESS":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs" data-testid={`badge-status-${status}`}>In Progress</Badge>;
    case "COMPLETED":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs" data-testid={`badge-status-${status}`}>Completed</Badge>;
    case "ON_HOLD":
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid={`badge-status-${status}`}>On Hold</Badge>;
    case "SCRAPPED":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs" data-testid={`badge-status-${status}`}>Scrapped</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function qcStatusBadge(status: string | null) {
  switch (status) {
    case "PASS":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs" data-testid="badge-qc-pass">Pass</Badge>;
    case "FAIL":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs" data-testid="badge-qc-fail">Fail</Badge>;
    case "ON_HOLD":
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid="badge-qc-hold">QC Hold</Badge>;
    case "PENDING":
    default:
      return <Badge variant="secondary" className="text-xs" data-testid="badge-qc-pending">Pending</Badge>;
  }
}

// ── Batch list item ──

function BatchListItem({
  batch,
  isSelected,
  onClick,
}: {
  batch: ProductionBatchWithDetails;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`item-batch-${batch.id}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" data-testid={`text-batch-number-${batch.id}`}>{batch.batchNumber}</span>
            {statusBadge(batch.status)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-batch-product-${batch.id}`}>
            {batch.productName}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{batch.startDate ?? "No date"}</p>
        </div>
      </div>
    </button>
  );
}

// ── Create/Edit batch form schema ──
//
// NOTE(F-00-e): `_createBatchSchema` is retained as a const with `_` prefix so
// ESLint ignores "unused" — it is not currently passed to `useForm({resolver})`,
// so it's only used to derive the form's value type. A follow-up ticket should
// wire it into useForm via zodResolver to actually validate at submit time.

const _createBatchSchema = z.object({
  batchNumber: z.string().min(1, "Batch number required"),
  productId: z.string().min(1, "Product required"),
  plannedQuantity: z.string().min(1, "Planned quantity required"),
  startDate: z.string().optional(),
  notes: z.string().optional(),
});

type CreateBatchForm = z.infer<typeof _createBatchSchema>;


// ── Create/Edit Batch Sheet ──

function CreateBatchSheet({
  open,
  onOpenChange,
  products,
  inventory: _inventory,
  locations: _locations,
  editBatch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: Product[];
  inventory: InventoryGrouped[];
  locations: Location[];
  editBatch: ProductionBatchWithDetails | null;
}) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const isEditMode = editBatch !== null;

  // FIFO allocations state: maps recipe line index → allocations
  const [allocationsMap, setAllocationsMap] = useState<Map<number, { allocations: FIFOAllocation[]; sufficient: boolean; requested: number }>>(new Map());

  // Override quantities per recipe line (index → custom qty string)
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());

  // Fetch next batch number
  const [nextBatchNumber, setNextBatchNumber] = useState<string>("");
  const [loadingBatchNum, setLoadingBatchNum] = useState(false);

  useEffect(() => {
    if (open && !isEditMode) {
      setLoadingBatchNum(true);
      apiRequest("GET", "/api/production-batches/next-number")
        .then(res => res.json())
        .then(data => {
          setNextBatchNumber(data.batchNumber);
          form.setValue("batchNumber", data.batchNumber);
        })
        .catch(() => {
          setNextBatchNumber("BATCH-001");
          form.setValue("batchNumber", "BATCH-001");
        })
        .finally(() => setLoadingBatchNum(false));
    }
  }, [open, isEditMode]);

  // Filter products to FINISHED_GOOD only for the product dropdown
  const finishedGoods = useMemo(() =>
    products.filter(p => p.category === "FINISHED_GOOD"),
    [products]
  );

  const form = useForm<CreateBatchForm>({
    defaultValues: {
      batchNumber: isEditMode ? editBatch?.batchNumber ?? "" : "",
      productId: isEditMode ? editBatch?.productId ?? "" : "",
      plannedQuantity: isEditMode ? editBatch?.plannedQuantity ?? "" : "",
      startDate: isEditMode ? editBatch?.startDate ?? today : today,
      notes: isEditMode ? editBatch?.notes ?? "" : "",
    },
  });

  // Reset form when sheet opens or editBatch changes
  useEffect(() => {
    if (open) {
      setAllocationsMap(new Map());
      setOverrides(new Map());
      if (isEditMode && editBatch) {
        form.reset({
          batchNumber: editBatch.batchNumber,
          productId: editBatch.productId,
          plannedQuantity: editBatch.plannedQuantity,
          startDate: editBatch.startDate ?? today,
          notes: editBatch.notes ?? "",
        });
      } else {
        form.reset({
          batchNumber: "",
          productId: "",
          plannedQuantity: "",
          startDate: today,
          notes: "",
        });
      }
    }
  }, [open, editBatch?.id]);

  // Fetch FIFO allocation for a recipe line
  const fetchFIFOAllocation = useCallback(async (index: number, productId: string, quantity: string) => {
    if (!productId || !quantity || parseFloat(quantity) <= 0) {
      setAllocationsMap(prev => {
        const next = new Map(prev);
        next.delete(index);
        return next;
      });
      return;
    }

    // Skip FIFO for secondary packaging
    const prod = products.find(p => p.id === productId);
    if (prod?.category === "SECONDARY_PACKAGING") return;

    try {
      const res = await apiRequest("POST", "/api/stock/allocate-fifo", {
        productId,
        quantity,
      });
      const data = await res.json();
      setAllocationsMap(prev => {
        const next = new Map(prev);
        next.set(index, {
          allocations: data.allocations,
          sufficient: data.sufficient,
          requested: data.requested,
        });
        return next;
      });
    } catch {
      // Silently handle
    }
  }, [products]);

  // ── Recipe lookup ──
  const selectedProductId = form.watch("productId");
  const { data: recipesData } = useQuery<RecipeWithDetails[]>({
    queryKey: ["/api/recipes", selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const res = await apiRequest("GET", `/api/recipes?productId=${selectedProductId}`);
      return res.json();
    },
    enabled: !!selectedProductId,
  });
  const recipe = recipesData?.[0]; // First recipe for this product
  const hasRecipe = !!recipe;

  // Compute effective quantities for each recipe line based on planned qty and overrides
  const plannedQuantity = form.watch("plannedQuantity");
  const recipeLines = useMemo(() => {
    if (!recipe) return [];
    const plannedQty = parseFloat(plannedQuantity) || 1;
    return recipe.lines.map((line, idx) => {
      const recipeQty = String(Math.round(parseFloat(line.quantity) * plannedQty * 1000000) / 1000000);
      const overrideQty = overrides.get(idx);
      const effectiveQty = overrideQty !== undefined && overrideQty !== "" ? overrideQty : recipeQty;
      return {
        ...line,
        recipeQty,
        effectiveQty,
        isOverridden: overrideQty !== undefined && overrideQty !== "",
      };
    });
  }, [recipe, plannedQuantity, overrides]);

  // Trigger FIFO allocations when recipe lines or quantities change
  useEffect(() => {
    if (!recipe || recipeLines.length === 0) return;
    recipeLines.forEach((line, idx) => {
      if (line.productId && parseFloat(line.effectiveQty) > 0) {
        fetchFIFOAllocation(idx, line.productId, line.effectiveQty);
      }
    });
  }, [recipeLines.map(l => `${l.productId}:${l.effectiveQty}`).join(",")]);

  // In edit mode, load existing inputs into overrides map if they differ from recipe
  useEffect(() => {
    if (!isEditMode || !editBatch || !recipe) return;
    const plannedQty = parseFloat(editBatch.plannedQuantity) || 1;
    const newOverrides = new Map<number, string>();

    // Group edit batch inputs by productId to sum quantities
    const inputQtyByProduct = new Map<string, number>();
    for (const inp of editBatch.inputs) {
      inputQtyByProduct.set(inp.productId, (inputQtyByProduct.get(inp.productId) ?? 0) + parseFloat(inp.quantityUsed));
    }

    recipe.lines.forEach((line, idx) => {
      const recipeExpected = Math.round(parseFloat(line.quantity) * plannedQty * 1000000) / 1000000;
      const actualQty = inputQtyByProduct.get(line.productId);
      if (actualQty !== undefined && Math.abs(actualQty - recipeExpected) > 0.0001) {
        newOverrides.set(idx, String(actualQty));
      }
    });
    setOverrides(newOverrides);
  }, [isEditMode, editBatch?.id, recipe?.id]);

  const createMutation = useMutation({
    mutationFn: async (data: CreateBatchForm) => {
      if (!recipe) {
        throw new Error("Cannot create batch without a recipe. Please select a product that has a recipe defined.");
      }

      // Build final inputs from recipe lines + FIFO allocations
      const finalInputs: Array<{
        productId: string;
        lotId: string;
        locationId: string;
        quantityUsed: string;
        uom: string;
      }> = [];

      for (let i = 0; i < recipeLines.length; i++) {
        const line = recipeLines[i];
        const prod = products.find(p => p.id === line.productId);
        const isSecondary = prod?.category === "SECONDARY_PACKAGING";

        if (isSecondary) {
          finalInputs.push({
            productId: line.productId,
            lotId: "",
            locationId: "",
            quantityUsed: line.effectiveQty,
            uom: line.uom,
          });
        } else {
          const allocData = allocationsMap.get(i);
          if (!allocData || allocData.allocations.length === 0) {
            throw new Error(`No stock allocation for ${prod?.name ?? "material"}. Stock may not be available.`);
          }
          for (const alloc of allocData.allocations) {
            finalInputs.push({
              productId: line.productId,
              lotId: alloc.lotId,
              locationId: alloc.locationId,
              quantityUsed: String(alloc.quantity),
              uom: line.uom,
            });
          }
        }
      }

      if (finalInputs.length === 0) {
        throw new Error("At least one input material is required");
      }

      const payload = {
        batchNumber: data.batchNumber,
        productId: data.productId,
        plannedQuantity: data.plannedQuantity,
        outputUom: "units",
        startDate: data.startDate || null,
        operatorName: "Eric",
        notes: data.notes || null,
        inputs: finalInputs,
      };

      if (isEditMode && editBatch) {
        const res = await apiRequest("PATCH", `/api/production-batches/${editBatch.id}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/production-batches", payload);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      form.reset();
      setAllocationsMap(new Map());
      setOverrides(new Map());
      onOpenChange(false);
      toast({ title: isEditMode ? "Batch updated" : "Batch record created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function onSubmit(data: CreateBatchForm) {
    if (!hasRecipe) {
      toast({
        title: "No Recipe Found",
        description: "Cannot create a batch without a recipe. Please define a recipe for this product first.",
        variant: "destructive",
      });
      return;
    }
    // Pre-submit validation: check all non-secondary lines have sufficient stock
    for (let i = 0; i < recipeLines.length; i++) {
      const line = recipeLines[i];
      const prod = products.find(p => p.id === line.productId);
      if (prod?.category === "SECONDARY_PACKAGING") continue;
      const allocData = allocationsMap.get(i);
      if (allocData && !allocData.sufficient) {
        toast({
          title: "Insufficient Stock",
          description: `${prod?.name ?? "Material"} does not have enough stock. Available: ${formatQty(allocData.allocations.reduce((s, a) => s + a.quantity, 0))} ${line.uom}, Needed: ${line.effectiveQty} ${line.uom}`,
          variant: "destructive",
        });
        return;
      }
    }
    createMutation.mutate(data);
  }

  // Stock status helper for a recipe line
  function stockStatus(index: number): { label: string; color: string } {
    const allocData = allocationsMap.get(index);
    if (!allocData) return { label: "—", color: "text-muted-foreground" };
    if (allocData.sufficient) return { label: "OK", color: "text-emerald-600 dark:text-emerald-400" };
    const total = allocData.allocations.reduce((s, a) => s + a.quantity, 0);
    return { label: `Low (${formatQty(total)})`, color: "text-red-600 dark:text-red-400" };
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-create-batch">
        <SheetHeader>
          <SheetTitle>{isEditMode ? "Edit Batch Record" : "Create Batch Record"}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            {/* Auto-generated Batch Number — read-only display */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Batch Number</Label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50" data-testid="display-batch-number">
                {loadingBatchNum ? (
                  <Skeleton className="h-4 w-24" />
                ) : (
                  <span className="font-mono font-medium text-foreground text-sm">
                    {form.watch("batchNumber") || nextBatchNumber || "—"}
                  </span>
                )}
              </div>
            </div>

            {/* Product (finished good) */}
            <FormField
              control={form.control}
              name="productId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product (Finished Good)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-product">
                        <SelectValue placeholder="Select product..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {finishedGoods.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No finished goods found. Add a product with category "Finished Good" first.
                        </div>
                      ) : (
                        finishedGoods.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* No recipe warning */}
            {selectedProductId && !hasRecipe && recipesData !== undefined && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2" data-testid="warning-no-recipe">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>No recipe found for this product. </span>
                <a
                  href={`#/inventory?product=${selectedProductId}&openRecipe=true`}
                  className="underline text-primary cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenChange(false);
                    window.location.hash = `#/inventory?product=${selectedProductId}&openRecipe=true`;
                  }}
                >
                  Create one in Inventory →
                </a>
              </div>
            )}

            {/* Planned qty + fixed Output UOM */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="plannedQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planned Output Qty</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="any" placeholder="0" data-testid="input-planned-qty" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">Output UOM</Label>
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50" data-testid="display-output-uom">
                  <span className="text-sm font-medium">units</span>
                </div>
              </div>
            </div>

            {/* Start Date */}
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date</FormLabel>
                  <FormControl>
                    <DateInput {...field} data-testid="input-start-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Operator — fixed to "Eric" */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Operator</Label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/50" data-testid="display-operator">
                <span className="text-sm font-medium">Eric</span>
              </div>
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes..." rows={2} data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Recipe Materials Table */}
            {hasRecipe && recipeLines.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">Recipe: {recipe!.name}</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">Materials are auto-populated from the recipe. Quantities scale with planned output. Click a qty to override it. FIFO lot assignment is automatic.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-xs">#</TableHead>
                        <TableHead className="text-xs">Material</TableHead>
                        <TableHead className="text-xs">SKU</TableHead>
                        <TableHead className="text-xs text-right">Qty Needed</TableHead>
                        <TableHead className="text-xs">UOM</TableHead>
                        <TableHead className="text-xs">LOT# (FIFO)</TableHead>
                        <TableHead className="text-xs text-center">Stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipeLines.map((line, idx) => {
                        const allocData = allocationsMap.get(idx);
                        const lotDisplay = allocData && allocData.allocations.length > 0
                          ? allocData.allocations.map(a => a.lotNumber).join(", ")
                          : "—";
                        const status = stockStatus(idx);
                        const isSecondary = products.find(p => p.id === line.productId)?.category === "SECONDARY_PACKAGING";

                        return (
                          <TableRow key={line.id || idx} data-testid={`row-recipe-line-${idx}`}>
                            <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="text-xs font-medium">{line.productName}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{line.productSku}</TableCell>
                            <TableCell className="text-right">
                              {line.isOverridden ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    step="any"
                                    value={overrides.get(idx) ?? ""}
                                    onChange={e => {
                                      setOverrides(prev => {
                                        const next = new Map(prev);
                                        if (e.target.value === "") {
                                          next.delete(idx);
                                        } else {
                                          next.set(idx, e.target.value);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="h-6 w-20 text-xs text-right"
                                    data-testid={`input-override-qty-${idx}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => {
                                      setOverrides(prev => {
                                        const next = new Map(prev);
                                        next.delete(idx);
                                        return next;
                                      });
                                    }}
                                    data-testid={`button-clear-override-${idx}`}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="text-xs hover:underline cursor-pointer tabular-nums"
                                  onClick={() => {
                                    setOverrides(prev => {
                                      const next = new Map(prev);
                                      next.set(idx, line.recipeQty);
                                      return next;
                                    });
                                  }}
                                  data-testid={`button-edit-qty-${idx}`}
                                >
                                  {formatQty(parseFloat(line.recipeQty))}
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{line.uom}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {isSecondary ? (
                                <span className="text-muted-foreground italic">N/A</span>
                              ) : (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help">{lotDisplay}</span>
                                    </TooltipTrigger>
                                    {allocData && allocData.allocations.length > 0 && (
                                      <TooltipContent side="bottom" className="max-w-sm">
                                        <div className="text-xs space-y-1">
                                          {allocData.allocations.map((a, ai) => (
                                            <div key={ai} className="flex justify-between gap-4">
                                              <span>{a.lotNumber} @ {a.locationName}</span>
                                              <span className="font-mono">{formatQty(a.quantity)} {line.uom}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {isSecondary ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span className={`text-xs font-medium ${status.color}`} data-testid={`text-stock-status-${idx}`}>
                                  {status.label}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={createMutation.isPending || (!!selectedProductId && !hasRecipe)}
              data-testid="button-submit-batch"
            >
              {createMutation.isPending
                ? (isEditMode ? "Saving..." : "Creating...")
                : (isEditMode ? "Save Changes" : "Create Batch Record")}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

// ── Batch Notes ──

interface ProductionNote {
  id: string;
  batchId: string;
  content: string;
  author: string | null;
  createdAt: string;
}

function BatchNotes({ batchId }: { batchId: string }) {
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");
  const { toast } = useToast();

  const { data: notes = [], isLoading } = useQuery<ProductionNote[]>({
    queryKey: ["/api/production-batches", batchId, "notes"],
    enabled: !!batchId,
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/production-batches/${batchId}/notes`, {
        content,
        author: author || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches", batchId, "notes"] });
      setContent("");
      toast({ title: "Note added" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  function formatTimestamp(dateStr: string) {
    return formatDateTime(dateStr);
  }

  return (
    <div data-testid="section-batch-notes">
      <Separator className="my-4" />
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Notes
      </h3>

      {/* Notes list */}
      <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic" data-testid="text-no-notes">No notes yet</p>
        ) : (
          notes.map(note => (
            <div key={note.id} className="border rounded-md p-3 text-sm" data-testid={`note-${note.id}`}>
              <p className="whitespace-pre-wrap" data-testid="note-content">{note.content}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                <span data-testid="note-author">{note.author || "—"}</span>
                <span>·</span>
                <span data-testid="note-timestamp">{formatTimestamp(note.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add note form */}
      <div className="space-y-2">
        <Textarea
          placeholder="Add a note..."
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={2}
          data-testid="input-note-content"
        />
        <div className="flex items-center gap-2">
          <Input
            placeholder="Author (optional)"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            className="flex-1"
            data-testid="input-note-author"
          />
          <Button
            size="sm"
            onClick={() => addNoteMutation.mutate()}
            disabled={!content.trim() || addNoteMutation.isPending}
            data-testid="button-add-note"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {addNoteMutation.isPending ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Complete Batch Dialog ──

function CompleteBatchDialog({
  open,
  onOpenChange,
  batch,
  locations,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  batch: ProductionBatchWithDetails | null;
  locations: Location[];
}) {
  const { toast } = useToast();

  const [actualQuantity, setActualQuantity] = useState("");
  const [outputLotNumber, setOutputLotNumber] = useState("");
  const [outputExpirationDate, setOutputExpirationDate] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposition, setDisposition] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  const [pendingDisposition, setPendingDisposition] = useState<string | null>(null);
  const [showDispositionConfirm, setShowDispositionConfirm] = useState(false);

  // Fetch next auto-generated lot number when dialog opens
  const { data: nextLotData } = useQuery<{ lotNumber: string }>({
    queryKey: ["/api/production-batches/next-lot-number"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/production-batches/next-lot-number");
      return res.json();
    },
    enabled: open,
  });

  // Pre-fill with planned qty and next lot number when batch changes
  useMemo(() => {
    if (batch) {
      setActualQuantity(batch.plannedQuantity ?? "");
      setOutputLotNumber(nextLotData?.lotNumber ?? "");
      setOutputExpirationDate("");
      setOutputLocationId("");
      setEndDate(new Date().toISOString().slice(0, 10));
      setDisposition("");
      setQcNotes("");
    }
  }, [batch?.id, nextLotData?.lotNumber]);

  // Yield % calculation
  const yieldPct = useMemo(() => {
    const actual = parseFloat(actualQuantity);
    const planned = parseFloat(batch?.plannedQuantity ?? "0");
    if (!actual || !planned || planned === 0) return 0;
    return (actual / planned) * 100;
  }, [actualQuantity, batch?.plannedQuantity]);

  const yieldColor = yieldPct === 0 ? "" :
    (yieldPct >= 95 && yieldPct <= 105) ? "text-emerald-600 dark:text-emerald-400" :
    (yieldPct >= 85 && yieldPct <= 115) ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400";

  const isRejectedOrReprocess = disposition === "REJECTED" || disposition === "REPROCESS";

  useEffect(() => {
    if (isRejectedOrReprocess) {
      setActualQuantity("0");
    }
  }, [disposition]);

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!batch) throw new Error("No batch");
      const qcStatus = disposition === "APPROVED_FOR_DISTRIBUTION" ? "PASS" : disposition === "REJECTED" ? "FAIL" : "ON_HOLD";
      try {
        const res = await apiRequest("POST", `/api/production-batches/${batch.id}/complete`, {
          actualQuantity,
          outputLotNumber,
          outputExpirationDate: outputExpirationDate || null,
          locationId: outputLocationId,
          qcStatus,
          qcNotes: qcNotes || null,
          endDate: endDate || undefined,
          qcDisposition: disposition,
          yieldPercentage: yieldPct > 0 ? String(Math.round(yieldPct * 100) / 100) : null,
        });
        return res.json();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const jsonStart = errMsg.indexOf("{");
        if (jsonStart >= 0) {
          try {
            const parsed = JSON.parse(errMsg.slice(jsonStart));
            throw new Error(parsed.message || errMsg, { cause: err });
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== errMsg) throw parseErr;
          }
        }
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches/next-lot-number"] });
      onOpenChange(false);
      toast({ title: "Batch completed successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Insufficient Stock", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = !!actualQuantity && !!outputLotNumber && !!outputLocationId && !!disposition;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="dialog-complete-batch">
        <SheetHeader>
          <SheetTitle>Complete Batch {batch?.batchNumber}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Section 1: Actual Output */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actual Output</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="actual-qty">Actual Output Quantity</Label>
                <Input
                  id="actual-qty"
                  type="number"
                  step="any"
                  value={actualQuantity}
                  onChange={e => {
                    if (!isRejectedOrReprocess) {
                      setActualQuantity(e.target.value);
                    }
                  }}
                  readOnly={isRejectedOrReprocess}
                  className={cn(isRejectedOrReprocess && "opacity-50 cursor-not-allowed")}
                  data-testid="input-actual-qty"
                />
                {isRejectedOrReprocess && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {disposition === "REJECTED"
                      ? "Rejected batches produce no output \u2014 quantity set to 0."
                      : "Reprocess batches produce no output until the batch is re-run."}
                  </p>
                )}
              </div>
              <div>
                <Label>Yield %</Label>
                <p className={`mt-2 text-sm font-semibold ${yieldColor}`}>
                  {yieldPct > 0 ? `${formatQty(Math.round(yieldPct * 100) / 100)}%` : "—"}
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="output-lot">Output Lot Number</Label>
              <Input
                id="output-lot"
                value={outputLotNumber}
                onChange={e => setOutputLotNumber(e.target.value)}
                placeholder="e.g., FG-001"
                data-testid="input-output-lot"
              />
            </div>
            <div>
              <Label htmlFor="output-exp">Output Expiration Date</Label>
              <DateInput
                id="output-exp"
                value={outputExpirationDate}
                onChange={setOutputExpirationDate}
                data-testid="input-output-expiration"
              />
            </div>
            <div>
              <Label htmlFor="output-location">Output Location</Label>
              <LocationSelectWithAdd
                locations={locations}
                value={outputLocationId}
                onValueChange={setOutputLocationId}
                data-testid="select-output-location"
              />
            </div>
            <div>
              <Label htmlFor="end-date">Completion Date</Label>
              <DateInput
                id="end-date"
                value={endDate}
                onChange={setEndDate}
                data-testid="input-end-date"
              />
            </div>
          </div>

          <Separator />

          {/* Section 2: QC Review */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">QC Review</h3>
            <div>
              <Label htmlFor="disposition">Disposition</Label>
              <Select
                onValueChange={(val) => {
                  if (val === "REJECTED" || val === "REPROCESS") {
                    setPendingDisposition(val);
                    setShowDispositionConfirm(true);
                  } else {
                    setDisposition(val);
                  }
                }}
                value={disposition}
              >
                <SelectTrigger data-testid="select-disposition">
                  <SelectValue placeholder="Select disposition..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED_FOR_DISTRIBUTION">Approved for Distribution</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="REPROCESS">Reprocess</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="qc-notes">QC Notes (optional)</Label>
              <Textarea
                id="qc-notes"
                value={qcNotes}
                onChange={e => setQcNotes(e.target.value)}
                rows={2}
                placeholder="Optional review notes"
                data-testid="input-qc-notes"
              />
            </div>
          </div>
        </div>

        <SheetFooter className="flex gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-complete">Cancel</Button>
          <Button
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending || !canSubmit}
            data-testid="button-confirm-complete"
          >
            {completeMutation.isPending ? "Completing..." : "Complete Batch"}
          </Button>
        </SheetFooter>
      </SheetContent>

      <AlertDialog open={showDispositionConfirm} onOpenChange={setShowDispositionConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDisposition === "REJECTED" ? "Reject this batch?" : "Mark for reprocessing?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisposition === "REJECTED"
                ? "Rejecting this batch will record zero output and flag the batch as failed. This action is final."
                : "Marking for reprocessing will record zero output. The batch will need to be re-run. Are you sure?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingDisposition(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={pendingDisposition === "REJECTED" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}
              onClick={() => {
                setDisposition(pendingDisposition!);
                setPendingDisposition(null);
                setShowDispositionConfirm(false);
              }}
            >
              {pendingDisposition === "REJECTED" ? "Yes, Reject" : "Yes, Reprocess"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ── Confirm Dialog (for delete/scrap) ──

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
  variant = "destructive",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  variant?: "destructive" | "default";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-confirm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-confirm">Cancel</Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isPending}
            data-testid="button-confirm-action"
          >
            {isPending ? "Processing..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── BPR Link ──
//
// NOTE(F-00-e): BprLink is fully-formed BPR-viewing logic that will be
// referenced from BatchDetail in a future ticket. Deleting would mean
// re-authoring the /api/batch-production-records/by-batch query + the View
// Batch Record button styling. The eslint-disable below preserves the code
// without having to rename it (React components must start with an uppercase
// letter for the rules-of-hooks check to recognise useQuery's caller).

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BprLink({ batchId, batchStatus }: { batchId: string; batchStatus: string }) {
  const showBpr = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "SCRAPPED"].includes(batchStatus);

  const { data: bprData, isLoading: bprLoading } = useQuery<{ id: string } | null>({
    queryKey: ["/api/batch-production-records/by-batch", batchId],
    enabled: showBpr,
  });

  if (!showBpr) return null;

  if (bprLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="opacity-50">
        <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
        Loading BPR...
      </Button>
    );
  }

  if (!bprData || !bprData.id) return null;

  return (
    <Link href={`/bpr/${bprData.id}`}>
      <Button variant="outline" size="sm" data-testid="button-view-bpr">
        <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
        View Batch Record
      </Button>
    </Link>
  );
}

// ── Detail Panel ──

function BatchDetail({
  batch,
  onStartProduction,
  onCompleteBatch,
  onPutOnHold,
  onResume,
  onEdit,
  onDelete,
  onScrap,
  isUpdating,
}: {
  batch: ProductionBatchWithDetails;
  onStartProduction: () => void;
  onCompleteBatch: () => void;
  onPutOnHold: () => void;
  onResume: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onScrap: () => void;
  isUpdating: boolean;
}) {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" data-testid="text-detail-batch-number">{batch.batchNumber}</h2>
            {statusBadge(batch.status)}
          </div>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-detail-product">
            <span
              className="cursor-pointer hover:underline text-primary"
              onClick={() => { window.location.hash = `#/inventory?product=${batch.productId}`; }}
            >
              {batch.productName}
            </span>{" "}
            ({batch.productSku})
          </p>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">Planned Quantity</span>
          <p className="font-medium" data-testid="text-detail-planned-qty">{formatQty(batch.plannedQuantity)} {batch.outputUom}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Actual Quantity</span>
          <p className="font-medium" data-testid="text-detail-actual-qty">
            {batch.actualQuantity ? `${formatQty(batch.actualQuantity)} ${batch.outputUom}` : "—"}
          </p>
        </div>
        {batch.yieldPercentage && (
          <div>
            <span className="text-muted-foreground">Yield</span>
            <p className={`font-medium ${
              parseFloat(batch.yieldPercentage) >= 95 && parseFloat(batch.yieldPercentage) <= 105
                ? "text-emerald-600 dark:text-emerald-400"
                : parseFloat(batch.yieldPercentage) >= 85 && parseFloat(batch.yieldPercentage) <= 115
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400"
            }`}>{formatQty(batch.yieldPercentage)}%</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Start Date</span>
          <p className="font-medium">{batch.startDate ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">End Date</span>
          <p className="font-medium">{batch.endDate ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Operator</span>
          <p className="font-medium">{batch.operatorName ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">QC Status</span>
          {batch.qcDisposition ? (
            <div className="mt-0.5">
              <Badge variant="outline" className={
                batch.qcDisposition === "APPROVED_FOR_DISTRIBUTION"
                  ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                  : batch.qcDisposition === "REJECTED"
                  ? "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                  : "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              }>
                {batch.qcDisposition === "APPROVED_FOR_DISTRIBUTION" ? "Approved for Distribution"
                  : batch.qcDisposition === "REJECTED" ? "Rejected" : "Reprocess"}
              </Badge>
              {batch.qcReviewedBy && (
                <p className="text-xs text-muted-foreground mt-1">Reviewed by: {batch.qcReviewedBy}</p>
              )}
            </div>
          ) : (
            <div className="mt-0.5">{qcStatusBadge(batch.qcStatus)}</div>
          )}
        </div>
        {batch.qcNotes && (
          <div className="col-span-2">
            <span className="text-muted-foreground">QC Notes</span>
            <p className="font-medium">{batch.qcNotes}</p>
          </div>
        )}
        {batch.notes && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Notes</span>
            <p className="font-medium">{batch.notes}</p>
          </div>
        )}
        {batch.outputLotNumber && (
          <>
            <div>
              <span className="text-muted-foreground">Output Lot #</span>
              <p className="font-medium" data-testid="text-detail-output-lot">{batch.outputLotNumber}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Output Expiration</span>
              <p className="font-medium">{batch.outputExpirationDate ?? "—"}</p>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {batch.status === "DRAFT" && (
          <>
            <Button
              onClick={onEdit}
              disabled={isUpdating}
              variant="outline"
              size="sm"
              data-testid="button-edit-batch"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            <Button
              onClick={onStartProduction}
              disabled={isUpdating}
              size="sm"
              data-testid="button-start-production"
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Start Production
            </Button>
            <Button
              onClick={onDelete}
              disabled={isUpdating}
              variant="destructive"
              size="sm"
              data-testid="button-delete-batch"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </>
        )}
        {batch.status === "IN_PROGRESS" && (
          <>
            <Button
              onClick={onCompleteBatch}
              disabled={isUpdating}
              size="sm"
              data-testid="button-complete-batch"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Complete Batch
            </Button>
            <Button
              onClick={onPutOnHold}
              disabled={isUpdating}
              variant="outline"
              size="sm"
              data-testid="button-put-on-hold"
            >
              <Pause className="h-3.5 w-3.5 mr-1.5" />
              Put On Hold
            </Button>
            <Button
              onClick={onScrap}
              disabled={isUpdating}
              variant="destructive"
              size="sm"
              data-testid="button-scrap-batch"
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Scrap
            </Button>
          </>
        )}
        {batch.status === "ON_HOLD" && (
          <>
            <Button
              onClick={onResume}
              disabled={isUpdating}
              size="sm"
              data-testid="button-resume"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Resume
            </Button>
            <Button
              onClick={onScrap}
              disabled={isUpdating}
              variant="destructive"
              size="sm"
              data-testid="button-scrap-batch"
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Scrap
            </Button>
          </>
        )}
        {batch.status === "COMPLETED" && (
          <Button
            onClick={onDelete}
            disabled={isUpdating}
            variant="destructive"
            size="sm"
            data-testid="button-delete-completed-batch"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Batch
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => { window.location.hash = `#/production/print/${batch.id}`; }}
          data-testid="button-print-batch"
        >
          <Printer className="h-3.5 w-3.5 mr-1.5" />
          Print
        </Button>
      </div>

      {/* Input materials table */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Input Materials</h3>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>LOT #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Qty Used</TableHead>
                <TableHead>UOM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.inputs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No input materials
                  </TableCell>
                </TableRow>
              ) : (
                batch.inputs.map(input => (
                  <TableRow key={input.id} data-testid={`row-input-${input.id}`}>
                    <TableCell className="text-sm">
                      <span
                        className="cursor-pointer hover:underline text-primary"
                        onClick={(e) => { e.stopPropagation(); window.location.hash = `#/inventory?material=${input.productId}`; }}
                      >
                        {input.productName}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{input.lotNumber}</TableCell>
                    <TableCell className="text-sm">{input.locationName}</TableCell>
                    <TableCell className="text-right text-sm">{formatQty(input.quantityUsed)}</TableCell>
                    <TableCell className="text-sm">{input.uom}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Notes section */}
      <BatchNotes batchId={batch.id} />
    </div>
  );
}

// ── Main Production Page ──

export default function Production() {
  // Read batch ID from URL params (hash routing: /#/production?batch=xxx)
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const urlBatchId = searchParams.get("batch");

  const [selectedId, setSelectedId] = useState<string | null>(urlBatchId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [editBatch, setEditBatch] = useState<ProductionBatchWithDetails | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scrapDialogOpen, setScrapDialogOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);

  const { toast } = useToast();

  const { data: batches, isLoading } = useQuery<ProductionBatchWithDetails[]>({
    queryKey: ["/api/production-batches"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: inventory } = useQuery<InventoryGrouped[]>({
    queryKey: ["/api/inventory"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const selectedBatch = useMemo(() => {
    if (!selectedId || !batches) return null;
    return batches.find(b => b.id === selectedId) ?? null;
  }, [selectedId, batches]);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/production-batches/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/production-batches/${id}`);
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete batch");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setSelectedId(null);
      setDeleteDialogOpen(false);
      toast({ title: "Batch deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleStartProduction() {
    if (!selectedBatch) return;
    // R-03 Task 15: opening the modal lets the operator confirm the equipment
    // list (pre-filled from product defaults) before the gate checks run.
    // Resume from ON_HOLD intentionally still goes through the direct PATCH
    // below — gates already passed at the original IN_PROGRESS transition.
    setStartModalOpen(true);
  }

  function handlePutOnHold() {
    if (!selectedBatch) return;
    updateMutation.mutate({ id: selectedBatch.id, data: { status: "ON_HOLD" } });
    toast({ title: "Batch put on hold" });
  }

  function handleResume() {
    if (!selectedBatch) return;
    updateMutation.mutate({ id: selectedBatch.id, data: { status: "IN_PROGRESS" } });
    toast({ title: "Production resumed" });
  }

  function handleEdit() {
    if (!selectedBatch) return;
    setEditBatch(selectedBatch);
    setSheetOpen(true);
  }

  function handleDelete() {
    setDeleteDialogOpen(true);
  }

  function handleScrap() {
    setScrapDialogOpen(true);
  }

  function confirmDelete() {
    if (!selectedBatch) return;
    deleteMutation.mutate(selectedBatch.id);
  }

  function confirmScrap() {
    if (!selectedBatch) return;
    updateMutation.mutate(
      { id: selectedBatch.id, data: { status: "SCRAPPED" } },
      {
        onSuccess: () => {
          setScrapDialogOpen(false);
          toast({ title: "Batch scrapped" });
        },
      }
    );
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      setEditBatch(null);
    }
  }

  // Delete dialog description changes based on batch status
  const deleteDescription = selectedBatch?.status === "COMPLETED"
    ? `Are you sure you want to delete completed batch ${selectedBatch?.batchNumber}? This will reverse all transaction logs (consumption and output) created when the batch was completed. Inventory levels will be restored to their pre-completion state.`
    : `Are you sure you want to delete batch ${selectedBatch?.batchNumber}? This action cannot be undone.`;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full">
        <div className="w-96 border-r">
          <div className="p-4 border-b">
            <Skeleton className="h-8 w-full" />
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="p-4 border-b">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full" data-testid="page-production">
        {/* Left panel: batch list */}
        <div className="w-96 shrink-0 border-r border-border flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Beaker className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold" data-testid="text-page-title">Production</h1>
              {batches && (
                <Badge variant="secondary" className="text-xs">{batches.length}</Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditBatch(null);
                setSheetOpen(true);
              }}
              data-testid="button-new-batch"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New Batch
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {batches && batches.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No batch records yet. Create your first batch.
              </div>
            ) : (
              batches?.map(b => (
                <BatchListItem
                  key={b.id}
                  batch={b}
                  isSelected={selectedId === b.id}
                  onClick={() => setSelectedId(b.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel: detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedBatch ? (
            <BatchDetail
              batch={selectedBatch}
              onStartProduction={handleStartProduction}
              onCompleteBatch={() => setCompleteDialogOpen(true)}
              onPutOnHold={handlePutOnHold}
              onResume={handleResume}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onScrap={handleScrap}
              isUpdating={updateMutation.isPending}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a batch record to view details
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit batch sheet */}
      <CreateBatchSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        products={products ?? []}
        inventory={inventory ?? []}
        locations={locations ?? []}
        editBatch={editBatch}
      />

      {/* Complete batch dialog */}
      <CompleteBatchDialog
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        batch={selectedBatch}
        locations={locations ?? []}
      />

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={selectedBatch?.status === "COMPLETED" ? "Delete Completed Batch" : "Delete Batch"}
        description={deleteDescription}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        isPending={deleteMutation.isPending}
        variant="destructive"
      />

      {/* Scrap confirm dialog */}
      <ConfirmDialog
        open={scrapDialogOpen}
        onOpenChange={setScrapDialogOpen}
        title="Scrap Batch"
        description={`Are you sure you want to scrap batch ${selectedBatch?.batchNumber}? This will mark it as scrapped and it cannot be resumed.`}
        confirmLabel="Scrap"
        onConfirm={confirmScrap}
        isPending={updateMutation.isPending}
        variant="destructive"
      />

      {/* BPR Start modal (R-03 Task 15) */}
      {selectedBatch && (
        <BprStartModal
          open={startModalOpen}
          onOpenChange={setStartModalOpen}
          batchId={selectedBatch.id}
          productId={selectedBatch.productId}
          batchNumber={selectedBatch.batchNumber}
          onStarted={() => {
            // Cache invalidation already handled in the modal's mutation;
            // nothing extra needed here yet.
          }}
        />
      )}
    </>
  );
}
