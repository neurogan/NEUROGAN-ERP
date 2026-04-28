import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BatchProductionRecord } from "@shared/schema";

export default function ReconciliationQueueTab() {
  const [, setLocation] = useLocation();

  const { data: bprs, isLoading, isError } = useQuery<BatchProductionRecord[]>({
    queryKey: ["/api/batch-production-records", "IN_PROGRESS"],
    queryFn: async () => (await apiRequest("GET", "/api/batch-production-records?status=IN_PROGRESS")).json(),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load batch production records.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Batch production records currently IN_PROGRESS. Navigate to a batch to issue labels or reconcile.
      </p>

      <Table data-testid="table-recon-queue">
        <TableHeader>
          <TableRow>
            <TableHead>Batch number</TableHead>
            <TableHead>Production batch ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(!bprs || bprs.length === 0) && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8" data-testid="text-recon-queue-empty">
                No in-progress batches.
              </TableCell>
            </TableRow>
          )}
          {(bprs ?? []).map((bpr) => (
            <TableRow key={bpr.id} data-testid={`row-recon-bpr-${bpr.id}`}>
              <TableCell className="font-mono text-sm">{bpr.batchNumber}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{bpr.productionBatchId}</TableCell>
              <TableCell>
                <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                  {bpr.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLocation("/production")}
                  data-testid={`button-view-bpr-${bpr.id}`}
                >
                  View in Production
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
