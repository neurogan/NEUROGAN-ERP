import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, FlaskConical, ClipboardCheck, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComponentType } from "react";

interface UserTask {
  id: string;
  taskType: "LAB_TEST_REQUIRED" | "QUALIFICATION_REQUIRED" | "PENDING_QC" | "IDENTITY_CHECK_REQUIRED" | "REJECTED_LOT";
  receivingRecordId: string;
  receivingIdentifier: string;
  materialName: string | null;
  supplierName: string | null;
  quantityReceived: string | null;
  uom: string | null;
  dateReceived: string | null;
  isUrgent: boolean;
}

async function fetchTasks(): Promise<UserTask[]> {
  const res = await fetch("/api/tasks", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load tasks");
  return res.json();
}

const TASK_CONFIG: Record<UserTask["taskType"], { label: string; icon: ComponentType<{ className?: string }> }> = {
  LAB_TEST_REQUIRED: { label: "Full lab test required", icon: FlaskConical },
  QUALIFICATION_REQUIRED: { label: "New material — qualification required", icon: AlertTriangle },
  PENDING_QC: { label: "Lot pending QC disposition", icon: ClipboardCheck },
  IDENTITY_CHECK_REQUIRED: { label: "Identity check required", icon: Search },
  REJECTED_LOT: { label: "Rejected lot — coordinate return", icon: XCircle },
};

export function DashboardTasks() {
  const [, navigate] = useLocation();
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["dashboard-tasks"],
    queryFn: fetchTasks,
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
              return (
                <button
                  key={task.id}
                  className="w-full text-left flex items-start gap-2.5 rounded-md p-2 hover:bg-muted transition-colors"
                  onClick={() => navigate(`/receiving?highlight=${task.receivingRecordId}`)}
                  data-testid={`task-item-${task.taskType}`}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      task.isUrgent ? "text-amber-400" : task.taskType === "REJECTED_LOT" ? "text-destructive" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight">{config.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {task.materialName ?? "Unknown material"}
                      {task.supplierName ? ` · ${task.supplierName}` : ""}
                      {task.quantityReceived ? ` · ${task.quantityReceived} ${task.uom ?? ""}` : ""}
                      {task.dateReceived ? ` · ${task.receivingIdentifier}` : ""}
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
