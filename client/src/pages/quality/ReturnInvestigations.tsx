import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface ReturnInvestigation {
  id: string;
  lotId: string;
  triggeredAt: string;
  returnsCount: number;
  thresholdAtTrigger: number;
  status: "OPEN" | "CLOSED";
  rootCause: string | null;
  correctiveAction: string | null;
  closedAt: string | null;
}

export default function ReturnInvestigations() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "CLOSED" | "">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState({ rootCause: "", correctiveAction: "" });
  const [showCeremony, setShowCeremony] = useState(false);

  const { data: investigations = [], isLoading } = useQuery<ReturnInvestigation[]>({
    queryKey: ["/api/return-investigations", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return apiRequest("GET", `/api/return-investigations?${params}`).then(r => r.json());
    },
  });

  const closeMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/return-investigations/${expandedId}/close`, {
        rootCause: closeForm.rootCause,
        correctiveAction: closeForm.correctiveAction,
        password,
      }).then(r => r.json()),
    onSuccess: () => {
      setShowCeremony(false);
      setExpandedId(null);
      setCloseForm({ rootCause: "", correctiveAction: "" });
      void qc.invalidateQueries({ queryKey: ["/api/return-investigations"] });
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const expanded = expandedId ? investigations.find(i => i.id === expandedId) : null;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/returns")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to returns
        </Button>
        <h1 className="text-xl font-semibold">Return investigations</h1>
      </div>

      <div className="flex gap-2">
        {(["", "OPEN", "CLOSED"] as const).map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s === "" ? "All" : s}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {investigations.length === 0 && (
          <p className="text-sm text-muted-foreground">No investigations found.</p>
        )}
        {investigations.map((inv) => (
          <Card key={inv.id} className={inv.status === "OPEN" ? "border-amber-500/30" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Lot {inv.lotId?.slice(0, 8)}… — {inv.returnsCount} returns (threshold {inv.thresholdAtTrigger})</span>
                <div className="flex items-center gap-2">
                  {inv.status === "OPEN"
                    ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Open</Badge>
                    : <Badge className="bg-muted text-muted-foreground border-0">Closed</Badge>
                  }
                  {inv.status === "OPEN" && (
                    <Button size="sm" variant="outline" onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}>
                      {expandedId === inv.id ? "Cancel" : "Close investigation"}
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>Triggered: {new Date(inv.triggeredAt).toLocaleString()}</div>
              {inv.rootCause && <div><span className="text-foreground">Root cause:</span> {inv.rootCause}</div>}
              {inv.correctiveAction && <div><span className="text-foreground">Corrective action:</span> {inv.correctiveAction}</div>}
              {inv.closedAt && <div>Closed: {new Date(inv.closedAt).toLocaleString()}</div>}

              {expandedId === inv.id && (
                <div className="pt-3 space-y-3">
                  <div>
                    <Label className="text-xs">Root cause</Label>
                    <Textarea rows={2} value={closeForm.rootCause} onChange={e => setCloseForm(f => ({ ...f, rootCause: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Corrective action</Label>
                    <Textarea rows={2} value={closeForm.correctiveAction} onChange={e => setCloseForm(f => ({ ...f, correctiveAction: e.target.value }))} />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowCeremony(true)}
                    disabled={!closeForm.rootCause || !closeForm.correctiveAction}
                  >
                    Sign close (F-04)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <SignatureCeremony
        open={showCeremony}
        onOpenChange={setShowCeremony}
        entityDescription={`Return investigation — lot ${expanded?.lotId?.slice(0, 8) ?? ""}…`}
        meaning="RETURN_INVESTIGATION_CLOSE"
        isPending={closeMutation.isPending}
        onSign={async (password) => { closeMutation.mutate(password); }}
      />
    </div>
  );
}
