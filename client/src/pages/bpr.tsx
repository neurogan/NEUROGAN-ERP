import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatQty } from "@/lib/formatQty";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ClipboardCheck,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Save,
  Send,
  Beaker,
  Scale,
  FileWarning,
  Sparkles,
  Clock,
  User,
} from "lucide-react";
import type { BprWithDetails, BprStep, BprDeviation, Sop } from "@shared/schema";
import { SignatureCeremony } from "@/components/SignatureCeremony";

// ── Status helpers ──

function bprStatusBadge(status: string) {
  switch (status) {
    case "IN_PROGRESS":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs" data-testid="badge-bpr-status">
          In Progress
        </Badge>
      );
    case "PENDING_QC_REVIEW":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid="badge-bpr-status">
          Pending QC Review
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs" data-testid="badge-bpr-status">
          Approved
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs" data-testid="badge-bpr-status">
          Rejected
        </Badge>
      );
    default:
      return <Badge variant="secondary" className="text-xs" data-testid="badge-bpr-status">{status}</Badge>;
  }
}

function stepStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return <Badge variant="secondary" className="text-xs">Pending</Badge>;
    case "IN_PROGRESS":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs">In Progress</Badge>;
    case "COMPLETED":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">Completed</Badge>;
    case "VERIFIED":
      return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0 text-xs">Verified</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function formatTimestamp(val: string | Date | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Section 1: Header ──

