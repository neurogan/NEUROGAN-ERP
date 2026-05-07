import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Equipment, MmrWithSteps } from "@shared/schema";

// Sentinel for the placeholder option in the "Add equipment" picker. Radix
// forbids empty-string values; same pattern as cleaning.tsx and
// line-clearance.tsx.
const SELECT_PLACEHOLDER = "__select_equipment__";

type GateFailureCalibration = {
  equipmentId: string;
  assetTag: string | null;
  dueAt: string;
};

type GateFailureLineClearance = {
  equipmentId: string;
  assetTag: string | null;
  fromProductId: string;
  toProductId: string;
};

type GateFailure =
  | GateFailureCalibration
  | GateFailureLineClearance;

type GateError = {
  code:
    | "EQUIPMENT_LIST_EMPTY"
    | "CALIBRATION_OVERDUE"
    | "LINE_CLEARANCE_MISSING";
  message: string;
  payload: { equipment: GateFailure[] };
};

interface BprStartModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  productId: string;
  batchNumber: string;
  onStarted: () => void;
}

export function BprStartModal({
  open,
  onOpenChange,
  batchId,
  productId,
  batchNumber,
  onStarted,
}: BprStartModalProps) {
  const { toast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [gateError, setGateError] = useState<GateError | null>(null);
  const initialisedRef = useRef(false);

  // Reset init-flag whenever the dialog opens OR the productId changes while
  // open, so the per-product default list is re-applied. Clear selectedIds
  // immediately so stale defaults from the previous product don't flash; the
  // init effect below will repopulate once the new query resolves.
  useEffect(() => {
    if (open) {
      initialisedRef.current = false;
      setGateError(null);
      setSelectedIds(new Set());
    }
  }, [open, productId]);

  const {
    data: defaultEquipment,
    isLoading: defaultsLoading,
  } = useQuery<Equipment[]>({
    queryKey: ["/api/products", productId, "equipment"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/products/${productId}/equipment`,
      );
      return res.json();
    },
    enabled: open && !!productId,
  });

  const { data: approvedMmr, isLoading: mmrLoading } = useQuery<MmrWithSteps | null>({
    queryKey: ["/api/mmrs", "approved", productId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mmrs?productId=${productId}&status=APPROVED`);
      const arr = await res.json() as MmrWithSteps[];
      return arr[0] ?? null;
    },
    enabled: open && !!productId,
  });


  const { data: allEquipment, isLoading: allLoading } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment");
      return res.json();
    },
    enabled: open,
  });

  // Initialise selectedIds from the per-product list once it loads. The
  // initialisedRef guard prevents clobbering operator edits if the query
  // refetches in the background.
  useEffect(() => {
    if (!open) return;
    if (initialisedRef.current) return;
    if (!defaultEquipment) return;
    // R-07: merge MMR equipment IDs into the default selection
    const mmrEquipmentIds = approvedMmr
      ? approvedMmr.steps.flatMap((s) => s.equipmentIds)
      : [];
    setSelectedIds(new Set([...defaultEquipment.map((e) => e.id), ...mmrEquipmentIds]));
    initialisedRef.current = true;
  }, [open, defaultEquipment, approvedMmr]);

  const equipmentById = useMemo(() => {
    const m = new Map<string, Equipment>();
    (allEquipment ?? []).forEach((e) => m.set(e.id, e));
    (defaultEquipment ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [allEquipment, defaultEquipment]);

  const activeEquipment = useMemo(
    () => (allEquipment ?? []).filter((e) => e.status !== "RETIRED"),
    [allEquipment],
  );

  const addableEquipment = useMemo(
    () => activeEquipment.filter((e) => !selectedIds.has(e.id)),
    [activeEquipment, selectedIds],
  );

  const selectedList = useMemo(() => {
    const rows: Equipment[] = [];
    selectedIds.forEach((id) => {
      const eq = equipmentById.get(id);
      if (eq) rows.push(eq);
    });
    rows.sort((a, b) => a.assetTag.localeCompare(b.assetTag));
    return rows;
  }, [selectedIds, equipmentById]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/production-batches/${batchId}/start`,
        { equipmentIds: Array.from(selectedIds) },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setGateError(null);
      onStarted();
      onOpenChange(false);
      toast({ title: "Production started" });
    },
    onError: (err: Error) => {
      // apiRequest throws Error(`${status}: ${body}`). Extract the body for
      // 409 gate-failure responses; otherwise surface a toast.
      const match = err.message.match(/^(\d+):\s*([\s\S]*)$/);
      if (match && match[1] === "409") {
        try {
          const parsed = JSON.parse(match[2]);
          if (parsed.code && parsed.payload) {
            setGateError(parsed);
            return;
          }
        } catch {
          // fall through to generic toast
        }
      }
      toast({
        title: "Failed to start",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleAdd(id: string) {
    if (id === SELECT_PLACEHOLDER) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function handleRemove(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleOpenChange(o: boolean) {
    if (!o) {
      setGateError(null);
    }
    onOpenChange(o);
  }

  const loading = defaultsLoading || allLoading || mmrLoading;
  const submitDisabled = startMutation.isPending || selectedIds.size === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[560px]"
        data-testid="dialog-bpr-start"
      >
        <DialogHeader>
          <DialogTitle>Start Production – Batch {batchNumber}</DialogTitle>
          <DialogDescription className="text-xs">
            Confirm the equipment used in this batch. The system will verify
            calibration, qualifications, and line clearance before starting
            (R-03 gates).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* R-07: MMR banner */}
          {approvedMmr ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Batch will be produced from <strong>MMR v{approvedMmr.version}</strong> — {approvedMmr.productName}
            </div>
          ) : (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              No approved MMR exists for this product. Steps must be entered manually.
            </div>
          )}


          {gateError && <GateBanners error={gateError} />}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Equipment for this batch</h3>
            {loading && selectedList.length === 0 ? (
              <Skeleton className="h-10 w-full" />
            ) : selectedList.length === 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-no-equipment-selected"
              >
                No equipment selected. Add at least one piece below.
              </p>
            ) : (
              <ul
                className="flex flex-wrap gap-2"
                data-testid="list-selected-equipment"
              >
                {selectedList.map((eq) => (
                  <li
                    key={eq.id}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                    data-testid={`chip-equipment-${eq.id}`}
                  >
                    <span className="font-mono">{eq.assetTag}</span>
                    <span className="text-muted-foreground">{eq.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemove(eq.id)}
                      className="rounded-sm p-0.5 hover:bg-muted"
                      aria-label={`Remove ${eq.assetTag}`}
                      data-testid={`button-remove-equipment-${eq.id}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Add equipment</h3>
            <Select
              value={SELECT_PLACEHOLDER}
              onValueChange={handleAdd}
              disabled={addableEquipment.length === 0 || allLoading}
            >
              <SelectTrigger data-testid="select-add-equipment">
                <SelectValue placeholder="Select equipment to add" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_PLACEHOLDER} disabled>
                  {addableEquipment.length === 0
                    ? "All active equipment already selected"
                    : "Select equipment to add"}
                </SelectItem>
                {addableEquipment.map((eq) => (
                  <SelectItem key={eq.id} value={eq.id}>
                    {eq.assetTag} — {eq.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Plus className="h-3 w-3" />
              Defaults come from the product&rsquo;s configured equipment list.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={startMutation.isPending}
            data-testid="button-cancel-start"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={submitDisabled}
            data-testid="button-submit-start"
          >
            {startMutation.isPending ? "Starting…" : "Start Production"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GateBanners({ error }: { error: GateError }) {
  if (error.code === "EQUIPMENT_LIST_EMPTY") {
    return (
      <Alert variant="destructive" data-testid="gate-banner-empty">
        <AlertDescription>
          Select at least one piece of equipment to start production.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      {error.payload.equipment.map((f) => {
        if (error.code === "CALIBRATION_OVERDUE") {
          const cal = f as GateFailureCalibration;
          const dueAt = new Date(cal.dueAt).toLocaleDateString();
          const calibrationHref = cal.assetTag
            ? `/operations/equipment/calibration?focus=${encodeURIComponent(cal.assetTag)}`
            : `/operations/equipment/calibration`;
          return (
            <Alert
              variant="destructive"
              key={cal.equipmentId}
              data-testid={`gate-banner-${cal.equipmentId}`}
            >
              <AlertDescription>
                <strong>{cal.assetTag ?? cal.equipmentId}</strong>: calibration
                overdue (due {dueAt}).{" "}
                <Link
                  href={calibrationHref}
                  className="underline"
                  data-testid={`link-resolve-${cal.equipmentId}`}
                >
                  Log calibration record
                </Link>
              </AlertDescription>
            </Alert>
          );
        }
        if (error.code === "LINE_CLEARANCE_MISSING") {
          const lc = f as GateFailureLineClearance;
          const lineClearanceHref = lc.assetTag
            ? `/operations/equipment/line-clearance?focus=${encodeURIComponent(lc.assetTag)}`
            : `/operations/equipment/line-clearance`;
          return (
            <Alert
              variant="destructive"
              key={lc.equipmentId}
              data-testid={`gate-banner-${lc.equipmentId}`}
            >
              <AlertDescription>
                <strong>{lc.assetTag ?? lc.equipmentId}</strong>: line
                clearance required for product change.{" "}
                <Link
                  href={lineClearanceHref}
                  className="underline"
                  data-testid={`link-resolve-${lc.equipmentId}`}
                >
                  Log line clearance
                </Link>
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })}
    </div>
  );
}

export default BprStartModal;
