import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ApprovedMaterialEntry {
  id: string;
  productName: string;
  productSku: string;
  supplierName: string;
  approvedByName: string;
  approvedAt: string;
  notes: string | null;
  isActive: boolean;
}

export function ApprovedMaterialsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery<ApprovedMaterialEntry[]>({ queryKey: ["/api/approved-materials"] });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/approved-materials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/approved-materials"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Approval revoked. Future receipts of this material will require re-qualification." });
    },
    onError: () => toast({ title: "Failed to revoke approval", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold mb-1">Approved Materials</h2>
        <p className="text-sm text-muted-foreground">
          Materials and supplier combinations approved for receiving. Created automatically on first QC approval of a new material.
          Revoking forces re-qualification on the next receipt.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">
          No approved materials yet. They appear here automatically after a new material is received and QC-approved for the first time.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Approved by</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium text-sm">{item.productName}</div>
                  <div className="text-xs text-muted-foreground">{item.productSku}</div>
                </TableCell>
                <TableCell className="text-sm">{item.supplierName}</TableCell>
                <TableCell className="text-sm">{item.approvedByName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(item.approvedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={() => revokeMutation.mutate(item.id)}
                    disabled={revokeMutation.isPending}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
