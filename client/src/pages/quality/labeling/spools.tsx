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
import { SpoolReceiveDialog } from "@/components/labeling/SpoolReceiveDialog";
import type { LabelSpool, LabelArtwork, Product } from "@shared/schema";

function spoolStatusBadge(status: LabelSpool["status"]) {
  const variants: Record<LabelSpool["status"], string> = {
    ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    DEPLETED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    QUARANTINED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    DISPOSED: "bg-slate-100 text-slate-400",
  };
  return <Badge className={`text-xs ${variants[status]}`}>{status}</Badge>;
}

function ageDays(createdAt: string | Date | null | undefined): string {
  if (!createdAt) return "—";
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  return `${days}d`;
}

export default function SpoolsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const [productId, setProductId] = useState<string>("");
  const [artworkId, setArtworkId] = useState<string>("");
  const [receiveOpen, setReceiveOpen] = useState(false);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => (await apiRequest("GET", "/api/products")).json(),
  });

  const { data: artworks } = useQuery<LabelArtwork[]>({
    queryKey: ["/api/label-artwork", productId],
    queryFn: async () => (await apiRequest("GET", `/api/label-artwork?productId=${productId}`)).json(),
    enabled: !!productId,
  });

  const { data: spools, isLoading } = useQuery<LabelSpool[]>({
    queryKey: ["/api/label-spools", artworkId],
    queryFn: async () => (await apiRequest("GET", `/api/label-spools?artworkId=${artworkId}`)).json(),
    enabled: !!artworkId,
  });

  const disposeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/label-spools/${id}/dispose`, { reason: "Disposed via Quality UI" });
      if (!res.ok) {
        const body = await res.json() as { message?: string };
        throw new Error(body.message ?? "Failed to dispose spool");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/label-spools"] });
      toast({ title: "Spool disposed" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={productId} onValueChange={(v) => { setProductId(v); setArtworkId(""); }}>
          <SelectTrigger className="w-56" data-testid="select-spools-product">
            <SelectValue placeholder="Product…" />
          </SelectTrigger>
          <SelectContent>
            {(products ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={artworkId} onValueChange={setArtworkId} disabled={!productId}>
          <SelectTrigger className="w-44" data-testid="select-spools-artwork">
            <SelectValue placeholder="Artwork version…" />
          </SelectTrigger>
          <SelectContent>
            {(artworks ?? []).filter((a) => a.status === "APPROVED").map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.version}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManage && artworkId && (
          <Button size="sm" onClick={() => setReceiveOpen(true)} data-testid="button-receive-spool">
            + Receive spool
          </Button>
        )}
      </div>

      {!artworkId && (
        <p className="text-sm text-muted-foreground" data-testid="text-spools-empty-state">
          Select a product and artwork version to view spools.
        </p>
      )}

      {artworkId && isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {artworkId && !isLoading && spools !== undefined && (
        <Table data-testid="table-spools">
          <TableHeader>
            <TableRow>
              <TableHead>Spool #</TableHead>
              <TableHead>Qty on hand</TableHead>
              <TableHead>Qty initial</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {spools.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">
                  No spools for this artwork.
                </TableCell>
              </TableRow>
            )}
            {spools.map((s) => (
              <TableRow key={s.id} data-testid={`row-spool-${s.id}`}>
                <TableCell className="font-mono text-sm">{s.spoolNumber}</TableCell>
                <TableCell className="tabular-nums">{s.qtyOnHand}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{s.qtyInitial}</TableCell>
                <TableCell>{spoolStatusBadge(s.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{ageDays(s.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {canManage && s.status !== "DISPOSED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => disposeMutation.mutate(s.id)}
                      disabled={disposeMutation.isPending}
                      data-testid={`button-dispose-spool-${s.id}`}
                    >
                      Dispose
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {artworkId && (
        <SpoolReceiveDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          artworkId={artworkId}
          onReceived={() => queryClient.invalidateQueries({ queryKey: ["/api/label-spools", artworkId] })}
        />
      )}
    </div>
  );
}
