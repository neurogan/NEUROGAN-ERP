import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Plus, Trash2, Search, Package, Pencil } from "lucide-react";
import type { Product, MmrWithSteps } from "@shared/schema";
import { formatQty } from "@/lib/formatQty";

// ── Product form schema (create / edit name+SKU) ─────────

const productFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

// ── Product Form Dialog ──────────────────────────────────

function ProductFormDialog({
  product,
  open,
  onOpenChange,
}: {
  product?: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEditing = !!product;

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: product?.name ?? "",
      sku: product?.sku ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      if (isEditing) {
        return apiRequest("PATCH", `/api/products/${product.id}`, {
          name: values.name,
          sku: values.sku,
        });
      }
      return apiRequest("POST", "/api/products", {
        name: values.name,
        sku: values.sku,
        category: "FINISHED_GOOD",
        defaultUom: "pcs",
        status: "ACTIVE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: isEditing ? "Product updated" : "Product created",
        description: `${form.getValues("name")} has been ${isEditing ? "updated" : "created"}.`,
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
            data-testid="form-product"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. CBD Capsules 60ct" data-testid="input-product-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. US-CBDC1" data-testid="input-product-sku" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-product">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-product">
                {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}



// ── Main page ──────────────────────────────────────────

export default function FinishedGoods() {
  const [, setLocation] = useLocation();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Product CRUD state
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | undefined>();
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  const { toast } = useToast();

  // Fetch all products, filter to finished goods
  const { data: allProducts, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });
  const finishedGoods = allProducts?.filter((p) => p.category === "FINISHED_GOOD") ?? [];

  // Fetch approved MMR for selected product
  const { data: approvedMmrs } = useQuery<MmrWithSteps[]>({
    queryKey: ["/api/mmrs", "approved", selectedProductId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mmrs?productId=${selectedProductId}&status=APPROVED`);
      return res.json();
    },
    enabled: !!selectedProductId,
  });
  const approvedMmr = approvedMmrs?.[0] ?? null;

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Product deleted" });
      if (deleteProductId === selectedProductId) {
        setSelectedProductId(null);
      }
      setDeleteProductId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const selectedProduct = finishedGoods.find((p) => p.id === selectedProductId);

  const filteredGoods = finishedGoods.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Product handlers
  const handleAddProduct = () => {
    setEditingProduct(undefined);
    setProductDialogOpen(true);
  };

  const handleEditProduct = (p: Product) => {
    setEditingProduct(p);
    setProductDialogOpen(true);
  };

  return (
    <div className="flex h-full">
      {/* Left panel: product list */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold" data-testid="text-page-title">Products</h1>
            <Button size="sm" onClick={handleAddProduct} data-testid="button-add-product">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-search-products"
            />
          </div>
          <p className="text-xs text-muted-foreground">{filteredGoods.length} finished goods</p>
        </div>

        <ScrollArea className="flex-1">
          {productsLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredGoods.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No finished goods found.
            </div>
          ) : (
            <div className="p-2">
              {filteredGoods.map((product) => (
                <button
                  key={product.id}
                  className={`w-full text-left px-3 py-2.5 rounded-md mb-0.5 transition-colors ${
                    selectedProductId === product.id
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedProductId(product.id)}
                  data-testid={`button-select-product-${product.id}`}
                >
                  <div className="text-sm font-medium leading-tight">{product.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{product.sku}</div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right panel: product detail + recipe */}
      <div className="flex-1 overflow-auto">
        {!selectedProductId ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Package className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Select a product to view its details and recipe</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Product header with edit/delete */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold" data-testid="text-product-name">
                  {selectedProduct?.name}
                </h2>
                <span className="text-xs font-mono text-muted-foreground" data-testid="text-product-sku">
                  {selectedProduct?.sku}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    selectedProduct?.status === "ACTIVE"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0 text-xs"
                  }
                >
                  {selectedProduct?.status}
                </Badge>
                {approvedMmr && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation(`/operations/mmr?mmrId=${approvedMmr.id}`)}
                    data-testid="button-view-mmr"
                  >
                    View MMR
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => selectedProduct && handleEditProduct(selectedProduct)}
                  data-testid="button-edit-product"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => selectedProduct && setDeleteProductId(selectedProduct.id)}
                  data-testid="button-delete-product"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* MMR section */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Master Manufacturing Record</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLocation(`/manufacturing/mmr?productId=${selectedProductId}`)}
                    data-testid="button-view-mmr"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    View / Create MMR
                  </Button>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>

      {/* Product form dialog (create / edit) */}
      <ProductFormDialog
        key={editingProduct?.id ?? "new-product"}
        product={editingProduct}
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
      />

      {/* Delete product confirmation */}
      <AlertDialog open={!!deleteProductId} onOpenChange={() => setDeleteProductId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product? This will also remove its recipe, lots, and related transactions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-product">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteProductId && deleteProductMutation.mutate(deleteProductId)}
              data-testid="button-confirm-delete-product"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
