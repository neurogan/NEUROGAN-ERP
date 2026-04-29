import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import type { Sop } from "@shared/schema";

type SopAction = { sop: Sop; meaning: "SOP_APPROVED" | "SOP_RETIRED" } | null;

function statusBadge(status: Sop["status"]) {
  const variants: Record<Sop["status"], string> = {
    DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    RETIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return <Badge className={`text-xs ${variants[status]}`}>{status}</Badge>;
}

export default function SopsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SopAction>(null);

  const { data: sops, isLoading } = useQuery<Sop[]>({
    queryKey: ["/api/sops"],
    queryFn: async () => (await apiRequest("GET", "/api/sops")).json(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sops", { code, title, version });
      if (!res.ok) {
        const body = await res.json() as { message?: string };
        throw new Error(body.message ?? "Failed to create SOP");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sops"] });
      toast({ title: "SOP created" });
      setCreateOpen(false);
      setCode(""); setTitle(""); setVersion(""); setCreateError(null);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ endpoint, password }: { endpoint: string; password: string }) => {
      const res = await apiRequest("POST", endpoint, { password });
      if (!res.ok) {
        const body = await res.json() as { message?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sops"] });
      toast({ title: "Done", description: `SOP ${pendingAction?.meaning === "SOP_APPROVED" ? "approved" : "retired"}.` });
      setPendingAction(null);
    },
  });

  async function onSign(password: string) {
    if (!pendingAction) return;
    const endpoint = pendingAction.meaning === "SOP_APPROVED"
      ? `/api/sops/${pendingAction.sop.id}/approve`
      : `/api/sops/${pendingAction.sop.id}/retire`;
    await actionMutation.mutateAsync({ endpoint, password });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-sop">
            + New SOP
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {!isLoading && sops !== undefined && (
        <Table data-testid="table-sops">
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sops.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6" data-testid="text-sops-empty">
                  No SOPs registered yet.
                </TableCell>
              </TableRow>
            )}
            {sops.map((sop) => (
              <TableRow key={sop.id} data-testid={`row-sop-${sop.id}`}>
                <TableCell className="font-mono text-sm">{sop.code}</TableCell>
                <TableCell className="text-sm">{sop.title}</TableCell>
                <TableCell className="font-mono text-sm">{sop.version}</TableCell>
                <TableCell>{statusBadge(sop.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {sop.approvedAt ? new Date(sop.approvedAt).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {canManage && sop.status === "DRAFT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ sop, meaning: "SOP_APPROVED" })}
                      data-testid={`button-approve-sop-${sop.id}`}
                    >
                      Approve
                    </Button>
                  )}
                  {canManage && sop.status === "APPROVED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ sop, meaning: "SOP_RETIRED" })}
                      data-testid={`button-retire-sop-${sop.id}`}
                    >
                      Retire
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(next) => { if (!next) { setCode(""); setTitle(""); setVersion(""); setCreateError(null); } setCreateOpen(next); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>New SOP</DialogTitle>
            <DialogDescription className="text-xs">Creates a DRAFT SOP. Approve it once the document is ready.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3" data-testid="form-create-sop">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SOP-LAB-001" data-testid="input-sop-code" />
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Label Application Procedure" data-testid="input-sop-title" />
            </div>
            <div className="space-y-1.5">
              <Label>Version</Label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 1.0" data-testid="input-sop-version" />
            </div>
            {createError && (
              <p className="text-xs text-destructive" data-testid="text-sop-create-error">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!code || !title || !version || createMutation.isPending}
              data-testid="button-submit-create-sop"
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignatureCeremony
        open={pendingAction !== null}
        onOpenChange={(next) => { if (!next) setPendingAction(null); }}
        entityDescription={pendingAction ? `SOP ${pendingAction.sop.code} v${pendingAction.sop.version}` : ""}
        meaning={pendingAction?.meaning ?? "SOP_APPROVED"}
        onSign={onSign}
        isPending={actionMutation.isPending}
      />
    </div>
  );
}
