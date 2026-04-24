import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
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
  const { data: items = [], isLoading, isError } = useQuery<ApprovedMaterialEntry[]>({ queryKey: ["/api/approved-materials"] });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/approved-materials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/approved-materials"] });
      // revocation may change which tasks appear in the dashboard
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Approval revoked. Future receipts of this material will require re-qualification." });
    },
    onError: (err: Error) => toast({ title: "Failed to revoke approval", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError) return (
    <div className="p-6 text-sm text-destructive">Could not load approved materials. Refresh to try again.</div>
  );

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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive hover:text-destructive"
                        disabled={revokeMutation.isPending}
                      >
                        Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke approval?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The next receipt of <strong>{item.productName}</strong> from <strong>{item.supplierName}</strong> will require full re-qualification before release.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => revokeMutation.mutate(item.id)}
                        >
                          Revoke approval
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
