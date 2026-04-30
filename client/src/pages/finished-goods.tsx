import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
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
import { Plus, Trash2, Search, BookOpen, FlaskConical, Package, Pencil } from "lucide-react";
import type { Product, RecipeWithDetails, MmrWithSteps } from "@shared/schema";
import { formatQty } from "@/lib/formatQty";

const UOMS = ["g", "mg", "L", "mL", "gal", "pcs", "lb", "oz"];

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

// ── Recipe form schema ──────────────────────────────────

const recipeLineSchema = z.object({
  productId: z.string().min(1, "Material is required"),
  quantity: z.string().min(1, "Quantity is required"),
  uom: z.string().min(1, "UOM is required"),
  notes: z.string().optional().nullable(),
});

const recipeFormSchema = z.object({
  name: z.string().min(1, "Recipe name is required"),
  notes: z.string().optional().nullable(),
  lines: z.array(recipeLineSchema).min(1, "At least one material line is required"),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

// ── Recipe Form Dialog ──────────────────────────────────

function RecipeFormDialog({
  productId,
  recipe,
  materials,
  open,
  onOpenChange,
}: {
  productId: string;
  recipe?: RecipeWithDetails;
  materials: Product[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEditing = !!recipe;

  const form = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues: {
      name: recipe?.name ?? "Standard Formula",
      notes: recipe?.notes ?? "",
      lines: recipe?.lines?.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        uom: l.uom,
        notes: l.notes ?? "",
      })) ?? [{ productId: "", quantity: "", uom: "g", notes: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const mutation = useMutation({
    mutationFn: async (values: RecipeFormValues) => {
      const payload = {
        productId,
        name: values.name,
        notes: values.notes || null,
        lines: values.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          uom: l.uom,
          notes: l.notes || null,
        })),
      };
      if (isEditing) {
        return apiRequest("PATCH", `/api/recipes/${recipe.id}`, payload);
      }
      return apiRequest("POST", "/api/recipes", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({
        title: isEditing ? "Recipe updated" : "Recipe created",
        description: `${form.getValues("name")} has been ${isEditing ? "updated" : "created"}.`,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Recipe" : "New Recipe"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4 flex-1 overflow-auto"
            data-testid="form-recipe"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipe Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Standard Formula" data-testid="input-recipe-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="Optional notes" data-testid="input-recipe-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Materials (per 1 unit of output)</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ productId: "", quantity: "", uom: "g", notes: "" })}
                  data-testid="button-add-recipe-line"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Line
                </Button>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Material</TableHead>
                      <TableHead className="text-xs w-24">Qty</TableHead>
                      <TableHead className="text-xs w-20">UOM</TableHead>
                      <TableHead className="text-xs w-32">Notes</TableHead>
                      <TableHead className="text-xs w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, index) => (
                      <TableRow key={field.id}>
                        <TableCell className="py-1.5">
                          <FormField
                            control={form.control}
                            name={`lines.${index}.productId`}
                            render={({ field: f }) => (
                              <Select onValueChange={f.onChange} value={f.value}>
                                <SelectTrigger className="h-8 text-xs" data-testid={`select-recipe-material-${index}`}>
                                  <SelectValue placeholder="Select material" />
                                </SelectTrigger>
                                <SelectContent>
                                  {materials.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                      <span className="text-xs">{m.name}</span>
                                      <span className="text-xs text-muted-foreground ml-1">({m.sku})</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <FormField
                            control={form.control}
                            name={`lines.${index}.quantity`}
                            render={({ field: f }) => (
                              <Input {...f} className="h-8 text-xs" type="number" step="any" placeholder="0" data-testid={`input-recipe-qty-${index}`} />
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <FormField
                            control={form.control}
                            name={`lines.${index}.uom`}
                            render={({ field: f }) => (
                              <Select onValueChange={f.onChange} value={f.value}>
                                <SelectTrigger className="h-8 text-xs" data-testid={`select-recipe-uom-${index}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {UOMS.map((u) => (
                                    <SelectItem key={u} value={u}>{u}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <FormField
                            control={form.control}
                            name={`lines.${index}.notes`}
                            render={({ field: f }) => (
                              <Input {...f} value={f.value ?? ""} className="h-8 text-xs" placeholder="—" data-testid={`input-recipe-line-notes-${index}`} />
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => remove(index)}
                              data-testid={`button-remove-recipe-line-${index}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-recipe">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-recipe">
                {mutation.isPending ? "Saving..." : isEditing ? "Update Recipe" : "Create Recipe"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Category badge helper ──────────────────────────────────

function categoryBadge(cat: string) {
  const labels: Record<string, string> = {
    ACTIVE_INGREDIENT: "Active Ingredient",
    SUPPORTING_INGREDIENT: "Supporting Ingredient",
    PRIMARY_PACKAGING: "Primary Packaging",
    SECONDARY_PACKAGING: "Secondary Packaging",
  };
  return labels[cat] ?? cat;
}

// ── Recipe detail panel ──────────────────────────────────

function RecipePanel({
  recipe,
  onEdit,
  onDelete,
}: {
  recipe: RecipeWithDetails;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold" data-testid="text-recipe-name">{recipe.name}</h3>
          {recipe.notes && (
            <p className="text-xs text-muted-foreground mt-0.5">{recipe.notes}</p>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={onEdit} data-testid="button-edit-recipe">
            Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete} data-testid="button-delete-recipe">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Material</TableHead>
              <TableHead className="text-xs">SKU</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs text-right">Qty / Unit</TableHead>
              <TableHead className="text-xs">UOM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipe.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                  No materials in this recipe.
                </TableCell>
              </TableRow>
            ) : (
              recipe.lines.map((line) => (
                <TableRow key={line.id} data-testid={`row-recipe-line-${line.id}`}>
                  <TableCell className="text-sm font-medium">{line.productName}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{line.productSku}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {categoryBadge(line.productCategory)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">{formatQty(parseFloat(line.quantity))}</TableCell>
                  <TableCell className="text-sm">{line.uom}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
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

  // Recipe CRUD state
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<RecipeWithDetails | undefined>();
  const [deleteRecipeId, setDeleteRecipeId] = useState<string | null>(null);

  const { toast } = useToast();

  // Fetch all products, filter to finished goods
  const { data: allProducts, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });
  const finishedGoods = allProducts?.filter((p) => p.category === "FINISHED_GOOD") ?? [];

  // Fetch all materials (non-finished goods) for the recipe form
  const materials = allProducts?.filter((p) => p.category !== "FINISHED_GOOD") ?? [];

  // Fetch recipes for selected product
  const { data: recipes, isLoading: recipesLoading } = useQuery<RecipeWithDetails[]>({
    queryKey: ["/api/recipes", selectedProductId],
    queryFn: () => apiRequest("GET", `/api/recipes?productId=${selectedProductId}`).then(r => r.json()),
    enabled: !!selectedProductId,
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
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

  // Delete recipe mutation
  const deleteRecipeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/recipes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Recipe deleted" });
      setDeleteRecipeId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const selectedProduct = finishedGoods.find((p) => p.id === selectedProductId);
  const recipe = recipes?.[0]; // One recipe per product for now

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

  // Recipe handlers
  const handleAddRecipe = () => {
    setEditingRecipe(undefined);
    setRecipeDialogOpen(true);
  };

  const handleEditRecipe = (r: RecipeWithDetails) => {
    setEditingRecipe(r);
    setRecipeDialogOpen(true);
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
                    onClick={() => setLocation("/operations/mmr")}
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

            {/* Recipe section */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Recipe / BOM</CardTitle>
                  </div>
                  {!recipe && (
                    <Button size="sm" onClick={handleAddRecipe} data-testid="button-add-recipe">
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Recipe
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {recipesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : recipe ? (
                  <RecipePanel
                    recipe={recipe}
                    onEdit={() => handleEditRecipe(recipe)}
                    onDelete={() => setDeleteRecipeId(recipe.id)}
                  />
                ) : (
                  <div className="flex flex-col items-center py-8 text-center">
                    <FlaskConical className="h-8 w-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No recipe assigned yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add a recipe to define the materials needed to produce 1 unit.
                    </p>
                  </div>
                )}
              </CardContent>
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

      {/* Recipe form dialog */}
      {selectedProductId && (
        <RecipeFormDialog
          key={editingRecipe?.id ?? "new-recipe"}
          productId={selectedProductId}
          recipe={editingRecipe}
          materials={materials}
          open={recipeDialogOpen}
          onOpenChange={setRecipeDialogOpen}
        />
      )}

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

      {/* Delete recipe confirmation */}
      <AlertDialog open={!!deleteRecipeId} onOpenChange={() => setDeleteRecipeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this recipe? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-recipe">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRecipeId && deleteRecipeMutation.mutate(deleteRecipeId)}
              data-testid="button-confirm-delete-recipe"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
