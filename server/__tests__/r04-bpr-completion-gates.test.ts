// R-04 Task 8 — BPR completion gates unit tests.
//
// Pure unit tests with mocked DB calls: no real DB required.
// We mock getReconciliationForBpr to return controlled values and verify
// that runCompletionGates throws the right CompletionGateError on failure
// or resolves cleanly on success.

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../storage/label-reconciliations", () => ({
  getReconciliationForBpr: vi.fn(),
}));

vi.mock("../storage/bpr-records", () => ({
  getCleaningLogIdForBpr: vi.fn(),
}));

import { getReconciliationForBpr } from "../storage/label-reconciliations";
import { getCleaningLogIdForBpr } from "../storage/bpr-records";
import {
  runCompletionGates,
  CompletionGateError,
} from "../state/bpr-completion-gates";

const mockedGet = vi.mocked(getReconciliationForBpr);
const mockedGetCleaning = vi.mocked(getCleaningLogIdForBpr);

// Minimal shape matching schema.LabelReconciliation for test purposes.
function makeRecon(overrides: Partial<{
  id: string;
  bprId: string;
  variance: number;
  toleranceExceeded: boolean;
  deviationId: string | null;
}> = {}) {
  return {
    id: "recon-1",
    bprId: "bpr-1",
    qtyIssued: 100,
    qtyApplied: 95,
    qtyReturned: 3,
    qtyDestroyed: 2,
    variance: 0,
    toleranceExceeded: false,
    deviationId: null,
    signatureId: "sig-1",
    proofFileData: null,
    proofMimeType: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Gate 3 passes by default in unit tests — integration tests cover the blocking path
  mockedGetCleaning.mockResolvedValue("cleaning-log-1");
});

describe("R-04 BPR completion gates", () => {
  describe("LABEL_RECONCILIATION_MISSING", () => {
    it("throws when no reconciliation exists for the BPR", async () => {
      mockedGet.mockResolvedValue(undefined);

      await expect(runCompletionGates("bpr-missing")).rejects.toMatchObject({
        status: 409,
        code: "LABEL_RECONCILIATION_MISSING",
      });
    });

    it("throws an instance of CompletionGateError", async () => {
      mockedGet.mockResolvedValue(undefined);

      const err = await runCompletionGates("bpr-missing").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompletionGateError);
      expect((err as CompletionGateError).payload.bprId).toBe("bpr-missing");
    });
  });

  describe("LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION", () => {
    it("throws when tolerance exceeded and no deviation is linked", async () => {
      mockedGet.mockResolvedValue(
        makeRecon({ bprId: "bpr-oot", variance: 10, toleranceExceeded: true, deviationId: null }),
      );

      await expect(runCompletionGates("bpr-oot")).rejects.toMatchObject({
        status: 409,
        code: "LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION",
      });
    });

    it("includes variance in the error payload", async () => {
      mockedGet.mockResolvedValue(
        makeRecon({ bprId: "bpr-oot", variance: 10, toleranceExceeded: true, deviationId: null }),
      );

      const err = await runCompletionGates("bpr-oot").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CompletionGateError);
      expect((err as CompletionGateError).payload.variance).toBe(10);
    });
  });

  describe("Gate passes — happy paths", () => {
    it("resolves when reconciliation exists and is in-tolerance", async () => {
      mockedGet.mockResolvedValue(
        makeRecon({ bprId: "bpr-ok", variance: 0, toleranceExceeded: false, deviationId: null }),
      );

      await expect(runCompletionGates("bpr-ok")).resolves.toBeUndefined();
    });

    it("resolves when tolerance exceeded but deviation is present", async () => {
      mockedGet.mockResolvedValue(
        makeRecon({
          bprId: "bpr-dev",
          variance: 10,
          toleranceExceeded: true,
          deviationId: "dev-123",
        }),
      );

      await expect(runCompletionGates("bpr-dev")).resolves.toBeUndefined();
    });
  });

  describe("CLEANING_LOG_MISSING", () => {
    it("throws when cleaningLogId is null", async () => {
      mockedGet.mockResolvedValue(makeRecon({ bprId: "bpr-no-clean" }));
      mockedGetCleaning.mockResolvedValue(null);

      await expect(runCompletionGates("bpr-no-clean")).rejects.toMatchObject({
        status: 409,
        code: "CLEANING_LOG_MISSING",
      });
    });

    it("resolves when cleaningLogId is set", async () => {
      mockedGet.mockResolvedValue(makeRecon({ bprId: "bpr-clean" }));
      mockedGetCleaning.mockResolvedValue("cleaning-log-1");

      await expect(runCompletionGates("bpr-clean")).resolves.toBeUndefined();
    });
  });

  describe("CompletionGateError.is type guard", () => {
    it("returns true for CompletionGateError instances", () => {
      const err = new CompletionGateError(
        "LABEL_RECONCILIATION_MISSING",
        "msg",
        { bprId: "bpr-1" },
      );
      expect(CompletionGateError.is(err)).toBe(true);
    });

    it("returns false for plain errors", () => {
      expect(CompletionGateError.is(new Error("plain"))).toBe(false);
    });

    it("returns false for non-error values", () => {
      expect(CompletionGateError.is(null)).toBe(false);
      expect(CompletionGateError.is(undefined)).toBe(false);
      expect(CompletionGateError.is({ status: 409 })).toBe(false);
    });
  });
});
