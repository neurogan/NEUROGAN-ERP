import { useMemo, useState } from "react";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import type {
  Equipment,
  CalibrationRecord,
  CalibrationSchedule,
} from "@shared/schema";

type CalibrationData = {
  schedule: CalibrationSchedule | null;
  records: CalibrationRecord[];
};

type RowStatus = "OVERDUE" | "DUE_SOON" | "OK" | "NO_SCHEDULE";

const DAY_MS = 86_400_000;

function computeStatus(schedule: CalibrationSchedule | null | undefined): RowStatus {
  if (!schedule) return "NO_SCHEDULE";
  const due = new Date(schedule.nextDueAt).getTime();
  const days = (due - Date.now()) / DAY_MS;
  if (days < 0) return "OVERDUE";
  if (days <= 7) return "DUE_SOON";
  return "OK";
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === "OVERDUE") {
    return (
      <Badge variant="destructive" className="text-xs" data-testid="badge-status-overdue">
        Overdue
      </Badge>
    );
  }
  if (status === "DUE_SOON") {
    return (
      <Badge
        className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs"
        data-testid="badge-status-due-soon"
      >
        Due This Week
      </Badge>
    );
  }
  if (status === "OK") {
    return (
      <Badge
        className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs"
        data-testid="badge-status-ok"
      >
        OK
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs border-muted-foreground text-muted-foreground"
      data-testid="badge-status-no-schedule"
    >
      No Schedule
    </Badge>
  );
}

const scheduleSchema = z.object({
  frequencyDays: z
    .number({ invalid_type_error: "Must be a positive integer" })
    .int("Must be an integer")
    .positive("Must be a positive integer"),
});

type ScheduleForm = z.infer<typeof scheduleSchema>;

const SCHEDULE_DEFAULTS: ScheduleForm = { frequencyDays: 30 };

const calibrationSchema = z.object({
  result: z.enum(["PASS", "FAIL"]),
  notes: z.string().trim().optional(),
  certUrl: z.string().trim().optional(),
  signaturePassword: z.string().min(1, "Password is required"),
  commentary: z.string().trim().min(1, "Commentary is required"),
});

type CalibrationForm = z.infer<typeof calibrationSchema>;

const CALIBRATION_DEFAULTS: CalibrationForm = {
  result: "PASS",
  notes: "",
  certUrl: "",
  signaturePassword: "",
  commentary: "",
};

