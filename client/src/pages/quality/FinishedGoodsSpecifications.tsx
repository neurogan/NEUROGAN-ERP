import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

// ── Types ────────────────────────────────────────────────────────────────────

interface FgSpecAttribute {
  id: string;
  analyte: string;
  category: "NUTRIENT_CONTENT" | "CONTAMINANT" | "MICROBIOLOGICAL";
  targetValue: string | null;
  minValue: string | null;
  maxValue: string | null;
  unit: string;
  required: boolean;
  notes: string | null;
}

interface FgSpecVersionWithAttrs {
  id: string;
  version: number;
  status: "PENDING_APPROVAL" | "APPROVED" | "SUPERSEDED";
  approvedAt: string | null;
  approvedByName: string | null;
  createdByName: string;
  attributes: FgSpecAttribute[];
}

interface FgSpecRow {
  id: string;
  productId: string;
  productName: string;
  name: string;
  status: "ACTIVE" | "RETIRED";
  versions: FgSpecVersionWithAttrs[];
  activeVersion: FgSpecVersionWithAttrs | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  NUTRIENT_CONTENT: "Nutrient Content",
  CONTAMINANT: "Contaminant",
  MICROBIOLOGICAL: "Microbiological",
};

function versionStatusBadge(status: string) {
  const variants: Record<string, string> = {
    PENDING_APPROVAL:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    APPROVED:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    SUPERSEDED:
      "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  const labels: Record<string, string> = {
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    SUPERSEDED: "Superseded",
  };
  return (
    <Badge className={`text-xs ${variants[status] ?? ""}`}>
      {labels[status] ?? status}
    </Badge>
  );
}

function specStatusBadge(status: string) {
  return (
    <Badge
      className={
        status === "ACTIVE"
          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs"
          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 text-xs"
      }
    >
      {status === "ACTIVE" ? "Active" : "Retired"}
    </Badge>
  );
}

// ── Add Attribute Dialog ──────────────────────────────────────────────────────

interface AddAttributeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specId: string;
  versionId: string;
}

