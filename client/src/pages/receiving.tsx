import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ToastAction } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  Clock,
  Package,
  AlertTriangle,
  FileCheck,
  CheckCircle2,
  XCircle,
  Shield,
  Search,
  Loader2,
  Send,
  Save,
  FileText,
  Upload,
  RotateCcw,
} from "lucide-react";
import { formatQty } from "@/lib/formatQty";
import { formatDate, formatDateTime } from "@/lib/formatDate";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import type {
  ReceivingRecordWithDetails,
  CoaDocument,
  PurchaseOrderWithDetails,
  Product,
  Location,
} from "@shared/schema";
import { ReceiveSheet } from "./purchase-orders";
import { ReceivingLabelDrawer, type PrintJob } from "@/components/receiving/ReceivingLabelDrawer";

// ── Identity snapshot helper ──
// visualExamBy and qcReviewedBy are stored as jsonb { userId, fullName, title }
// but may be legacy strings in old rows — handle both gracefully.
function toDisplayName(val: { fullName: string } | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.fullName;
}

// ── QC workflow type labels ──
const WORKFLOW_LABELS: Record<string, string> = {
  FULL_LAB_TEST: "Full Lab Test",
  IDENTITY_CHECK: "Identity Check",
  COA_REVIEW: "COA Review",
  EXEMPT: "Exempt",
};

// ── Status badge ──

function receivingStatusBadge(status: string) {
  switch (status) {
    case "QUARANTINED":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <ShieldAlert className="h-3 w-3 mr-1" />
          Quarantined
        </Badge>
      );
    case "SAMPLING":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <Clock className="h-3 w-3 mr-1" />
          Sampling
        </Badge>
      );
    case "PENDING_QC":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <ClipboardCheck className="h-3 w-3 mr-1" />
          Pending QC
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <ShieldCheck className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    case "ON_HOLD":
      return (
        <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300 border-0 text-xs" data-testid={`badge-status-${status}`}>
          <AlertTriangle className="h-3 w-3 mr-1" />
          On Hold
        </Badge>
      );
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function dispositionLabel(disposition: string) {
  switch (disposition) {
    case "APPROVED": return "Approved";
    case "REJECTED": return "Rejected";
    case "APPROVED_WITH_CONDITIONS": return "Approved with Conditions";
    default: return disposition;
  }
}

// ── List item ──

