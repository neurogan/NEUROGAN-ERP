import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

function printDocument(doc: ValidationDocumentDetail, contentHtml: string) {
  const sig = doc.signature!;
  const signedAt = new Date(sig.signedAt).toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "long",
  });
  const printedAt = new Date().toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${doc.docId} — ${doc.title}</title>
  <style>
    @page { size: A4; margin: 18mm 20mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Georgia", "Times New Roman", serif;
      font-size: 10.5pt;
      color: #1a1a1a;
      line-height: 1.6;
    }

    /* ── Page header ── */
    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 12px;
      margin-bottom: 20px;
      border-bottom: 2px solid #1a1a1a;
    }
    .company-block { display: flex; flex-direction: column; gap: 2px; }
    .company-name {
      font-size: 16pt;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #1a1a1a;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .company-sub {
      font-size: 8pt;
      color: #555;
      font-family: "Helvetica Neue", Arial, sans-serif;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .doc-meta-block { text-align: right; font-family: "Helvetica Neue", Arial, sans-serif; }
    .doc-meta-block .doc-id { font-size: 9pt; font-weight: 600; color: #333; }
    .doc-meta-block .doc-type { font-size: 8pt; color: #666; margin-top: 2px; }
    .signed-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      background: #166534;
      color: #fff;
      font-size: 7.5pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 3px;
    }

    /* ── Document title ── */
    .doc-title {
      font-size: 17pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 4px;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .doc-subtitle {
      font-size: 9pt;
      color: #555;
      margin-bottom: 24px;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }

    /* ── Content ── */
    .content { margin-bottom: 32px; }
    .content h1 {
      font-size: 13pt; font-weight: 700; margin: 20px 0 8px;
      font-family: "Helvetica Neue", Arial, sans-serif;
      border-bottom: 1px solid #ccc; padding-bottom: 4px;
    }
    .content h2 {
      font-size: 11pt; font-weight: 700; margin: 16px 0 6px;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .content h3 {
      font-size: 10.5pt; font-weight: 700; margin: 12px 0 4px;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .content p { margin-bottom: 8px; }
    .content ul, .content ol { margin: 6px 0 8px 20px; }
    .content li { margin-bottom: 3px; }
    .content strong { font-weight: 700; }
    .content em { font-style: italic; }
    .content code {
      font-family: "Courier New", monospace;
      font-size: 9pt;
      background: #f3f4f6;
      padding: 1px 4px;
      border-radius: 2px;
    }
    .content pre {
      font-family: "Courier New", monospace;
      font-size: 8.5pt;
      background: #f3f4f6;
      padding: 10px;
      border-radius: 4px;
      white-space: pre-wrap;
      margin: 8px 0;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9pt;
    }
    .content th {
      background: #f3f4f6;
      font-weight: 700;
      padding: 6px 8px;
      text-align: left;
      border: 1px solid #d1d5db;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .content td {
      padding: 5px 8px;
      border: 1px solid #d1d5db;
      vertical-align: top;
    }
    .content tr:nth-child(even) td { background: #f9fafb; }

    /* ── Signature certificate ── */
    .cert-wrapper {
      page-break-inside: avoid;
      border: 1.5px solid #166534;
      border-radius: 6px;
      overflow: hidden;
      margin-top: 32px;
    }
    .cert-header {
      background: #166534;
      color: #fff;
      padding: 10px 16px;
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cert-header-icon { font-size: 12pt; }
    .cert-body { padding: 16px; background: #f0fdf4; }
    .cert-legal {
      font-size: 8.5pt;
      color: #374151;
      margin-bottom: 14px;
      font-style: italic;
    }
    .cert-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 24px;
      margin-bottom: 14px;
    }
    .cert-field { display: flex; flex-direction: column; gap: 2px; }
    .cert-label {
      font-size: 7.5pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .cert-value {
      font-size: 9.5pt;
      font-weight: 600;
      color: #1a1a1a;
    }
    .cert-value-sub { font-size: 8.5pt; color: #374151; font-weight: 400; }
    .cert-divider { border: none; border-top: 1px solid #bbf7d0; margin: 12px 0; }
    .cert-footer {
      font-size: 7.5pt;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
    .cert-doc-id { font-family: "Courier New", monospace; font-size: 7pt; color: #9ca3af; }

    /* ── Page footer ── */
    .page-footer {
      margin-top: 28px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #9ca3af;
      font-family: "Helvetica Neue", Arial, sans-serif;
    }
  </style>
</head>
<body>

  <div class="page-header">
    <div class="company-block">
      <div class="company-name">Neurogan</div>
      <div class="company-sub">Quality &amp; Compliance</div>
    </div>
    <div class="doc-meta-block">
      <div class="doc-id">${doc.docId}</div>
      <div class="doc-type">${doc.type} &nbsp;·&nbsp; ${doc.module}</div>
      <div class="signed-badge">✓ Electronically Signed</div>
    </div>
  </div>

  <div class="doc-title">${doc.title}</div>
  <div class="doc-subtitle">Document ID: ${doc.docId} &nbsp;·&nbsp; Type: ${doc.type} &nbsp;·&nbsp; Module: ${doc.module}</div>

  <div class="content">${contentHtml}</div>

  <div class="cert-wrapper">
    <div class="cert-header">
      <span class="cert-header-icon">✦</span>
      Electronic Signature Certificate
    </div>
    <div class="cert-body">
      <p class="cert-legal">
        This document has been electronically signed in accordance with 21 CFR Part 11.
        The signature below constitutes a legally binding electronic signature equivalent to a handwritten signature.
      </p>
      <div class="cert-grid">
        <div class="cert-field">
          <span class="cert-label">Signed by</span>
          <span class="cert-value">${sig.fullNameAtSigning}</span>
          ${sig.titleAtSigning ? `<span class="cert-value-sub">${sig.titleAtSigning}</span>` : ""}
        </div>
        <div class="cert-field">
          <span class="cert-label">Meaning / Intent</span>
          <span class="cert-value">${sig.meaning}</span>
        </div>
        <div class="cert-field">
          <span class="cert-label">Date &amp; Time</span>
          <span class="cert-value" style="font-size:9pt">${signedAt}</span>
        </div>
        <div class="cert-field">
          <span class="cert-label">System</span>
          <span class="cert-value">Neurogan ERP</span>
          <span class="cert-value-sub">neurogan-erp.up.railway.app</span>
        </div>
        ${sig.commentary ? `
        <div class="cert-field" style="grid-column: span 2;">
          <span class="cert-label">Commentary</span>
          <span class="cert-value-sub" style="font-style:italic">"${sig.commentary}"</span>
        </div>` : ""}
      </div>
      <hr class="cert-divider" />
      <div class="cert-footer">
        <span>Regulation: 21 CFR Part 11 §11.50, §11.70, §11.200</span>
        <span class="cert-doc-id">Record ID: ${doc.id}</span>
      </div>
    </div>
  </div>

  <div class="page-footer">
    <span>Neurogan A/S · Confidential · For regulatory use</span>
    <span>Printed: ${printedAt}</span>
  </div>

</body>
</html>`;

  const win = window.open("", "_blank", "width=860,height=1100");
  if (!win) { alert("Please allow pop-ups to print."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
}

export default function ValidationDetail() {
  const [, params] = useRoute("/settings/validation/:id");
  const [, navigate] = useLocation();
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handlePrint = () => {
    if (!doc || !contentRef.current) return;
    printDocument(doc, contentRef.current.innerHTML);
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (isError || !doc) return <div className="p-6 text-destructive text-sm">Failed to load document.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <button
        onClick={() => navigate("/settings")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{doc.docId} · {doc.type} · {doc.module}</p>
        </div>
        <div className="flex items-center gap-2">
          {doc.status === "SIGNED" && (
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
          )}
          {doc.status === "SIGNED" ? (
            <Badge variant="default" className="bg-green-600 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Signed
            </Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
        </div>
      </div>

      {/* Document content */}
      <div className="border rounded-lg p-8 bg-card mb-8">
        <div
          ref={contentRef}
          className="prose prose-sm dark:prose-invert max-w-none
            prose-headings:font-semibold prose-headings:tracking-tight
            prose-h1:text-xl prose-h2:text-base prose-h3:text-sm
            prose-table:text-xs prose-td:py-2 prose-th:py-2
            prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:font-mono"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>
      </div>

      {/* Signature block */}
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

      {/* Sign button */}
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
