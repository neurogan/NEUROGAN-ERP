import { AlertTriangle } from "lucide-react";

export function QmsComplianceBanner() {
  return (
    <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        <strong>Part 11 Note:</strong> This system uses a demo PIN for re-authentication. Real 21 CFR Part 11
        compliance requires verified password re-authentication and a validated electronic signature system
        before use in an FDA inspection. See compliance roadmap.
      </span>
    </div>
  );
}
