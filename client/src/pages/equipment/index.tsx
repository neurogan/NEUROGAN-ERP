import { useMemo, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import type { Equipment, Location } from "@shared/schema";
import { CalibrationTab } from "./calibration";
import { CleaningTab } from "./cleaning";
import { LineClearanceTab } from "./line-clearance";

type SubTab = "master" | "calibration" | "cleaning" | "line-clearance";

const SUBTABS: { value: SubTab; label: string }[] = [
  { value: "master", label: "Master" },
  { value: "calibration", label: "Calibration" },
  { value: "cleaning", label: "Cleaning" },
  { value: "line-clearance", label: "Line Clearance" },
];

const NO_LOCATION = "__none__";

const createEquipmentSchema = z.object({
  assetTag: z
    .string()
    .trim()
    .min(1, "Asset tag is required")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Name is required"),
  model: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  locationId: z.string().optional(),
});

type CreateEquipmentForm = z.infer<typeof createEquipmentSchema>;

export default function EquipmentPage() {
  const [, params] = useRoute<{ tab?: string }>("/equipment/:tab");
  const tabParam = params?.tab;
  const activeTab: SubTab =
    tabParam === "calibration" || tabParam === "cleaning" || tabParam === "line-clearance"
      ? tabParam
      : "master";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Equipment</h1>
      </div>

      <SubTabNav activeTab={activeTab} />

      {activeTab === "master" && <MasterTab />}
      {activeTab === "calibration" && <CalibrationTab />}
      {activeTab === "cleaning" && <CleaningTab />}
      {activeTab === "line-clearance" && <LineClearanceTab />}
    </div>
  );
}

function SubTabNav({ activeTab }: { activeTab: SubTab }) {
  const [, setLocation] = useLocation();

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => {
        if (v === "master") setLocation("/equipment");
        else setLocation(`/equipment/${v}`);
      }}
    >
      <TabsList>
        {SUBTABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function MasterTab() {
  const { user } = useAuth();
  const canManage = user?.roles?.some((r) => r === "ADMIN" || r === "QA") ?? false;
  const [showRetired, setShowRetired] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [retireTarget, setRetireTarget] = useState<Equipment | null>(null);

  const { data: equipment, isLoading, isError, error } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment");
      return res.json();
    },
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/locations");
      return res.json();
    },
  });

  const locationsById = useMemo(() => {
    const m = new Map<string, string>();
    (locations ?? []).forEach((l) => m.set(l.id, l.name));
    return m;
  }, [locations]);

  const visibleEquipment = useMemo(() => {
    const list = equipment ?? [];
    return showRetired ? list : list.filter((e) => e.status !== "RETIRED");
  }, [equipment, showRetired]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showRetired}
            onCheckedChange={(c) => setShowRetired(c === true)}
            data-testid="checkbox-show-retired"
          />
          <span>Show retired</span>
        </label>
        {canManage && (
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="button-new-equipment"
          >
            <Plus className="mr-1 h-4 w-4" />
            New Equipment
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border" data-testid="table-equipment">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset Tag</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Manufacturer</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {isError && !isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-destructive">
                  Failed to load equipment: {(error as Error)?.message ?? "Unknown error"}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && visibleEquipment.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  No equipment found.
                </TableCell>
              </TableRow>
            )}
            {visibleEquipment.map((e) => (
              <TableRow key={e.id} data-testid={`row-equipment-${e.assetTag}`}>
                <TableCell className="font-mono text-xs">{e.assetTag}</TableCell>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.model ?? "—"}</TableCell>
                <TableCell>{e.manufacturer ?? "—"}</TableCell>
                <TableCell>
                  {e.locationId ? locationsById.get(e.locationId) ?? "—" : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={e.status} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/equipment/${e.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`link-view-equipment-${e.assetTag}`}
                      >
                        View
                      </Button>
                    </Link>
                    {canManage && e.status !== "RETIRED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRetireTarget(e)}
                        data-testid={`button-retire-equipment-${e.assetTag}`}
                      >
                        Retire
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <CreateEquipmentDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          locations={locations ?? []}
        />
      )}

      <RetireEquipmentDialog
        target={retireTarget}
        onClose={() => setRetireTarget(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: Equipment["status"] }) {
  if (status === "RETIRED") {
    return (
      <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">
        RETIRED
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
      ACTIVE
    </Badge>
  );
}

function CreateEquipmentDialog({
  open,
  onOpenChange,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
}) {
  const { toast } = useToast();
  const form = useForm<CreateEquipmentForm>({
    resolver: zodResolver(createEquipmentSchema),
    mode: "onChange",
    defaultValues: {
      assetTag: "",
      name: "",
      model: "",
      manufacturer: "",
      locationId: NO_LOCATION,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateEquipmentForm) => {
      const payload: Record<string, string> = {
        assetTag: data.assetTag.trim(),
        name: data.name.trim(),
      };
      if (data.model && data.model.trim()) payload.model = data.model.trim();
      if (data.manufacturer && data.manufacturer.trim())
        payload.manufacturer = data.manufacturer.trim();
      if (data.locationId && data.locationId !== NO_LOCATION)
        payload.locationId = data.locationId;
      const res = await apiRequest("POST", "/api/equipment", payload);
      return res.json() as Promise<Equipment>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({
        title: "Equipment created",
        description: `${created.assetTag} — ${created.name}`,
      });
      form.reset({
        assetTag: "",
        name: "",
        model: "",
        manufacturer: "",
        locationId: NO_LOCATION,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create equipment", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset({
            assetTag: "",
            name: "",
            model: "",
            manufacturer: "",
            locationId: NO_LOCATION,
          });
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Equipment</DialogTitle>
          <DialogDescription className="text-xs">
            Asset tags must be unique. Equipment can be retired but not deleted.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
            className="space-y-3"
            data-testid="form-create-equipment"
          >
            <FormField
              control={form.control}
              name="assetTag"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset tag</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="EQ-0001"
                      {...field}
                      data-testid="input-asset-tag"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Mixer #1"
                      {...field}
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-model" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="manufacturer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Manufacturer (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-manufacturer" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="locationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? NO_LOCATION}>
                    <FormControl>
                      <SelectTrigger data-testid="select-location">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_LOCATION}>— None —</SelectItem>
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
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !form.formState.isValid}
                data-testid="button-submit-equipment"
              >
                {createMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RetireEquipmentDialog({
  target,
  onClose,
}: {
  target: Equipment | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const retireMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/equipment/${id}/retire`);
      return res.json() as Promise<Equipment>;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Equipment retired", description: updated.assetTag });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to retire", description: err.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retire equipment?</AlertDialogTitle>
          <AlertDialogDescription>
            {target && (
              <>
                <span className="font-medium">{target.assetTag}</span> — {target.name} will be marked
                RETIRED. Existing records are preserved; the asset is hidden by default and cannot
                be selected for new production batches.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-retire">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => target && retireMutation.mutate(target.id)}
            disabled={retireMutation.isPending}
            data-testid="button-confirm-retire"
          >
            {retireMutation.isPending ? "Retiring…" : "Retire"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