function BprHeader({ bpr, isReadOnly }: { bpr: BprWithDetails; isReadOnly: boolean }) {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-1" data-testid="section-bpr-header">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight" data-testid="text-bpr-batch-number">
          {bpr.batchNumber}
        </h1>
        {bprStatusBadge(bpr.status)}
        {isReadOnly && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">Read-only</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
        {bpr.lotNumber && (
          <span data-testid="text-bpr-lot-number">LOT: <span className="font-mono text-foreground">{bpr.lotNumber}</span></span>
        )}
        <span data-testid="text-bpr-product">
          {bpr.productName} <span className="font-mono">({bpr.productSku})</span>
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap mt-1">
        {bpr.startedAt && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Started: {formatTimestamp(bpr.startedAt)}
          </span>
        )}
        {bpr.completedAt && (
          <span className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Completed: {formatTimestamp(bpr.completedAt)}
          </span>
        )}
        {bpr.mmrId && bpr.mmrVersion != null && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
            onClick={() => setLocation("/operations/mmr")}
            data-testid="link-produced-from-mmr"
          >
            Produced from MMR v{bpr.mmrVersion}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Section 2: Yield Calculator ──

function YieldCalculator({
  bpr,
  isReadOnly,
}: {
  bpr: BprWithDetails;
  isReadOnly: boolean;
}) {
  const { toast } = useToast();
  const [actualYield, setActualYield] = useState(bpr.actualYield ?? "");
  const [minThreshold, setMinThreshold] = useState(bpr.yieldMinThreshold ?? "90");
  const [maxThreshold, setMaxThreshold] = useState(bpr.yieldMaxThreshold ?? "110");

  const theoretical = parseFloat(bpr.theoreticalYield ?? "0");
  const actual = parseFloat(String(actualYield) || "0");
  const yieldPct = theoretical > 0 ? (actual / theoretical) * 100 : 0;
  const minT = parseFloat(String(minThreshold) || "90");
  const maxT = parseFloat(String(maxThreshold) || "110");
  const hasDeviation = yieldPct > 0 && (yieldPct < minT || yieldPct > maxT);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/batch-production-records/${bpr.id}`, {
        actualYield: String(actual),
        yieldPercentage: String(yieldPct.toFixed(2)),
        yieldMinThreshold: String(minT),
        yieldMaxThreshold: String(maxT),
        yieldDeviation: hasDeviation ? "true" : "false",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bpr.id] });
      toast({ title: "Yield data saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save yield", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="section-yield-calculator">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4 text-muted-foreground" />
          Yield Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Theoretical Yield</Label>
            <p className="text-sm font-medium mt-1" data-testid="text-theoretical-yield">
              {theoretical > 0 ? formatQty(theoretical) : "—"}
            </p>
          </div>
          <div>
            <Label htmlFor="actual-yield" className="text-xs text-muted-foreground">
              Actual Yield
            </Label>
            <Input
              id="actual-yield"
              type="number"
              step="any"
              value={actualYield}
              onChange={(e) => setActualYield(e.target.value)}
              disabled={isReadOnly}
              className="mt-1 h-8 text-sm"
              data-testid="input-actual-yield"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Yield %</Label>
            <p
              className={`text-sm font-semibold mt-1 ${
                hasDeviation ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              }`}
              data-testid="text-yield-percentage"
            >
              {yieldPct > 0 ? `${yieldPct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="min-threshold" className="text-xs text-muted-foreground">
                Min %
              </Label>
              <Input
                id="min-threshold"
                type="number"
                step="any"
                value={minThreshold}
                onChange={(e) => setMinThreshold(e.target.value)}
                disabled={isReadOnly}
                className="mt-1 h-8 text-sm"
                data-testid="input-min-threshold"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="max-threshold" className="text-xs text-muted-foreground">
                Max %
              </Label>
              <Input
                id="max-threshold"
                type="number"
                step="any"
                value={maxThreshold}
                onChange={(e) => setMaxThreshold(e.target.value)}
                disabled={isReadOnly}
                className="mt-1 h-8 text-sm"
                data-testid="input-max-threshold"
              />
            </div>
          </div>
        </div>

        {hasDeviation && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-md px-3 py-2" data-testid="alert-yield-deviation">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">
              YIELD DEVIATION — Investigation required
            </span>
          </div>
        )}

        {!isReadOnly && (
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            size="sm"
            data-testid="button-save-yield"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save Yield"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 3: Equipment & Cleaning ──

function EquipmentCleaning({
  bpr,
  isReadOnly,
}: {
  bpr: BprWithDetails;
  isReadOnly: boolean;
}) {
  const { toast } = useToast();
  const [processingLines, setProcessingLines] = useState(bpr.processingLines ?? "");
  const [cleaningVerified, setCleaningVerified] = useState(bpr.cleaningVerified === "true");
  const [cleaningVerifiedBy, setCleaningVerifiedBy] = useState(bpr.cleaningVerifiedBy ?? "");
  const [cleaningRecordRef, setCleaningRecordRef] = useState(bpr.cleaningRecordLegacyText ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/batch-production-records/${bpr.id}`, {
        processingLines,
        cleaningVerified: cleaningVerified ? "true" : "false",
        cleaningVerifiedBy: cleaningVerified ? cleaningVerifiedBy : null,
        cleaningVerifiedAt: cleaningVerified ? new Date().toISOString() : null,
        cleaningRecordLegacyText: cleaningRecordRef || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bpr.id] });
      toast({ title: "Equipment & cleaning saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="section-equipment-cleaning">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Equipment &amp; Cleaning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="processing-lines" className="text-xs text-muted-foreground">
              Processing Lines
            </Label>
            <Input
              id="processing-lines"
              value={processingLines}
              onChange={(e) => setProcessingLines(e.target.value)}
              disabled={isReadOnly}
              className="mt-1 h-8 text-sm"
              placeholder="e.g. Line 1, Line 2"
              data-testid="input-processing-lines"
            />
          </div>
          <div>
            <Label htmlFor="cleaning-record-ref" className="text-xs text-muted-foreground">
              Cleaning Record Reference
            </Label>
            <Input
              id="cleaning-record-ref"
              value={cleaningRecordRef}
              onChange={(e) => setCleaningRecordRef(e.target.value)}
              disabled={isReadOnly}
              className="mt-1 h-8 text-sm"
              placeholder="Cross-reference ID"
              data-testid="input-cleaning-record-ref"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="cleaning-verified"
            checked={cleaningVerified}
            onCheckedChange={(checked) => setCleaningVerified(!!checked)}
            disabled={isReadOnly}
            data-testid="checkbox-cleaning-verified"
          />
          <Label htmlFor="cleaning-verified" className="text-sm cursor-pointer">
            Cleaning Verified
          </Label>
        </div>

        {cleaningVerified && (
          <div className="max-w-xs">
            <Label htmlFor="cleaning-verified-by" className="text-xs text-muted-foreground">
              Verified By <span className="text-red-500">*</span>
            </Label>
            <Input
              id="cleaning-verified-by"
              value={cleaningVerifiedBy}
              onChange={(e) => setCleaningVerifiedBy(e.target.value)}
              disabled={isReadOnly}
              className="mt-1 h-8 text-sm"
              placeholder="Name"
              data-testid="input-cleaning-verified-by"
            />
          </div>
        )}

        {!isReadOnly && (
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (cleaningVerified && !cleaningVerifiedBy.trim())}
            size="sm"
            data-testid="button-save-equipment"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 4: Production Steps ──

function DualVerificationField({
  label,
  value,
  onChange,
  compareValue,
  compareName,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  compareValue: string;
  compareName: string;
  disabled: boolean;
  testId: string;
}) {
  const hasError = value.trim() !== "" && compareValue.trim() !== "" && value.trim().toLowerCase() === compareValue.trim().toLowerCase();

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`mt-1 h-7 text-xs ${hasError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
        placeholder="Name"
        data-testid={testId}
      />
      {hasError && (
        <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5" data-testid={`${testId}-error`}>
          {label} must be different from {compareName}
        </p>
      )}
    </div>
  );
}

function StepCard({
  step,
  bprId,
  isReadOnly,
}: {
  step: BprStep;
  bprId: string;
  isReadOnly: boolean;
}) {
  const { toast } = useToast();
  const [performedBy, setPerformedBy] = useState(step.performedBy ?? "");
  const [verifiedBy, setVerifiedBy] = useState(step.verifiedBy ?? "");
  const [weighedBy, setWeighedBy] = useState(step.weighedBy ?? "");
  const [weightVerifiedBy, setWeightVerifiedBy] = useState(step.weightVerifiedBy ?? "");
  const [addedBy, setAddedBy] = useState(step.addedBy ?? "");
  const [additionVerifiedBy, setAdditionVerifiedBy] = useState(step.additionVerifiedBy ?? "");
  const [actualWeight, setActualWeight] = useState(step.actualWeightMeasure ?? "");
  const [monitoringResults, setMonitoringResults] = useState(step.monitoringResults ?? "");
  const [testResults, setTestResults] = useState(step.testResults ?? "");
  const [testReference, setTestReference] = useState(step.testReference ?? "");
  const [notes, setNotes] = useState(step.notes ?? "");
  const [sopKey, setSopKey] = useState(
    step.sopCode && step.sopVersion ? `${step.sopCode}::${step.sopVersion}` : "",
  );

  const hasComponent = !!step.componentId;

  const { data: allSops } = useQuery<Sop[]>({
    queryKey: ["/api/sops"],
    queryFn: async () => (await apiRequest("GET", "/api/sops")).json(),
    enabled: !isReadOnly,
  });
  const approvedSops = (allSops ?? []).filter((s) => s.status === "APPROVED");

  // Dual verification checks
  const performVerifyConflict = performedBy.trim() !== "" && verifiedBy.trim() !== "" && performedBy.trim().toLowerCase() === verifiedBy.trim().toLowerCase();
  const weighVerifyConflict = weighedBy.trim() !== "" && weightVerifiedBy.trim() !== "" && weighedBy.trim().toLowerCase() === weightVerifiedBy.trim().toLowerCase();
  const addVerifyConflict = addedBy.trim() !== "" && additionVerifiedBy.trim() !== "" && addedBy.trim().toLowerCase() === additionVerifiedBy.trim().toLowerCase();
  const hasAnyConflict = performVerifyConflict || weighVerifyConflict || addVerifyConflict;

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/batch-production-records/${bprId}/steps/${step.id}`, {
        performedBy: performedBy || null,
        performedAt: performedBy && !step.performedAt ? new Date().toISOString() : step.performedAt,
        verifiedBy: verifiedBy || null,
        verifiedAt: verifiedBy && !step.verifiedAt ? new Date().toISOString() : step.verifiedAt,
        actualWeightMeasure: actualWeight || null,
        weighedBy: weighedBy || null,
        weightVerifiedBy: weightVerifiedBy || null,
        addedBy: addedBy || null,
        additionVerifiedBy: additionVerifiedBy || null,
        monitoringResults: monitoringResults || null,
        testResults: testResults || null,
        testReference: testReference || null,
        notes: notes || null,
        status: verifiedBy ? "VERIFIED" : performedBy ? "COMPLETED" : "IN_PROGRESS",
        sopCode: sopKey ? sopKey.split("::")[0] ?? null : null,
        sopVersion: sopKey ? sopKey.split("::")[1] ?? null : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bprId] });
      toast({ title: `Step ${step.stepNumber} saved` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save step", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="border border-border rounded-lg p-4 space-y-3"
      data-testid={`card-step-${step.id}`}
    >
      {/* Step header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
            {step.stepNumber}
          </span>
          <span className="text-sm font-medium truncate" data-testid={`text-step-desc-${step.id}`}>
            {step.stepDescription}
          </span>
        </div>
        {stepStatusBadge(step.status)}
      </div>

      {/* Perform & Verify */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DualVerificationField
          label="Performed By"
          value={performedBy}
          onChange={setPerformedBy}
          compareValue={verifiedBy}
          compareName="Verified By"
          disabled={isReadOnly}
          testId={`input-performed-by-${step.id}`}
        />
        <div>
          <Label className="text-xs text-muted-foreground">Performed At</Label>
          <p className="text-xs mt-2 text-muted-foreground">
            {step.performedAt ? formatTimestamp(step.performedAt) : performedBy ? "On save" : "—"}
          </p>
        </div>
        <DualVerificationField
          label="Verified By"
          value={verifiedBy}
          onChange={setVerifiedBy}
          compareValue={performedBy}
          compareName="Performed By"
          disabled={isReadOnly}
          testId={`input-verified-by-${step.id}`}
        />
        <div>
          <Label className="text-xs text-muted-foreground">Verified At</Label>
          <p className="text-xs mt-2 text-muted-foreground">
            {step.verifiedAt ? formatTimestamp(step.verifiedAt) : verifiedBy ? "On save" : "—"}
          </p>
        </div>
      </div>

      {/* Component info */}
      {hasComponent && (
        <>
          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Component Weighing</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Target Weight</Label>
                <p className="text-sm mt-1">{step.targetWeightMeasure ? `${formatQty(step.targetWeightMeasure)} ${step.uom ?? ""}` : "—"}</p>
              </div>
              <div>
                <Label htmlFor={`actual-weight-${step.id}`} className="text-xs text-muted-foreground">Actual Weight</Label>
                <Input
                  id={`actual-weight-${step.id}`}
                  type="number"
                  step="any"
                  value={actualWeight}
                  onChange={(e) => setActualWeight(e.target.value)}
                  disabled={isReadOnly}
                  className="mt-1 h-7 text-xs"
                  data-testid={`input-actual-weight-${step.id}`}
                />
              </div>
              <DualVerificationField
                label="Weighed By"
                value={weighedBy}
                onChange={setWeighedBy}
                compareValue={weightVerifiedBy}
                compareName="Weight Verified By"
                disabled={isReadOnly}
                testId={`input-weighed-by-${step.id}`}
              />
              <DualVerificationField
                label="Weight Verified By"
                value={weightVerifiedBy}
                onChange={setWeightVerifiedBy}
                compareValue={weighedBy}
                compareName="Weighed By"
                disabled={isReadOnly}
                testId={`input-weight-verified-by-${step.id}`}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <DualVerificationField
                label="Added By"
                value={addedBy}
                onChange={setAddedBy}
                compareValue={additionVerifiedBy}
                compareName="Addition Verified By"
                disabled={isReadOnly}
                testId={`input-added-by-${step.id}`}
              />
              <DualVerificationField
                label="Addition Verified By"
                value={additionVerifiedBy}
                onChange={setAdditionVerifiedBy}
                compareValue={addedBy}
                compareName="Added By"
                disabled={isReadOnly}
                testId={`input-addition-verified-by-${step.id}`}
              />
            </div>
          </div>
        </>
      )}

      {/* Results & notes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Monitoring Results</Label>
          <Textarea
            value={monitoringResults}
            onChange={(e) => setMonitoringResults(e.target.value)}
            disabled={isReadOnly}
            className="mt-1 text-xs min-h-[56px]"
            rows={2}
            data-testid={`input-monitoring-results-${step.id}`}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Test Results</Label>
          <Textarea
            value={testResults}
            onChange={(e) => setTestResults(e.target.value)}
            disabled={isReadOnly}
            className="mt-1 text-xs min-h-[56px]"
            rows={2}
            data-testid={`input-test-results-${step.id}`}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Test Reference</Label>
          <Input
            value={testReference}
            onChange={(e) => setTestReference(e.target.value)}
            disabled={isReadOnly}
            className="mt-1 h-7 text-xs"
            data-testid={`input-test-reference-${step.id}`}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isReadOnly}
          className="mt-1 text-xs min-h-[56px]"
          rows={2}
          data-testid={`input-step-notes-${step.id}`}
        />
      </div>

      {/* SOP citation */}
      {!isReadOnly && (
        <div>
          <Label className="text-xs text-muted-foreground">Referenced SOP (optional)</Label>
          <Select
            value={sopKey}
            onValueChange={setSopKey}
          >
            <SelectTrigger className="mt-1 h-7 text-xs" data-testid={`select-sop-${step.id}`}>
              <SelectValue placeholder="— None —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— None —</SelectItem>
              {approvedSops.map((s) => (
                <SelectItem key={s.id} value={`${s.code}::${s.version}`}>
                  {s.code} v{s.version} — {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {isReadOnly && (step.sopCode) && (
        <div>
          <Label className="text-xs text-muted-foreground">Referenced SOP</Label>
          <p className="text-xs mt-1 font-mono" data-testid={`text-sop-${step.id}`}>{step.sopCode} v{step.sopVersion}</p>
        </div>
      )}

      {/* Save button */}
      {!isReadOnly && (
        <div className="flex justify-end">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || hasAnyConflict}
            size="sm"
            variant="outline"
            data-testid={`button-save-step-${step.id}`}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {updateMutation.isPending ? "Saving..." : "Save Step"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ProductionSteps({
  bpr,
  isReadOnly,
}: {
  bpr: BprWithDetails;
  isReadOnly: boolean;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [newStepNumber, setNewStepNumber] = useState("");
  const [newStepDesc, setNewStepDesc] = useState("");

  const sortedSteps = useMemo(
    () => [...bpr.steps].sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber)),
    [bpr.steps]
  );

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/batch-production-records/${bpr.id}/steps`, {
        bprId: bpr.id,
        stepNumber: newStepNumber,
        stepDescription: newStepDesc,
        status: "PENDING",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bpr.id] });
      setAddOpen(false);
      setNewStepNumber("");
      setNewStepDesc("");
      toast({ title: "Step added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add step", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="section-production-steps">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Beaker className="h-4 w-4 text-muted-foreground" />
            Production Steps
            <Badge variant="secondary" className="text-xs ml-1">{sortedSteps.length}</Badge>
          </CardTitle>
          {!isReadOnly && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} data-testid="button-add-step">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Step
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedSteps.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No steps recorded yet</p>
        ) : (
          sortedSteps.map((step) => (
            <StepCard key={step.id} step={step} bprId={bpr.id} isReadOnly={isReadOnly} />
          ))
        )}
      </CardContent>

      {/* Add Step Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-step">
          <DialogHeader>
            <DialogTitle>Add Production Step</DialogTitle>
            <DialogDescription>Define a new step in the batch production record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="new-step-number" className="text-sm">
                Step Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="new-step-number"
                type="number"
                step="1"
                value={newStepNumber}
                onChange={(e) => setNewStepNumber(e.target.value)}
                className="mt-1"
                placeholder="e.g. 1"
                data-testid="input-new-step-number"
              />
            </div>
            <div>
              <Label htmlFor="new-step-desc" className="text-sm">
                Description <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="new-step-desc"
                value={newStepDesc}
                onChange={(e) => setNewStepDesc(e.target.value)}
                className="mt-1"
                placeholder="Describe this production step"
                data-testid="input-new-step-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add-step">
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !newStepNumber || !newStepDesc.trim()}
              data-testid="button-confirm-add-step"
            >
              {addMutation.isPending ? "Adding..." : "Add Step"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Section 5: Deviations ──

function DeviationItem({ deviation }: { deviation: BprDeviation }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3" data-testid={`card-deviation-${deviation.id}`}>
      <div className="flex items-start gap-2">
        <FileWarning className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium" data-testid={`text-deviation-desc-${deviation.id}`}>
            {deviation.deviationDescription}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reported by {deviation.reportedBy ?? "—"} on {formatTimestamp(deviation.reportedAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {deviation.investigation && (
          <div>
            <span className="text-xs text-muted-foreground">Investigation</span>
            <p className="mt-0.5">{deviation.investigation}</p>
          </div>
        )}
        {deviation.impactEvaluation && (
          <div>
            <span className="text-xs text-muted-foreground">Impact Evaluation</span>
            <p className="mt-0.5">{deviation.impactEvaluation}</p>
          </div>
        )}
        {deviation.correctiveActions && (
          <div>
            <span className="text-xs text-muted-foreground">Corrective Actions</span>
            <p className="mt-0.5">{deviation.correctiveActions}</p>
          </div>
        )}
        {deviation.preventiveActions && (
          <div>
            <span className="text-xs text-muted-foreground">Preventive Actions</span>
            <p className="mt-0.5">{deviation.preventiveActions}</p>
          </div>
        )}
        {deviation.disposition && (
          <div>
            <span className="text-xs text-muted-foreground">Disposition</span>
            <p className="mt-0.5">{deviation.disposition}</p>
          </div>
        )}
        {deviation.scientificRationale && (
          <div>
            <span className="text-xs text-muted-foreground">Scientific Rationale</span>
            <p className="mt-0.5">{deviation.scientificRationale}</p>
          </div>
        )}
      </div>

      {(deviation.reviewedBy || deviation.reviewedAt) && (
        <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
          Reviewed by {deviation.reviewedBy ?? "—"} on {formatTimestamp(deviation.reviewedAt)}
          {deviation.signatureOfReviewer && ` — Signature: ${deviation.signatureOfReviewer}`}
        </div>
      )}
    </div>
  );
}

function Deviations({
  bpr,
  isReadOnly,
}: {
  bpr: BprWithDetails;
  isReadOnly: boolean;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    deviationDescription: "",
    investigation: "",
    impactEvaluation: "",
    correctiveActions: "",
    preventiveActions: "",
    disposition: "",
    scientificRationale: "",
    reportedBy: "",
  });

  const updateField = (key: string, val: string) => setForm((prev) => ({ ...prev, [key]: val }));

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/batch-production-records/${bpr.id}/deviations`, {
        bprId: bpr.id,
        deviationDescription: form.deviationDescription,
        investigation: form.investigation || null,
        impactEvaluation: form.impactEvaluation || null,
        correctiveActions: form.correctiveActions || null,
        preventiveActions: form.preventiveActions || null,
        disposition: form.disposition || null,
        scientificRationale: form.scientificRationale || null,
        reportedBy: form.reportedBy || null,
        reportedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bpr.id] });
      setAddOpen(false);
      setForm({
        deviationDescription: "",
        investigation: "",
        impactEvaluation: "",
        correctiveActions: "",
        preventiveActions: "",
        disposition: "",
        scientificRationale: "",
        reportedBy: "",
      });
      toast({ title: "Deviation recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record deviation", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="section-deviations">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Deviations
            <Badge variant="secondary" className="text-xs ml-1">{bpr.deviations.length}</Badge>
          </CardTitle>
          {!isReadOnly && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} data-testid="button-record-deviation">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Record Deviation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {bpr.deviations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No deviations recorded</p>
        ) : (
          bpr.deviations.map((d) => <DeviationItem key={d.id} deviation={d} />)
        )}
      </CardContent>

      {/* Record Deviation Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-record-deviation">
          <DialogHeader>
            <DialogTitle>Record Deviation</DialogTitle>
            <DialogDescription>Document the deviation per 21 CFR Part 111, Sec. 111.140(b)(3).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm">
                Deviation Description <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={form.deviationDescription}
                onChange={(e) => updateField("deviationDescription", e.target.value)}
                className="mt-1"
                rows={3}
                data-testid="input-deviation-description"
              />
            </div>
            <div>
              <Label className="text-sm">Investigation</Label>
              <Textarea
                value={form.investigation}
                onChange={(e) => updateField("investigation", e.target.value)}
                className="mt-1"
                rows={2}
                data-testid="input-deviation-investigation"
              />
            </div>
            <div>
              <Label className="text-sm">Impact Evaluation</Label>
              <Textarea
                value={form.impactEvaluation}
                onChange={(e) => updateField("impactEvaluation", e.target.value)}
                className="mt-1"
                rows={2}
                data-testid="input-deviation-impact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Corrective Actions</Label>
                <Textarea
                  value={form.correctiveActions}
                  onChange={(e) => updateField("correctiveActions", e.target.value)}
                  className="mt-1"
                  rows={2}
                  data-testid="input-deviation-corrective"
                />
              </div>
              <div>
                <Label className="text-sm">Preventive Actions</Label>
                <Textarea
                  value={form.preventiveActions}
                  onChange={(e) => updateField("preventiveActions", e.target.value)}
                  className="mt-1"
                  rows={2}
                  data-testid="input-deviation-preventive"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Disposition</Label>
              <Input
                value={form.disposition}
                onChange={(e) => updateField("disposition", e.target.value)}
                className="mt-1"
                data-testid="input-deviation-disposition"
              />
            </div>
            <div>
              <Label className="text-sm">Scientific Rationale</Label>
              <Textarea
                value={form.scientificRationale}
                onChange={(e) => updateField("scientificRationale", e.target.value)}
                className="mt-1"
                rows={2}
                data-testid="input-deviation-rationale"
              />
            </div>
            <div>
              <Label className="text-sm">Reported By</Label>
              <Input
                value={form.reportedBy}
                onChange={(e) => updateField("reportedBy", e.target.value)}
                className="mt-1"
                placeholder="Name"
                data-testid="input-deviation-reported-by"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-deviation">
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !form.deviationDescription.trim()}
              data-testid="button-confirm-deviation"
            >
              {addMutation.isPending ? "Saving..." : "Record Deviation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Section 6: QC Review ──

function QcReview({
  bpr,
}: {
  bpr: BprWithDetails;
}) {
  const { toast } = useToast();
  const [disposition, setDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [sigOpen, setSigOpen] = useState(false);

  const isReviewable = bpr.status === "PENDING_QC_REVIEW";
  const isReviewed = bpr.status === "APPROVED" || bpr.status === "REJECTED";

  const submitMutation = useMutation({
    mutationFn: async ({ password, commentary }: { password: string; commentary: string }) => {
      await apiRequest("POST", `/api/batch-production-records/${bpr.id}/qc-review`, {
        disposition,
        notes: notes || undefined,
        password,
        commentary: commentary || undefined,
      });
    },
    onSuccess: () => {
      setSigOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bpr.id] });
      toast({ title: "QC review submitted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit review", description: err.message, variant: "destructive" });
    },
  });

  if (!isReviewable && !isReviewed) return null;

  return (
    <Card data-testid="section-qc-review">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          QC Review
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isReviewed ? (
          <div className="space-y-3" data-testid="qc-review-readonly">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Disposition</span>
                <p className="font-medium mt-0.5" data-testid="text-qc-disposition">
                  {bpr.qcDisposition === "APPROVED_FOR_DISTRIBUTION" && (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="h-3.5 w-3.5" /> Approved for Distribution
                    </span>
                  )}
                  {bpr.qcDisposition === "REJECTED" && (
                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="h-3.5 w-3.5" /> Rejected
                    </span>
                  )}
                  {bpr.qcDisposition === "REPROCESS" && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Reprocess
                    </span>
                  )}
                  {!bpr.qcDisposition && "—"}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Reviewed By</span>
                <p className="font-medium mt-0.5 flex items-center gap-1" data-testid="text-qc-reviewed-by">
                  <User className="h-3 w-3 text-muted-foreground" />
                  {bpr.qcReviewedBy ?? "—"}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Review Date</span>
                <p className="font-medium mt-0.5" data-testid="text-qc-reviewed-at">
                  {formatTimestamp(bpr.qcReviewedAt)}
                </p>
              </div>
            </div>
            {bpr.qcNotes && (
              <div>
                <span className="text-xs text-muted-foreground">Notes</span>
                <p className="text-sm mt-0.5" data-testid="text-qc-notes">{bpr.qcNotes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4" data-testid="qc-review-form">
            <div className="max-w-xs">
              <Label className="text-sm">
                Disposition <span className="text-red-500">*</span>
              </Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger className="mt-1" data-testid="select-qc-disposition">
                  <SelectValue placeholder="Select disposition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED_FOR_DISTRIBUTION">Approved for Distribution</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="REPROCESS">Reprocess</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="qc-notes" className="text-sm">Notes</Label>
              <Textarea
                id="qc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                rows={3}
                placeholder="Optional review notes"
                data-testid="input-qc-notes"
              />
            </div>
            <Button
              onClick={() => setSigOpen(true)}
              disabled={!disposition}
              data-testid="button-submit-qc-review"
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
              Submit QC Review
            </Button>
            <SignatureCeremony
              open={sigOpen}
              onOpenChange={setSigOpen}
              entityDescription={`BPR ${bpr.batchNumber}`}
              meaning="QC_DISPOSITION"
              isPending={submitMutation.isPending}
              onSign={async (password, commentary) => {
                await submitMutation.mutateAsync({ password, commentary });
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main BPR Detail Page ──

export default function BprDetail() {
  const [, params] = useRoute("/bpr/:id");
  const bprId = params?.id;
  const { toast } = useToast();

  const {
    data: bpr,
    isLoading,
    error,
  } = useQuery<BprWithDetails>({
    queryKey: ["/api/batch-production-records", bprId],
    enabled: !!bprId,
  });

  const submitForReviewMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/batch-production-records/${bprId}/submit-for-review`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batch-production-records", bprId] });
      toast({ title: "Submitted for QC review" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto" data-testid="bpr-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !bpr) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="bpr-error">
        <Link href="/production">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4" data-testid="link-back-error">
            <ArrowLeft className="h-4 w-4" />
            Back to Production
          </button>
        </Link>
        <Card>
          <CardContent className="p-8 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {error ? `Error: ${(error as Error).message}` : "Batch Production Record not found."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isReadOnly = bpr.status === "APPROVED" || bpr.status === "REJECTED";
  const isInProgress = bpr.status === "IN_PROGRESS";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 pb-12" data-testid="page-bpr-detail">
      {/* Back link */}
      <Link href="/production">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back">
          <ArrowLeft className="h-4 w-4" />
          Back to Production
        </button>
      </Link>

      {/* Header + Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <BprHeader bpr={bpr} isReadOnly={isReadOnly} />

        <div className="flex items-center gap-2 shrink-0">
          {isInProgress && (
            <Button
              onClick={() => submitForReviewMutation.mutate()}
              disabled={submitForReviewMutation.isPending}
              data-testid="button-submit-for-review"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {submitForReviewMutation.isPending ? "Submitting..." : "Submit for QC Review"}
            </Button>
          )}
          {bpr.status === "APPROVED" && (
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-sm" data-testid="text-approved-label">
              <CheckCircle className="h-4 w-4" />
              APPROVED
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Section 2: Yield Calculator */}
      <YieldCalculator bpr={bpr} isReadOnly={isReadOnly} />

      {/* Section 3: Equipment & Cleaning */}
      <EquipmentCleaning bpr={bpr} isReadOnly={isReadOnly} />

      {/* Section 4: Production Steps */}
      <ProductionSteps bpr={bpr} isReadOnly={isReadOnly} />

      {/* Section 5: Deviations */}
      <Deviations bpr={bpr} isReadOnly={isReadOnly} />

      {/* Section 6: QC Review */}
      <QcReview bpr={bpr} />
    </div>
  );
}
