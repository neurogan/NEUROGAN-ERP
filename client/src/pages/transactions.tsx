import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { Product, Lot, Location } from "@shared/schema";
import { formatQty } from "@/lib/formatQty";
import { DateInput } from "@/components/ui/date-input";
import { formatDate } from "@/lib/formatDate";

interface TransactionWithDetails {
  id: string;
  lotId: string;
  locationId: string;
  type: string;
  quantity: string;
  uom: string;
  productionBatchId: string | null;
  batchNumber: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  productName: string;
  lotNumber: string;
  locationName: string;
}

const TX_TYPES = [
  { value: "PO_RECEIPT", label: "PO Receipt" },
  { value: "PRODUCTION_CONSUMPTION", label: "Production Consumption" },
  { value: "COUNT_ADJUSTMENT", label: "Count Adjustment" },
  { value: "PRODUCTION_OUTPUT", label: "Production Output" },
];

function typeBadge(type: string) {
  switch (type) {
    case "PO_RECEIPT":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">PO Receipt</Badge>;
    case "PRODUCTION_CONSUMPTION":
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">Production</Badge>;
    case "PRODUCTION_OUTPUT":
      return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0 text-xs">Production Output</Badge>;
    case "COUNT_ADJUSTMENT":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs">Adjustment</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{type}</Badge>;
  }
}

// ── Production / Adjustment: pick existing lot from dropdown ──
const productionSchema = z.object({
  productId: z.string().min(1, "Material is required"),
  lotId: z.string().min(1, "Lot is required"),
  quantity: z.string().min(1, "Quantity is required").refine((v) => parseFloat(v) > 0, "Must be positive"),
  productionBatchId: z.string().min(1, "Production Batch ID is required"),
  locationId: z.string().min(1, "Location is required"),
  notes: z.string().optional(),
});

const adjustmentSchema = z.object({
  productId: z.string().min(1, "Material is required"),
  lotId: z.string().min(1, "Lot is required"),
  locationId: z.string().min(1, "Location is required"),
  quantity: z.string().min(1, "Quantity is required"),
  notes: z.string().min(1, "Reason/notes required for adjustments"),
});