export function CalibrationTab() {
  const { user } = useAuth();
  const canManage =
    user?.roles?.some((r) => r === "ADMIN" || r === "QA") ?? false;

  const [logTarget, setLogTarget] = useState<Equipment | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<Equipment | null>(null);

  const {
    data: equipment,
    isLoading,
    isError,
    error,
  } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment");
      return res.json();
    },
  });

  const activeEquipment = useMemo(
    () => (equipment ?? []).filter((e) => e.status !== "RETIRED"),
    [equipment],
  );

  const calibrationQueries = useQueries({
    queries: activeEquipment.map((e) => ({
      queryKey: [`/api/equipment/${e.id}/calibration`],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/equipment/${e.id}/calibration`,
        );
        return res.json() as Promise<CalibrationData>;
      },
      enabled: !!e.id,
    })),
  });

  // Sort: overdue first, then due soon, then OK, then no schedule.
  const sortedRows = useMemo(() => {
    const rows = activeEquipment.map((e, idx) => {
      const q = calibrationQueries[idx];
      const data = q?.data;
      const status = computeStatus(data?.schedule ?? null);
      return { equipment: e, data, status, queryIdx: idx };
    });
    const order: Record<RowStatus, number> = {
      OVERDUE: 0,
      DUE_SOON: 1,
      OK: 2,
      NO_SCHEDULE: 3,
    };
    return rows.sort((a, b) => {
      const so = order[a.status] - order[b.status];
      if (so !== 0) return so;
      return a.equipment.assetTag.localeCompare(b.equipment.assetTag);
    });
  }, [activeEquipment, calibrationQueries]);

  return (
    <div className="space-y-4" data-testid="panel-calibration-tab" data-tour="equipment-calibration">
      <div
        className="rounded-md border border-border"
        data-testid="table-calibration-schedules"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset Tag</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Record</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {isError && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-destructive">
                  Failed to load equipment:{" "}
                  {(error as Error)?.message ?? "Unknown error"}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  No active equipment.
                </TableCell>
              </TableRow>
            )}
            {sortedRows.map(({ equipment: e, data, status, queryIdx }) => {
              const q = calibrationQueries[queryIdx];
              const loadingRow = q?.isLoading ?? true;
              const errorRow = q?.isError ?? false;
              const schedule = data?.schedule ?? null;
              const records = data?.records ?? [];
              const lastRecord = records[0];
              const rowClass =
                status === "OVERDUE" ? "bg-destructive/10" : undefined;

              return (
                <TableRow
                  key={e.id}
                  className={rowClass}
                  data-testid={`row-calibration-${e.assetTag}`}
                >
                  <TableCell className="font-mono text-xs">{e.assetTag}</TableCell>
                  <TableCell>{e.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {loadingRow ? (
                      <Skeleton className="h-4 w-24" />
                    ) : schedule ? (
                      new Date(schedule.nextDueAt).toLocaleDateString()
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {loadingRow ? (
                      <Skeleton className="h-4 w-16" />
                    ) : errorRow ? (
                      <span className="text-xs text-destructive">Error</span>
                    ) : (
                      <StatusBadge status={status} />
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {loadingRow ? (
                      <Skeleton className="h-4 w-32" />
                    ) : lastRecord ? (
                      <span data-testid={`text-last-record-${e.assetTag}`}>
                        {lastRecord.result}{" "}
                        <span className="text-[10px]">
                          ({new Date(lastRecord.performedAt).toLocaleDateString()})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canManage && status === "NO_SCHEDULE" && !loadingRow && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setScheduleTarget(e)}
                          data-testid={`button-setup-schedule-${e.assetTag}`}
                        >
                          Set up schedule
                        </Button>
                      )}
                      {canManage && status !== "NO_SCHEDULE" && !loadingRow && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLogTarget(e)}
                          data-testid={`button-log-calibration-${e.assetTag}`}
                        >
                          Log Calibration
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <SetupScheduleDialog
          target={scheduleTarget}
          onClose={() => setScheduleTarget(null)}
        />
      )}
      {canManage && (
        <LogCalibrationDialog
          target={logTarget}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}

export default CalibrationTab;

function SetupScheduleDialog({
  target,
  onClose,
}: {
  target: Equipment | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    mode: "onChange",
    defaultValues: SCHEDULE_DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: async (data: ScheduleForm) => {
      if (!target) throw new Error("No equipment selected");
      const res = await apiRequest(
        "POST",
        `/api/equipment/${target.id}/calibration-schedule`,
        { frequencyDays: data.frequencyDays },
      );
      return res.json() as Promise<CalibrationSchedule>;
    },
    onSuccess: () => {
      if (target) {
        queryClient.invalidateQueries({
          queryKey: [`/api/equipment/${target.id}/calibration`],
        });
      }
      toast({
        title: "Schedule created",
        description: target
          ? `${target.assetTag} — every ${form.getValues().frequencyDays} days`
          : undefined,
      });
      form.reset(SCHEDULE_DEFAULTS);
      setSubmitError(null);
      onClose();
    },
    onError: (err: Error) => {
      const msg = err.message ?? "";
      if (msg.includes("DUPLICATE_CALIBRATION_SCHEDULE")) {
        setSubmitError(
          "A calibration schedule already exists for this equipment.",
        );
      } else {
        setSubmitError(msg || "Failed to create schedule.");
      }
    },
  });

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          form.reset(SCHEDULE_DEFAULTS);
          setSubmitError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Set up calibration schedule</DialogTitle>
          <DialogDescription className="text-xs">
            {target ? (
              <>
                <span className="font-medium">{target.assetTag}</span> — {target.name}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
            data-testid="form-setup-schedule"
          >
            <FormField
              control={form.control}
              name="frequencyDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Frequency (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === "" ? undefined : Number(v));
                      }}
                      data-testid="input-frequency-days"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {submitError && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive"
                data-testid="text-schedule-error"
              >
                {submitError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onClose()}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !form.formState.isValid}
                data-testid="button-submit-schedule"
              >
                {mutation.isPending ? "Saving…" : "Save schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LogCalibrationDialog({
  target,
  onClose,
}: {
  target: Equipment | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<CalibrationForm>({
    resolver: zodResolver(calibrationSchema),
    mode: "onChange",
    defaultValues: CALIBRATION_DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: async (data: CalibrationForm) => {
      if (!target) throw new Error("No equipment selected");
      const payload: Record<string, string> = {
        result: data.result,
        signaturePassword: data.signaturePassword,
        commentary: data.commentary,
      };
      if (data.notes && data.notes.trim()) payload.notes = data.notes.trim();
      if (data.certUrl && data.certUrl.trim()) payload.certUrl = data.certUrl.trim();
      const res = await apiRequest(
        "POST",
        `/api/equipment/${target.id}/calibration`,
        payload,
      );
      return res.json() as Promise<CalibrationRecord>;
    },
    onSuccess: (created) => {
      if (target) {
        queryClient.invalidateQueries({
          queryKey: [`/api/equipment/${target.id}/calibration`],
        });
      }
      toast({
        title: "Calibration recorded",
        description: `${created.result} signed.`,
      });
      form.reset(CALIBRATION_DEFAULTS);
      setSubmitError(null);
      onClose();
    },
    onError: (err: Error) => {
      const msg = err.message ?? "";
      if (msg.startsWith("401:")) {
        setSubmitError(
          "Wrong password. Please re-enter your e-signature password.",
        );
      } else if (msg.startsWith("423:")) {
        setSubmitError(
          "Your account is locked from too many failed signature attempts. Contact an administrator.",
        );
      } else {
        setSubmitError(msg || "Failed to record calibration.");
      }
    },
  });

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          form.reset(CALIBRATION_DEFAULTS);
          setSubmitError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Log calibration</DialogTitle>
          <DialogDescription className="text-xs">
            {target ? (
              <>
                <span className="font-medium">{target.assetTag}</span> — {target.name}.
                Your password is required as an electronic signature (F-04, 21 CFR §11).
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
            data-testid="form-log-calibration"
          >
            <FormField
              control={form.control}
              name="result"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Result</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-result">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PASS">PASS</SelectItem>
                      <SelectItem value="FAIL">FAIL</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="certUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Certificate URL (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://…"
                      {...field}
                      data-testid="input-cert-url"
                    />
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
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      {...field}
                      data-testid="input-notes"
                    />
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
                      placeholder="Why are you logging this calibration?"
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
                data-testid="text-calibration-error"
              >
                {submitError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onClose()}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !form.formState.isValid}
                data-testid="button-submit-calibration"
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
