import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/formatDate";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { DateInput } from "@/components/ui/date-input";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileCheck,
  FlaskConical,
  Shield,
  Search,
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Download,
  Trash2,
  ArrowLeft,
  FileText,
  Microscope,
  Beaker,
} from "lucide-react";
import type { CoaDocumentWithDetails, Lot } from "@shared/schema";

// ── Types ──

type TestRow = {
  testName: string;
  method: string;
  specification: string;
  result: string;
  passFail: string;
  specVersionId?: string | null;
  specAttributeId?: string | null;
};

type SpecAttribute = {
  id: string;
  name: string;
  category: string;
  specMin: string | null;
  specMax: string | null;
  units: string | null;
  testMethod: string | null;
  sortOrder: number;
};

type ActiveSpec = {
  version: {
    id: string;
    versionNumber: number;
    status: string;
  };
  attributes: SpecAttribute[];
} | null;

type LotOption = Lot & {
  productName: string;
  productSku: string;
};

// ── Source type badge ──

function sourceTypeBadge(sourceType: string) {
  switch (sourceType) {
    case "INTERNAL_LAB":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-[11px]">
          Internal Lab
        </Badge>
      );
    case "THIRD_PARTY_LAB":
      return (
        <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0 text-[11px]">
          Third-Party
        </Badge>
      );
    case "SUPPLIER":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[11px]">
          Supplier
        </Badge>
      );
    default:
      return <Badge variant="secondary" className="text-[11px]">{sourceType}</Badge>;
  }
}

// ── Overall result badge ──

function resultBadge(result: string | null | undefined) {
  switch (result) {
    case "PASS":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[11px]">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Pass
        </Badge>
      );
    case "FAIL":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-[11px]">
          <XCircle className="h-3 w-3 mr-1" />
          Fail
        </Badge>
      );
    case "CONDITIONAL":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[11px]">
          <Clock className="h-3 w-3 mr-1" />
          Conditional
        </Badge>
      );
    default:
      return <Badge variant="secondary" className="text-[11px]">—</Badge>;
  }
}

// ── Parse tests JSON ──