function LogTransactionSheet({
  open,
  onOpenChange,
  products,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  locations: Location[];
}) {
  const [txType, setTxType] = useState("PRODUCTION_CONSUMPTION");
  const { toast } = useToast();

  const schema = txType === "PRODUCTION_CONSUMPTION" ? productionSchema : adjustmentSchema;

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema as any),
    defaultValues: {
      productId: "",
      lotId: "",
      quantity: "",
      locationId: "",
      notes: "",
      productionBatchId: "",
    } as any,
  });

  const selectedProductId = form.watch("productId");

  // Fetch existing lots for lot dropdown
  const { data: lots } = useQuery<Lot[]>({
    queryKey: ["/api/lots", selectedProductId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/lots?productId=${selectedProductId}`);
      return res.json();
    },
    enabled: !!selectedProductId,
  });

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // Reset lot when product changes
  useEffect(() => {
    (form as any).setValue("lotId", "");
  }, [selectedProductId]);

  // Reset form when type changes
  useEffect(() => {
    form.reset({
      productId: "",
      lotId: "",
      quantity: "",
      locationId: "",
      notes: "",
      productionBatchId: "",
    } as any);
  }, [txType]);

  const txMutation = useMutation({
    mutationFn: async (values: any) => {
      let qty = parseFloat(values.quantity);
      if (txType === "PRODUCTION_CONSUMPTION") {
        qty = -Math.abs(qty);
      }
      return apiRequest("POST", "/api/transactions", {
        lotId: values.lotId,
        locationId: values.locationId,
        type: txType,
        quantity: String(qty),
        uom: selectedProduct?.defaultUom ?? "g",
        productionBatchId: values.productionBatchId || null,
        notes: values.notes || null,
        performedBy: "admin",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Transaction logged",
        description: `${TX_TYPES.find((t) => t.value === txType)?.label} recorded successfully.`,
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log Transaction</SheetTitle>
        </SheetHeader>
        <p className="text-xs text-muted-foreground mt-1">To log incoming materials, use Purchase Orders → Receive Items.</p>
        <div className="mt-4 space-y-4">
          <Tabs value={txType} onValueChange={setTxType}>
            <TabsList className="w-full">
              <TabsTrigger value="PRODUCTION_CONSUMPTION" className="flex-1 text-xs" data-testid="tab-production">
                Production
              </TabsTrigger>
              <TabsTrigger value="COUNT_ADJUSTMENT" className="flex-1 text-xs" data-testid="tab-adjustment">
                Adjustment
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => txMutation.mutate(v))}
              className="space-y-4"
              data-testid="form-transaction"
            >
              {/* Material */}
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Material</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tx-product">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Lot dropdown */}
              <FormField
                control={form.control}
                name={"lotId" as any}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lot</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!selectedProductId}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tx-lot">
                          <SelectValue placeholder={selectedProductId ? "Select lot" : "Select material first"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {lots?.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.lotNumber} {l.supplierName ? `(${l.supplierName})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Location */}
              <FormField
                control={form.control}
                name="locationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tx-location">
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Quantity */}
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Quantity {selectedProduct ? `(${selectedProduct.defaultUom})` : ""}
                      {txType === "PRODUCTION_CONSUMPTION" && (
                        <span className="text-muted-foreground ml-1">(will be negated)</span>
                      )}
                      {txType === "COUNT_ADJUSTMENT" && (
                        <span className="text-muted-foreground ml-1">(+/-)</span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="any"
                        placeholder="0"
                        data-testid="input-tx-quantity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Production Batch ID (production only) */}
              {txType === "PRODUCTION_CONSUMPTION" && (
                <FormField
                  control={form.control}
                  name={"productionBatchId" as any}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Production Batch ID</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. PB-2026-001"
                          data-testid="input-tx-batch-id"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {txType === "COUNT_ADJUSTMENT" ? "Reason / Notes (required)" : "Notes"}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder={txType === "COUNT_ADJUSTMENT" ? "Reason for adjustment..." : "Optional notes"}
                        data-testid="input-tx-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-tx">
                  Cancel
                </Button>
                <Button type="submit" disabled={txMutation.isPending} data-testid="button-submit-tx">
                  {txMutation.isPending ? "Logging..." : "Log Transaction"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Transactions() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterProductId, setFilterProductId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Build query params
  const params = new URLSearchParams();
  if (filterProductId && filterProductId !== "all") params.set("productId", filterProductId);
  if (filterType && filterType !== "all") params.set("type", filterType);
  if (filterDateFrom) params.set("dateFrom", filterDateFrom);
  if (filterDateTo) params.set("dateTo", filterDateTo);
  const queryString = params.toString();

  const { data: transactions, isLoading } = useQuery<TransactionWithDetails[]>({
    queryKey: ["/api/transactions", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/transactions?${queryString}` : "/api/transactions";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Transactions</h1>
        <Button
          size="sm"
          onClick={() => setSheetOpen(true)}
          data-testid="button-log-transaction"
        >
          <Plus className="h-4 w-4 mr-1" />
          Log Transaction
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Material</label>
              <Select value={filterProductId} onValueChange={setFilterProductId}>
                <SelectTrigger className="w-48 h-8 text-xs" data-testid="filter-product">
                  <SelectValue placeholder="All materials" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All materials</SelectItem>
                  {products?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-44 h-8 text-xs" data-testid="filter-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TX_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <DateInput
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-36 h-8 text-xs"
                data-testid="filter-date-from"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <DateInput
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-36 h-8 text-xs"
                data-testid="filter-date-to"
              />
            </div>
            {(filterProductId || filterType || filterDateFrom || filterDateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => {
                  setFilterProductId("");
                  setFilterType("");
                  setFilterDateFrom("");
                  setFilterDateTo("");
                }}
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Material</TableHead>
                  <TableHead className="text-xs">Lot #</TableHead>
                  <TableHead className="text-xs text-right">Quantity</TableHead>
                  <TableHead className="text-xs">UOM</TableHead>
                  <TableHead className="text-xs">Location</TableHead>
                  <TableHead className="text-xs">Batch #</TableHead>
                  <TableHead className="text-xs">Notes</TableHead>
                  <TableHead className="text-xs">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!transactions || transactions.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((tx) => {
                    const qty = parseFloat(tx.quantity);
                    return (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(tx.createdAt)}
                        </TableCell>
                        <TableCell>{typeBadge(tx.type)}</TableCell>
                        <TableCell className="text-xs">{tx.productName}</TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{tx.lotNumber}</TableCell>
                        <TableCell
                          className={`text-xs text-right font-mono ${
                            qty > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {qty > 0 ? "+" : ""}{formatQty(qty)}
                        </TableCell>
                        <TableCell className="text-xs">{tx.uom}</TableCell>
                        <TableCell className="text-xs">{tx.locationName}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {tx.productionBatchId && tx.batchNumber ? (
                            <span
                              className="cursor-pointer hover:underline text-primary"
                              onClick={(e) => { e.stopPropagation(); window.location.hash = `#/production?batch=${tx.productionBatchId}`; }}
                            >
                              {tx.batchNumber}
                            </span>
                          ) : (tx.batchNumber ?? "—")}
                        </TableCell>
                        <TableCell className="text-xs max-w-32 truncate" title={tx.notes ?? undefined}>
                          {tx.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{tx.performedBy ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {products && locations && (
        <LogTransactionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          products={products}
          locations={locations}
        />
      )}
    </div>
  );
}
