import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
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
import { Progress } from "@/components/ui/progress";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ClipboardList, PackageCheck, X, Send, Ban, Upload, ClipboardPaste, Download, FileSpreadsheet, UserPlus, PackagePlus } from "lucide-react";
import { LocationSelectWithAdd } from "@/components/LocationSelectWithAdd";
import { formatQty } from "@/lib/formatQty";
import { DateInput } from "@/components/ui/date-input";
import { formatDate } from "@/lib/formatDate";
import type {
  PurchaseOrderWithDetails,
  POLineItemWithProduct,
  Supplier,
  Product,
  Location,
} from "@shared/schema";

// ── Status badge ──

function statusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary" className="text-xs">Draft</Badge>;
    case "SUBMITTED":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs">Submitted</Badge>;
    case "PARTIALLY_RECEIVED":
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">Partially Received</Badge>;
    case "CLOSED":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">Closed</Badge>;
    case "CANCELLED":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs">Cancelled</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

// ── PO List Item ──

function POListItem({
  po,
  isSelected,
  onClick,
}: {
  po: PurchaseOrderWithDetails;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`item-po-${po.id}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono">{po.poNumber}</span>
            {statusBadge(po.status)}
          </div>
          <span className="text-xs text-muted-foreground">{po.supplierName}</span>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {po.orderDate ? formatDate(po.orderDate) : formatDate(po.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Detail Panel ──

function DetailPanel({
  po,
  onSubmitPO,
  onCancelPO,
  onReceive,
  isSubmitting,
  isCancelling,
}: {
  po: PurchaseOrderWithDetails;
  onSubmitPO: () => void;
  onCancelPO: () => void;
  onReceive: () => void;
  isSubmitting: boolean;
  isCancelling: boolean;
}) {
  const overallProgress = po.totalOrdered > 0 ? (po.totalReceived / po.totalOrdered) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="detail-panel">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold font-mono">{po.poNumber}</h2>
            {statusBadge(po.status)}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            <span
              className="cursor-pointer hover:underline text-primary"
              onClick={() => { window.location.hash = `#/suppliers?supplier=${po.supplierId}`; }}
            >
              {po.supplierName}
            </span>
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {po.status === "DRAFT" && (
            <>
              <Button
                size="sm"
                onClick={onSubmitPO}
                disabled={isSubmitting}
                data-testid="button-submit-po"
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                {isSubmitting ? "Submitting..." : "Submit PO"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancelPO}
                disabled={isCancelling}
                data-testid="button-cancel-po"
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </>
          )}
          {po.status === "SUBMITTED" && (
            <>
              <Button
                size="sm"
                onClick={onReceive}
                data-testid="button-receive-items"
              >
                <PackageCheck className="h-3.5 w-3.5 mr-1" />
                Receive Items
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancelPO}
                disabled={isCancelling}
                data-testid="button-cancel-po"
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </>
          )}
          {po.status === "PARTIALLY_RECEIVED" && (
            <Button
              size="sm"
              onClick={onReceive}
              data-testid="button-receive-items"
            >
              <PackageCheck className="h-3.5 w-3.5 mr-1" />
              Receive Items
            </Button>
          )}
        </div>
      </div>

      {/* Info row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {po.orderDate && (
          <span>Order Date: <span className="text-foreground">{formatDate(po.orderDate)}</span></span>
        )}
        {po.expectedDeliveryDate && (
          <span>Expected: <span className="text-foreground">{formatDate(po.expectedDeliveryDate)}</span></span>
        )}
        {po.createdAt && (
          <span>Created: <span className="text-foreground">{formatDate(po.createdAt)}</span></span>
        )}
      </div>

      {po.notes && (
        <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">{po.notes}</p>
      )}

      {/* Overall progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-medium tabular-nums">{formatQty(po.totalReceived)} / {formatQty(po.totalOrdered)} ({Math.round(overallProgress)}%)</span>
        </div>
        <Progress value={overallProgress} className="h-2" data-testid="progress-overall" />
      </div>

      {/* Line items table */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Line Items ({po.lineItems.length})
        </h3>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Material</TableHead>
                  <TableHead className="text-xs text-right">Ordered</TableHead>
                  <TableHead className="text-xs text-right">Received</TableHead>
                  <TableHead className="text-xs">UOM</TableHead>
                  <TableHead className="text-xs text-right">Unit Price</TableHead>
                  <TableHead className="text-xs w-32">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lineItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      No line items.
                    </TableCell>
                  </TableRow>
                ) : (
                  po.lineItems.map((li) => {
                    const ordered = parseFloat(li.quantityOrdered);
                    const received = parseFloat(li.quantityReceived);
                    const pct = ordered > 0 ? (received / ordered) * 100 : 0;
                    return (
                      <TableRow key={li.id} data-testid={`row-line-item-${li.id}`}>
                        <TableCell>
                          <div className="text-sm font-medium">
                            <span
                              className="cursor-pointer hover:underline text-primary"
                              onClick={(e) => { e.stopPropagation(); window.location.hash = `#/inventory?material=${li.productId}`; }}
                            >
                              {li.productName}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground">{li.productSku}</div>
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums font-medium">
                          {formatQty(ordered)}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {formatQty(received)}
                        </TableCell>
                        <TableCell className="text-xs">{li.uom}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {li.unitPrice ? `$${parseFloat(li.unitPrice).toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Empty Detail State ──

function EmptyDetailState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16 px-8">
      <div className="rounded-full bg-muted p-4 mb-4">
        <ClipboardList className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium mb-1">Select a purchase order</h3>
      <p className="text-xs text-muted-foreground max-w-[220px]">
        Click on a PO from the list to view details, line items, and receiving status.
      </p>
    </div>
  );
}

// ── Bulk Import helpers ──

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

interface ParsedLineItem {
  materialName: string;
  quantity: string;
  uom: string;
  unitPrice: string;
}

function parseBulkText(text: string): ParsedLineItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const results: ParsedLineItem[] = [];
  const firstLine = lines[0].toLowerCase();
  const isCSV = text.includes(",");
  const startIdx = (firstLine.includes("material") || firstLine.includes("name") || firstLine.includes("sku")) ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    let cols: string[];
    if (isCSV) {
      cols = parseCSVLine(lines[i]);
    } else {
      // Tab-separated (from Excel/Sheets paste)
      cols = lines[i].split("\t").map((c) => c.trim());
    }
    if (cols.length < 2) continue;

    results.push({
      materialName: cols[0] || "",
      quantity: cols[1] || "0",
      uom: cols[2] || "g",
      unitPrice: cols[3] || "",
    });
  }
  return results;
}

function downloadCSVTemplate() {
  const header = "Material Name or SKU,Quantity,UOM,Unit Price";
  const example1 = "Urolithin A,50,kg,125.00";
  const example2 = "RA-CBDIS,200,kg,45.50";
  const example3 = "Berberine,100,kg,";
  const csv = [header, example1, example2, example3].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "po-line-items-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Create PO Sheet ──

const createPOSchema = z.object({
  poNumber: z.string().min(1, "PO number is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  orderDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(
    z.object({
      productId: z.string().min(1, "Material is required"),
      quantityOrdered: z.string().min(1, "Quantity is required").refine((v) => parseFloat(v) > 0, "Must be positive"),
      uom: z.string().min(1, "UOM is required"),
      unitPrice: z.string().optional(),
      lotNumber: z.string().optional(),
      notes: z.string().optional(),
    })
  ).min(1, "At least one line item is required"),
});

type CreatePOValues = z.infer<typeof createPOSchema>;

function CreatePOSheet({
  open,
  onOpenChange,
  suppliers,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  products: Product[];
}) {
  const { toast } = useToast();
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [showNewMaterial, setShowNewMaterial] = useState(false);
  const [newMaterialLineIndex, setNewMaterialLineIndex] = useState<number>(0);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialSku, setNewMaterialSku] = useState("");
  const [newMaterialCategory, setNewMaterialCategory] = useState("ACTIVE_INGREDIENT");
  const [newMaterialUom, setNewMaterialUom] = useState("g");
  const [creatingMaterial, setCreatingMaterial] = useState(false);

  const CATEGORIES = [
    { value: "ACTIVE_INGREDIENT", label: "Active Ingredient" },
    { value: "SUPPORTING_INGREDIENT", label: "Supporting Ingredient" },
    { value: "PRIMARY_PACKAGING", label: "Primary Packaging" },
    { value: "SECONDARY_PACKAGING", label: "Secondary Packaging" },
  ];
  const UOMS = ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"];

  const handleCreateMaterial = async () => {
    if (!newMaterialName.trim() || !newMaterialSku.trim()) return;
    setCreatingMaterial(true);
    try {
      const res = await apiRequest("POST", "/api/products", {
        name: newMaterialName.trim(),
        sku: newMaterialSku.trim(),
        category: newMaterialCategory,
        defaultUom: newMaterialUom,
      });
      const material = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      // Auto-select the new material in the line item that triggered the dialog
      setTimeout(() => {
        form.setValue(`lineItems.${newMaterialLineIndex}.productId`, material.id);
        form.setValue(`lineItems.${newMaterialLineIndex}.uom`, material.defaultUom);
      }, 100);
      toast({ title: "Material created", description: `${material.name} (${material.sku}) has been added.` });
      setShowNewMaterial(false);
      setNewMaterialName("");
      setNewMaterialSku("");
      setNewMaterialCategory("ACTIVE_INGREDIENT");
      setNewMaterialUom("g");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setCreatingMaterial(false);
    }
  };

  // Auto-generate SKU suggestion from material name
  const generateSkuSuggestion = (name: string) => {
    if (!name.trim()) return "";
    // Take first 5 chars of the name, uppercased, removing spaces/special chars
    const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const abbrev = clean.slice(0, 5).padEnd(5, "X");
    return `RA-${abbrev}`;
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) return;
    setCreatingSupplier(true);
    try {
      const res = await apiRequest("POST", "/api/suppliers", {
        name: newSupplierName.trim(),
        contactEmail: newSupplierEmail.trim() || null,
        contactPhone: newSupplierPhone.trim() || null,
      });
      const supplier = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      // Wait a tick for the supplier list to update, then set the form value
      setTimeout(() => form.setValue("supplierId", supplier.id), 100);
      toast({ title: "Supplier created", description: `${supplier.name} has been added.` });
      setShowNewSupplier(false);
      setNewSupplierName("");
      setNewSupplierEmail("");
      setNewSupplierPhone("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setCreatingSupplier(false);
    }
  };

  const form = useForm<CreatePOValues>({
    resolver: zodResolver(createPOSchema),
    defaultValues: {
      poNumber: "",
      supplierId: "",
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: "",
      notes: "",
      lineItems: [{ productId: "", quantityOrdered: "", uom: "g", unitPrice: "", lotNumber: "", notes: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });

  const mutation = useMutation({
    mutationFn: async (values: CreatePOValues) => {
      return apiRequest("POST", "/api/purchase-orders", {
        poNumber: values.poNumber,
        supplierId: values.supplierId,
        orderDate: values.orderDate || null,
        expectedDeliveryDate: values.expectedDeliveryDate || null,
        notes: values.notes || null,
        lineItems: values.lineItems.map((li) => ({
          productId: li.productId,
          quantityOrdered: li.quantityOrdered,
          uom: li.uom,
          unitPrice: li.unitPrice || null,
          lotNumber: li.lotNumber || null,
          notes: li.notes || null,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Purchase order created", description: `PO ${form.getValues("poNumber")} has been created.` });
      onOpenChange(false);
      form.reset();
      setShowBulkImport(false);
      setPasteText("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Auto-fill UOM when product changes
  const handleProductChange = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setValue(`lineItems.${index}.uom`, product.defaultUom);
    }
  };

  // Match parsed material names/SKUs to existing products
  const matchProduct = (nameOrSku: string): Product | undefined => {
    const input = nameOrSku.trim().toLowerCase();
    // Try exact SKU match first
    const skuMatch = products.find((p) => p.sku.toLowerCase() === input);
    if (skuMatch) return skuMatch;
    // Try exact name match
    const nameMatch = products.find((p) => p.name.toLowerCase() === input);
    if (nameMatch) return nameMatch;
    // Try partial name match (starts with)
    const partialMatch = products.find((p) => p.name.toLowerCase().startsWith(input) || input.startsWith(p.name.toLowerCase()));
    if (partialMatch) return partialMatch;
    // Try contains
    return products.find((p) => p.name.toLowerCase().includes(input) || input.includes(p.name.toLowerCase()));
  };

  const applyBulkImport = (parsed: ParsedLineItem[]) => {
    if (parsed.length === 0) {
      toast({ title: "No items found", description: "Could not parse any line items from the input.", variant: "destructive" });
      return;
    }

    const validUoms = ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"];
    let matched = 0;
    let unmatched = 0;
    const newItems: CreatePOValues["lineItems"] = [];

    for (const item of parsed) {
      const product = matchProduct(item.materialName);
      const uom = validUoms.includes(item.uom) ? item.uom : (product?.defaultUom ?? "g");
      newItems.push({
        productId: product?.id ?? "",
        quantityOrdered: item.quantity,
        uom,
        unitPrice: item.unitPrice,
        notes: product ? "" : `Unmatched: ${item.materialName}`,
      });
      if (product) matched++;
      else unmatched++;
    }

    // Replace current line items
    form.setValue("lineItems", newItems);

    const msg = unmatched > 0
      ? `${matched} matched, ${unmatched} unmatched (marked in red — select manually).`
      : `All ${matched} items matched successfully.`;
    toast({ title: `${parsed.length} items imported`, description: msg });
    setShowBulkImport(false);
    setPasteText("");
  };

  const handlePasteImport = () => {
    const parsed = parseBulkText(pasteText);
    applyBulkImport(parsed);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseBulkText(text);
      applyBulkImport(parsed);
    };
    reader.readAsText(file);
    // Reset file input so same file can be re-uploaded
    e.target.value = "";
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Purchase Order</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="space-y-4"
              data-testid="form-create-po"
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="poNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PO Number</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. PO-2026-001" data-testid="input-po-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier</FormLabel>
                      <Select
                        onValueChange={(v) => {
                          if (v === "__new__") {
                            setShowNewSupplier(true);
                          } else {
                            field.onChange(v);
                          }
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-po-supplier">
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                          <SelectItem value="__new__" className="text-primary font-medium">
                            <span className="flex items-center gap-1"><UserPlus className="h-3.5 w-3.5" /> New Supplier</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="orderDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Date</FormLabel>
                      <FormControl>
                        <DateInput {...field} data-testid="input-po-order-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expectedDeliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected Delivery</FormLabel>
                      <FormControl>
                        <DateInput {...field} data-testid="input-po-expected-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} placeholder="Optional notes" data-testid="input-po-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Line items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Line Items</h3>
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBulkImport(!showBulkImport)}
                      data-testid="button-bulk-import"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                      Bulk Import
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ productId: "", quantityOrdered: "", uom: "g", unitPrice: "", lotNumber: "", notes: "" })}
                      data-testid="button-add-line-item"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Item
                    </Button>
                  </div>
                </div>

                {/* Bulk Import Panel */}
                {showBulkImport && (
                  <Card className="p-3 border-dashed border-primary/30 bg-primary/5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">Import line items from spreadsheet</p>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowBulkImport(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-1">
                        Paste rows from Excel/Google Sheets, or upload a CSV. Columns: Material Name or SKU, Quantity, UOM, Unit Price.
                      </p>

                      {/* Paste area */}
                      <Textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={4}
                        placeholder={"Urolithin A\t50\tkg\t125.00\nRA-CBDIS\t200\tkg\t45.50\nBerberine\t100\tkg"}
                        className="font-mono text-xs"
                        data-testid="textarea-bulk-paste"
                      />

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handlePasteImport}
                          disabled={!pasteText.trim()}
                          data-testid="button-apply-paste"
                        >
                          <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
                          Import Pasted Data
                        </Button>

                        <span className="text-xs text-muted-foreground">or</span>

                        <Button type="button" variant="outline" size="sm" asChild>
                          <label className="cursor-pointer" data-testid="button-upload-csv">
                            <Upload className="h-3.5 w-3.5 mr-1" />
                            Upload CSV
                            <input
                              type="file"
                              accept=".csv,.tsv,.txt"
                              className="hidden"
                              onChange={handleFileUpload}
                            />
                          </label>
                        </Button>

                        <div className="flex-1" />

                        <Button type="button" variant="ghost" size="sm" onClick={downloadCSVTemplate} data-testid="button-download-template">
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Template
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {fields.map((field, index) => {
                  const lineNotes = form.watch(`lineItems.${index}.notes`);
                  const isUnmatched = lineNotes?.startsWith("Unmatched:");
                  return (
                  <Card key={field.id} className={`p-3 ${isUnmatched ? "border-destructive/50 bg-destructive/5" : ""}`}>
                    {isUnmatched && (
                      <p className="text-xs text-destructive mb-2 font-medium">
                        ⚠ {lineNotes} — select the correct material below
                      </p>
                    )}
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.productId`}
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Material</FormLabel>
                                <Select
                                  onValueChange={(v) => {
                                    if (v === "__new_material__") {
                                      setNewMaterialLineIndex(index);
                                      setShowNewMaterial(true);
                                    } else {
                                      f.onChange(v);
                                      handleProductChange(index, v);
                                    }
                                  }}
                                  value={f.value}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid={`select-line-product-${index}`}>
                                      <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {products.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                                    ))}
                                    <SelectItem value="__new_material__" className="text-primary font-medium">
                                      <span className="flex items-center gap-1"><PackagePlus className="h-3.5 w-3.5" /> New Material</span>
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`lineItems.${index}.quantityOrdered`}
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Quantity</FormLabel>
                                <FormControl>
                                  <Input {...f} type="number" step="any" placeholder="0" data-testid={`input-line-qty-${index}`} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 mt-6 text-destructive hover:text-destructive"
                            onClick={() => remove(index)}
                            data-testid={`button-remove-line-${index}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <FormField
                          control={form.control}
                          name={`lineItems.${index}.uom`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">UOM</FormLabel>
                              <Select onValueChange={f.onChange} value={f.value}>
                                <FormControl>
                                  <SelectTrigger data-testid={`select-line-uom-${index}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"].map((u) => (
                                    <SelectItem key={u} value={u}>{u}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lineItems.${index}.lotNumber`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">LOT#</FormLabel>
                              <FormControl>
                                <Input {...f} placeholder="Optional" data-testid={`input-line-lot-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lineItems.${index}.unitPrice`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Unit Price ($)</FormLabel>
                              <FormControl>
                                <Input {...f} type="number" step="0.01" placeholder="0.00" data-testid={`input-line-price-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </Card>
                  );
                })}
                {form.formState.errors.lineItems?.root && (
                  <p className="text-sm text-destructive">{form.formState.errors.lineItems.root.message}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create-po">
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-create-po">
                  {mutation.isPending ? "Creating..." : "Create PO"}
                </Button>
              </div>
            </form>
          </Form>
        </div>

        {/* New Supplier Dialog */}
        <Dialog open={showNewSupplier} onOpenChange={setShowNewSupplier}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Supplier</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="new-supplier-name" className="text-sm">Name *</Label>
                <Input
                  id="new-supplier-name"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="e.g. Uline, Amazon"
                  data-testid="input-new-supplier-name"
                />
              </div>
              <div>
                <Label htmlFor="new-supplier-email" className="text-sm">Email</Label>
                <Input
                  id="new-supplier-email"
                  value={newSupplierEmail}
                  onChange={(e) => setNewSupplierEmail(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-new-supplier-email"
                />
              </div>
              <div>
                <Label htmlFor="new-supplier-phone" className="text-sm">Phone</Label>
                <Input
                  id="new-supplier-phone"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-new-supplier-phone"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewSupplier(false)} data-testid="button-cancel-new-supplier">
                Cancel
              </Button>
              <Button
                onClick={handleCreateSupplier}
                disabled={!newSupplierName.trim() || creatingSupplier}
                data-testid="button-save-new-supplier"
              >
                {creatingSupplier ? "Creating..." : "Add Supplier"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* New Material Dialog */}
        <Dialog open={showNewMaterial} onOpenChange={setShowNewMaterial}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Material</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="new-material-name" className="text-sm">Name *</Label>
                <Input
                  id="new-material-name"
                  value={newMaterialName}
                  onChange={(e) => {
                    setNewMaterialName(e.target.value);
                    // Auto-suggest SKU if SKU field hasn't been manually edited
                    if (!newMaterialSku || newMaterialSku === generateSkuSuggestion(newMaterialName)) {
                      setNewMaterialSku(generateSkuSuggestion(e.target.value));
                    }
                  }}
                  placeholder="e.g. Urolithin A, CBD Isolate"
                  data-testid="input-new-material-name"
                />
              </div>
              <div>
                <Label htmlFor="new-material-sku" className="text-sm">SKU *</Label>
                <Input
                  id="new-material-sku"
                  value={newMaterialSku}
                  onChange={(e) => setNewMaterialSku(e.target.value.toUpperCase())}
                  placeholder="e.g. RA-UROLA"
                  data-testid="input-new-material-sku"
                />
                <p className="text-xs text-muted-foreground mt-1">Format: RA-XXXXX</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-material-category" className="text-sm">Category</Label>
                  <Select value={newMaterialCategory} onValueChange={setNewMaterialCategory}>
                    <SelectTrigger data-testid="select-new-material-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="new-material-uom" className="text-sm">Default UOM</Label>
                  <Select value={newMaterialUom} onValueChange={setNewMaterialUom}>
                    <SelectTrigger data-testid="select-new-material-uom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UOMS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewMaterial(false)} data-testid="button-cancel-new-material">
                Cancel
              </Button>
              <Button
                onClick={handleCreateMaterial}
                disabled={!newMaterialName.trim() || !newMaterialSku.trim() || creatingMaterial}
                data-testid="button-save-new-material"
              >
                {creatingMaterial ? "Creating..." : "Add Material"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

// ── Receiving Sheet ──

function ReceiveSheet({
  po,
  open,
  onOpenChange,
  locations,
  products,
}: {
  po: PurchaseOrderWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  products: Product[];
}) {
  const { toast } = useToast();

  // Only line items that still have remaining qty
  const receivableItems = useMemo(() => {
    return po.lineItems.filter((li) => {
      const ordered = parseFloat(li.quantityOrdered);
      const received = parseFloat(li.quantityReceived);
      return ordered - received > 0;
    });
  }, [po.lineItems]);

  const receiveSchema = z.object({
    receivedDate: z.string().min(1, "Date received is required"),
    items: z.array(
      z.object({
        lineItemId: z.string(),
        productName: z.string(),
        productSku: z.string(),
        ordered: z.number(),
        alreadyReceived: z.number(),
        remaining: z.number(),
        quantity: z.string(),
        productId: z.string(),
        lotNumber: z.string().optional().default(""),
        locationId: z.string().min(1, "Location is required"),
        expirationDate: z.string().optional(),
      })
    ),
  });

  type ReceiveValues = z.infer<typeof receiveSchema>;

  const form = useForm<ReceiveValues>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      receivedDate: new Date().toISOString().slice(0, 10),
      items: receivableItems.map((li) => {
        const ordered = parseFloat(li.quantityOrdered);
        const received = parseFloat(li.quantityReceived);
        const remaining = ordered - received;
        return {
          lineItemId: li.id,
          productId: li.productId,
          productName: li.productName,
          productSku: li.productSku,
          ordered,
          alreadyReceived: received,
          remaining,
          quantity: String(remaining),
          lotNumber: li.lotNumber ?? "",
          locationId: "",
          expirationDate: "",
        };
      }),
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper to check if a product is secondary packaging
  function isSecondaryPackaging(productId: string) {
    const p = products.find(x => x.id === productId);
    return p?.category === "SECONDARY_PACKAGING";
  }

  const onSubmit = async (values: ReceiveValues) => {
    const itemsToReceive = values.items.filter((item) => parseFloat(item.quantity) > 0);
    if (itemsToReceive.length === 0) {
      toast({ title: "Nothing to receive", description: "Enter quantity > 0 for at least one item.", variant: "destructive" });
      return;
    }
    // Validate lotNumber: required for non-secondary packaging
    for (const item of itemsToReceive) {
      if (!isSecondaryPackaging(item.productId) && !item.lotNumber) {
        toast({ title: "Lot # required", description: `Lot # is required for ${item.productName}.`, variant: "destructive" });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      for (const item of itemsToReceive) {
        await apiRequest("POST", "/api/purchase-orders/receive", {
          lineItemId: item.lineItemId,
          quantity: item.quantity,
          lotNumber: item.lotNumber,
          locationId: item.locationId,
          supplierName: po.supplierName,
          expirationDate: item.expirationDate || null,
          receivedDate: values.receivedDate || null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });

      toast({
        title: "Items received",
        description: `${itemsToReceive.length} line item${itemsToReceive.length > 1 ? "s" : ""} received for ${po.poNumber}.`,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Receive Items — {po.poNumber}</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground mt-1">{po.supplierName}</p>

        <div className="mt-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              data-testid="form-receive"
            >
              {/* Date received — applies to this delivery */}
              <FormField
                control={form.control}
                name="receivedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Date Received</FormLabel>
                    <FormControl>
                      <DateInput {...field} data-testid="input-received-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {receivableItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">All items have been fully received.</p>
              ) : (
                form.getValues("items").map((item, index) => (
                  <Card key={item.lineItemId} className="p-3" data-testid={`receive-item-${item.lineItemId}`}>
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium">{item.productName}</div>
                        <div className="text-xs font-mono text-muted-foreground">{item.productSku}</div>
                        <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                          <span>Ordered: <span className="text-foreground font-medium">{formatQty(item.ordered)}</span></span>
                          <span>Received: <span className="text-foreground font-medium">{formatQty(item.alreadyReceived)}</span></span>
                          <span>Remaining: <span className="text-foreground font-medium">{formatQty(item.remaining)}</span></span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <FormField
                          control={form.control}
                          name={`items.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Qty to Receive</FormLabel>
                              <FormControl>
                                <Input {...field} type="number" step="any" data-testid={`input-receive-qty-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.lotNumber`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                Lot #
                                {isSecondaryPackaging(item.productId) && (
                                  <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
                                )}
                              </FormLabel>
                              <FormControl>
                                <Input {...field} placeholder={isSecondaryPackaging(item.productId) ? "Auto-generated if empty" : "e.g. LOT-001"} data-testid={`input-receive-lot-${index}`} />
                              </FormControl>
                              {!isSecondaryPackaging(item.productId) && <FormMessage />}
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <FormField
                          control={form.control}
                          name={`items.${index}.locationId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Location</FormLabel>
                              <FormControl>
                                <LocationSelectWithAdd
                                  locations={locations}
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  placeholder="Select"
                                  data-testid={`select-receive-location-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.expirationDate`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Expiration Date</FormLabel>
                              <FormControl>
                                <DateInput {...field} data-testid={`input-receive-expiry-${index}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </Card>
                ))
              )}

              {receivableItems.length > 0 && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-receive">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting} data-testid="button-submit-receive">
                    {isSubmitting ? "Receiving..." : "Receive"}
                  </Button>
                </div>
              )}
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ──

export default function PurchaseOrders({ initialSelectedId }: { initialSelectedId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [statusFilter, setStatusFilter] = useState("");
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [receiveSheetOpen, setReceiveSheetOpen] = useState(false);
  const { toast } = useToast();

  // Build query string for filtering
  const filterParams = new URLSearchParams();
  if (statusFilter && statusFilter !== "all") filterParams.set("status", statusFilter);
  const filterString = filterParams.toString();

  const { data: poList, isLoading } = useQuery<PurchaseOrderWithDetails[]>({
    queryKey: ["/api/purchase-orders", filterString],
    queryFn: async () => {
      const url = filterString ? `/api/purchase-orders?${filterString}` : "/api/purchase-orders";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // Fetch the selected PO details
  const { data: selectedPO } = useQuery<PurchaseOrderWithDetails>({
    queryKey: ["/api/purchase-orders", selectedId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/purchase-orders/${selectedId}`);
      return res.json();
    },
    enabled: !!selectedId,
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/purchase-orders/${id}/submit`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "PO submitted", description: "Status changed to Submitted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/purchase-orders/${id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "PO cancelled", description: "Status changed to Cancelled." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Purchase Orders</h1>
        <Button
          size="sm"
          onClick={() => setCreateSheetOpen(true)}
          data-testid="button-create-po"
        >
          <Plus className="h-4 w-4 mr-1" />
          Create PO
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — PO list */}
        <div className="w-80 xl:w-96 border-r flex flex-col shrink-0">
          <div className="p-3 border-b shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-sm" data-testid="filter-po-status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="PARTIALLY_RECEIVED">Partially Received</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground mt-2">
              {poList?.length ?? 0} order{(poList?.length ?? 0) !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !poList || poList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No purchase orders found.
              </div>
            ) : (
              poList.map((po) => (
                <POListItem
                  key={po.id}
                  po={po}
                  isSelected={selectedId === po.id}
                  onClick={() => setSelectedId(po.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel — detail view */}
        <div className="flex-1 min-w-0 overflow-auto">
          {selectedPO ? (
            <div className="p-6">
              <DetailPanel
                po={selectedPO}
                onSubmitPO={() => submitMutation.mutate(selectedPO.id)}
                onCancelPO={() => cancelMutation.mutate(selectedPO.id)}
                onReceive={() => setReceiveSheetOpen(true)}
                isSubmitting={submitMutation.isPending}
                isCancelling={cancelMutation.isPending}
              />
            </div>
          ) : (
            <EmptyDetailState />
          )}
        </div>
      </div>

      {/* Create PO Sheet */}
      {suppliers && products && (
        <CreatePOSheet
          open={createSheetOpen}
          onOpenChange={setCreateSheetOpen}
          suppliers={suppliers}
          products={products}
        />
      )}

      {/* Receive Sheet */}
      {selectedPO && locations && products && (
        <ReceiveSheet
          key={selectedPO.id + "-receive"}
          po={selectedPO}
          open={receiveSheetOpen}
          onOpenChange={setReceiveSheetOpen}
          locations={locations}
          products={products}
        />
      )}
    </div>
  );
}