function ReceivingListItem({
  record,
  isSelected,
  onClick,
}: {
  record: ReceivingRecordWithDetails;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`item-receiving-${record.id}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" data-testid={`text-product-name-${record.id}`}>
              {record.productName}
            </span>
            {receivingStatusBadge(record.status)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            <span className="font-mono" data-testid={`text-lot-number-${record.id}`}>{record.lotNumber}</span>
            {record.productSku && (
              <span className="ml-2 opacity-70">{record.productSku}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-0.5 font-mono" data-testid={`text-unique-id-${record.id}`}>
            {record.uniqueIdentifier}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{record.dateReceived ?? "No date"}</p>
        </div>
      </div>
    </button>
  );
}

// ── Status timeline ──

function StatusTimeline({ record }: { record: ReceivingRecordWithDetails }) {
  const isCOAWorkflow = record.qcWorkflowType !== "EXEMPT";
  const hasCoa = record.coaDocuments.length > 0;

  const baseSteps = [
    {
      label: "Received",
      description: `Quarantined on ${record.dateReceived ?? "unknown date"}`,
      completed: true,
      icon: Package,
    },
    {
      label: "Visual Inspection",
      description: record.visualExamBy
        ? `Inspected by ${
            typeof record.visualExamBy === "object"
              ? `${record.visualExamBy.fullName}${record.visualExamBy.title ? ` (${record.visualExamBy.title})` : ""}`
              : toDisplayName(record.visualExamBy)
          }${record.visualExamAt ? ` on ${formatDate(record.visualExamAt)}` : ""}`
        : "Pending inspection",
      completed: !!record.visualExamBy,
      icon: ClipboardCheck,
    },
  ];

  const coaStep = {
    label: "COA Uploaded",
    description: hasCoa
      ? `${record.coaDocuments[record.coaDocuments.length - 1].fileName ?? "COA"} · ${record.coaDocuments[record.coaDocuments.length - 1].sourceType} · ${record.coaDocuments[record.coaDocuments.length - 1].overallResult}`
      : "Awaiting COA upload",
    completed: hasCoa,
    icon: FileText,
  };

  const signOffStep = {
    label: "QC Sign-off",
    description: record.qcReviewedBy
      ? `${dispositionLabel(record.qcDisposition ?? "")} by ${
          typeof record.qcReviewedBy === "object"
            ? `${record.qcReviewedBy.fullName}${record.qcReviewedBy.title ? ` (${record.qcReviewedBy.title})` : ""}`
            : toDisplayName(record.qcReviewedBy)
        }${record.qcReviewedAt ? ` on ${formatDate(record.qcReviewedAt)}` : ""}`
      : record.status === "PENDING_QC"
      ? "Awaiting QC sign-off"
      : "Not yet submitted",
    completed: !!record.qcReviewedBy,
    icon: Shield,
  };

  const releasedStep = {
    label: "Released",
    description: record.status === "APPROVED"
      ? "Material released for use"
      : record.status === "REJECTED"
      ? "Material rejected"
      : "Pending release",
    completed: record.status === "APPROVED" || record.status === "REJECTED",
    icon: record.status === "REJECTED" ? XCircle : CheckCircle2,
  };

  const steps = isCOAWorkflow
    ? [...baseSteps, coaStep, signOffStep, releasedStep]
    : [...baseSteps, signOffStep, releasedStep];

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const Icon = step.icon;
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.label} className="flex gap-3" data-testid={`timeline-step-${idx}`}>
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-7 h-7 rounded-full border-2 ${
                  step.completed
                    ? "bg-primary/10 border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 min-h-[24px] ${
                    step.completed ? "bg-primary/30" : "bg-border"
                  }`}
                />
              )}
            </div>
            <div className="pb-4">
              <p className={`text-sm font-medium ${step.completed ? "text-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Detail panel ──

function ReceivingDetail({
  record,
  onUpdated,
  onNavigateTo,
}: {
  record: ReceivingRecordWithDetails;
  onUpdated: () => void;
  onNavigateTo: (id: string) => void;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qcReviewRef = useRef<HTMLDivElement>(null);

  // Visual inspection form state
  const [containerOk, setContainerOk] = useState(record.containerConditionOk === "true");
  const [sealsIntact, setSealsIntact] = useState(record.sealsIntact === "true");
  const [labelsMatch, setLabelsMatch] = useState(record.labelsMatch === "true");
  const [invoiceMatch, setInvoiceMatch] = useState(record.invoiceMatchesPo === "true");
  const [examNotes, setExamNotes] = useState(record.visualExamNotes ?? "");

  // QC review form state
  const [qcDisposition, setQcDisposition] = useState<string>("");
  const [qcNotes, setQcNotes] = useState("");
  const [sigOpen, setSigOpen] = useState(false);

  // COA upload state — local copy so we can append on upload without re-fetching
  const [localCoaDocs, setLocalCoaDocs] = useState<CoaDocument[]>(record.coaDocuments);
  const [showCoaUploadForm, setShowCoaUploadForm] = useState(false);
  const [coaFile, setCoaFile] = useState<File | null>(null);
  const [coaSource, setCoaSource] = useState("SUPPLIER");
  const [coaResult, setCoaResult] = useState("");
  const [coaDocNumber, setCoaDocNumber] = useState("");
  const coaFileRef = useRef<HTMLInputElement>(null);

  // Reset form when record changes
  const recordId = record.id;
  useMemo(() => {
    setContainerOk(record.containerConditionOk === "true");
    setSealsIntact(record.sealsIntact === "true");
    setLabelsMatch(record.labelsMatch === "true");
    setInvoiceMatch(record.invoiceMatchesPo === "true");
    setExamNotes(record.visualExamNotes ?? "");
    setQcDisposition("");
    setQcNotes("");
    setLocalCoaDocs(record.coaDocuments);
    setShowCoaUploadForm(false);
    setCoaFile(null);
    setCoaSource("SUPPLIER");
    setCoaResult("");
    setCoaDocNumber("");
  }, [recordId]);

  // Save inspection mutation
  const saveInspection = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/receiving/${record.id}`, {
        containerConditionOk: containerOk ? "true" : "false",
        sealsIntact: sealsIntact ? "true" : "false",
        labelsMatch: labelsMatch ? "true" : "false",
        invoiceMatchesPo: invoiceMatch ? "true" : "false",
        visualExamNotes: examNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inspection saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Submit for QC mutation
  const submitForQc = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/receiving/${record.id}`, {
        status: "PENDING_QC",
        containerConditionOk: containerOk ? "true" : "false",
        sealsIntact: sealsIntact ? "true" : "false",
        labelsMatch: labelsMatch ? "true" : "false",
        invoiceMatchesPo: invoiceMatch ? "true" : "false",
        visualExamNotes: examNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Submitted for QC review" });
      queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // QC review mutation
  const submitQcReview = useMutation({
    mutationFn: async ({ password, commentary }: { password: string; commentary: string }) => {
      const res = await apiRequest("POST", `/api/receiving/${record.id}/qc-review`, {
        disposition: qcDisposition,
        notes: qcNotes || undefined,
        password,
        commentary: commentary || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setSigOpen(false);
      const lotId = record.lotId;
      toast({
        title: "QC review submitted",
        action: (
          <ToastAction altText="View in Inventory" onClick={() => setLocation(`/inventory?lot=${lotId}`)}>
            View in Inventory
          </ToastAction>
        ),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const uploadCoa = useMutation({
    mutationFn: async () => {
      if (!coaFile) throw new Error("No file selected");
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(coaFile);
      });
      const res = await apiRequest("POST", `/api/receiving/${record.id}/coa`, {
        fileData,
        fileName: coaFile.name,
        sourceType: coaSource,
        overallResult: coaResult,
        documentNumber: coaDocNumber || undefined,
      });
      return res.json() as Promise<CoaDocument>;
    },
    onSuccess: (doc) => {
      toast({ title: "COA uploaded" });
      setLocalCoaDocs((prev) => [...prev, doc]);
      setShowCoaUploadForm(false);
      setCoaFile(null);
      setCoaSource("SUPPLIER");
      setCoaResult("");
      setCoaDocNumber("");
      if (coaFileRef.current) coaFileRef.current.value = "";
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const isQuarantined = record.status === "QUARANTINED";
  const isPendingQc = record.status === "PENDING_QC";
  const isReviewed = record.status === "APPROVED" || record.status === "REJECTED";
  const showQcSection = isPendingQc || isReviewed;
  const isCOAWorkflow = record.qcWorkflowType !== "EXEMPT";
  const hasCoa = localCoaDocs.length > 0;
  const latestCoa = localCoaDocs[localCoaDocs.length - 1];

  return (
    <div className="p-5 space-y-6 overflow-y-auto h-full" data-tour="receiving-detail">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-semibold text-foreground" data-testid="text-detail-product-name">
            {record.productName}
          </h2>
          {receivingStatusBadge(record.status)}
        </div>
        <div className="space-y-2 mb-3">
          {/* Qualification banner */}
          {record.requiresQualification && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>New material — QC qualification required before release to inventory</span>
            </div>
          )}
          {/* Workflow type badge */}
          {record.qcWorkflowType && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">QC Workflow:</span>
              <Badge variant="secondary" className="text-xs">
                {WORKFLOW_LABELS[record.qcWorkflowType] ?? record.qcWorkflowType}
              </Badge>
            </div>
          )}
          {/* Z1.4 sampling plan */}
          {record.qcWorkflowType === "FULL_LAB_TEST" && record.samplingPlan && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1" data-tour="receiving-sampling-plan">
              <div className="text-xs font-medium text-foreground">Z1.4 Sampling Plan — AQL 2.5</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground">{record.samplingPlan.sampleSize}</div>
                  <div>Sample size</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">≤{record.samplingPlan.acceptNumber}</div>
                  <div>Accept if defects</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">≥{record.samplingPlan.rejectNumber}</div>
                  <div>Reject if defects</div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">Code {record.samplingPlan.codeLetterLevel2} • Level II Normal</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div>
            <span className="text-muted-foreground">Lot Number:</span>{" "}
            <span className="font-mono font-medium" data-testid="text-detail-lot">{record.lotNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Unique ID:</span>{" "}
            <span className="font-mono font-medium" data-testid="text-detail-uid">{record.uniqueIdentifier}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Date Received:</span>{" "}
            <span data-testid="text-detail-date">{record.dateReceived ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Quantity:</span>{" "}
            <span data-testid="text-detail-qty">
              {record.quantityReceived ? formatQty(record.quantityReceived) : "—"} {record.uom ?? ""}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Supplier:</span>{" "}
            {record.supplierId && record.supplierName ? (
              <span
                className="cursor-pointer hover:underline text-primary"
                onClick={() => { window.location.hash = `#/suppliers?supplier=${record.supplierId}`; }}
                data-testid="text-detail-supplier"
              >
                {record.supplierName}
              </span>
            ) : (
              <span data-testid="text-detail-supplier">{record.supplierName ?? "—"}</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Supplier Lot #:</span>{" "}
            <span className="font-mono" data-testid="text-detail-supplier-lot">{record.supplierLotNumber ?? "—"}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Visual Inspection */}
      <div data-tour="receiving-visual-exam">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          Visual Inspection
        </h3>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              id="container-ok"
              checked={containerOk}
              onCheckedChange={(c) => setContainerOk(c === true)}
              disabled={!isQuarantined}
              data-testid="checkbox-container-ok"
            />
            <Label htmlFor="container-ok" className="text-sm cursor-pointer">
              Container Condition OK
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="seals-intact"
              checked={sealsIntact}
              onCheckedChange={(c) => setSealsIntact(c === true)}
              disabled={!isQuarantined}
              data-testid="checkbox-seals-intact"
            />
            <Label htmlFor="seals-intact" className="text-sm cursor-pointer">
              Seals Intact
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="labels-match"
              checked={labelsMatch}
              onCheckedChange={(c) => setLabelsMatch(c === true)}
              disabled={!isQuarantined}
              data-testid="checkbox-labels-match"
            />
            <Label htmlFor="labels-match" className="text-sm cursor-pointer">
              Labels Match
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="invoice-match"
              checked={invoiceMatch}
              onCheckedChange={(c) => setInvoiceMatch(c === true)}
              disabled={!isQuarantined}
              data-testid="checkbox-invoice-match"
            />
            <Label htmlFor="invoice-match" className="text-sm cursor-pointer">
              Invoice Matches PO
            </Label>
          </div>

          <div className="space-y-1.5 pt-1">
            <Label htmlFor="exam-notes" className="text-sm">Visual Exam Notes</Label>
            <Textarea
              id="exam-notes"
              placeholder="Observations, damage notes, etc."
              value={examNotes}
              onChange={(e) => setExamNotes(e.target.value)}
              disabled={!isQuarantined}
              className="text-sm min-h-[60px]"
              data-testid="textarea-exam-notes"
            />
          </div>
          {isQuarantined && (
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveInspection.mutate()}
                disabled={saveInspection.isPending}
                data-testid="button-save-inspection"
              >
                {saveInspection.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save Inspection
              </Button>
              <Button
                size="sm"
                onClick={() => submitForQc.mutate()}
                disabled={submitForQc.isPending}
                data-testid="button-submit-qc"
              >
                {submitForQc.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                Submit for QC Review
              </Button>
            </div>
          )}
          {(() => {
            const snap = record.visualExamBy;
            if (!snap || typeof snap !== "object") return null;
            return (
              <p className="text-sm text-muted-foreground" data-testid="text-visual-exam-by">
                Inspected by {snap.fullName}{snap.title ? ` (${snap.title})` : ""}
              </p>
            );
          })()}
        </div>
      </div>

      {/* QC Review section */}
      {showQcSection && (
        <>
          <Separator />
          <div data-tour="receiving-qc-review" ref={qcReviewRef}>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              QC Review
            </h3>

            {isReviewed ? (
              // Read-only review summary
              <div className="space-y-3">
                {isCOAWorkflow && latestCoa && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      Certificate of Analysis
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {latestCoa.fileName} · {latestCoa.sourceType} · {latestCoa.overallResult}
                      {latestCoa.documentNumber ? ` · ${latestCoa.documentNumber}` : ""}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Disposition:</span>
                    <Badge
                      className={`text-xs border-0 ${
                        record.qcDisposition === "APPROVED" || record.qcDisposition === "APPROVED_WITH_CONDITIONS"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                      data-testid="text-qc-disposition"
                    >
                      {dispositionLabel(record.qcDisposition ?? "")}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Reviewed By:</span>{" "}
                    <span data-testid="text-qc-reviewer">
                      {record.qcReviewedBy && typeof record.qcReviewedBy === "object"
                        ? `${record.qcReviewedBy.fullName}${record.qcReviewedBy.title ? ` · ${record.qcReviewedBy.title}` : ""}`
                        : toDisplayName(record.qcReviewedBy) || "—"}
                    </span>
                  </div>
                  {record.qcReviewedAt && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Reviewed At:</span>{" "}
                      <span data-testid="text-qc-date">{formatDateTime(record.qcReviewedAt)}</span>
                    </div>
                  )}
                  {record.qcNotes && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Notes:</span>{" "}
                      <span data-testid="text-qc-notes">{record.qcNotes}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // QC review form: COA upload (non-EXEMPT) + sign-off
              <div className="space-y-4">
                {/* Step 1: COA Upload (COA-required workflows only) */}
                {isCOAWorkflow && (
                  <div className="space-y-2" data-testid="coa-upload-section">
                    {hasCoa && !showCoaUploadForm ? (
                      // COA uploaded — summary card
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 flex items-center justify-between" data-testid="coa-summary-card">
                        <div>
                          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            COA Uploaded
                          </p>
                          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                            {latestCoa!.fileName} · {latestCoa!.sourceType} · {latestCoa!.overallResult}
                            {latestCoa!.documentNumber ? ` · ${latestCoa!.documentNumber}` : ""}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 shrink-0"
                          onClick={() => setShowCoaUploadForm(true)}
                          data-testid="button-replace-coa"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Replace
                        </Button>
                      </div>
                    ) : (
                      // COA upload form
                      <div className="rounded-lg border border-border p-3 space-y-2.5" data-testid="coa-upload-form">
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {hasCoa ? "Replace COA" : "Upload COA"} <span className="text-muted-foreground font-normal">(Step 1 of 2)</span>
                        </p>
                        <div className="space-y-1">
                          <Label className="text-xs">PDF File <span className="text-destructive">*</span></Label>
                          <input
                            ref={coaFileRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            className="block w-full text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-border file:text-xs file:bg-muted file:text-foreground cursor-pointer"
                            onChange={(e) => setCoaFile(e.target.files?.[0] ?? null)}
                            data-testid="input-coa-file"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Source <span className="text-destructive">*</span></Label>
                            <Select value={coaSource} onValueChange={setCoaSource}>
                              <SelectTrigger className="text-xs h-8" data-testid="select-coa-source">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="SUPPLIER" disabled={record.requiresQualification ?? false}>
                                  Supplier{record.requiresQualification ? " (first-time: not allowed)" : ""}
                                </SelectItem>
                                <SelectItem value="INTERNAL_LAB">Internal Lab</SelectItem>
                                <SelectItem value="THIRD_PARTY_LAB">Third-Party Lab</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Overall Result <span className="text-destructive">*</span></Label>
                            <Select value={coaResult} onValueChange={setCoaResult}>
                              <SelectTrigger className="text-xs h-8" data-testid="select-coa-result">
                                <SelectValue placeholder="Select…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PASS">Pass</SelectItem>
                                <SelectItem value="FAIL">Fail</SelectItem>
                                <SelectItem value="CONDITIONAL">Conditional</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Document Number (optional)</Label>
                          <Input
                            placeholder="e.g. COA-2024-001"
                            value={coaDocNumber}
                            onChange={(e) => setCoaDocNumber(e.target.value)}
                            className="text-xs h-8"
                            data-testid="input-coa-doc-number"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => uploadCoa.mutate()}
                            disabled={uploadCoa.isPending || !coaFile || !coaResult}
                            data-testid="button-save-coa"
                          >
                            {uploadCoa.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Upload className="h-3 w-3 mr-1" />
                            )}
                            Save COA
                          </Button>
                          {hasCoa && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowCoaUploadForm(false)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: QC Sign-off */}
                <div className={`space-y-3 ${isCOAWorkflow && !hasCoa ? "opacity-40 pointer-events-none" : ""}`} data-testid="qc-signoff-section">
                  {isCOAWorkflow && !hasCoa && (
                    <p className="text-xs text-muted-foreground">Step 2 of 2 — Sign-off <span className="text-muted-foreground/60">🔒 requires COA upload</span></p>
                  )}
                  {record.requiresQualification && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        First-time supplier approval
                      </div>
                      <p className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">
                        <strong>{record.supplierName ?? "This supplier"}</strong> has not previously been approved
                        for <strong>{record.productName}</strong>. Approving will add them to the Approved Materials list.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-sm">QC Disposition</Label>
                    <Select value={qcDisposition} onValueChange={setQcDisposition}>
                      <SelectTrigger className="text-sm" data-testid="select-qc-disposition">
                        <SelectValue placeholder="Select disposition…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="APPROVED">Approved</SelectItem>
                        <SelectItem value="REJECTED">Rejected</SelectItem>
                        <SelectItem value="APPROVED_WITH_CONDITIONS">Approved with Conditions</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">QC Notes</Label>
                    <Textarea
                      placeholder="Optional notes…"
                      value={qcNotes}
                      onChange={(e) => setQcNotes(e.target.value)}
                      className="text-sm min-h-[60px]"
                      data-testid="textarea-qc-notes"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSigOpen(true)}
                    disabled={!qcDisposition || (isCOAWorkflow && !hasCoa)}
                    data-testid="button-submit-qc-review"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Submit QC Review
                  </Button>
                  <SignatureCeremony
                    open={sigOpen}
                    onOpenChange={setSigOpen}
                    entityDescription={`receiving record ${record.uniqueIdentifier}`}
                    meaning="QC_DISPOSITION"
                    isPending={submitQcReview.isPending}
                    onSign={async (password, commentary) => {
                      await submitQcReview.mutateAsync({ password, commentary });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Separator />

      {/* Status Timeline */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Status Timeline
        </h3>
        <StatusTimeline record={{ ...record, coaDocuments: localCoaDocs }} />
      </div>

    </div>
  );
}

// ── Main page ──

export default function Receiving() {
  // Read record ID / PO ID from URL params (hash routing: /#/receiving?record=xxx or ?po=xxx)
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const urlRecordId = searchParams.get("record");
  const urlPoId = searchParams.get("po");

  const [selectedId, setSelectedId] = useState<string | null>(urlRecordId);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [receiveSheetPo, setReceiveSheetPo] = useState<PurchaseOrderWithDetails | null>(null);
  const [receiveSheetOpen, setReceiveSheetOpen] = useState(false);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);

  const { data: records = [], isLoading } = useQuery<ReceivingRecordWithDetails[]>({
    queryKey: ["/api/receiving"],
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Fetch open POs (SUBMITTED or PARTIALLY_RECEIVED)
  const { data: allPOs } = useQuery<PurchaseOrderWithDetails[]>({
    queryKey: ["/api/purchase-orders"],
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const submittedPOs = useMemo(
    () => (allPOs ?? []).filter((po) => po.status === "SUBMITTED" || po.status === "PARTIALLY_RECEIVED"),
    [allPOs],
  );

  // Auto-open ReceiveSheet when navigated from dashboard with ?po=xxx
  useEffect(() => {
    if (!urlPoId || !allPOs) return;
    const po = allPOs.find((p) => p.id === urlPoId);
    if (po) {
      setReceiveSheetPo(po);
      setReceiveSheetOpen(true);
    }
  }, [urlPoId, allPOs]);

  const filteredRecords = useMemo(() => {
    let result = records;
    if (statusFilter !== "ALL") {
      result = result.filter((r) => r.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.productName.toLowerCase().includes(q) ||
          r.lotNumber.toLowerCase().includes(q) ||
          r.uniqueIdentifier.toLowerCase().includes(q) ||
          (r.productSku && r.productSku.toLowerCase().includes(q)) ||
          (r.supplierName && r.supplierName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [records, statusFilter, searchQuery]);

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId]
  );

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
  };

  // Status counts for filter badges
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: records.length };
    for (const r of records) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [records]);

  const totalItems = submittedPOs.length + filteredRecords.length;
  const hasAnyContent = submittedPOs.length > 0 || filteredRecords.length > 0;

  return (
    <div className="flex h-full" data-testid="page-receiving">
      {/* Left panel — list */}
      <div className="w-[380px] shrink-0 border-r border-border flex flex-col bg-card">
        {/* Header & filters */}
        <div className="px-4 pt-4 pb-3 space-y-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-foreground">Receiving & Quarantine</h1>
            <span className="text-xs text-muted-foreground" data-testid="text-total-count">
              {totalItems} item{totalItems !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search materials, lots, IDs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-search"
            />
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-status-filter" data-tour="receiving-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses ({statusCounts.ALL ?? 0})</SelectItem>
              <SelectItem value="QUARANTINED">Quarantined ({statusCounts.QUARANTINED ?? 0})</SelectItem>
              <SelectItem value="PENDING_QC">Pending QC ({statusCounts.PENDING_QC ?? 0})</SelectItem>
              <SelectItem value="APPROVED">Approved ({statusCounts.APPROVED ?? 0})</SelectItem>
              <SelectItem value="REJECTED">Rejected ({statusCounts.REJECTED ?? 0})</SelectItem>
              <SelectItem value="SAMPLING">Sampling ({statusCounts.SAMPLING ?? 0})</SelectItem>
              <SelectItem value="ON_HOLD">On Hold ({statusCounts.ON_HOLD ?? 0})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" data-testid="list-receiving" data-tour="receiving-list">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : !hasAnyContent ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-empty-state">
                No purchase orders or receiving records. Create a PO in the Suppliers tab to get started.
              </p>
            </div>
          ) : (
            <>
              {/* Open POs awaiting receipt */}
              {submittedPOs.length > 0 && (
                <>
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b">
                    Awaiting Receipt ({submittedPOs.length})
                  </div>
                  {submittedPOs.map((po) => (
                    <button
                      key={po.id}
                      className="w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors"
                      onClick={() => { setReceiveSheetPo(po); setReceiveSheetOpen(true); }}
                      data-testid={`item-open-po-${po.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-medium font-mono">{po.poNumber}</span>
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]">
                            {po.status === "PARTIALLY_RECEIVED" ? "Partial" : "Submitted"}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDate(po.orderDate)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{po.supplierName ?? "—"}</p>
                    </button>
                  ))}
                </>
              )}

              {/* Received records */}
              {filteredRecords.length > 0 && (
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b">
                  Received ({filteredRecords.length})
                </div>
              )}
              {filteredRecords.map((r) => (
                <ReceivingListItem
                  key={r.id}
                  record={r}
                  isSelected={selectedId === r.id}
                  onClick={() => setSelectedId(r.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 overflow-hidden bg-background">
        {selectedRecord ? (
          <ReceivingDetail
            key={selectedRecord.id + ":" + selectedRecord.status}
            record={selectedRecord}
            onUpdated={handleUpdated}
            onNavigateTo={(id) => setSelectedId(id)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <ShieldAlert className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-selection">
              Select a receiving record to view details, inspection, and QC review.
            </p>
          </div>
        )}
      </div>

      {receiveSheetPo && (
        <ReceiveSheet
          po={receiveSheetPo}
          open={receiveSheetOpen}
          onOpenChange={(open) => {
            setReceiveSheetOpen(open);
            if (!open) setReceiveSheetPo(null);
          }}
          locations={locations}
          products={products}
          onReceiveComplete={(jobs) => {
            setReceiveSheetOpen(false);
            setReceiveSheetPo(null);
            setPrintJobs(jobs);
          }}
        />
      )}
      <ReceivingLabelDrawer
        jobs={printJobs}
        open={printJobs.length > 0}
        onOpenChange={(open) => { if (!open) setPrintJobs([]); }}
      />
    </div>
  );
}
