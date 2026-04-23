import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ValidationDocumentSummary {
  id: string;
  docId: string;
  title: string;
  type: string;
  module: string;
  status: "DRAFT" | "SIGNED";
  signatureId: string | null;
  createdAt: string;
  updatedAt: string;
  signedBy: string | null;
  signedAt: string | null;
}

async function fetchValidationDocuments(): Promise<ValidationDocumentSummary[]> {
  const res = await fetch("/api/validation-documents", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load validation documents");
  return res.json();
}

export default function ValidationList() {
  const [, navigate] = useLocation();
  const { data: docs = [], isLoading, isError } = useQuery({
    queryKey: ["validation-documents"],
    queryFn: fetchValidationDocuments,
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (isError) return <div className="p-6 text-destructive text-sm">Failed to load validation documents.</div>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Validation Documents</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Platform and module IQ / OQ / PQ / VSR records. QA signature required to proceed to Phase 1.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Module</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signed At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => (
            <TableRow
              key={doc.id}
              className="cursor-pointer"
              onClick={() => navigate(`/quality/validation/${doc.id}`)}
            >
              <TableCell className="font-medium">{doc.title}</TableCell>
              <TableCell>{doc.type}</TableCell>
              <TableCell>{doc.module}</TableCell>
              <TableCell>
                {doc.status === "SIGNED" ? (
                  <Badge variant="default" className="bg-green-600">Signed</Badge>
                ) : (
                  <Badge variant="secondary">Draft</Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {doc.status === "SIGNED" && doc.signedAt ? (
                  <span>
                    {doc.signedBy ?? "—"} ·{" "}
                    {new Date(doc.signedAt).toLocaleDateString("en-US", {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
