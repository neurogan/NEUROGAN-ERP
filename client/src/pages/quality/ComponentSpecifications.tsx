import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface ActiveVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  signatureId: string | null;
  createdByUserId: string;
  createdAt: string;
}

interface ComponentSpecRow {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  productCategory: string;
  createdByName: string;
  versions: ActiveVersion[];
  activeVersion: ActiveVersion | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  ACTIVE_INGREDIENT: "Active Ingredient",
  SUPPORTING_INGREDIENT: "Supporting Ingredient",
  PRIMARY_PACKAGING: "Primary Packaging",
  SECONDARY_PACKAGING: "Secondary Packaging",
};

function statusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const variants: Record<string, string> = {
    DRAFT: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    SUPERSEDED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <Badge className={`text-xs ${variants[status] ?? ""}`}>{status}</Badge>
  );
}

export default function ComponentSpecifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const canManage = user?.roles?.some((r) => r === "QA" || r === "ADMIN") ?? false;

  const { data: specs, isLoading } = useQuery<ComponentSpecRow[]>({
    queryKey: ["/api/component-specs"],
    queryFn: async () => (await apiRequest("GET", "/api/component-specs")).json(),
  });

  const createMutation = useMutation({
    mutationFn: (productId: string) =>
      apiRequest("POST", "/api/component-specs", { productId }),
    onSuccess: async (res) => {
      const data = (await res.json()) as { id: string };
      queryClient.invalidateQueries({ queryKey: ["/api/component-specs"] });
      navigate(`/quality/component-specifications/${data.id}`);
    },
    onError: () =>
      toast({ title: "Failed to create specification", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="component-specs-loading">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!specs || specs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="component-specs-empty">
        No component products found.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Table data-testid="table-component-specs">
        <TableHeader>
          <TableRow>
            <TableHead>Product Name</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Active Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Approved</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {specs.map((item) => {
            const hasSpec = item.id !== "";
            const draftVersion = item.versions.find((v) => v.status === "DRAFT") ?? null;
            const displayStatus = item.activeVersion?.status ?? (draftVersion ? "DRAFT" : null);
            const activeVersionNumber = item.activeVersion?.versionNumber ?? (draftVersion?.versionNumber ?? null);

            return (
              <TableRow
                key={item.productId}
                data-testid={`row-component-spec-${item.productId}`}
                className={hasSpec ? "cursor-pointer hover:bg-muted/50" : undefined}
                onClick={hasSpec ? () => navigate(`/quality/component-specifications/${item.id}`) : undefined}
              >
                <TableCell className="text-sm font-medium">{item.productName}</TableCell>
                <TableCell className="font-mono text-sm">{item.productSku}</TableCell>
                <TableCell className="text-sm">
                  {CATEGORY_LABELS[item.productCategory] ?? item.productCategory}
                </TableCell>
                <TableCell className="text-sm">
                  {activeVersionNumber !== null ? `v${activeVersionNumber}` : "—"}
                </TableCell>
                <TableCell>{statusBadge(displayStatus)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.activeVersion?.createdAt
                    ? new Date(item.activeVersion.createdAt).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {!hasSpec && canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        createMutation.mutate(item.productId);
                      }}
                      disabled={createMutation.isPending}
                      data-testid={`button-create-spec-${item.productId}`}
                    >
                      Create spec
                    </Button>
                  ) : hasSpec ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/quality/component-specifications/${item.id}`);
                      }}
                      data-testid={`button-view-spec-${item.id}`}
                    >
                      View
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
