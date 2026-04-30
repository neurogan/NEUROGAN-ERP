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
import { Trash2, ArrowLeft, Plus } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import type {
  ComponentSpecWithVersions,
  ComponentSpecVersionWithAttributes,
  SpecAttributeCategory,
} from "@shared/schema";

// ── Constants ────────────────────────────────────────────────

const ATTRIBUTE_CATEGORIES: SpecAttributeCategory[] = [
  "IDENTITY",
  "ASSAY",
  "HEAVY_METAL",
  "MICROBIAL",
  "PHYSICAL",
  "OTHER",
];

const CATEGORY_LABELS: Record<SpecAttributeCategory, string> = {
  IDENTITY: "Identity",
  ASSAY: "Assay",
  HEAVY_METAL: "Heavy Metal",
  MICROBIAL: "Microbial",
  PHYSICAL: "Physical",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<SpecAttributeCategory, string> = {
  IDENTITY: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  ASSAY: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  HEAVY_METAL: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  MICROBIAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  PHYSICAL: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  OTHER: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
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

function categoryBadge(category: SpecAttributeCategory) {
  return (
    <Badge className={`text-xs ${CATEGORY_COLORS[category]}`}>
      {CATEGORY_LABELS[category]}
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

  const sortedVersions = [...spec.versions].sort((a, b) => b.versionNumber - a.versionNumber);

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
                  })
                }
                data-testid="button-add-attribute"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add attribute
              </Button>
            )}
          </div>

          <div className="rounded-md border">
            <Table data-testid="table-attributes">
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Min</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Test Method</TableHead>
                  {canManage && isDraft && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedVersion.attributes.length === 0 && !newAttributeRow && (
                  <TableRow>
                    <TableCell
                      colSpan={canManage && isDraft ? 7 : 6}
                      className="text-center text-muted-foreground text-sm py-6"
                      data-testid="text-attributes-empty"
                    >
                      No attributes defined yet.
                    </TableCell>
                  </TableRow>
                )}
                {selectedVersion.attributes.map((attr) => (
                  <TableRow key={attr.id} data-testid={`row-attribute-${attr.id}`}>
                    <TableCell>{categoryBadge(attr.category as SpecAttributeCategory)}</TableCell>
                    <TableCell className="text-sm">{attr.name}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {attr.specMin ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {attr.specMax ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {attr.units ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {attr.testMethod ?? "—"}
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
                ))}

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
                        <SelectTrigger className="h-7 text-xs w-32" data-testid="select-new-category">
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
                      <Input
                        className="h-7 text-xs w-20"
                        placeholder="Min"
                        value={newAttributeRow.specMin}
                        onChange={(e) => setNewAttributeRow({ ...newAttributeRow, specMin: e.target.value })}
                        data-testid="input-new-min"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs w-20"
                        placeholder="Max"
                        value={newAttributeRow.specMax}
                        onChange={(e) => setNewAttributeRow({ ...newAttributeRow, specMax: e.target.value })}
                        data-testid="input-new-max"
                      />
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
