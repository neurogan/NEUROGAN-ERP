import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { ArrowLeft, Download } from "lucide-react";

interface TrendRow {
  month: string;
  defect_category: string | null;
  count: number;
  ae_count: number;
}

export default function ComplaintTrends() {
  const [, navigate] = useLocation();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: rows = [], isLoading } = useQuery<TrendRow[]>({
    queryKey: ["/api/complaints/trends", from, to],
    queryFn: () =>
      apiRequest("GET", `/api/complaints/trends?from=${from}&to=${to}`).then((r) => r.json()),
  });

  // Aggregate by month for the chart
  const byMonth = rows.reduce<Record<string, { total: number; aeCount: number }>>((acc, row) => {
    const m = row.month.slice(0, 7);
    if (!acc[m]) acc[m] = { total: 0, aeCount: 0 };
    acc[m].total += row.count;
    acc[m].aeCount += row.ae_count;
    return acc;
  }, {});

  const chartData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, total: v.total, aeCount: v.aeCount }));

  function exportCsv() {
    const header = "month,defect_category,count,ae_count";
    const body = rows.map((r) => `${r.month.slice(0, 7)},${r.defect_category ?? ""},${r.count},${r.ae_count}`).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `complaints-trends-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/complaints")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-semibold">Complaint Trends</h1>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Monthly complaint volume</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No data for selected range</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total" name="Total" fill="#6366f1" radius={[2, 2, 0, 0]} />
                <Bar dataKey="aeCount" name="AE flag" fill="#f59e0b" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">By month × defect category</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Defect category</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">AE count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data</TableCell></TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{r.month.slice(0, 7)}</TableCell>
                    <TableCell className="text-xs">{r.defect_category ?? "—"}</TableCell>
                    <TableCell className="text-xs text-right">{r.count}</TableCell>
                    <TableCell className="text-xs text-right">{r.ae_count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
