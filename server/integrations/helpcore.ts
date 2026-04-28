import { createHmac } from "crypto";

export interface HelpcoreClosedPayload {
  helpcoreRef: string;
  complaintId: string;
  disposition: {
    summary: string;
    signedAt: string;
    signedByRole: "DIRECTOR_OF_QUALITY" | "QA";
    capaOpened: boolean;
    capaRef: string | null;
  };
}

// Outbound HMAC-signed POST to HelpCore.
// Feature-flagged: when HELPCORE_BASE_URL is unset, enqueueCallback is a no-op.
// Retries: 1m, 5m, 30m, 2h, 6h, 24h. After 24h marks failure for manual nudge.

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];

interface RetryJob {
  payload: HelpcoreClosedPayload;
  attemptIndex: number;
  timer: ReturnType<typeof setTimeout>;
}

const activeJobs = new Map<string, RetryJob>();

// Called when a timer fires — attempts the outbound POST.
async function attempt(complaintId: string, payload: HelpcoreClosedPayload, attemptIndex: number): Promise<void> {
  const baseUrl = process.env.HELPCORE_BASE_URL;
  const secret = process.env.HELPCORE_OUTBOUND_SECRET;

  if (!baseUrl) {
    activeJobs.delete(complaintId);
    return;
  }

  const body = JSON.stringify(payload);
  const sig = secret
    ? `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
    : "unsigned";

  try {
    const res = await fetch(`${baseUrl}/api/erp/complaints/closed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Erp-Signature": sig,
      },
      body,
    });

    if (res.ok) {
      activeJobs.delete(complaintId);
      console.log(`[helpcore] callback delivered for complaint ${complaintId}`);
      return;
    }

    console.warn(`[helpcore] callback HTTP ${res.status} for complaint ${complaintId}, attempt ${attemptIndex + 1}`);
  } catch (err) {
    console.warn(`[helpcore] callback network error for complaint ${complaintId}, attempt ${attemptIndex + 1}:`, err);
  }

  // Schedule next retry if attempts remain
  const nextIndex = attemptIndex + 1;
  if (nextIndex < RETRY_DELAYS_MS.length) {
    const timer = setTimeout(() => void attempt(complaintId, payload, nextIndex), RETRY_DELAYS_MS[nextIndex]);
    activeJobs.set(complaintId, { payload, attemptIndex: nextIndex, timer });
  } else {
    // All retries exhausted — leave in map with attemptIndex = -1 as failure signal
    const existing = activeJobs.get(complaintId);
    if (existing) clearTimeout(existing.timer);
    activeJobs.set(complaintId, { payload, attemptIndex: -1, timer: undefined as unknown as ReturnType<typeof setTimeout> });
    console.error(`[helpcore] callback permanently failed for complaint ${complaintId} after ${RETRY_DELAYS_MS.length} attempts`);
  }
}

// Enqueue the outbound callback for a closed complaint.
// Called in the same logical operation as disposition commit; does not block the response.
export function enqueueCallback(payload: HelpcoreClosedPayload): void {
  if (!process.env.HELPCORE_BASE_URL) return;

  const { complaintId } = payload;
  const existing = activeJobs.get(complaintId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => void attempt(complaintId, payload, 0), RETRY_DELAYS_MS[0]);
  activeJobs.set(complaintId, { payload, attemptIndex: 0, timer });
}

// Returns complaint IDs with permanently failed callbacks (for the dashboard tile).
export function getFailedCallbackIds(): string[] {
  return [...activeJobs.entries()]
    .filter(([, job]) => job.attemptIndex === -1)
    .map(([id]) => id);
}
