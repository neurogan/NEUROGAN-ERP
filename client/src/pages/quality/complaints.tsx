import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";

interface Complaint {
  id: string;
  helpcoreRef: string;
  status: string;
  customerName: string;
  customerEmail: string;
  severity: string | null;
  defectCategory: string | null;
  aeFlag: boolean;
  lotCodeRaw: string;
  intakeAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  TRIAGE: "Triage",
  LOT_UNRESOLVED: "Lot Unresolved",
  INVESTIGATION: "Investigation",
  AE_URGENT_REVIEW: "AE Urgent Review",
  AWAITING_DISPOSITION: "Awaiting Disposition",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  TRIAGE: "secondary",
  LOT_UNRESOLVED: "destructive",
  INVESTIGATION: "secondary",
  AE_URGENT_REVIEW: "destructive",
  AWAITING_DISPOSITION: "secondary",
  CLOSED: "outline",
  CANCELLED: "outline",
};

export default function ComplaintsPage() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [aeOnly, setAeOnly] = useState(false);
  const [search, setSearch] = useState("");

  const { data: complaints = [], isLoading } = useQuery<Complaint[]>({
    queryKey: ["/api/complaints", statusFilter, aeOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (aeOnly) params.set("aeOnly", "true");
      const res = await fetch(`/api/complaints?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load complaints");
      return res.json() as Promise<Complaint[]>;
    },
  });

  const filtered = complaints.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.helpcoreRef.toLowerCase().includes(q) ||
      c.customerName.toLowerCase().includes(q) ||
      c.customerEmail.toLowerCase().includes(q) ||
      c.lotCodeRaw.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search ref, customer, lot…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-52" data-tour="complaints-status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={aeOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setAeOnly(!aeOnly)}
            data-tour="complaints-ae-flag"
          >
            AE only
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/quality/complaints/trends")}
        >
          Trends
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Table data-tour="complaints-list">
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Lot</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Intake</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No complaints found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/quality/complaints/${c.id}`)}
                >
                  <TableCell className="font-mono text-xs">
                    {c.aeFlag && <AlertTriangle className="inline h-3 w-3 text-amber-400 mr-1" />}
                    {c.helpcoreRef}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{c.customerName}</div>
                    <div className="text-xs text-muted-foreground">{c.customerEmail}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.lotCodeRaw}</TableCell>
                  <TableCell>
                    {c.severity && (
                      <Badge variant={c.severity === "HIGH" ? "destructive" : "secondary"} className="text-[10px]">
                        {c.severity}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"} className="text-[10px]">
                      {STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(c.intakeAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
