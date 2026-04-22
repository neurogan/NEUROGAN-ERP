import { useState, useCallback } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, RefreshCw, ShieldAlert } from "lucide-react";

// ── Types ────────────────────────────────────────────────────

const ALL_ACTIONS = [
  "CREATE", "UPDATE", "DELETE_BLOCKED", "TRANSITION", "SIGN",
  "LOGIN", "LOGIN_FAILED", "LOGOUT", "ROLE_GRANT", "ROLE_REVOKE", "PASSWORD_ROTATE",
] as const;
type AuditAction = (typeof ALL_ACTIONS)[number];

interface AuditRow {
  id: string;
  occurredAt: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  route: string | null;
  requestId: string | null;
  meta: unknown;
}

interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

interface UserRow {
  id: string;
  email: string;
  fullName: string;
}

// ── Helpers ──────────────────────────────────────────────────

function actionVariant(action: AuditAction): "default" | "secondary" | "outline" | "destructive" {
  if (action === "LOGIN" || action === "LOGOUT") return "secondary";
  if (action === "LOGIN_FAILED" || action === "DELETE_BLOCKED") return "destructive";
  if (action === "SIGN") return "default";
  return "outline";
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

// ── Filters ──────────────────────────────────────────────────

interface Filters {
  action: string;
  entityType: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { action: "", entityType: "", from: "", to: "" };

function buildParams(filters: Filters, cursor?: string): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.action) p.set("action", filters.action);
  if (filters.entityType) p.set("entityType", filters.entityType);
  if (filters.from) p.set("from", new Date(filters.from).toISOString());
  if (filters.to) p.set("to", new Date(filters.to).toISOString());
  if (cursor) p.set("cursor", cursor);
  return p;
}

// ── Row detail expand ────────────────────────────────────────

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
      <pre className="text-[11px] leading-relaxed bg-muted rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ExpandedRow({ row }: { row: AuditRow }) {
  const hasDetail = row.before !== null && row.before !== undefined
    || row.after !== null && row.after !== undefined
    || row.meta !== null && row.meta !== undefined;
  if (!hasDetail) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="bg-muted/30 px-6 py-3 text-xs text-muted-foreground">
          No additional details.
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell colSpan={6} className="bg-muted/30 px-6 py-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <JsonBlock label="Before" value={row.before} />
          <JsonBlock label="After" value={row.after} />
          <JsonBlock label="Meta" value={row.meta} />
        </div>
        {row.requestId && (
          <div className="mt-2 text-[10px] text-muted-foreground font-mono">
            Request ID: {row.requestId}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function AuditTrail() {
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes("ADMIN") ?? false;

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // User name lookup (admin sees /api/users)
  const { data: users } = useQuery<UserRow[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<UserRow[]>;
    },
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const nameOf = useCallback(
    (userId: string): string => {
      const u = users?.find((x) => x.id === userId);
      return u ? `${u.fullName} (${u.email})` : userId.slice(0, 8) + "…";
    },
    [users],
  );

  // Paginated audit rows
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery<AuditPage>({
    queryKey: ["/api/audit", applied],
    queryFn: async ({ pageParam }) => {
      const params = buildParams(applied, pageParam as string | undefined);
      params.set("limit", "50");
      const res = await fetch(`/api/audit?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<AuditPage>;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const allRows = data?.pages.flatMap((p) => p.rows) ?? [];

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => setApplied({ ...filters });
  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const handleExport = () => {
    const params = buildParams(applied);
    window.location.href = `/api/audit/export?${params.toString()}`;
  };

  // ── Access check ─────────────────────────────────────────

  const canView = user?.roles?.some((r) => r === "ADMIN" || r === "QA") ?? false;
  if (!canView) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Audit Trail</h1>
        </div>
        <div className="rounded-md border border-border p-6 bg-muted/40">
          <p className="text-sm font-medium">Access restricted</p>
          <p className="text-xs text-muted-foreground mt-1">
            The audit trail is accessible to ADMIN and QA roles only (21 CFR Part 11 §11.10(e)).
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Audit Trail</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tamper-evident record of all regulated actions. 21 CFR Part 11 §11.10(e).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            data-testid="button-refresh-audit"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              data-testid="button-export-audit"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export NDJSON
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b shrink-0 bg-muted/20">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select
              value={filters.action || "__all"}
              onValueChange={(v) => setFilters((f) => ({ ...f, action: v === "__all" ? "" : v }))}
            >
              <SelectTrigger className="h-8 w-44 text-xs" data-testid="filter-action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All actions</SelectItem>
                {ALL_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Entity type</Label>
            <Input
              className="h-8 w-32 text-xs"
              placeholder="user, batch…"
              value={filters.entityType}
              onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
              data-testid="filter-entity-type"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="datetime-local"
              className="h-8 text-xs"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              data-testid="filter-from"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="datetime-local"
              className="h-8 text-xs"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              data-testid="filter-to"
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-8" onClick={handleApply} data-testid="button-apply-filters">
              Apply
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={handleReset} data-testid="button-reset-filters">
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isError ? (
          <div className="p-6 text-sm text-destructive">Failed to load audit rows. Check your connection or permissions.</div>
        ) : (
          <div className="rounded-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead className="text-xs w-44">Timestamp</TableHead>
                  <TableHead className="text-xs w-36">Action</TableHead>
                  <TableHead className="text-xs">Entity</TableHead>
                  <TableHead className="text-xs">Who</TableHead>
                  <TableHead className="text-xs">Route</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : allRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-12">
                      No audit rows match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  allRows.map((row) => {
                    const isExpanded = expanded.has(row.id);
                    return (
                      <>
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => toggleExpand(row.id)}
                          data-testid={`row-audit-${row.id}`}
                        >
                          <TableCell className="py-2 pr-0">
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-xs font-mono whitespace-nowrap py-2">
                            {fmt(row.occurredAt)}
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge variant={actionVariant(row.action)} className="text-xs font-mono">
                              {row.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs py-2">
                            <span className="font-medium">{row.entityType}</span>
                            {row.entityId && (
                              <span className="ml-1 text-muted-foreground font-mono">
                                {row.entityId.length > 16
                                  ? row.entityId.slice(0, 8) + "…"
                                  : row.entityId}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs py-2 max-w-[200px] truncate">
                            {nameOf(row.userId)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono py-2 max-w-[180px] truncate">
                            {row.route ?? "—"}
                          </TableCell>
                        </TableRow>
                        {isExpanded && <ExpandedRow key={`${row.id}-expanded`} row={row} />}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Load more */}
        {hasNextPage && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="button-load-more-audit"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
