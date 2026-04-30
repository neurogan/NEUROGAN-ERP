import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, ArrowLeft, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import type {
  ComponentSpecWithVersions,
  ComponentSpecVersionWithAttributes,
  SpecAttributeCategory,
  SpecVerificationSource,
  SpecFrequency,
  SpecResultType,
} from "@shared/schema";

// ── Constants ────────────────────────────────────────────────

const ATTRIBUTE_CATEGORIES: SpecAttributeCategory[] = [
  "IDENTITY",
  "ASSAY",
  "HEAVY_METAL",
  "MICROBIAL",
  "PHYSICAL",
  "BOTANICAL_CONTAMINANT",
  "RESIDUAL_SOLVENT",
  "MATERIAL_DECLARATION",
  "OTHER",
];

const CATEGORY_LABELS: Record<string, string> = {
  IDENTITY: "Identity",
  ASSAY: "Assay",
  HEAVY_METAL: "Heavy Metals",
  MICROBIAL: "Microbial",
  PHYSICAL: "Physical",
  BOTANICAL_CONTAMINANT: "Botanical Contaminants",
  RESIDUAL_SOLVENT: "Residual Solvents",
  MATERIAL_DECLARATION: "Material Declarations",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  IDENTITY: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  ASSAY: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  HEAVY_METAL: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  MICROBIAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  PHYSICAL: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  BOTANICAL_CONTAMINANT: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400",
  RESIDUAL_SOLVENT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  MATERIAL_DECLARATION: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  OTHER: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const VERIFICATION_SOURCE_LABELS: Record<string, string> = {
  NEUROGAN_IN_HOUSE: "In-House",
  SUPPLIER_COA: "Supplier COA",
  THIRD_PARTY_LAB: "3rd-Party Lab",
  SUPPLIER_DECLARATION: "Supplier Decl.",
};

const FREQUENCY_LABELS: Record<string, string> = {
  EVERY_LOT: "Every Lot",
  ANNUAL: "Annual",
  PERIODIC: "Periodic",
};

const RESULT_TYPE_LABELS: Record<string, string> = {
  NUMERIC: "Numeric",
  PASS_FAIL: "Pass/Fail",
  TEXT: "Text",
};

// ── Helpers ──────────────────────────────────────────────────

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    DRAFT: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    SUPERSEDED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <Badge className={`text-xs ${variants[status] ?? ""}`}>{status}</Badge>
  );
}

