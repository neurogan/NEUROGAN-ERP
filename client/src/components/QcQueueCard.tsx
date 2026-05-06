import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  FlaskConical, AlertTriangle, ClipboardCheck, Search,
  CheckCircle, ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComponentType } from "react";

interface ReceivingTask {
  id: string;
  taskType: string;
  sourceModule: string;
  sourceRecordId: string;
  sourceIdentifier: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  quantityReceived: string | null;
  uom: string | null;
  isUrgent: boolean;
}

type StageKey = "QUALIFICATION_REQUIRED" | "LAB_TEST_REQUIRED" | "IDENTITY_CHECK_REQUIRED" | "PENDING_QC";

const STAGE_CONFIG: Record<StageKey, {
  label: string;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
}> = {
  QUALIFICATION_REQUIRED: {
    label: "New material — qualification required",
    icon: AlertTriangle,
    iconClass: "text-amber-500",
  },
  LAB_TEST_REQUIRED: {
    label: "Lab testing in progress",
    icon: FlaskConical,
    iconClass: "text-blue-500",
  },
  IDENTITY_CHECK_REQUIRED: {
    label: "Identity check needed",
    icon: Search,
    iconClass: "text-blue-400",
  },
  PENDING_QC: {
    label: "Ready for QC disposition",
    icon: ClipboardCheck,
    iconClass: "text-primary",
  },
};

const STAGE_ORDER: StageKey[] = [
  "QUALIFICATION_REQUIRED",
  "LAB_TEST_REQUIRED",
  "IDENTITY_CHECK_REQUIRED",
  "PENDING_QC",
];

export function QcQueueCard() {
  const [, navigate] = useLocation();
  const { data: allTasks = [] } = useQuery<ReceivingTask[]>({
    queryKey: ["/api/tasks"],
    staleTime: 30_000,
  });

  const receivingTasks = allTasks.filter((t) => t.sourceModule === "RECEIVING");
  const total = receivingTasks.length;

  const grouped = STAGE_ORDER.map((type) => ({
    type,
    config: STAGE_CONFIG[type],
    items: receivingTasks.filter((t) => t.taskType === type),
  })).filter((g) => g.items.length > 0);

  return (
    <Card data-testid="card-qc-queue">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            Incoming Materials — QC Queue
            {total > 0 && (
              <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-4 ml-1">
                {total}
              </Badge>
            )}
          </CardTitle>
          <span
            className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1"
            onClick={() => navigate("/procurement/receiving")}
          >
            View all <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {total === 0 ? (
          <div className="flex items-center gap-2 px-6 pb-4 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            No materials awaiting lab or QC action.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {grouped.flatMap(({ type, config, items }) => {
              const Icon = config.icon;
              const visible = items.slice(0, 4);
              return visible.map((task) => (
                <button
                  key={task.id}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  onClick={() =>
                    navigate(`/procurement/receiving?record=${task.sourceRecordId}`)
                  }
                  data-testid={`qc-queue-row-${type}`}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {task.primaryLabel ?? task.sourceIdentifier}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {config.label}
                      {task.secondaryLabel ? ` · ${task.secondaryLabel}` : ""}
                      {task.quantityReceived
                        ? ` · ${task.quantityReceived} ${task.uom ?? ""}`
                        : ""}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 mt-1">
                    {task.sourceIdentifier}
                  </span>
                </button>
              ));
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
