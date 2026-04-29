// F-04: Shared electronic signature ceremony dialog.
//
// Drop this onto any regulated record page. The parent provides:
//   - entityDescription  — human-readable record name shown in the preview
//   - meaning            — the regulated action being attested
//   - onSign             — async (password, commentary?) => void; called on submit
//   - isPending          — disables the form while the parent mutation runs
//
// The component renders the Part 11 manifestation preview ("I, Name (Title),
// hereby … this record on …") using the currently-authenticated user. The
// parent is responsible for calling the actual API endpoint that embeds the
// ceremony server-side.

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PenLine } from "lucide-react";

// ── Types ────────────────────────────────────────────────────

const MEANING_VERB: Record<string, string> = {
  AUTHORED: "authored",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  REJECTED: "rejected",
  QC_DISPOSITION: "issued QC disposition for",
  QA_RELEASE: "authorized QA release of",
  DEVIATION_DISPOSITION: "issued deviation disposition for",
  RETURN_DISPOSITION: "issued return disposition for",
  RETURNED_PRODUCT_DISPOSITION: "issued return disposition for",
  RETURN_INVESTIGATION_CLOSE: "closed return investigation for",
  COMPLAINT_REVIEW: "reviewed complaint for",
  SAER_SUBMIT: "submitted SAER for",
  MMR_APPROVAL: "approved MMR for",
  SPEC_APPROVAL: "approved specification for",
  LAB_APPROVAL: "approved laboratory result for",
};

export interface SignatureCeremonyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human-readable description of the record being signed, e.g. "COA #12345". */
  entityDescription: string;
  meaning: string;
  onSign: (password: string, commentary: string) => Promise<void>;
  isPending?: boolean;
}

// ── Component ────────────────────────────────────────────────

export function SignatureCeremony({
  open,
  onOpenChange,
  entityDescription,
  meaning,
  onSign,
  isPending = false,
}: SignatureCeremonyProps) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [commentary, setCommentary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const verb = MEANING_VERB[meaning] ?? meaning.toLowerCase();
  const now = new Date();
  const titlePart = user?.title ? ` (${user.title})` : "";
  const manifestationText = user
    ? `I, ${user.fullName}${titlePart}, hereby ${verb} ${entityDescription} on ${now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
    : "Loading…";

  const handleSubmit = async () => {
    if (!password) return;
    setError(null);
    try {
      await onSign(password, commentary);
      // Parent closes the dialog on success via onOpenChange
      setPassword("");
      setCommentary("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signature failed.";
      setError(msg);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPassword("");
      setCommentary("");
      setError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Electronic signature
          </DialogTitle>
          <DialogDescription className="text-xs">
            21 CFR Part 11 §11.50 — re-enter your password to sign.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Manifestation preview */}
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Manifestation
            </p>
            <p className="text-sm leading-relaxed">{manifestationText}</p>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="sig-password" className="text-sm">
              Password <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sig-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) void handleSubmit();
              }}
              disabled={isPending}
              data-testid="input-sig-password"
            />
          </div>

          {/* Commentary (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="sig-commentary" className="text-sm">
              Commentary <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="sig-commentary"
              rows={2}
              placeholder="Reason or note for this signature…"
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              disabled={isPending}
              data-testid="input-sig-commentary"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="sig-error">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!password || isPending}
            data-testid="button-submit-signature"
          >
            {isPending ? "Signing…" : "Sign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