function parseTests(testsPerformed: string | null | undefined): TestRow[] {
  if (!testsPerformed) return [];
  try {
    const parsed = JSON.parse(testsPerformed);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// ── List item ──

function CoaListItem({
  coa,
  isSelected,
  onClick,
}: {
  coa: CoaDocumentWithDetails;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isReviewed = !!coa.qcReviewedBy;

  return (
    <button
      onClick={onClick}
      data-testid={`item-coa-${coa.id}`}
      className={`w-full text-left px-4 pr-5 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate" data-testid={`text-coa-product-${coa.id}`}>
              {coa.productName}
            </span>
            {resultBadge(coa.overallResult)}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono" data-testid={`text-coa-lot-${coa.id}`}>{coa.lotNumber}</span>
          </p>
          {coa.documentNumber && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 font-mono" data-testid={`text-coa-docnum-${coa.id}`}>
              {coa.documentNumber}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {sourceTypeBadge(coa.sourceType)}
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              {isReviewed ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span>QC Reviewed</span>
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 text-amber-500" />
                  <span>Pending QC</span>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{coa.analysisDate ?? "—"}</p>
        </div>
      </div>
    </button>
  );
}

// ── Active Spec Panel (read-only) ──

function ActiveSpecPanel({ spec }: { spec: NonNullable<ActiveSpec> }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Active Specification (v{spec.version.versionNumber})
      </h4>
      {spec.attributes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No attributes defined.</p>
      ) : (
        <div className="rounded border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Attribute</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Min</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Max</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Units</th>
              </tr>
            </thead>
            <tbody>
              {spec.attributes.map((attr) => (
                <tr key={attr.id} className="border-t border-border/50">
                  <td className="px-2 py-1.5 text-muted-foreground font-mono text-[10px]">{attr.category}</td>
                  <td className="px-2 py-1.5 font-medium">{attr.name}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{attr.specMin ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{attr.specMax ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{attr.units ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Detail panel ──

function CoaDetail({
  coa,
  onUpdated,
}: {
  coa: CoaDocumentWithDetails;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const tests = useMemo(() => parseTests(coa.testsPerformed), [coa.testsPerformed]);

  // Fetch active spec if the COA has a product linked
  const { data: activeSpec = null } = useQuery<ActiveSpec>({
    queryKey: ["/api/component-specs/by-product", coa.productId],
    queryFn: () => apiRequest("GET", `/api/component-specs/by-product/${coa.productId}`).then((r) => r.json()),
    enabled: !!coa.productId,
  });

  // QC Review form
  const [reviewNotes, setReviewNotes] = useState("");
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingAccepted, setPendingAccepted] = useState<boolean | null>(null);

  const coaId = coa.id;
  useMemo(() => {
    setReviewNotes("");
  }, [coaId]);

  const submitQcReview = useMutation({
    mutationFn: async ({ accepted, password, commentary }: { accepted: boolean; password: string; commentary: string }) => {
      const res = await apiRequest("POST", `/api/coa/${coa.id}/qc-review`, {
        accepted,
        notes: reviewNotes || undefined,
        password,
        commentary: commentary || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setSigOpen(false);
      toast({ title: "QC review submitted" });
      queryClient.invalidateQueries({ queryKey: ["/api/coa"] });
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isReviewed = !!coa.qcReviewedBy;

  // Download handler
  const handleDownload = useCallback(() => {
    if (!coa.fileData || !coa.fileName) return;

    // Detect mime type from extension
    const ext = coa.fileName.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    const mime = mimeMap[ext] || "application/octet-stream";

    // Create blob from base64
    const byteChars = atob(coa.fileData);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = coa.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [coa.fileData, coa.fileName]);

  return (
    <div className="p-5 space-y-6 overflow-y-auto h-full" data-testid="coa-detail-panel">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-semibold text-foreground" data-testid="text-coa-detail-product">
            {coa.productName}
          </h2>
          {sourceTypeBadge(coa.sourceType)}
          {resultBadge(coa.overallResult)}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div>
            <span className="text-muted-foreground">Lot Number:</span>{" "}
            <span className="font-mono font-medium" data-testid="text-coa-detail-lot">{coa.lotNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Document #:</span>{" "}
            <span className="font-mono font-medium" data-testid="text-coa-detail-docnum">{coa.documentNumber ?? "—"}</span>
          </div>
          {coa.productSku && (
            <div>
              <span className="text-muted-foreground">SKU:</span>{" "}
              <span className="font-mono" data-testid="text-coa-detail-sku">{coa.productSku}</span>
            </div>
          )}
          {coa.supplierName && (
            <div>
              <span className="text-muted-foreground">Supplier:</span>{" "}
              <span data-testid="text-coa-detail-supplier">{coa.supplierName}</span>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Lab Info */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          Lab Information
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div>
            <span className="text-muted-foreground">Lab Name:</span>{" "}
            <span data-testid="text-coa-lab-name">{coa.labName ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Analyst:</span>{" "}
            <span data-testid="text-coa-analyst">{coa.analystName ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Analysis Date:</span>{" "}
            <span data-testid="text-coa-analysis-date">{coa.analysisDate ?? "—"}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Active Specification Panel */}
      {activeSpec && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              Component Specification
            </h3>
            <ActiveSpecPanel spec={activeSpec} />
          </div>
          <Separator />
        </>
      )}

      {/* Test Results Table */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Beaker className="h-4 w-4 text-muted-foreground" />
          Test Results
        </h3>
        {tests.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm" data-testid="table-test-results">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Test Name</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Method</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Specification</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Result</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Pass/Fail</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-border/50"
                    data-testid={`row-test-${idx}`}
                  >
                    <td className="px-3 py-2 font-medium">{test.testName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{test.method}</td>
                    <td className="px-3 py-2 text-muted-foreground">{test.specification}</td>
                    <td className="px-3 py-2">{test.result}</td>
                    <td className="px-3 py-2 text-center">
                      {test.passFail === "PASS" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                      ) : test.passFail === "FAIL" ? (
                        <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-tests">No test results recorded.</p>
        )}
      </div>

      <Separator />

      {/* Identity Testing */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Microscope className="h-4 w-4 text-muted-foreground" />
          Identity Testing
        </h3>
        {coa.identityTestPerformed === "true" ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <div>
              <span className="text-muted-foreground">Identity Test:</span>{" "}
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-[11px]">
                Performed
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Method:</span>{" "}
              <span data-testid="text-coa-identity-method">{coa.identityTestMethod ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Identity Confirmed:</span>{" "}
              {coa.identityConfirmed === "true" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 inline" />
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-identity-test">
            Identity test not performed.
          </p>
        )}
      </div>

      <Separator />

      {/* QC Review */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          QC Review
        </h3>
        {isReviewed ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              {coa.qcAccepted === "true" ? (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[11px]">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Accepted
                </Badge>
              ) : (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0 text-[11px]">
                  <XCircle className="h-3 w-3 mr-1" /> Rejected
                </Badge>
              )}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Reviewed By:</span>{" "}
              <span data-testid="text-coa-qc-reviewer">{coa.qcReviewedBy ?? "—"}</span>
            </div>
            {coa.qcReviewedAt && (
              <div className="text-sm">
                <span className="text-muted-foreground">Reviewed At:</span>{" "}
                <span data-testid="text-coa-qc-date">{formatDateTime(coa.qcReviewedAt)}</span>
              </div>
            )}
            {coa.qcNotes && (
              <div className="text-sm">
                <span className="text-muted-foreground">Notes:</span>{" "}
                <span data-testid="text-coa-qc-notes">{coa.qcNotes}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Notes</Label>
              <Textarea
                placeholder="Optional review notes…"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="text-sm min-h-[60px]"
                data-testid="textarea-coa-qc-notes"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => { setPendingAccepted(true); setSigOpen(true); }}
                data-testid="button-coa-qc-accept"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { setPendingAccepted(false); setSigOpen(true); }}
                data-testid="button-coa-qc-reject"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
            </div>
            <SignatureCeremony
              open={sigOpen}
              onOpenChange={setSigOpen}
              entityDescription={`COA document`}
              meaning="QC_DISPOSITION"
              isPending={submitQcReview.isPending}
              onSign={async (password, commentary) => {
                if (pendingAccepted === null) return;
                await submitQcReview.mutateAsync({ accepted: pendingAccepted, password, commentary });
              }}
            />
          </div>
        )}
      </div>

      {/* Document */}
      {coa.fileName && (
        <>
          <Separator />
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Document
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span data-testid="text-coa-filename">{coa.fileName}</span>
              </div>
              {coa.fileData && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  data-testid="button-coa-download"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Upload COA Dialog ──

function UploadCoaDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();

  // Lot options
  const { data: lotOptions = [] } = useQuery<LotOption[]>({
    queryKey: ["/api/lots"],
    enabled: open,
  });

  // Form state
  const [lotId, setLotId] = useState("");

  // Derive productId from selected lot
  const selectedLot = lotOptions.find((l) => l.id === lotId);
  const productId = selectedLot?.productId ?? null;

  // Fetch active spec for selected product
  const { data: activeSpec = null } = useQuery<ActiveSpec>({
    queryKey: ["/api/component-specs/by-product", productId],
    queryFn: () => apiRequest("GET", `/api/component-specs/by-product/${productId}`).then((r) => r.json()),
    enabled: !!productId && open,
  });
  const [sourceType, setSourceType] = useState("SUPPLIER");
  const [documentNumber, setDocumentNumber] = useState("");
  const [labName, setLabName] = useState("");
  const [analystName, setAnalystName] = useState("");
  const [analysisDate, setAnalysisDate] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileData, setFileData] = useState("");
  const [overallResult, setOverallResult] = useState("");
  const [identityTestPerformed, setIdentityTestPerformed] = useState(false);
  const [identityTestMethod, setIdentityTestMethod] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [tests, setTests] = useState<TestRow[]>([]);

  const resetForm = useCallback(() => {
    setLotId("");
    setSourceType("SUPPLIER");
    setDocumentNumber("");
    setLabName("");
    setAnalystName("");
    setAnalysisDate("");
    setFileName("");
    setFileData("");
    setOverallResult("");
    setIdentityTestPerformed(false);
    setIdentityTestMethod("");
    setIdentityConfirmed(false);
    setTests([]);
  }, []);

  // File handling
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:... prefix to store raw base64
      const base64 = result.split(",")[1] ?? result;
      setFileData(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      setFileData(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  // Test rows management
  const addTestRow = useCallback(() => {
    setTests((prev) => [...prev, { testName: "", method: "", specification: "", result: "", passFail: "PASS" }]);
  }, []);

  const updateTestRow = useCallback((idx: number, field: keyof TestRow, value: string | null | undefined) => {
    setTests((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }, []);

  const removeTestRow = useCallback((idx: number) => {
    setTests((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Save mutation
  const createCoa = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        lotId,
        sourceType,
        documentNumber: documentNumber || undefined,
        labName: labName || undefined,
        analystName: analystName || undefined,
        analysisDate: analysisDate || undefined,
        fileName: fileName || undefined,
        fileData: fileData || undefined,
        overallResult: overallResult || undefined,
        identityTestPerformed: identityTestPerformed ? "true" : "false",
        identityTestMethod: identityTestPerformed ? identityTestMethod || undefined : undefined,
        identityConfirmed: identityTestPerformed ? (identityConfirmed ? "true" : "false") : "false",
        testsPerformed: tests.length > 0 ? JSON.stringify(tests) : undefined,
      };
      const res = await apiRequest("POST", "/api/coa", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "COA created" });
      queryClient.invalidateQueries({ queryKey: ["/api/coa"] });
      resetForm();
      onOpenChange(false);
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload COA
          </DialogTitle>
          <DialogDescription>
            Upload a Certificate of Analysis for a specific lot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Lot selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Lot *</Label>
            <Select value={lotId} onValueChange={setLotId}>
              <SelectTrigger className="text-sm" data-testid="select-coa-lot">
                <SelectValue placeholder="Select a lot…" />
              </SelectTrigger>
              <SelectContent>
                {lotOptions.map((lot) => (
                  <SelectItem key={lot.id} value={lot.id}>
                    {lot.lotNumber} — {lot.productName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Source Type */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Source Type *</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger className="text-sm" data-testid="select-coa-source-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL_LAB">Internal Lab</SelectItem>
                <SelectItem value="THIRD_PARTY_LAB">Third-Party Lab</SelectItem>
                <SelectItem value="SUPPLIER">Supplier</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Document Number */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Document Number</Label>
              <Input
                placeholder="e.g. COA-2024-001"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="text-sm"
                data-testid="input-coa-doc-number"
              />
            </div>

            {/* Analysis Date */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Analysis Date</Label>
              <DateInput
                value={analysisDate}
                onChange={setAnalysisDate}
                className="text-sm"
                data-testid="input-coa-analysis-date"
              />
            </div>

            {/* Lab Name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Lab Name</Label>
              <Input
                placeholder="Laboratory name"
                value={labName}
                onChange={(e) => setLabName(e.target.value)}
                className="text-sm"
                data-testid="input-coa-lab-name"
              />
            </div>

            {/* Analyst Name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Analyst Name</Label>
              <Input
                placeholder="Analyst name"
                value={analystName}
                onChange={(e) => setAnalystName(e.target.value)}
                className="text-sm"
                data-testid="input-coa-analyst-name"
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Document File</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById("coa-file-input")?.click()}
              data-testid="dropzone-coa-file"
            >
              <input
                id="coa-file-input"
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                onChange={handleFileChange}
              />
              {fileName ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileCheck className="h-5 w-5 text-emerald-500" />
                  <span className="font-medium">{fileName}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileName("");
                      setFileData("");
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    Drop a PDF or image here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground/60">PDF, PNG, JPG, GIF, WebP</p>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Active Specification Panel (shown when a lot with an active spec is selected) */}
          {activeSpec && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Active Specification</Label>
              <ActiveSpecPanel spec={activeSpec} />
            </div>
          )}

          {/* Test Results */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">Test Results</Label>
              <Button variant="outline" size="sm" onClick={addTestRow} data-testid="button-add-test-row">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Test
              </Button>
            </div>
            {tests.length > 0 ? (
              <div className="space-y-3">
                {tests.map((test, idx) => (
                  <div
                    key={idx}
                    className={activeSpec
                      ? "grid grid-cols-[1fr_1fr_1fr_1fr_1fr_100px_28px] gap-2 items-end"
                      : "grid grid-cols-[1fr_1fr_1fr_1fr_100px_28px] gap-2 items-end"}
                    data-testid={`test-row-${idx}`}
                  >
                    {/* Spec Attribute dropdown — only when an active spec exists */}
                    {activeSpec && (
                      <div className="space-y-1">
                        {idx === 0 && <Label className="text-xs text-muted-foreground">Spec Attribute</Label>}
                        <Select
                          value={test.specAttributeId ?? "__none__"}
                          onValueChange={(v) => {
                            if (v === "__none__") {
                              updateTestRow(idx, "specAttributeId", null);
                              updateTestRow(idx, "specVersionId", null);
                              return;
                            }
                            const attr = activeSpec.attributes.find((a) => a.id === v);
                            if (!attr) return;
                            setTests((prev) =>
                              prev.map((t, i) => {
                                if (i !== idx) return t;
                                const specStr =
                                  attr.specMin !== null || attr.specMax !== null
                                    ? `${attr.specMin ?? ""}–${attr.specMax ?? ""}`
                                    : t.specification;
                                return {
                                  ...t,
                                  specAttributeId: attr.id,
                                  specVersionId: activeSpec.version.id,
                                  testName: attr.name,
                                  specification: specStr,
                                };
                              })
                            );
                          }}
                        >
                          <SelectTrigger className="text-sm h-8" data-testid={`select-spec-attr-${idx}`}>
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— free text —</SelectItem>
                            {activeSpec.attributes.map((attr) => (
                              <SelectItem key={attr.id} value={attr.id}>
                                {attr.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Test Name</Label>}
                      <Input
                        placeholder="Test name"
                        value={test.testName}
                        onChange={(e) => updateTestRow(idx, "testName", e.target.value)}
                        className="text-sm h-8"
                        data-testid={`input-test-name-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Method</Label>}
                      <Input
                        placeholder="Method"
                        value={test.method}
                        onChange={(e) => updateTestRow(idx, "method", e.target.value)}
                        className="text-sm h-8"
                        data-testid={`input-test-method-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Specification</Label>}
                      <Input
                        placeholder="Spec"
                        value={test.specification}
                        onChange={(e) => updateTestRow(idx, "specification", e.target.value)}
                        className="text-sm h-8"
                        data-testid={`input-test-spec-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Result</Label>}
                      <Input
                        placeholder="Result"
                        value={test.result}
                        onChange={(e) => updateTestRow(idx, "result", e.target.value)}
                        className="text-sm h-8"
                        data-testid={`input-test-result-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Pass/Fail</Label>}
                      <Select
                        value={test.passFail}
                        onValueChange={(v) => updateTestRow(idx, "passFail", v)}
                      >
                        <SelectTrigger className="text-sm h-8" data-testid={`select-test-passfail-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PASS">Pass</SelectItem>
                          <SelectItem value="FAIL">Fail</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeTestRow(idx)}
                      data-testid={`button-remove-test-${idx}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No tests added yet. Click "Add Test" to add rows.</p>
            )}
          </div>

          <Separator />

          {/* Identity Testing */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="identity-test"
                checked={identityTestPerformed}
                onCheckedChange={(c) => setIdentityTestPerformed(c === true)}
                data-testid="checkbox-identity-test"
              />
              <Label htmlFor="identity-test" className="text-sm font-medium cursor-pointer">
                Identity test performed?
              </Label>
            </div>
            {identityTestPerformed && (
              <div className="grid grid-cols-2 gap-4 pl-7">
                <div className="space-y-1.5">
                  <Label className="text-sm">Method</Label>
                  <Input
                    placeholder="e.g. FTIR, HPTLC"
                    value={identityTestMethod}
                    onChange={(e) => setIdentityTestMethod(e.target.value)}
                    className="text-sm"
                    data-testid="input-identity-method"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="identity-confirmed"
                      checked={identityConfirmed}
                      onCheckedChange={(c) => setIdentityConfirmed(c === true)}
                      data-testid="checkbox-identity-confirmed"
                    />
                    <Label htmlFor="identity-confirmed" className="text-sm cursor-pointer">
                      Identity confirmed
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Overall Result */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Overall Result</Label>
            <Select value={overallResult} onValueChange={setOverallResult}>
              <SelectTrigger className="text-sm" data-testid="select-coa-overall-result">
                <SelectValue placeholder="Select result…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PASS">Pass</SelectItem>
                <SelectItem value="FAIL">Fail</SelectItem>
                <SelectItem value="CONDITIONAL">Conditional</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-coa-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => createCoa.mutate()}
              disabled={createCoa.isPending || !lotId}
              data-testid="button-coa-save"
            >
              {createCoa.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <FileCheck className="h-4 w-4 mr-1.5" />
              )}
              Save COA
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──

export default function CoaLibrary() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [resultFilter, setResultFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter !== "ALL") params.set("sourceType", sourceFilter);
    if (resultFilter !== "ALL") params.set("overallResult", resultFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [sourceFilter, resultFilter]);

  const { data: coas = [], isLoading } = useQuery<CoaDocumentWithDetails[]>({
    queryKey: ["/api/coa", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/coa${queryParams}`);
      return res.json();
    },
  });

  // Client-side text search on top of server-side filters
  const filteredCoas = useMemo(() => {
    if (!searchQuery.trim()) return coas;
    const q = searchQuery.toLowerCase();
    return coas.filter(
      (c) =>
        c.productName.toLowerCase().includes(q) ||
        c.lotNumber.toLowerCase().includes(q) ||
        (c.documentNumber && c.documentNumber.toLowerCase().includes(q))
    );
  }, [coas, searchQuery]);

  const selectedCoa = useMemo(
    () => coas.find((c) => c.id === selectedId) ?? null,
    [coas, selectedId]
  );

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/coa"] });
  };

  return (
    <div className="flex h-full" data-testid="page-coa-library">
      {/* Left panel — list */}
      <div className="w-[380px] shrink-0 border-r border-border flex flex-col bg-card">
        {/* Header & filters */}
        <div className="px-4 pt-4 pb-3 space-y-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link href="/receiving">
                <button className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-receiving">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </Link>
              <h1 className="text-base font-semibold text-foreground">COA Library</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground" data-testid="text-coa-count">
                {filteredCoas.length} COA{filteredCoas.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                onClick={() => setUploadOpen(true)}
                data-testid="button-upload-coa"
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload COA
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search products, lots, doc #…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-coa-search"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-coa-source-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sources</SelectItem>
                <SelectItem value="INTERNAL_LAB">Internal Lab</SelectItem>
                <SelectItem value="THIRD_PARTY_LAB">Third-Party Lab</SelectItem>
                <SelectItem value="SUPPLIER">Supplier</SelectItem>
              </SelectContent>
            </Select>

            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-coa-result-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Results</SelectItem>
                <SelectItem value="PASS">Pass</SelectItem>
                <SelectItem value="FAIL">Fail</SelectItem>
                <SelectItem value="CONDITIONAL">Conditional</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" data-testid="list-coa">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : filteredCoas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <FileCheck className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-coa-empty">
                {coas.length === 0
                  ? "No COA documents yet. Upload a Certificate of Analysis to get started."
                  : "No COAs match the current filters."}
              </p>
            </div>
          ) : (
            filteredCoas.map((c) => (
              <CoaListItem
                key={c.id}
                coa={c}
                isSelected={selectedId === c.id}
                onClick={() => setSelectedId(c.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 overflow-hidden bg-background">
        {selectedCoa ? (
          <CoaDetail
            key={selectedCoa.id}
            coa={selectedCoa}
            onUpdated={handleUpdated}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <FileCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground" data-testid="text-coa-no-selection">
              Select a COA document to view details, test results, and QC review.
            </p>
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <UploadCoaDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={handleUpdated}
      />
    </div>
  );
}
