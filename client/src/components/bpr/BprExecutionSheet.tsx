import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  List,
  Info,
  Plus,
  X,
} from "lucide-react";
import type { BprWithDetails, BprStep, BprDeviation } from "@shared/schema";

interface Props {
  batchId: string;
  batchNumber: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Parse guidance from monitoringResults JSON
function parseGuidance(monitoringResults: string | null): string | null {
  if (!monitoringResults) return null;
  try {
    const parsed = JSON.parse(monitoringResults) as Record<string, unknown>;
    return typeof parsed.guidance === "string" ? parsed.guidance : null;
  } catch {
    return null;
  }
}

// Step overview overlay
function StepOverlay({
  steps,
  currentIndex,
  onSelect,
  onClose,
}: {
  steps: BprStep[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 bg-background/95 backdrop-blur-sm overflow-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base">All Steps</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          {steps.map((step, idx) => {
            const isComplete = step.status === "COMPLETED" || step.status === "VERIFIED";
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={step.id}
                className={`w-full text-left flex items-start gap-3 rounded-lg p-3 transition-colors ${
                  isCurrent
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted"
                }`}
                onClick={() => { onSelect(idx); onClose(); }}
                data-testid={`step-overview-${idx}`}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      Step {Number(step.stepNumber)}
                    </span>
                    {isCurrent && (
                      <Badge className="text-[10px] px-1 py-0 h-4 bg-primary/20 text-primary border-0">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm mt-0.5 line-clamp-2">{step.stepDescription}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Inline deviation form
function DeviationForm({
  bprId,
  stepId,
  onSaved,
  onCancel,
}: {
  bprId: string;
  stepId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/batch-production-records/${bprId}/deviations`, {
        bprId,
        bprStepId: stepId,
        deviationDescription: description,
        reportedBy: user?.fullName ?? user?.email ?? "Unknown",
        reportedAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/batch-production-records/by-batch"],
      });
      onSaved();
    },
    onError: () => {
      toast({
        title: "Failed to save deviation",
        description: "Your text has been preserved — please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        Describe the deviation
      </p>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happened? What deviated from the MMR instruction?"
        className="text-sm min-h-[80px]"
        data-testid="textarea-deviation-description"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!description.trim() || mutation.isPending}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          data-testid="button-save-deviation"
        >
          {mutation.isPending ? "Saving…" : "Save Deviation"}
        </Button>
      </div>
    </div>
  );
}

// Single step view
function StepView({
  step,
  deviations,
  bprId,
  onStepUpdated,
}: {
  step: BprStep;
  deviations: BprDeviation[];
  bprId: string;
  onStepUpdated: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [notes, setNotes] = useState(step.notes ?? "");
  const [showDeviationForm, setShowDeviationForm] = useState(false);
  const isComplete = step.status === "COMPLETED" || step.status === "VERIFIED";
  const guidance = parseGuidance(step.monitoringResults);
  const stepDeviations = deviations.filter((d) => d.bprStepId === step.id);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest(
        "PUT",
        `/api/batch-production-records/${bprId}/steps/${step.id}`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/batch-production-records/by-batch"],
      });
      onStepUpdated();
    },
    onError: () => {
      toast({
        title: "Failed to update step",
        variant: "destructive",
      });
    },
  });

  function handleComplete() {
    updateMutation.mutate({
      status: "COMPLETED",
      performedBy: user?.fullName ?? user?.email ?? "Unknown",
      performedAt: new Date().toISOString(),
      notes: notes || null,
    });
  }

  function handleUncomplete() {
    updateMutation.mutate({
      status: "PENDING",
      performedBy: null,
      performedAt: null,
    });
  }

  function handleNotesBlur() {
    if (notes !== (step.notes ?? "")) {
      updateMutation.mutate({ notes: notes || null });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Step header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="font-mono text-xs">
            Step {Number(step.stepNumber)}
          </Badge>
          {isComplete && (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          )}
          {stepDeviations.length > 0 && (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {stepDeviations.length} deviation{stepDeviations.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <p className="text-base font-medium leading-snug">{step.stepDescription}</p>
        {step.sopCode && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            SOP: {step.sopCode}{step.sopVersion ? ` v${step.sopVersion}` : ""}
          </p>
        )}
      </div>

      {/* Guidance callout */}
      {guidance && (
        <div className="flex gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2.5">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-300">{guidance}</p>
        </div>
      )}

      {/* Completion info (read-only when complete) */}
      {isComplete && step.performedBy && (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Completed by <strong>{step.performedBy}</strong>
          {step.performedAt && (
            <> at {new Date(step.performedAt).toLocaleString()}</>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Observations &amp; measurements</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Record what you did, actual values measured, and any observations…"
          className="text-sm min-h-[100px] tablet:text-base tablet:min-h-[120px]"
          data-testid="textarea-step-notes"
        />
      </div>

      {/* Existing deviations */}
      {stepDeviations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Deviations
          </p>
          {stepDeviations.map((dev) => (
            <div
              key={dev.id}
              className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm"
            >
              <p className="font-medium text-amber-700 dark:text-amber-300 text-xs mb-0.5">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                Deviation reported by {dev.reportedBy ?? "operator"}
              </p>
              <p>{dev.deviationDescription}</p>
            </div>
          ))}
        </div>
      )}

      {/* Deviation form or trigger */}
      {showDeviationForm ? (
        <DeviationForm
          bprId={bprId}
          stepId={step.id}
          onSaved={() => setShowDeviationForm(false)}
          onCancel={() => setShowDeviationForm(false)}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
          onClick={() => setShowDeviationForm(true)}
          data-testid="button-note-deviation"
        >
          <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
          Note a deviation
        </Button>
      )}

      <Separator />

      {/* Complete / Uncomplete */}
      {isComplete ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUncomplete}
          disabled={updateMutation.isPending}
          data-testid="button-uncomplete-step"
          className="w-full"
        >
          <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
          Completed — tap to undo
        </Button>
      ) : (
        <Button
          size="lg"
          onClick={handleComplete}
          disabled={updateMutation.isPending}
          data-testid="button-complete-step"
          className="w-full tablet:min-h-14 text-base"
        >
          <CheckCircle2 className="h-5 w-5 mr-2" />
          {updateMutation.isPending ? "Saving…" : "Mark Step Complete"}
        </Button>
      )}
    </div>
  );
}

export function BprExecutionSheet({
  batchId,
  batchNumber,
  productName,
  open,
  onOpenChange,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOverview, setShowOverview] = useState(false);

  const { data: bpr, isLoading } = useQuery<BprWithDetails | null>({
    queryKey: ["/api/batch-production-records/by-batch", batchId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/batch-production-records/by-batch/${batchId}`,
      );
      return res.json();
    },
    enabled: open,
    staleTime: 0,
  });

  const steps = bpr?.steps ?? [];
  const deviations = bpr?.deviations ?? [];
  const completedCount = steps.filter(
    (s) => s.status === "COMPLETED" || s.status === "VERIFIED",
  ).length;
  const totalCount = steps.length;
  const allComplete = totalCount > 0 && completedCount === totalCount;
  const incompleteNumbers = steps
    .filter((s) => s.status !== "COMPLETED" && s.status !== "VERIFIED")
    .map((s) => `Step ${Number(s.stepNumber)}`)
    .join(", ");

  const handleStepUpdated = useCallback(() => {
    // query cache is already invalidated by mutations; nothing extra needed
  }, []);

  const currentStep = steps[currentIndex] ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[100dvh] flex flex-col p-0"
        data-testid="sheet-bpr-execution"
      >
        {/* Fixed header */}
        <SheetHeader className="flex-none px-4 pt-4 pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <SheetTitle className="text-sm font-semibold truncate">
                {batchNumber} — {productName}
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {completedCount} / {totalCount} steps complete
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOverview(true)}
                data-testid="button-step-overview"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {totalCount > 0 && (
            <Progress
              value={(completedCount / totalCount) * 100}
              className="h-1.5 mt-2"
            />
          )}
        </SheetHeader>

        {/* Step navigation bar */}
        {totalCount > 0 && (
          <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              data-testid="button-prev-step"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="ml-1 text-sm">Prev</span>
            </Button>
            <span className="text-sm font-medium text-muted-foreground">
              Step {currentIndex + 1} of {totalCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setCurrentIndex((i) => Math.min(totalCount - 1, i + 1))
              }
              disabled={currentIndex === totalCount - 1}
              data-testid="button-next-step"
            >
              <span className="mr-1 text-sm">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Scrollable step content */}
        <div className="flex-1 overflow-hidden relative">
          {showOverview && (
            <StepOverlay
              steps={steps}
              currentIndex={currentIndex}
              onSelect={setCurrentIndex}
              onClose={() => setShowOverview(false)}
            />
          )}

          {isLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading steps…
            </div>
          ) : steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
              <p className="text-sm text-muted-foreground">
                No steps found for this batch.
              </p>
              <p className="text-xs text-muted-foreground">
                Ensure the product has an approved MMR with process steps before
                starting production.
              </p>
            </div>
          ) : currentStep ? (
            <StepView
              key={currentStep.id}
              step={currentStep}
              deviations={deviations}
              bprId={bpr!.id}
              onStepUpdated={handleStepUpdated}
            />
          ) : null}
        </div>

        {/* Fixed footer */}
        <div className="flex-none px-4 py-3 border-t border-border flex items-center justify-between bg-background">
          <p className="text-sm text-muted-foreground">
            {allComplete ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                All steps complete
              </span>
            ) : (
              `${totalCount - completedCount} step${totalCount - completedCount !== 1 ? "s" : ""} remaining`
            )}
          </p>
          <Button
            onClick={() => onOpenChange(false)}
            disabled={!allComplete}
            title={
              !allComplete
                ? `Cannot finish: ${incompleteNumbers}`
                : undefined
            }
            data-testid="button-finish-execution"
          >
            <Plus className="h-4 w-4 mr-1.5 rotate-45" />
            Finish
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
