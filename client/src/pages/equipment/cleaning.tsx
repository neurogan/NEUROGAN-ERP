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
import type { Equipment, CleaningLog, Product } from "@shared/schema";

interface UserDirectoryEntry {
  id: string;
  fullName: string;
  email: string;
}

const NO_PRODUCT = "__none__";
const RECENT_LIMIT = 100;

const cleaningSchema = z
  .object({
    equipmentId: z.string().min(1, "Equipment is required"),
    cleanedByUserId: z.string().min(1, "Cleaned-by is required"),
    verifiedByUserId: z.string().min(1, "Verified-by is required"),
    method: z.string().trim().optional(),
    priorProductId: z.string().optional(),
    nextProductId: z.string().optional(),
    notes: z.string().trim().optional(),
    commentary: z.string().trim().min(1, "Commentary is required"),
    signaturePassword: z.string().min(1, "Password is required"),
  })
  .refine((v) => v.cleanedByUserId !== v.verifiedByUserId, {
    message: "Verifier must differ from cleaner",
    path: ["verifiedByUserId"],
  });

type CleaningForm = z.infer<typeof cleaningSchema>;

export function CleaningTab() {
  const { user } = useAuth();
  const [logOpen, setLogOpen] = useState(false);

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

  // Fan out one /cleaning-logs query per active equipment. Same pattern as
  // calibration.tsx (Task 12) — useQueries over useEffect because react-query
  // owns the cache and mutation invalidation is keyed per-equipment.
  const logQueries = useQueries({
    queries: activeEquipment.map((e) => ({
      queryKey: [`/api/equipment/${e.id}/cleaning-logs`],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/equipment/${e.id}/cleaning-logs`,
        );
        return res.json() as Promise<CleaningLog[]>;
      },
      enabled: !!e.id,
    })),
  });

  const logsLoading = logQueries.some((q) => q.isLoading);

  const recentLogs = useMemo(() => {
    const all: CleaningLog[] = [];
    for (const q of logQueries) {
      if (q.data) all.push(...q.data);
    }
    all.sort(
      (a, b) =>
        new Date(b.cleanedAt).getTime() - new Date(a.cleanedAt).getTime(),
    );
    return all.slice(0, RECENT_LIMIT);
  }, [logQueries]);

  return (
    <div className="space-y-4" data-testid="panel-cleaning-tab" data-tour="equipment-cleaning">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Recent cleaning logs across all active equipment. New logs require two
          distinct users (F-05 dual-verification).
        </p>
        <Button
          onClick={() => setLogOpen(true)}
          disabled={!user || activeEquipment.length === 0}
          data-testid="button-new-cleaning-log"
        >
          <Plus className="mr-1 h-4 w-4" />
          New Log
        </Button>
      </div>

      <div
        className="rounded-md border border-border"
        data-testid="table-cleaning-logs"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Cleaned By</TableHead>
              <TableHead>Verified By</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Cleaned At</TableHead>
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
              logsLoading &&
              recentLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              )}
            {!equipmentLoading &&
              !equipmentError &&
              !logsLoading &&
              recentLogs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-sm text-muted-foreground"
                  >
                    No cleaning logs yet.
                  </TableCell>
                </TableRow>
              )}
            {recentLogs.map((log) => {
              const eq = equipmentById.get(log.equipmentId);
              const cleanedBy = usersById.get(log.cleanedByUserId);
              const verifiedBy = usersById.get(log.verifiedByUserId);
              return (
                <TableRow
                  key={log.id}
                  data-testid={`row-cleaning-log-${log.id}`}
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
                    {cleanedBy?.fullName ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {verifiedBy?.fullName ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.method ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(log.cleanedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {log.signatureId ? (
                      <Badge
                        className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs"
                        data-testid={`badge-signed-${log.id}`}
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

      <NewCleaningLogDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        activeEquipment={activeEquipment}
        directory={directory ?? []}
        products={products ?? []}
        currentUserId={user?.id ?? null}
      />
    </div>
  );
}

export default CleaningTab;

function NewCleaningLogDialog({
  open,
  onOpenChange,
  activeEquipment,
  directory,
  products,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeEquipment: Equipment[];
  directory: UserDirectoryEntry[];
  products: Product[];
  currentUserId: string | null;
}) {
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaults = useMemo<CleaningForm>(
    () => ({
      equipmentId: "",
      cleanedByUserId: currentUserId ?? "",
      verifiedByUserId: "",
      method: "",
      priorProductId: NO_PRODUCT,
      nextProductId: NO_PRODUCT,
      notes: "",
      commentary: "",
      signaturePassword: "",
    }),
    [currentUserId],
  );

  const form = useForm<CleaningForm>({
    resolver: zodResolver(cleaningSchema),
    mode: "onChange",
    defaultValues: defaults,
  });

  const cleanedById = form.watch("cleanedByUserId");

  const mutation = useMutation({
    mutationFn: async (data: CleaningForm) => {
      const payload: Record<string, string> = {
        cleanedByUserId: data.cleanedByUserId,
        verifiedByUserId: data.verifiedByUserId,
        signaturePassword: data.signaturePassword,
        commentary: data.commentary,
      };
      if (data.method && data.method.trim()) payload.method = data.method.trim();
      if (data.notes && data.notes.trim()) payload.notes = data.notes.trim();
      if (data.priorProductId && data.priorProductId !== NO_PRODUCT) {
        payload.priorProductId = data.priorProductId;
      }
      if (data.nextProductId && data.nextProductId !== NO_PRODUCT) {
        payload.nextProductId = data.nextProductId;
      }
      const res = await apiRequest(
        "POST",
        `/api/equipment/${data.equipmentId}/cleaning-logs`,
        payload,
      );
      return {
        log: (await res.json()) as CleaningLog,
        equipmentId: data.equipmentId,
      };
    },
    onSuccess: ({ log, equipmentId }) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/equipment/${equipmentId}/cleaning-logs`],
      });
      toast({
        title: "Cleaning log recorded",
        description: log.method
          ? `${log.method} signed.`
          : "Dual-verified cleaning event signed.",
      });
      form.reset(defaults);
      setSubmitError(null);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // apiRequest throws "<status>: <body>". 401/423 are signature ceremony
      // failures (wrong password / locked account); 409 IDENTITY_SAME is the
      // F-05 dual-verification backstop in case the UI guard is bypassed.
      const msg = err.message ?? "";
      if (msg.startsWith("401:")) {
        setSubmitError(
          "Wrong password. Please re-enter your e-signature password.",
        );
      } else if (msg.startsWith("423:")) {
        setSubmitError(
          "Your account is locked from too many failed signature attempts. Contact an administrator.",
        );
      } else if (msg.includes("IDENTITY_SAME")) {
        setSubmitError(
          "Verifier must differ from the person who cleaned the equipment.",
        );
      } else {
        setSubmitError(msg || "Failed to record cleaning log.");
      }
    },
  });

  const verifierOptions = useMemo(
    () => directory.filter((u) => u.id !== cleanedById),
    [directory, cleanedById],
  );

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
          <DialogTitle>New cleaning log</DialogTitle>
          <DialogDescription className="text-xs">
            Two distinct users are required (F-05 dual-verification). Your
            password is the electronic signature for this event (F-04, 21 CFR
            §11).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
            data-testid="form-new-cleaning-log"
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
                name="cleanedByUserId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cleaned by</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        // If the verifier now matches the new cleaner, clear it
                        // so the user is forced to pick someone different.
                        if (form.getValues("verifiedByUserId") === v) {
                          form.setValue("verifiedByUserId", "", {
                            shouldValidate: true,
                          });
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-cleaned-by">
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {directory.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.fullName}
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
                name="verifiedByUserId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verified by</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-verified-by">
                          <SelectValue placeholder="Select different user" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {verifierOptions.length === 0 ? (
                          <SelectItem value="__no_other_users__" disabled>
                            No other active users available
                          </SelectItem>
                        ) : (
                          verifierOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.fullName}
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
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Wash + sanitize"
                      {...field}
                      data-testid="input-method"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="priorProductId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prior product (optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? NO_PRODUCT}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-prior-product">
                          <SelectValue placeholder="— None —" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PRODUCT}>— None —</SelectItem>
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
                name="nextProductId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next product (optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? NO_PRODUCT}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-next-product">
                          <SelectValue placeholder="— None —" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PRODUCT}>— None —</SelectItem>
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
                      placeholder="Why are you logging this cleaning?"
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
                data-testid="text-cleaning-error"
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
                data-testid="button-submit-cleaning-log"
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