function AddAttributeDialog({
  open,
  onOpenChange,
  specId,
  versionId,
}: AddAttributeDialogProps) {
  const { toast } = useToast();
  const [analyte, setAnalyte] = useState("");
  const [category, setCategory] = useState<
    "NUTRIENT_CONTENT" | "CONTAMINANT" | "MICROBIOLOGICAL" | ""
  >("");
  const [minValue, setMinValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [unit, setUnit] = useState("");
  const [required, setRequired] = useState(true);
  const [notes, setNotes] = useState("");

  const reset = () => {
    setAnalyte("");
    setCategory("");
    setMinValue("");
    setTargetValue("");
    setMaxValue("");
    setUnit("");
    setRequired(true);
    setNotes("");
  };

  const addMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/finished-goods-specs/${specId}/versions/${versionId}/attributes`,
        {
          analyte,
          category,
          minValue: minValue || null,
          targetValue: targetValue || null,
          maxValue: maxValue || null,
          unit,
          required,
          notes: notes || null,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finished-goods-specs"] });
      toast({ title: "Attribute added" });
      reset();
      onOpenChange(false);
    },
    onError: () =>
      toast({ title: "Failed to add attribute", variant: "destructive" }),
  });

  const canSubmit = analyte.trim() && category && unit.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Attribute</DialogTitle>
          <DialogDescription>
            Add a new analyte to this spec version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="attr-analyte">
              Analyte <span className="text-destructive">*</span>
            </Label>
            <Input
              id="attr-analyte"
              value={analyte}
              onChange={(e) => setAnalyte(e.target.value)}
              placeholder="e.g. Total CBD"
              data-testid="input-attr-analyte"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-category">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select
              value={category}
              onValueChange={(v) =>
                setCategory(
                  v as "NUTRIENT_CONTENT" | "CONTAMINANT" | "MICROBIOLOGICAL",
                )
              }
            >
              <SelectTrigger id="attr-category" data-testid="select-attr-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NUTRIENT_CONTENT">Nutrient Content</SelectItem>
                <SelectItem value="CONTAMINANT">Contaminant</SelectItem>
                <SelectItem value="MICROBIOLOGICAL">Microbiological</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="attr-min">Min Value</Label>
              <Input
                id="attr-min"
                type="number"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                placeholder="—"
                data-testid="input-attr-min"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attr-target">Target Value</Label>
              <Input
                id="attr-target"
                type="number"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="—"
                data-testid="input-attr-target"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attr-max">Max Value</Label>
              <Input
                id="attr-max"
                type="number"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                placeholder="—"
                data-testid="input-attr-max"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-unit">
              Unit <span className="text-destructive">*</span>
            </Label>
            <Input
              id="attr-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. mg/g"
              data-testid="input-attr-unit"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="attr-required"
              checked={required}
              onCheckedChange={(checked) => setRequired(checked === true)}
              data-testid="checkbox-attr-required"
            />
            <Label htmlFor="attr-required" className="cursor-pointer">
              Required for QC release
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-notes">Notes</Label>
            <Textarea
              id="attr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes"
              data-testid="input-attr-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!canSubmit || addMutation.isPending}
            data-testid="button-add-attr-submit"
          >
            {addMutation.isPending ? "Adding…" : "Add Attribute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Spec Dialog ────────────────────────────────────────────────────────

interface CreateSpecDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}

function CreateSpecDialog({
  open,
  onOpenChange,
  productId,
  productName,
}: CreateSpecDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setName("");
    setDescription("");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/finished-goods-specs", {
        productId,
        name,
        description: description || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finished-goods-specs"] });
      toast({ title: "Spec created" });
      reset();
      onOpenChange(false);
    },
    onError: () =>
      toast({ title: "Failed to create spec", variant: "destructive" }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Create FG Specification</DialogTitle>
          <DialogDescription>
            Create a new specification for{" "}
            <span className="font-medium">{productName}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="spec-name">
              Spec Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="spec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CBD Gummies v1"
              data-testid="input-spec-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spec-description">Description</Label>
            <Textarea
              id="spec-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
              data-testid="input-spec-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            data-testid="button-create-spec-submit"
          >
            {createMutation.isPending ? "Creating…" : "Create Spec"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Version Inline Detail ─────────────────────────────────────────────────────

interface VersionDetailProps {
  specId: string;
  version: FgSpecVersionWithAttrs;
  canManage: boolean;
}

function VersionDetail({ specId, version, canManage }: VersionDetailProps) {
  const { toast } = useToast();
  const [addAttrOpen, setAddAttrOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

  const approveMutation = useMutation({
    mutationFn: async ({
      password,
      commentary,
    }: {
      password: string;
      commentary: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/finished-goods-specs/${specId}/versions/${version.id}/approve`,
        { password, commentary: commentary || undefined },
      );
      if (!res.ok) {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? "Failed to approve");
      }
    },
    onSuccess: () => {
      setSigOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/finished-goods-specs"] });
      toast({ title: "Version approved" });
    },
    onError: (err: Error) =>
      toast({
        title: "Approval failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {versionStatusBadge(version.status)}
        <span className="text-xs text-muted-foreground">
          Created by {version.createdByName}
        </span>
        {version.approvedAt && (
          <span className="text-xs text-muted-foreground">
            · Approved {new Date(version.approvedAt).toLocaleDateString()} by{" "}
            {version.approvedByName ?? "—"}
          </span>
        )}
      </div>

      {version.attributes.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Analyte</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs">Min</TableHead>
              <TableHead className="text-xs">Target</TableHead>
              <TableHead className="text-xs">Max</TableHead>
              <TableHead className="text-xs">Unit</TableHead>
              <TableHead className="text-xs">Required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {version.attributes.map((attr) => (
              <TableRow key={attr.id}>
                <TableCell className="text-xs font-medium">
                  {attr.analyte}
                </TableCell>
                <TableCell className="text-xs">
                  {CATEGORY_LABELS[attr.category] ?? attr.category}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {attr.minValue ?? "—"}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {attr.targetValue ?? "—"}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {attr.maxValue ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{attr.unit}</TableCell>
                <TableCell className="text-xs">
                  {attr.required ? (
                    <span className="text-green-700 dark:text-green-400">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No attributes defined yet.
        </p>
      )}

      {version.status === "PENDING_APPROVAL" && canManage && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddAttrOpen(true)}
            data-testid={`button-add-attr-${version.id}`}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Attribute
          </Button>
          <Button
            size="sm"
            onClick={() => setSigOpen(true)}
            data-testid={`button-approve-version-${version.id}`}
          >
            Approve Version
          </Button>
        </div>
      )}

      <AddAttributeDialog
        open={addAttrOpen}
        onOpenChange={setAddAttrOpen}
        specId={specId}
        versionId={version.id}
      />

      <SignatureCeremony
        open={sigOpen}
        onOpenChange={setSigOpen}
        entityDescription={`FG Spec v${version.version}`}
        meaning="SPEC_APPROVAL"
        isPending={approveMutation.isPending}
        onSign={async (password, commentary) => {
          await approveMutation.mutateAsync({ password, commentary });
        }}
      />
    </div>
  );
}

// ── Expanded Row ──────────────────────────────────────────────────────────────

interface ExpandedSpecRowProps {
  spec: FgSpecRow;
  canManage: boolean;
}

function ExpandedSpecRow({ spec, canManage }: ExpandedSpecRowProps) {
  const { toast } = useToast();

  const addVersionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/finished-goods-specs/${spec.id}/versions`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finished-goods-specs"] });
      toast({ title: "New version created" });
    },
    onError: (err: Error) =>
      toast({
        title: "Failed to create version",
        description: err.message,
        variant: "destructive",
      }),
  });

  const hasPendingVersion = spec.versions.some(
    (v) => v.status === "PENDING_APPROVAL",
  );

  return (
    <div className="space-y-6 py-2">
      {spec.versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      ) : (
        spec.versions.map((version) => (
          <div key={version.id} className="space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">
              Version {version.version}
            </p>
            <VersionDetail
              specId={spec.id}
              version={version}
              canManage={canManage}
            />
          </div>
        ))
      )}
      {canManage && !hasPendingVersion && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => addVersionMutation.mutate()}
          disabled={addVersionMutation.isPending}
          data-testid={`button-add-version-${spec.id}`}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {addVersionMutation.isPending ? "Creating…" : "Add Version"}
        </Button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FinishedGoodsSpecifications() {
  const { user } = useAuth();
  const { toast: _toast } = useToast();

  const canManage =
    user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const { data: specs, isLoading } = useQuery<FgSpecRow[]>({
    queryKey: ["/api/finished-goods-specs"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/finished-goods-specs")).json(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createDialogProductId, setCreateDialogProductId] = useState<
    string | null
  >(null);

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="fg-specs-loading">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!specs || specs.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="fg-specs-empty"
      >
        No finished-good products found.
      </p>
    );
  }

  const createTarget = specs.find(
    (s) => s.productId === createDialogProductId,
  );

  return (
    <div className="space-y-4" data-testid="fg-specs-page">
      <Table data-testid="table-fg-specs">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead>Spec Name</TableHead>
            <TableHead>Active Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {specs.map((item) => {
            const hasSpec = item.id !== "";
            const isExpanded = expandedId === item.productId;

            return (
              <>
                <TableRow
                  key={item.productId}
                  data-testid={`row-fg-spec-${item.productId}`}
                  className={
                    hasSpec ? "cursor-pointer hover:bg-muted/50" : undefined
                  }
                  onClick={
                    hasSpec
                      ? () =>
                          setExpandedId(
                            isExpanded ? null : item.productId,
                          )
                      : undefined
                  }
                >
                  <TableCell className="w-8">
                    {hasSpec &&
                      (isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ))}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {item.productName}
                  </TableCell>
                  <TableCell className="text-sm">
                    {hasSpec ? item.name : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.activeVersion
                      ? `v${item.activeVersion.version}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {hasSpec ? specStatusBadge(item.status) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.activeVersion && "approvedAt" in item.activeVersion &&
                    (item.activeVersion as FgSpecVersionWithAttrs).approvedAt
                      ? new Date(
                          (item.activeVersion as FgSpecVersionWithAttrs)
                            .approvedAt!,
                        ).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!hasSpec && canManage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreateDialogProductId(item.productId);
                        }}
                        data-testid={`button-create-spec-${item.productId}`}
                      >
                        Create Spec
                      </Button>
                    ) : hasSpec ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(isExpanded ? null : item.productId);
                        }}
                        data-testid={`button-view-spec-${item.id}`}
                      >
                        {isExpanded ? "Collapse" : "Expand"}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
                {isExpanded && hasSpec && (
                  <TableRow
                    key={`${item.productId}-detail`}
                    data-testid={`row-fg-spec-detail-${item.productId}`}
                  >
                    <TableCell colSpan={7} className="bg-muted/20 px-8 py-4">
                      <ExpandedSpecRow spec={item} canManage={canManage} />
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>

      {createTarget && (
        <CreateSpecDialog
          open={!!createDialogProductId}
          onOpenChange={(v) => {
            if (!v) setCreateDialogProductId(null);
          }}
          productId={createTarget.productId}
          productName={createTarget.productName}
        />
      )}
    </div>
  );
}
