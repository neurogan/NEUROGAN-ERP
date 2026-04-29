import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Plus, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  EquipmentQualification,
  Location,
  CalibrationRecord,
  CalibrationSchedule,
} from "@shared/schema";

type DetailTab = "overview" | "qualifications" | "calibration";

const promoteSchema = z
  .object({
    type: z.enum(["IQ", "OQ", "PQ"]),
    validFrom: z.string().min(1, "Valid from is required"),
    validUntil: z.string().min(1, "Valid until is required"),
    documentUrl: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    commentary: z.string().trim().min(1, "Commentary is required"),
    signaturePassword: z.string().min(1, "Password is required"),
  })
  .refine((v) => v.validUntil > v.validFrom, {
    path: ["validUntil"],
    message: "Valid until must be after Valid from",
  });

type PromoteForm = z.infer<typeof promoteSchema>;

export default function EquipmentDetailPage() {
  const [, params] = useRoute<{ id: string }>("/operations/equipment/:id");
  const equipmentId = params?.id ?? "";
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const { data: equipment, isLoading, isError, error } = useQuery<Equipment>({
    queryKey: [`/api/equipment/${equipmentId}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/equipment/${equipmentId}`);
      return res.json();
    },
    enabled: !!equipmentId,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/locations");
      return res.json();
    },
  });

  const locationName = useMemo(() => {
    if (!equipment?.locationId) return "—";
    return locations?.find((l) => l.id === equipment.locationId)?.name ?? "—";
  }, [equipment?.locationId, locations]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/operations/equipment">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            data-testid="link-back-to-equipment"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Equipment
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            className="text-xl font-semibold tracking-tight"
            data-testid="text-equipment-name"
          >
            {isLoading ? "Loading…" : equipment?.name ?? "Equipment"}
          </h1>
          {equipment && (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span
                className="font-mono text-xs text-muted-foreground"
                data-testid="text-equipment-asset-tag"
              >
                {equipment.assetTag}
              </span>
              <StatusBadge status={equipment.status} />
            </div>
          )}
        </div>
      </div>

      {isError && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="text-equipment-error"
        >
          Failed to load equipment: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as DetailTab)}
      >
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="qualifications" data-testid="tab-qualifications">
            Qualifications
          </TabsTrigger>
          <TabsTrigger value="calibration" data-testid="tab-calibration">
            Calibration
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "overview" && (
        <OverviewPanel
          equipment={equipment}
          locationName={locationName}
          isLoading={isLoading}
        />
      )}
      {activeTab === "qualifications" && (
        <QualificationsPanel equipmentId={equipmentId} />
      )}
      {activeTab === "calibration" && (
        <CalibrationPanel equipmentId={equipmentId} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Equipment["status"] }) {
  if (status === "RETIRED") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-muted-foreground text-muted-foreground"
      >
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

function OverviewPanel({
  equipment,
  locationName,
  isLoading,
}: {
  equipment: Equipment | undefined;
  locationName: string;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border p-4">
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }
  if (!equipment) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Equipment not found.
      </div>
    );
  }
  const fields: { label: string; value: string; testId: string; mono?: boolean }[] = [
    { label: "Asset tag", value: equipment.assetTag, testId: "field-asset-tag", mono: true },
    { label: "Name", value: equipment.name, testId: "field-name" },
    { label: "Model", value: equipment.model ?? "—", testId: "field-model" },
    { label: "Manufacturer", value: equipment.manufacturer ?? "—", testId: "field-manufacturer" },
    { label: "Serial", value: equipment.serial ?? "—", testId: "field-serial", mono: true },
    { label: "Location", value: locationName, testId: "field-location" },
    { label: "Status", value: equipment.status, testId: "field-status" },
  ];
  return (
    <div
      className="rounded-md border border-border"
      data-testid="panel-overview"
    >
      <dl className="divide-y divide-border">
        {fields.map((f) => (
          <div
            key={f.label}
            className="grid grid-cols-3 gap-3 px-4 py-2.5 text-sm"
          >
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd
              className={`col-span-2 ${f.mono ? "font-mono text-xs" : ""}`}
              data-testid={f.testId}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function QualificationsPanel({ equipmentId }: { equipmentId: string }) {
  const { user } = useAuth();
  const canManage = user?.roles?.some((r) => r === "ADMIN" || r === "QA") ?? false;
  const [promoteOpen, setPromoteOpen] = useState(false);

  const { data: quals, isLoading, isError, error } = useQuery<EquipmentQualification[]>({
    queryKey: [`/api/equipment/${equipmentId}/qualifications`],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/equipment/${equipmentId}/qualifications`,
      );
      return res.json();
    },
    enabled: !!equipmentId,
  });

  return (
    <div className="space-y-4" data-testid="panel-qualifications">
      <div className="flex items-center justify-end">
        {canManage && (
          <Button
            onClick={() => setPromoteOpen(true)}
            data-testid="button-promote-qualification"
          >
            <Plus className="mr-1 h-4 w-4" />
            Promote to QUALIFIED
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border" data-testid="table-qualifications">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Valid From</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Signed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {isError && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-destructive">
                  Failed to load qualifications:{" "}
                  {(error as Error)?.message ?? "Unknown error"}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && (quals?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  No qualifications recorded.
                </TableCell>
              </TableRow>
            )}
            {(quals ?? []).map((q) => (
              <TableRow key={q.id} data-testid={`row-qualification-${q.id}`}>
                <TableCell className="font-medium">{q.type}</TableCell>
                <TableCell>
                  <QualStatusBadge status={q.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {q.validFrom ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {q.validUntil ?? "—"}
                </TableCell>
                <TableCell>
                  {q.signatureId ? (
                    <Check
                      className="h-4 w-4 text-emerald-600"
                      data-testid={`signed-qualification-${q.id}`}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && (
        <PromoteQualificationDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          equipmentId={equipmentId}
        />
      )}
    </div>
  );
}

function QualStatusBadge({ status }: { status: EquipmentQualification["status"] }) {
  if (status === "QUALIFIED") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
        QUALIFIED
      </Badge>
    );
  }
  if (status === "EXPIRED") {
    return (
      <Badge variant="destructive" className="text-xs">
        EXPIRED
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      PENDING
    </Badge>
  );
}

const PROMOTE_DEFAULTS: PromoteForm = {
  type: "IQ",
  validFrom: "",
  validUntil: "",
  documentUrl: "",
  notes: "",
  commentary: "",
  signaturePassword: "",
};

function PromoteQualificationDialog({
  open,
  onOpenChange,
  equipmentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentId: string;
}) {
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<PromoteForm>({
    resolver: zodResolver(promoteSchema),
    mode: "onChange",
    defaultValues: PROMOTE_DEFAULTS,
  });

  const promoteMutation = useMutation({
    mutationFn: async (data: PromoteForm) => {
      const payload: Record<string, string> = {
        type: data.type,
        status: "QUALIFIED",
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        signaturePassword: data.signaturePassword,
        commentary: data.commentary,
      };
      if (data.documentUrl && data.documentUrl.trim()) {
        payload.documentUrl = data.documentUrl.trim();
      }
      if (data.notes && data.notes.trim()) {
        payload.notes = data.notes.trim();
      }
      const res = await apiRequest(
        "POST",
        `/api/equipment/${equipmentId}/qualifications`,
        payload,
      );
      return res.json() as Promise<EquipmentQualification>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/equipment/${equipmentId}/qualifications`],
      });
      toast({
        title: "Qualification recorded",
        description: `${created.type} marked QUALIFIED.`,
      });
      form.reset(PROMOTE_DEFAULTS);
      setSubmitError(null);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // apiRequest throws "<status>: <body>". Detect 401 and 423 specifically.
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
        setSubmitError(msg || "Failed to record qualification.");
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset(PROMOTE_DEFAULTS);
          setSubmitError(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Promote to QUALIFIED</DialogTitle>
          <DialogDescription className="text-xs">
            Records an IQ/OQ/PQ qualification event. Your password is required as
            an electronic signature (F-04, 21 CFR §11).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => promoteMutation.mutate(v))}
            className="space-y-3"
            data-testid="form-promote-qualification"
          >
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-qualification-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="IQ">IQ — Installation Qualification</SelectItem>
                      <SelectItem value="OQ">OQ — Operational Qualification</SelectItem>
                      <SelectItem value="PQ">PQ — Performance Qualification</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="validFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid from</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        data-testid="input-valid-from"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="validUntil"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid until</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        data-testid="input-valid-until"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="documentUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document URL (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://…"
                      {...field}
                      data-testid="input-document-url"
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
                      placeholder="Why are you qualifying this equipment?"
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
              <p
                className="text-sm text-destructive"
                data-testid="text-promote-error"
              >
                {submitError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={promoteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={promoteMutation.isPending || !form.formState.isValid}
                data-testid="button-submit-promote"
              >
                {promoteMutation.isPending ? "Signing…" : "Sign & promote"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CalibrationPanel({ equipmentId }: { equipmentId: string }) {
  const { data, isLoading, isError, error } = useQuery<{
    schedule: CalibrationSchedule | null;
    records: CalibrationRecord[];
  }>({
    queryKey: [`/api/equipment/${equipmentId}/calibration`],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/equipment/${equipmentId}/calibration`,
      );
      return res.json();
    },
    enabled: !!equipmentId,
  });

  const records = data?.records ?? [];
  const schedule = data?.schedule;

  return (
    <div className="space-y-4" data-testid="panel-calibration">
      <div className="rounded-md border border-border p-3 text-sm" data-testid="calibration-schedule">
        {schedule ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Schedule:</span>
            <span>Every {schedule.frequencyDays} days</span>
            <span className="text-muted-foreground">·</span>
            <span>
              Next due:{" "}
              <span className="font-mono text-xs">
                {new Date(schedule.nextDueAt).toLocaleDateString()}
              </span>
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            No calibration schedule configured. Schedule + record creation are managed
            from the Equipment → Calibration subtab (Task 12).
          </span>
        )}
      </div>

      <div className="rounded-md border border-border" data-testid="table-calibration-records">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Performed at</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Cert URL</TableHead>
              <TableHead>Signed</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {isError && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-destructive">
                  Failed to load calibration records:{" "}
                  {(error as Error)?.message ?? "Unknown error"}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && records.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  No calibration records.
                </TableCell>
              </TableRow>
            )}
            {records.map((r) => (
              <TableRow key={r.id} data-testid={`row-calibration-${r.id}`}>
                <TableCell className="font-mono text-xs">
                  {new Date(r.performedAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {r.result === "PASS" ? (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
                      PASS
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">
                      FAIL
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {r.certUrl ? (
                    <a
                      href={r.certUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      View
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {r.signatureId ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
