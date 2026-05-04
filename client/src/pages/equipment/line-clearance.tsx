import { useMemo, useState } from "react";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import type { Equipment, LineClearance, Product } from "@shared/schema";

interface UserDirectoryEntry {
  id: string;
  fullName: string;
  email: string;
}

const NO_PRODUCT = "__none__";
const RECENT_LIMIT = 100;

const clearanceSchema = z.object({
  equipmentId: z.string().min(1, "Equipment is required"),
  productChangeFromId: z.string().optional(),
  productChangeToId: z.string().min(1, "To-product is required"),
  notes: z.string().trim().optional(),
  commentary: z.string().trim().min(1, "Commentary is required"),
  signaturePassword: z.string().min(1, "Password is required"),
});

type ClearanceForm = z.infer<typeof clearanceSchema>;

export function LineClearanceTab() {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    data: equipment,
    isLoading: equipmentLoading,
    isError: equipmentError,
    error: equipmentErrObj,
  } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment");
      return res.json();
    },
  });

  const { data: directory } = useQuery<UserDirectoryEntry[]>({
    queryKey: ["/api/users/directory"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/directory");
      return res.json();
    },
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/products");
      return res.json();
    },
  });

  const activeEquipment = useMemo(
    () => (equipment ?? []).filter((e) => e.status !== "RETIRED"),
    [equipment],
  );

  const equipmentById = useMemo(() => {
    const m = new Map<string, Equipment>();
    (equipment ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [equipment]);

  const usersById = useMemo(() => {
    const m = new Map<string, UserDirectoryEntry>();
    (directory ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [directory]);

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    (products ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  // Fan out one /line-clearances query per active equipment. Mirrors the
  // calibration.tsx / cleaning.tsx pattern — useQueries over useEffect because
  // react-query owns the cache and mutation invalidation is keyed per-equipment.
  const clearanceQueries = useQueries({
    queries: activeEquipment.map((e) => ({
      queryKey: [`/api/equipment/${e.id}/line-clearances`],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/equipment/${e.id}/line-clearances`,
        );
        return res.json() as Promise<LineClearance[]>;
      },
      enabled: !!e.id,
    })),
  });

  const clearancesLoading = clearanceQueries.some((q) => q.isLoading);

  const recentClearances = useMemo(() => {
    const all: LineClearance[] = [];
    for (const q of clearanceQueries) {
      if (q.data) all.push(...q.data);
    }
    all.sort(
      (a, b) =>
        new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime(),
    );
    return all.slice(0, RECENT_LIMIT);
  }, [clearanceQueries]);

  return (
    <div className="space-y-4" data-testid="panel-line-clearance-tab" data-tour="equipment-line-clearance">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Recent line clearances across all active equipment. Each clearance is a
          single-signer F-04 product-changeover sign-off.
        </p>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={!user || activeEquipment.length === 0}
          data-testid="button-new-line-clearance"
        >
          <Plus className="mr-1 h-4 w-4" />
          New Clearance
        </Button>
      </div>

      <div
        className="rounded-md border border-border"
        data-testid="table-line-clearances"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>From Product</TableHead>
              <TableHead>To Product</TableHead>
              <TableHead>Performed By</TableHead>
              <TableHead>Performed At</TableHead>
              <TableHead>Signed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {equipmentLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {equipmentError && !equipmentLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-destructive">
                  Failed to load equipment:{" "}
                  {(equipmentErrObj as Error)?.message ?? "Unknown error"}
                </TableCell>
              </TableRow>
            )}
            {!equipmentLoading &&
              !equipmentError &&
              clearancesLoading &&
              recentClearances.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              )}
            {!equipmentLoading &&
              !equipmentError &&
              !clearancesLoading &&
              recentClearances.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-sm text-muted-foreground"
                  >
                    No line clearances yet.
                  </TableCell>
                </TableRow>
              )}
            {recentClearances.map((c) => {
              const eq = equipmentById.get(c.equipmentId);
              const fromProduct = c.productChangeFromId
                ? productsById.get(c.productChangeFromId)
                : null;
              const toProduct = productsById.get(c.productChangeToId);
              const performedBy = usersById.get(c.performedByUserId);
              return (
                <TableRow
                  key={c.id}
                  data-testid={`row-line-clearance-${c.id}`}
                >
                  <TableCell>
                    {eq ? (
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">{eq.assetTag}</span>
                        <span className="text-xs text-muted-foreground">
                          {eq.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.productChangeFromId ? (
                      fromProduct ? (
                        <div className="flex flex-col">
                          <span className="font-mono text-xs">
                            {fromProduct.sku}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {fromProduct.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-first-batch-${c.id}`}
                      >
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {toProduct ? (
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">
                          {toProduct.sku}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {toProduct.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {performedBy?.fullName ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(c.performedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {c.signatureId ? (
                      <Badge
                        className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs"
                        data-testid={`badge-signed-${c.id}`}
                      >
                        Signed
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs border-muted-foreground text-muted-foreground"
                      >
                        Unsigned
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <NewLineClearanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        activeEquipment={activeEquipment}
        products={products ?? []}
      />
    </div>
  );
}

export default LineClearanceTab;

function NewLineClearanceDialog({
  open,
  onOpenChange,
  activeEquipment,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeEquipment: Equipment[];
  products: Product[];
}) {
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaults: ClearanceForm = {
    equipmentId: "",
    productChangeFromId: NO_PRODUCT,
    productChangeToId: "",
    notes: "",
    commentary: "",
    signaturePassword: "",
  };

  const form = useForm<ClearanceForm>({
    resolver: zodResolver(clearanceSchema),
    mode: "onChange",
    defaultValues: defaults,
  });

  const mutation = useMutation({
    mutationFn: async (data: ClearanceForm) => {
      const payload: Record<string, string | null> = {
        productChangeToId: data.productChangeToId,
        signaturePassword: data.signaturePassword,
        commentary: data.commentary,
      };
      // NULL = first batch on equipment. The "__none__" sentinel exists only in
      // the Select; collapse it back to null here.
      if (data.productChangeFromId && data.productChangeFromId !== NO_PRODUCT) {
        payload.productChangeFromId = data.productChangeFromId;
      }
      if (data.notes && data.notes.trim()) payload.notes = data.notes.trim();
      const res = await apiRequest(
        "POST",
        `/api/equipment/${data.equipmentId}/line-clearances`,
        payload,
      );
      return {
        clearance: (await res.json()) as LineClearance,
        equipmentId: data.equipmentId,
      };
    },
    onSuccess: ({ equipmentId }) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/equipment/${equipmentId}/line-clearances`],
      });
      toast({
        title: "Line clearance recorded",
        description: "Product changeover signed.",
      });
      form.reset(defaults);
      setSubmitError(null);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // apiRequest throws "<status>: <body>". 401/423 are signature ceremony
      // failures (wrong password / locked account); 400 PRODUCT_TO_REQUIRED is
      // the server-side guard in case the zod min(1) on productChangeToId is
      // somehow bypassed.
      const msg = err.message ?? "";
      if (msg.startsWith("401:")) {
        setSubmitError(
          "Wrong password. Please re-enter your e-signature password.",
        );
      } else if (msg.startsWith("423:")) {
        setSubmitError(
          "Your account is locked from too many failed signature attempts. Contact an administrator.",
        );
      } else if (msg.includes("PRODUCT_TO_REQUIRED")) {
        setSubmitError("To-product is required for a line clearance.");
      } else {
        setSubmitError(msg || "Failed to record line clearance.");
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset(defaults);
          setSubmitError(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New line clearance</DialogTitle>
          <DialogDescription className="text-xs">
            Sign-off that the line is cleared between products. Your password is
            the electronic signature for this event (F-04, 21 CFR §11). Leave
            from-product as "None" for the first batch on this equipment.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
            data-testid="form-new-line-clearance"
          >
            <FormField
              control={form.control}
              name="equipmentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Equipment</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-equipment">
                        <SelectValue placeholder="Select equipment" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeEquipment.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.assetTag} — {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="productChangeFromId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From product (optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? NO_PRODUCT}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-from-product">
                          <SelectValue placeholder="— None (first batch) —" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PRODUCT}>
                          — None (first batch) —
                        </SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="productChangeToId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To product</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-to-product">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products.length === 0 ? (
                          <SelectItem value="__no_products__" disabled>
                            No products available
                          </SelectItem>
                        ) : (
                          products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.sku} — {p.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
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
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="commentary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Signature commentary</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Why are you signing this clearance?"
                      {...field}
                      data-testid="input-commentary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="signaturePassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your password (e-signature)</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      {...field}
                      data-testid="input-signature-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {submitError && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive"
                data-testid="text-line-clearance-error"
              >
                {submitError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !form.formState.isValid}
                data-testid="button-submit-line-clearance"
              >
                {mutation.isPending ? "Signing…" : "Sign & log"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
