import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { useToast } from "@/hooks/use-toast";

interface Signature {
  fullNameAtSigning: string;
  titleAtSigning: string | null;
  meaning: string;
  signedAt: string;
  commentary: string | null;
}

interface ValidationDocumentDetail {
  id: string;
  docId: string;
  title: string;
  type: string;
  module: string;
  content: string;
  status: "DRAFT" | "SIGNED";
  signature: Signature | null;
}

async function fetchDoc(id: string): Promise<ValidationDocumentDetail> {
  const res = await fetch(`/api/validation-documents/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load document");
  return res.json();
}

async function signDoc(id: string, password: string, commentary: string): Promise<ValidationDocumentDetail> {
  const res = await fetch(`/api/validation-documents/${id}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password, commentary }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? "Signature failed");
  }
  return res.json();
}

export default function ValidationDetail() {
  const [, params] = useRoute("/quality/validation/:id");
  const [, navigate] = useLocation();
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  const { data: doc, isLoading, isError } = useQuery({
    queryKey: ["validation-document", id],
    queryFn: () => fetchDoc(id),
    enabled: !!id,
  });

  const { mutateAsync: sign, isPending } = useMutation({
    mutationFn: ({ password, commentary }: { password: string; commentary: string }) =>
      signDoc(id, password, commentary),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["validation-document", id] });
      queryClient.invalidateQueries({ queryKey: ["validation-documents"] });
      setCeremonyOpen(false);
      toast({ title: "Document signed", description: "The document is now locked." });
    },
    onError: (err: Error) => {
      toast({ title: "Signature failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (isError || !doc) return <div className="p-6 text-destructive text-sm">Failed to load document.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <button
        onClick={() => navigate("/quality/validation")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to validation documents
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{doc.docId} · {doc.type} · {doc.module}</p>
        </div>
        {doc.status === "SIGNED" ? (
          <Badge variant="default" className="bg-green-600 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Signed
          </Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
      </div>

      {/* Document content — rendered as monospace preformatted text */}
      <div className="border rounded-lg p-6 bg-card font-mono text-sm whitespace-pre-wrap leading-relaxed mb-8">
        {doc.content}
      </div>

      {/* Signature block — only for SIGNED docs */}
      {doc.status === "SIGNED" && doc.signature && (
        <div className="border border-green-200 rounded-lg p-4 bg-green-50 dark:bg-green-950/20 dark:border-green-900 mb-6">
          <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">Electronically signed</p>
          <p className="text-sm">
            <span className="font-semibold">{doc.signature.fullNameAtSigning}</span>
            {doc.signature.titleAtSigning && `, ${doc.signature.titleAtSigning}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {doc.signature.meaning} ·{" "}
            {new Date(doc.signature.signedAt).toLocaleString("en-US", {
              year: "numeric", month: "long", day: "numeric",
              hour: "2-digit", minute: "2-digit", timeZoneName: "short",
            })}
          </p>
          {doc.signature.commentary && (
            <p className="text-sm mt-1 italic">{doc.signature.commentary}</p>
          )}
        </div>
      )}

      {/* Sign button — only for DRAFT */}
      {doc.status === "DRAFT" && (
        <div className="flex justify-end">
          <Button onClick={() => setCeremonyOpen(true)}>Sign document</Button>
        </div>
      )}

      <SignatureCeremony
        open={ceremonyOpen}
        onOpenChange={setCeremonyOpen}
        entityDescription={doc.title}
        meaning="APPROVED"
        isPending={isPending}
        onSign={async (password, commentary) => {
          await sign({ password, commentary: commentary ?? "" });
        }}
      />
    </div>
  );
}