function categoryBadge(category: string) {
  return (
    <Badge className={`text-xs ${CATEGORY_COLORS[category] ?? CATEGORY_COLORS.OTHER}`}>
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

// ── New attribute row type ───────────────────────────────────

interface NewAttributeRow {
  category: SpecAttributeCategory;
  name: string;
  specMin: string;
  specMax: string;
  units: string;
  testMethod: string;
  resultType: SpecResultType | "";
  verificationSource: SpecVerificationSource | "";
  frequency: SpecFrequency | "";
  specificationText: string;
}

// ── Header fields type ───────────────────────────────────────

interface HeaderFields {
  notes: string;
  documentNumber: string;
  synonyms: string;
  casNumber: string;
  botanicalSource: string;
  countryOfOrigin: string;
  primaryPackaging: string;
  secondaryPackaging: string;
  storageConditions: string;
  shelfLifeMonths: string;
  retestMonths: string;
}

function specToHeaderFields(spec: ComponentSpecWithVersions): HeaderFields {
  const s = spec as ComponentSpecWithVersions & Record<string, unknown>;
  return {
    notes: (s.notes as string | null) ?? "",
    documentNumber: (s.documentNumber as string | null) ?? "",
    synonyms: (s.synonyms as string | null) ?? "",
    casNumber: (s.casNumber as string | null) ?? "",
    botanicalSource: (s.botanicalSource as string | null) ?? "",
    countryOfOrigin: (s.countryOfOrigin as string | null) ?? "",
    primaryPackaging: (s.primaryPackaging as string | null) ?? "",
    secondaryPackaging: (s.secondaryPackaging as string | null) ?? "",
    storageConditions: (s.storageConditions as string | null) ?? "",
    shelfLifeMonths: (s.shelfLifeMonths as number | null) !== null ? String(s.shelfLifeMonths) : "",
    retestMonths: (s.retestMonths as number | null) !== null ? String(s.retestMonths) : "",
  };
}

function headerFieldsToPayload(h: HeaderFields) {
  return {
    notes: h.notes || null,
    documentNumber: h.documentNumber || null,
    synonyms: h.synonyms || null,
    casNumber: h.casNumber || null,
    botanicalSource: h.botanicalSource || null,
    countryOfOrigin: h.countryOfOrigin || null,
    primaryPackaging: h.primaryPackaging || null,
    secondaryPackaging: h.secondaryPackaging || null,
    storageConditions: h.storageConditions || null,
    shelfLifeMonths: h.shelfLifeMonths ? parseInt(h.shelfLifeMonths, 10) : null,
    retestMonths: h.retestMonths ? parseInt(h.retestMonths, 10) : null,
  };
}

// ── Collapsible section wrapper ───────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export default function ComponentSpecDetail() {
  const { specId } = useParams<{ specId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [newAttributeRow, setNewAttributeRow] = useState<NewAttributeRow | null>(null);
  const [editingAttributeId] = useState<string | null>(null);

  // Header section edit state
  const [docDetailsFields, setDocDetailsFields] = useState<HeaderFields | null>(null);
  const [packagingFields, setPackagingFields] = useState<HeaderFields | null>(null);

  // ── Data fetching ──────────────────────────────────────────

  const queryKey = [`/api/component-specs/${specId}`];

  const { data: spec, isLoading } = useQuery<ComponentSpecWithVersions>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", `/api/component-specs/${specId}`)).json(),
    enabled: !!specId,
  });

  // Derive selected version — default to latest (highest versionNumber)
  const latestVersion =
    spec?.versions.length
      ? [...spec.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0]
      : null;

  const selectedVersion: ComponentSpecVersionWithAttributes | null =
    spec?.versions.find((v) => v.id === (selectedVersionId ?? latestVersion?.id)) ?? null;

  const isDraft = selectedVersion?.status === "DRAFT";
  const isApproved = selectedVersion?.status === "APPROVED";

  // ── Mutations ──────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async ({ password, commentary }: { password: string; commentary?: string }) => {
      if (!selectedVersion) throw new Error("No version selected");
      const res = await apiRequest(
        "POST",
        `/api/component-specs/${specId}/versions/${selectedVersion.id}/approve`,
        { password, commentary },
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? "Approval failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setShowApproveModal(false);
      toast({ title: "Specification approved" });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error("No version selected");
      const res = await apiRequest(
        "DELETE",
        `/api/component-specs/${specId}/versions/${selectedVersion.id}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Discard failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/component-specs"] });
      toast({ title: "Draft discarded" });
      navigate("/quality/component-specifications");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to discard draft", description: err.message, variant: "destructive" });
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/component-specs/${specId}/versions`);
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to create new version");
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      setSelectedVersionId(data.id);
      toast({ title: "New draft version created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create new version", description: err.message, variant: "destructive" });
    },
  });

  const addAttributeMutation = useMutation({
    mutationFn: async (row: NewAttributeRow) => {
      if (!selectedVersion) throw new Error("No version selected");
      const res = await apiRequest(
        "POST",
        `/api/component-specs/${specId}/versions/${selectedVersion.id}/attributes`,
        {
          name: row.name,
          category: row.category,
          specMin: row.specMin || null,
          specMax: row.specMax || null,
          units: row.units || null,
          testMethod: row.testMethod || null,
          resultType: row.resultType || null,
          verificationSource: row.verificationSource || null,
          frequency: row.frequency || null,
          specificationText: row.specificationText || null,
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to add attribute");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setNewAttributeRow(null);
      toast({ title: "Attribute added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add attribute", description: err.message, variant: "destructive" });
    },
  });

  const deleteAttributeMutation = useMutation({
    mutationFn: async (attributeId: string) => {
      if (!selectedVersion) throw new Error("No version selected");
      const res = await apiRequest(
        "DELETE",
        `/api/component-specs/${specId}/versions/${selectedVersion.id}/attributes/${attributeId}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to delete attribute");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Attribute deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete attribute", description: err.message, variant: "destructive" });
    },
  });

  const patchSpecMutation = useMutation({
    mutationFn: async (payload: ReturnType<typeof headerFieldsToPayload>) => {
      const res = await apiRequest("PATCH", `/api/component-specs/${specId}`, payload);
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to update spec");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDocDetailsFields(null);
      setPackagingFields(null);
      toast({ title: "Specification updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update specification", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────

  function handleDiscard() {
    if (!window.confirm("Discard this draft? This cannot be undone.")) return;
    discardMutation.mutate();
  }

  async function handleSign(password: string, commentary: string) {
    await approveMutation.mutateAsync({ password, commentary });
  }

  function handleAddAttributeSave() {
    if (!newAttributeRow || !newAttributeRow.name) return;
    addAttributeMutation.mutate(newAttributeRow);
  }

  function handleSaveDocDetails() {
    if (!docDetailsFields || !spec) return;
    // Merge with current packaging values from spec
    const current = specToHeaderFields(spec);
    patchSpecMutation.mutate(headerFieldsToPayload({
      ...current,
      notes: docDetailsFields.notes,
      documentNumber: docDetailsFields.documentNumber,
      synonyms: docDetailsFields.synonyms,
      casNumber: docDetailsFields.casNumber,
      botanicalSource: docDetailsFields.botanicalSource,
      countryOfOrigin: docDetailsFields.countryOfOrigin,
    }));
  }

  function handleSavePackaging() {
    if (!packagingFields || !spec) return;
    const current = specToHeaderFields(spec);
    patchSpecMutation.mutate(headerFieldsToPayload({
      ...current,
      primaryPackaging: packagingFields.primaryPackaging,
      secondaryPackaging: packagingFields.secondaryPackaging,
      storageConditions: packagingFields.storageConditions,
      shelfLifeMonths: packagingFields.shelfLifeMonths,
      retestMonths: packagingFields.retestMonths,
    }));
  }

  // ── Loading / not found ────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="component-spec-detail-loading">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Specification not found.</p>
      </div>
    );
  }

  const s = spec as ComponentSpecWithVersions & Record<string, unknown>;
  const sortedVersions = [...spec.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  // Derive display values for header sections
  const displayDoc = docDetailsFields ?? specToHeaderFields(spec);
  const displayPkg = packagingFields ?? specToHeaderFields(spec);

  // new attribute: hide min/max when resultType is PASS_FAIL or TEXT
  const hideMinMax =
    newAttributeRow?.resultType === "PASS_FAIL" || newAttributeRow?.resultType === "TEXT";

  return (
    <div className="p-6 space-y-6 max-w-5xl" data-testid="component-spec-detail">
      {/* Back nav */}
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate("/quality/component-specifications")}
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Component Specifications
      </button>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold">{spec.productName}</h1>
          {/* Version tabs / chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {sortedVersions.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  v.id === (selectedVersionId ?? latestVersion?.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
                data-testid={`button-version-${v.versionNumber}`}
              >
                v{v.versionNumber}
                <span className="ml-1">{statusBadge(v.status)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          SKU: <span className="font-mono">{spec.productSku}</span>
          {" · "}
          Category: {spec.productCategory}
          {s.documentNumber ? (
            <>
              {" · "}
              Doc #: <span className="font-mono">{s.documentNumber as string}</span>
            </>
          ) : null}
        </p>
      </div>

      {/* Actions row */}
      {canManage && selectedVersion && (
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <>
              <Button
                size="sm"
                onClick={() => setShowApproveModal(true)}
                data-testid="button-approve-spec"
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscard}
                disabled={discardMutation.isPending}
                data-testid="button-discard-draft"
              >
                Discard draft
              </Button>
            </>
          )}
          {isApproved && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => newVersionMutation.mutate()}
              disabled={newVersionMutation.isPending}
              data-testid="button-new-version"
            >
              {newVersionMutation.isPending ? "Creating…" : "Create new version"}
            </Button>
          )}
        </div>
      )}

      {/* Document Details section */}
      {canManage && (
        <CollapsibleSection title="Document Details">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Document Number</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. CSPEC-RES01"
                value={displayDoc.documentNumber}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, documentNumber: e.target.value })
                }
                data-testid="input-document-number"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">CAS Number</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 501-36-0"
                value={displayDoc.casNumber}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, casNumber: e.target.value })
                }
                data-testid="input-cas-number"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Country of Origin</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. China"
                value={displayDoc.countryOfOrigin}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, countryOfOrigin: e.target.value })
                }
                data-testid="input-country-of-origin"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3">
              <label className="text-xs text-muted-foreground">Synonyms</label>
              <Input
                className="h-7 text-xs"
                placeholder='e.g. 3,5,4′-Trihydroxy-trans-stilbene'
                value={displayDoc.synonyms}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, synonyms: e.target.value })
                }
                data-testid="input-synonyms"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3">
              <label className="text-xs text-muted-foreground">Botanical Source</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. Polygonum cuspidatum root"
                value={displayDoc.botanicalSource}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, botanicalSource: e.target.value })
                }
                data-testid="input-botanical-source"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3">
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input
                className="h-7 text-xs"
                placeholder="General notes"
                value={displayDoc.notes}
                onChange={(e) =>
                  setDocDetailsFields({ ...displayDoc, notes: e.target.value })
                }
                data-testid="input-notes"
              />
            </div>
          </div>
          {docDetailsFields && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSaveDocDetails}
                disabled={patchSpecMutation.isPending}
                data-testid="button-save-doc-details"
              >
                {patchSpecMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setDocDetailsFields(null)}
                disabled={patchSpecMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Packaging & Storage section */}
      {canManage && (
        <CollapsibleSection title="Packaging & Storage">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Primary Packaging</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. HDPE drum"
                value={displayPkg.primaryPackaging}
                onChange={(e) =>
                  setPackagingFields({ ...displayPkg, primaryPackaging: e.target.value })
                }
                data-testid="input-primary-packaging"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Secondary Packaging</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. Outer carton"
                value={displayPkg.secondaryPackaging}
                onChange={(e) =>
                  setPackagingFields({ ...displayPkg, secondaryPackaging: e.target.value })
                }
                data-testid="input-secondary-packaging"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Storage Conditions</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. Store below 25°C"
                value={displayPkg.storageConditions}
                onChange={(e) =>
                  setPackagingFields({ ...displayPkg, storageConditions: e.target.value })
                }
                data-testid="input-storage-conditions"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Shelf Life (months)</label>
              <Input
                className="h-7 text-xs"
                type="number"
                min={0}
                placeholder="e.g. 24"
                value={displayPkg.shelfLifeMonths}
                onChange={(e) =>
                  setPackagingFields({ ...displayPkg, shelfLifeMonths: e.target.value })
                }
                data-testid="input-shelf-life-months"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Retest Period (months)</label>
              <Input
                className="h-7 text-xs"
                type="number"
                min={0}
                placeholder="e.g. 12"
                value={displayPkg.retestMonths}
                onChange={(e) =>
                  setPackagingFields({ ...displayPkg, retestMonths: e.target.value })
                }
                data-testid="input-retest-months"
              />
            </div>
          </div>
          {packagingFields && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSavePackaging}
                disabled={patchSpecMutation.isPending}
                data-testid="button-save-packaging"
              >
                {patchSpecMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setPackagingFields(null)}
                disabled={patchSpecMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Attributes table */}
      {selectedVersion && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Attributes
            </h2>
            {canManage && isDraft && !newAttributeRow && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setNewAttributeRow({
                    category: "IDENTITY",
                    name: "",
                    specMin: "",
                    specMax: "",
                    units: "",
                    testMethod: "",
                    resultType: "",
                    verificationSource: "",
                    frequency: "",
                    specificationText: "",
                  })
                }
                data-testid="button-add-attribute"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add attribute
              </Button>
            )}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table data-testid="table-attributes">
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Result Type</TableHead>
                  <TableHead>Min</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Spec / Criterion</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Frequency</TableHead>
                  {canManage && isDraft && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedVersion.attributes.length === 0 && !newAttributeRow && (
                  <TableRow>
                    <TableCell
                      colSpan={canManage && isDraft ? 11 : 10}
                      className="text-center text-muted-foreground text-sm py-6"
                      data-testid="text-attributes-empty"
                    >
                      No attributes defined yet.
                    </TableCell>
                  </TableRow>
                )}
                {selectedVersion.attributes.map((attr) => {
                  const a = attr as typeof attr & Record<string, unknown>;
                  const resultType = a.resultType as string | null;
                  const showSpecText = resultType === "PASS_FAIL" || resultType === "TEXT";
                  return (
                    <TableRow key={attr.id} data-testid={`row-attribute-${attr.id}`}>
                      <TableCell>{categoryBadge(attr.category)}</TableCell>
                      <TableCell className="text-sm">{attr.name}</TableCell>
                      <TableCell className="text-sm">
                        {resultType ? (RESULT_TYPE_LABELS[resultType] ?? resultType) : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {showSpecText ? "—" : (attr.specMin ?? "—")}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {showSpecText ? "—" : (attr.specMax ?? "—")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {showSpecText
                          ? ((a.specificationText as string | null) ?? "—")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {attr.units ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {attr.testMethod ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.verificationSource
                          ? (VERIFICATION_SOURCE_LABELS[a.verificationSource as string] ?? a.verificationSource as string)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.frequency
                          ? (FREQUENCY_LABELS[a.frequency as string] ?? a.frequency as string)
                          : "—"}
                      </TableCell>
                      {canManage && isDraft && (
                        <TableCell>
                          <button
                            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                            onClick={() => deleteAttributeMutation.mutate(attr.id)}
                            disabled={deleteAttributeMutation.isPending && editingAttributeId === attr.id}
                            data-testid={`button-delete-attribute-${attr.id}`}
                            title="Delete attribute"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}

                {/* New attribute inline row */}
                {newAttributeRow && (
                  <TableRow data-testid="row-new-attribute">
                    <TableCell>
                      <Select
                        value={newAttributeRow.category}
                        onValueChange={(val) =>
                          setNewAttributeRow({ ...newAttributeRow, category: val as SpecAttributeCategory })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-36" data-testid="select-new-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ATTRIBUTE_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat} className="text-xs">
                              {CATEGORY_LABELS[cat]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        placeholder="Attribute name"
                        value={newAttributeRow.name}
                        onChange={(e) => setNewAttributeRow({ ...newAttributeRow, name: e.target.value })}
                        data-testid="input-new-name"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={newAttributeRow.resultType || "__none__"}
                        onValueChange={(val) =>
                          setNewAttributeRow({
                            ...newAttributeRow,
                            resultType: val === "__none__" ? "" : (val as SpecResultType),
                          })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-28" data-testid="select-new-result-type">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                          <SelectItem value="NUMERIC" className="text-xs">Numeric</SelectItem>
                          <SelectItem value="PASS_FAIL" className="text-xs">Pass/Fail</SelectItem>
                          <SelectItem value="TEXT" className="text-xs">Text</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {!hideMinMax ? (
                        <Input
                          className="h-7 text-xs w-20"
                          placeholder="Min"
                          value={newAttributeRow.specMin}
                          onChange={(e) => setNewAttributeRow({ ...newAttributeRow, specMin: e.target.value })}
                          data-testid="input-new-min"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!hideMinMax ? (
                        <Input
                          className="h-7 text-xs w-20"
                          placeholder="Max"
                          value={newAttributeRow.specMax}
                          onChange={(e) => setNewAttributeRow({ ...newAttributeRow, specMax: e.target.value })}
                          data-testid="input-new-max"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {hideMinMax ? (
                        <Input
                          className="h-7 text-xs w-32"
                          placeholder="Criterion / spec text"
                          value={newAttributeRow.specificationText}
                          onChange={(e) =>
                            setNewAttributeRow({ ...newAttributeRow, specificationText: e.target.value })
                          }
                          data-testid="input-new-specification-text"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs w-20"
                        placeholder="Units"
                        value={newAttributeRow.units}
                        onChange={(e) => setNewAttributeRow({ ...newAttributeRow, units: e.target.value })}
                        data-testid="input-new-units"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs w-28"
                        placeholder="Test method"
                        value={newAttributeRow.testMethod}
                        onChange={(e) => setNewAttributeRow({ ...newAttributeRow, testMethod: e.target.value })}
                        data-testid="input-new-test-method"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={newAttributeRow.verificationSource || "__none__"}
                        onValueChange={(val) =>
                          setNewAttributeRow({
                            ...newAttributeRow,
                            verificationSource: val === "__none__" ? "" : (val as SpecVerificationSource),
                          })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-32" data-testid="select-new-verification-source">
                          <SelectValue placeholder="Source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                          <SelectItem value="NEUROGAN_IN_HOUSE" className="text-xs">In-House</SelectItem>
                          <SelectItem value="SUPPLIER_COA" className="text-xs">Supplier COA</SelectItem>
                          <SelectItem value="THIRD_PARTY_LAB" className="text-xs">3rd-Party Lab</SelectItem>
                          <SelectItem value="SUPPLIER_DECLARATION" className="text-xs">Supplier Decl.</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={newAttributeRow.frequency || "__none__"}
                        onValueChange={(val) =>
                          setNewAttributeRow({
                            ...newAttributeRow,
                            frequency: val === "__none__" ? "" : (val as SpecFrequency),
                          })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-28" data-testid="select-new-frequency">
                          <SelectValue placeholder="Frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                          <SelectItem value="EVERY_LOT" className="text-xs">Every Lot</SelectItem>
                          <SelectItem value="ANNUAL" className="text-xs">Annual</SelectItem>
                          <SelectItem value="PERIODIC" className="text-xs">Periodic</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={handleAddAttributeSave}
                          disabled={!newAttributeRow.name || addAttributeMutation.isPending}
                          data-testid="button-save-attribute"
                        >
                          {addAttributeMutation.isPending ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs px-2"
                          onClick={() => setNewAttributeRow(null)}
                          disabled={addAttributeMutation.isPending}
                          data-testid="button-cancel-attribute"
                        >
                          Cancel
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Version history */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Version History
        </h2>
        <div className="rounded-md border divide-y" data-testid="version-history">
          {sortedVersions.map((v) => {
            const vWithAttrs = spec.versions.find((sv) => sv.id === v.id) as ComponentSpecVersionWithAttributes | undefined;
            return (
              <div
                key={v.id}
                className="flex items-center justify-between px-4 py-3"
                data-testid={`version-history-row-${v.versionNumber}`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium">v{v.versionNumber}</span>
                  {statusBadge(v.status)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.status === "APPROVED" && vWithAttrs?.approvedByName ? (
                    <>approved by {vWithAttrs.approvedByName} · </>
                  ) : null}
                  created by {vWithAttrs?.createdByName ?? "—"} on{" "}
                  {new Date(v.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Approval ceremony */}
      {selectedVersion && (
        <SignatureCeremony
          open={showApproveModal}
          onOpenChange={(next) => {
            if (!next) setShowApproveModal(false);
          }}
          entityDescription={`component specification v${selectedVersion.versionNumber} for ${spec.productName}`}
          meaning="SPEC_APPROVAL"
          onSign={handleSign}
          isPending={approveMutation.isPending}
        />
      )}
    </div>
  );
}
