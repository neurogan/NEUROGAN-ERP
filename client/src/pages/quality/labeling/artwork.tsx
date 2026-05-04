import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { ArtworkCreateDialog } from "@/components/labeling/ArtworkCreateDialog";
import type { LabelArtwork, Product } from "@shared/schema";

type ArtworkAction = { artwork: LabelArtwork; meaning: "LABEL_ARTWORK_APPROVED" | "LABEL_ARTWORK_RETIRED" } | null;

function statusBadge(status: LabelArtwork["status"]) {
  const variants: Record<LabelArtwork["status"], string> = {
    DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    RETIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return <Badge className={`text-xs ${variants[status]}`}>{status}</Badge>;
}

export default function ArtworkTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const [productId, setProductId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ArtworkAction>(null);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => (await apiRequest("GET", "/api/products")).json(),
  });

  const { data: artworks, isLoading } = useQuery<LabelArtwork[]>({
    queryKey: ["/api/label-artwork", productId],
    queryFn: async () => (await apiRequest("GET", `/api/label-artwork?productId=${productId}`)).json(),
    enabled: !!productId,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ endpoint, password }: { id: string; endpoint: string; password: string }) => {
      const res = await apiRequest("POST", endpoint, { password });
      if (!res.ok) {
        const body = await res.json() as { message?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/label-artwork"] });
      toast({ title: "Done", description: `Artwork ${pendingAction?.meaning === "LABEL_ARTWORK_APPROVED" ? "approved" : "retired"}.` });
      setPendingAction(null);
    },
  });

  async function onSign(password: string) {
    if (!pendingAction) return;
    const endpoint = pendingAction.meaning === "LABEL_ARTWORK_APPROVED"
      ? `/api/label-artwork/${pendingAction.artwork.id}/approve`
      : `/api/label-artwork/${pendingAction.artwork.id}/retire`;
    await actionMutation.mutateAsync({ id: pendingAction.artwork.id, endpoint, password });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="w-64" data-testid="select-artwork-product-filter">
            <SelectValue placeholder="Select product to filter…" />
          </SelectTrigger>
          <SelectContent>
            {(products ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-artwork" data-tour="labeling-new-artwork">
            + New artwork
          </Button>
        )}
      </div>

      {!productId && (
        <p className="text-sm text-muted-foreground" data-testid="text-artwork-empty-state">
          Select a product above to view its label artwork.
        </p>
      )}

      {productId && isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {productId && !isLoading && artworks !== undefined && (
        <Table data-testid="table-artworks" data-tour="labeling-artwork-list">
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artworks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                  No artwork for this product.
                </TableCell>
              </TableRow>
            )}
            {artworks.map((a) => (
              <TableRow key={a.id} data-testid={`row-artwork-${a.id}`}>
                <TableCell className="font-mono text-sm">{a.version}</TableCell>
                <TableCell>{statusBadge(a.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.approvedAt ? new Date(a.approvedAt).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {canManage && a.status === "DRAFT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ artwork: a, meaning: "LABEL_ARTWORK_APPROVED" })}
                      data-testid={`button-approve-artwork-${a.id}`}
                    >
                      Approve
                    </Button>
                  )}
                  {canManage && a.status === "APPROVED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ artwork: a, meaning: "LABEL_ARTWORK_RETIRED" })}
                      data-testid={`button-retire-artwork-${a.id}`}
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

      <ArtworkCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { if (productId) queryClient.invalidateQueries({ queryKey: ["/api/label-artwork", productId] }); }}
      />

      <SignatureCeremony
        open={pendingAction !== null}
        onOpenChange={(next) => { if (!next) setPendingAction(null); }}
        entityDescription={pendingAction ? `artwork ${pendingAction.artwork.version}` : ""}
        meaning={pendingAction?.meaning ?? "LABEL_ARTWORK_APPROVED"}
        onSign={onSign}
        isPending={actionMutation.isPending}
      />
    </div>
  );
}
