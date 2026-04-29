import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, FlaskConical, ClipboardCheck, Search, XCircle,
  MessageSquareWarning, PackageSearch, Microscope, HeartPulse,
  TestTube, FileCheck, Clock, AlertOctagon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComponentType } from "react";

type ReceivingTaskType =
  | "LAB_TEST_REQUIRED"
  | "QUALIFICATION_REQUIRED"
  | "PENDING_QC"
  | "IDENTITY_CHECK_REQUIRED"
  | "REJECTED_LOT";

type ComplaintTaskType =
  | "COMPLAINT_TRIAGE_REQUIRED"
  | "COMPLAINT_LOT_UNRESOLVED"
  | "COMPLAINT_INVESTIGATION_REQUIRED"
  | "COMPLAINT_AE_URGENT_REVIEW"
  | "COMPLAINT_LAB_RETEST"
  | "COMPLAINT_DISPOSITION_REQUIRED"
  | "SAER_DUE_SOON"
  | "SAER_OVERDUE";

interface UserTask {
  id: string;
  taskType: ReceivingTaskType | ComplaintTaskType;
  sourceModule: "RECEIVING" | "COMPLAINT";
  sourceRecordId: string;
  sourceIdentifier: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  quantityReceived: string | null;
  uom: string | null;
  dateReceived: string | null;
  isUrgent: boolean;
  dueAt: string | null;
}

const TASK_CONFIG: Record<UserTask["taskType"], { label: string; icon: ComponentType<{ className?: string }> }> = {
  LAB_TEST_REQUIRED:              { label: "Full lab test required", icon: FlaskConical },
  QUALIFICATION_REQUIRED:         { label: "New material — qualification required", icon: AlertTriangle },
  PENDING_QC:                     { label: "Lot pending QC disposition", icon: ClipboardCheck },
  IDENTITY_CHECK_REQUIRED:        { label: "Identity check required", icon: Search },
  REJECTED_LOT:                   { label: "Rejected lot — coordinate return", icon: XCircle },
  COMPLAINT_TRIAGE_REQUIRED:      { label: "Complaint awaiting triage", icon: MessageSquareWarning },
  COMPLAINT_LOT_UNRESOLVED:       { label: "Complaint — lot unresolved", icon: PackageSearch },
  COMPLAINT_INVESTIGATION_REQUIRED: { label: "Complaint investigation required", icon: Microscope },
  COMPLAINT_AE_URGENT_REVIEW:     { label: "Adverse event — urgent review", icon: HeartPulse },
  COMPLAINT_LAB_RETEST:           { label: "Complaint lab retest", icon: TestTube },
  COMPLAINT_DISPOSITION_REQUIRED: { label: "Complaint awaiting disposition", icon: FileCheck },
  SAER_DUE_SOON:                  { label: "SAER due soon", icon: Clock },
  SAER_OVERDUE:                   { label: "SAER overdue", icon: AlertOctagon },
};

function getTaskRoute(task: UserTask): string {
  if (task.sourceModule === "RECEIVING") {
    return `/receiving?highlight=${task.sourceRecordId}`;
  }
  switch (task.taskType) {
    case "SAER_DUE_SOON":
    case "SAER_OVERDUE":
      return `/quality/complaints/${task.sourceRecordId}/ae`;
    case "COMPLAINT_LAB_RETEST":
      return `/lab?retest=${task.id.replace("retest-", "")}`;
    default:
      return `/quality/complaints/${task.sourceRecordId}`;
  }
}

export function DashboardTasks() {
  const [, navigate] = useLocation();
  const { data: tasks = [], isLoading } = useQuery<UserTask[]>({
    queryKey: ["/api/tasks"],
    staleTime: 30_000,
  });

  return (
    <Card data-testid="card-my-tasks">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          My Tasks
          {tasks.length > 0 && (
            <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-4 ml-1">
              {tasks.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">No tasks right now</div>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => {
              const config = TASK_CONFIG[task.taskType];
              const Icon = config.icon;
              const isOverdue = task.taskType === "SAER_OVERDUE";
              const isAeUrgent = task.taskType === "COMPLAINT_AE_URGENT_REVIEW";
              return (
                <button
                  key={task.id}
                  className="w-full text-left flex items-start gap-2.5 rounded-md p-2 hover:bg-muted transition-colors"
                  onClick={() => navigate(getTaskRoute(task))}
                  data-testid={`task-item-${task.taskType}`}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      isOverdue || task.taskType === "REJECTED_LOT"
                        ? "text-destructive"
                        : task.isUrgent || isAeUrgent
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight">{config.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {task.primaryLabel ?? ""}
                      {task.secondaryLabel ? ` · ${task.secondaryLabel}` : ""}
                      {task.sourceModule === "RECEIVING" && task.quantityReceived
                        ? ` · ${task.quantityReceived} ${task.uom ?? ""}`
                        : ""}
                      {` · ${task.sourceIdentifier}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
