import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileCheck,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  ChevronDown,
  ChevronUp,
  Lock,
  FileText,
} from "lucide-react";

// ─── Mock data ────────────────────────────────────────

interface ReleaseItem {
  lotCode: string;
  sku: string;
  product: string;
  submittedAt: string;
  batchSize: string;
  productionLead: string;
  verifier: string;
  hasBpr: boolean;
  hasCoa: boolean;
  assayPct: number | null;
  coaStatus: "accepted" | "pending" | "invalid_method";
  deviations: number;
  steps: { label: string; signedBy: string; signedAt: string }[];
}

const queueItems: ReleaseItem[] = [
  {
    lotCode: "LOT-2026-0412",
    sku: "UA-60CT-500MG",
    product: "Urolithin A 500mg",
    submittedAt: "2026-04-20 14:32",
    batchSize: "2,400 capsules",
    productionLead: "Marcus R.",
    verifier: "Diane P.",
    hasBpr: true,
    hasCoa: true,
    assayPct: 98.4,
    coaStatus: "accepted",
    deviations: 0,
    steps: [
      { label: "Weigh & blend API", signedBy: "Marcus R.", signedAt: "2026-04-19 08:11" },
      { label: "Encapsulation", signedBy: "Marcus R.", signedAt: "2026-04-19 11:45" },
      { label: "In-process fill weight", signedBy: "Diane P.", signedAt: "2026-04-19 12:02" },
      { label: "Metal detect", signedBy: "Diane P.", signedAt: "2026-04-19 14:17" },
      { label: "Label reconciliation", signedBy: "Marcus R.", signedAt: "2026-04-19 15:58" },
      { label: "Production Lead submit", signedBy: "Marcus R.", signedAt: "2026-04-20 14:32" },
    ],
  },
  {
    lotCode: "LOT-2026-0408",
    sku: "NMN-60CT-500MG",
    product: "NMN 500mg",
    submittedAt: "2026-04-19 09:15",
    batchSize: "3,000 capsules",
    productionLead: "Marcus R.",
    verifier: "Diane P.",
    hasBpr: true,
    hasCoa: true,
    assayPct: 96.1,
    coaStatus: "accepted",
    deviations: 1,
    steps: [
      { label: "Weigh & blend API", signedBy: "Marcus R.", signedAt: "2026-04-18 07:55" },
      { label: "Encapsulation", signedBy: "Marcus R.", signedAt: "2026-04-18 11:20" },
      { label: "In-process fill weight", signedBy: "Diane P.", signedAt: "2026-04-18 11:38" },
      { label: "Metal detect", signedBy: "Diane P.", signedAt: "2026-04-18 13:50" },
      { label: "Label reconciliation", signedBy: "Marcus R.", signedAt: "2026-04-18 15:30" },
      { label: "Production Lead submit", signedBy: "Marcus R.", signedAt: "2026-04-19 09:15" },
    ],
  },
  {
    lotCode: "LOT-2026-0401",
    sku: "OMGA-60CT-1000MG",
    product: "Omega-3 1000mg",
    submittedAt: "2026-04-18 16:50",
    batchSize: "1,800 softgels",
    productionLead: "Tom K.",
    verifier: "Diane P.",
    hasBpr: true,
    hasCoa: false,
    assayPct: null,
    coaStatus: "pending",
    deviations: 0,
    steps: [
      { label: "Weigh & measure oil", signedBy: "Tom K.", signedAt: "2026-04-17 09:05" },
      { label: "Softgel encapsulation", signedBy: "Tom K.", signedAt: "2026-04-17 13:30" },
      { label: "In-process fill weight", signedBy: "Diane P.", signedAt: "2026-04-17 13:48" },
      { label: "Metal detect", signedBy: "Diane P.", signedAt: "2026-04-17 15:00" },
      { label: "Label reconciliation", signedBy: "Tom K.", signedAt: "2026-04-17 16:20" },
      { label: "Production Lead submit", signedBy: "Tom K.", signedAt: "2026-04-18 16:50" },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────

function assayBadge(pct: number | null) {
  if (pct === null) return <span className="text-xs text-muted-foreground">Pending</span>;
  const color = pct >= 95 ? "text-green-700 dark:text-green-400" : "text-destructive";
  return <span className={`text-sm font-semibold ${color}`}>{pct}%</span>;
}

function coaBadge(status: "accepted" | "pending" | "invalid_method") {
  if (status === "accepted") return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">COA Accepted</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">COA Pending</Badge>;
  return <Badge variant="destructive" className="text-xs">Invalid Method</Badge>;
}

// ─── Sign dialog ──────────────────────────────────────

interface SignDialogProps {
  item: ReleaseItem;
  decision: "approved" | "rejected" | "on_hold";
  onClose: () => void;
  onConfirm: (decision: "approved" | "rejected" | "on_hold") => void;
}

function SignDialog({ item, decision, onClose, onConfirm }: SignDialogProps) {
  const [password, setPassword] = useState("");
  const [meaning] = useState(
    decision === "approved" ? "I approve this lot for release" :
    decision === "rejected" ? "I reject this lot — do not ship" :
    "I place this lot on hold pending further investigation"
  );

  const titles = {
    approved: "Approve lot for release",
    rejected: "Reject lot",
    on_hold: "Place lot on hold",
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            {titles[decision]}
          </DialogTitle>
          <DialogDescription>
            21 CFR Part 11 — Re-authentication required to sign
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <div className="text-xs text-muted-foreground">Lot code</div>
            <div className="text-sm font-mono font-medium">{item.lotCode}</div>
            <div className="text-xs text-muted-foreground mt-1">Product</div>
            <div className="text-sm font-medium">{item.product}</div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Signature meaning
            </label>
            <div className="text-sm text-foreground border border-border rounded-md px-3 py-2 bg-muted/40">
              {meaning}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Enter your password to sign *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This signature is legally binding under 21 CFR Part 11. Your credentials, IP address, and timestamp will be recorded.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            variant={decision === "approved" ? "default" : decision === "rejected" ? "destructive" : "outline"}
            disabled={password.length < 1}
            onClick={() => onConfirm(decision)}
          >
            Sign & {decision === "approved" ? "Release" : decision === "rejected" ? "Reject" : "Hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row ──────────────────────────────────────────────

function ReleaseRow({ item }: { item: ReleaseItem }) {
  const [expanded, setExpanded] = useState(false);
  const [signDecision, setSignDecision] = useState<"approved" | "rejected" | "on_hold" | null>(null);
  const [released, setReleased] = useState<"approved" | "rejected" | "on_hold" | null>(null);

  function handleConfirm(decision: "approved" | "rejected" | "on_hold") {
    setReleased(decision);
    setSignDecision(null);
  }

  const releasedBadge = released === "approved"
    ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Released</Badge>
    : released === "rejected"
    ? <Badge variant="destructive">Rejected</Badge>
    : released === "on_hold"
    ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">On Hold</Badge>
    : null;

  return (
    <>
      <TableRow className={released ? "opacity-60" : ""}>
        <TableCell className="pl-6 font-mono text-xs">{item.lotCode}</TableCell>
        <TableCell>
          <div className="text-sm font-medium">{item.product}</div>
          <div className="text-xs text-muted-foreground">{item.sku} · {item.batchSize}</div>
        </TableCell>
        <TableCell>
          <div className="text-xs">{item.productionLead} <span className="text-muted-foreground">(lead)</span></div>
          <div className="text-xs">{item.verifier} <span className="text-muted-foreground">(verifier)</span></div>
        </TableCell>
        <TableCell>{assayBadge(item.assayPct)}</TableCell>
        <TableCell>{coaBadge(item.coaStatus)}</TableCell>
        <TableCell>
          {item.deviations > 0
            ? <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">{item.deviations} deviation</Badge>
            : <span className="text-xs text-muted-foreground">None</span>}
        </TableCell>
        <TableCell className="pr-6">
          {releasedBadge ? (
            releasedBadge
          ) : (
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-7 text-xs px-2.5" onClick={() => setSignDecision("approved")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Release
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" onClick={() => setSignDecision("on_hold")}>
                <Pause className="h-3.5 w-3.5 mr-1" /> Hold
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs px-2.5" onClick={() => setSignDecision("rejected")}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            </div>
          )}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </TableCell>
      </TableRow>

      {/* Expanded BPR steps */}
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="px-6 pb-4 pt-0 bg-muted/30">
            <div className="pt-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Batch Production Record — Step Sign-offs
              </div>
              <div className="space-y-1.5">
                {item.steps.map((step) => (
                  <div key={step.label} className="flex items-center gap-3 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    <span className="font-medium w-52 shrink-0">{step.label}</span>
                    <span className="text-muted-foreground">{step.signedBy}</span>
                    <span className="text-muted-foreground ml-auto">{step.signedAt}</span>
                  </div>
                ))}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}

      {signDecision && (
        <SignDialog
          item={item}
          decision={signDecision}
          onClose={() => setSignDecision(null)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────

export default function QmsReleaseQueue() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Release Queue</h1>
            <p className="text-sm text-muted-foreground">
              QC signature required before any lot can ship
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          <FileCheck className="h-3.5 w-3.5 mr-1.5" />
          {queueItems.length} lots pending
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6 text-xs">Lot code</TableHead>
                <TableHead className="text-xs">Product</TableHead>
                <TableHead className="text-xs">Personnel</TableHead>
                <TableHead className="text-xs">Assay</TableHead>
                <TableHead className="text-xs">COA</TableHead>
                <TableHead className="text-xs">Deviations</TableHead>
                <TableHead className="text-xs pr-6">Decision</TableHead>
                <TableHead className="text-xs w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueItems.map((item) => (
                <ReleaseRow key={item.lotCode} item={item} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <span>
          All release decisions are cryptographically signed under 21 CFR Part 11. Password re-authentication is captured at the moment of signing. Decisions are immutable and append to the QMS audit log.
        </span>
      </div>
    </div>
  );
}
