import { db } from "../db";
import type { Tx } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { writeAuditRow } from "../audit/audit";
import { getActiveSpec } from "./finished-goods-specs";

// ─── Finished-Goods QC Test Storage ──────────────────────────────────────────

// ─── Helper: next OOS number ──────────────────────────────────────────────────

async function nextOosNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await tx
    .insert(schema.oosInvestigationCounter)
    .values({ year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: schema.oosInvestigationCounter.year,
      set: { lastSeq: sql`${schema.oosInvestigationCounter.lastSeq} + 1` },
    })
    .returning({ lastSeq: schema.oosInvestigationCounter.lastSeq });
  const seq = String(row!.lastSeq).padStart(3, "0");
  return `OOS-${year}-${seq}`;
}

// ─── Helper: build FgQcTestWithResults from a test row ───────────────────────

async function buildTestWithResults(
  test: schema.FinishedGoodsQcTest,
): Promise<schema.FgQcTestWithResults> {
  const [lab] = await db
    .select({ name: schema.labs.name })
    .from(schema.labs)
    .where(eq(schema.labs.id, test.labId));

  const [enteredBy] = await db
    .select({ fullName: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, test.enteredByUserId));

  const rawResults = await db
    .select()
    .from(schema.finishedGoodsQcTestResults)
    .where(eq(schema.finishedGoodsQcTestResults.testId, test.id));

  // Resolve analyte names for each result
  const attributeIds = rawResults.map((r) => r.specAttributeId);
  const attributeMap = new Map<string, string>();
  if (attributeIds.length > 0) {
    for (const attrId of attributeIds) {
      const [attr] = await db
        .select({ analyte: schema.finishedGoodsSpecAttributes.analyte })
        .from(schema.finishedGoodsSpecAttributes)
        .where(eq(schema.finishedGoodsSpecAttributes.id, attrId));
      if (attr) attributeMap.set(attrId, attr.analyte);
    }
  }

  const results = rawResults.map((r) => ({
    ...r,
    analyteName: attributeMap.get(r.specAttributeId) ?? "",
  }));

  return {
    ...test,
    labName: lab?.name ?? "",
    enteredByName: enteredBy?.fullName ?? "",
    results,
  };
}

// ─── 1. enterFgQcTest ─────────────────────────────────────────────────────────

export async function enterFgQcTest(
  bprId: string,
  userId: string,
  data: {
    labId: string;
    sampleReference?: string | null;
    testedAt: string; // ISO date string "YYYY-MM-DD"
    coaDocumentId?: string | null;
    notes?: string | null;
    results: Array<{
      specAttributeId: string;
      reportedValue: string;
      reportedUnit: string;
    }>;
  },
): Promise<schema.FgQcTestWithResults> {
  // 1. Look up the BPR to get productId
  const [bpr] = await db
    .select()
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, bprId));

  if (!bpr) {
    throw Object.assign(new Error("BPR not found"), { status: 404 });
  }

  // 2. Resolve active spec at test date
  const testedAtDate = new Date(data.testedAt);
  const activeSpecResult = await getActiveSpec(bpr.productId, testedAtDate);

  if (!activeSpecResult) {
    throw Object.assign(
      new Error("No active finished-goods spec found for this product at the test date"),
      { status: 409, code: "FG_SPEC_MISSING" },
    );
  }

  const { attributes: specAttributes } = activeSpecResult;

  // 3. For each result: lookup the spec attribute to get limits, compute pass/fail
  type ResultWithStatus = {
    specAttributeId: string;
    reportedValue: string;
    reportedUnit: string;
    passFail: schema.FgTestResultStatus;
    needsOos: boolean;
  };

  const evaluatedResults: ResultWithStatus[] = [];

  for (const result of data.results) {
    const specAttr = specAttributes.find((a) => a.id === result.specAttributeId);
    if (!specAttr) {
      // Attribute not in active spec — fall back to looking it up directly
      const [attr] = await db
        .select()
        .from(schema.finishedGoodsSpecAttributes)
        .where(eq(schema.finishedGoodsSpecAttributes.id, result.specAttributeId));

      if (!attr) {
        throw Object.assign(
          new Error(`Spec attribute ${result.specAttributeId} not found`),
          { status: 404 },
        );
      }
      // Evaluate without limits
      evaluatedResults.push({
        ...result,
        passFail: "PASS",
        needsOos: false,
      });
      continue;
    }

    const reported = parseFloat(result.reportedValue);
    let passFail: schema.FgTestResultStatus = "PASS";

    if (specAttr.minValue !== null && reported < parseFloat(specAttr.minValue)) {
      passFail = "FAIL";
    } else if (specAttr.maxValue !== null && reported > parseFloat(specAttr.maxValue)) {
      passFail = "FAIL";
    }

    evaluatedResults.push({
      ...result,
      passFail,
      needsOos: passFail === "FAIL",
    });
  }

  // 4. Run everything in one transaction
  const failedOosIds = new Map<string, string | null>();

  const newTestId = await db.transaction(async (tx) => {
    const [test] = await tx
      .insert(schema.finishedGoodsQcTests)
      .values({
        bprId,
        labId: data.labId,
        sampleReference: data.sampleReference ?? null,
        testedAt: data.testedAt,
        enteredByUserId: userId,
        coaDocumentId: data.coaDocumentId ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    const testId = test!.id;

    for (const result of evaluatedResults) {
      let oosInvestigationId: string | null = null;

      // Auto-create OOS on FAIL (coaDocumentId and lotId are now nullable on the OOS table)
      if (result.needsOos) {
        const oosNumber = await nextOosNumber(tx);
        const [created] = await tx
          .insert(schema.oosInvestigations)
          .values({
            oosNumber,
            coaDocumentId: data.coaDocumentId ?? null,
            lotId: null,  // FG batches don't have a component lot FK
          })
          .returning();
        oosInvestigationId = created!.id;

        await tx.insert(schema.auditTrail).values({
          userId,
          action: "OOS_OPENED",
          entityType: "oos_investigation",
          entityId: created!.id,
          after: { oosNumber, bprId },
          requestId: null,
          route: null,
        });
      }

      failedOosIds.set(result.specAttributeId, oosInvestigationId);

      await tx.insert(schema.finishedGoodsQcTestResults).values({
        testId,
        specAttributeId: result.specAttributeId,
        reportedValue: result.reportedValue,
        reportedUnit: result.reportedUnit,
        passFail: result.passFail,
        oosInvestigationId,
      });
    }

    return testId;
  });

  // 5. Write audit rows (outside transaction — non-critical, append-only)
  await writeAuditRow({
    userId,
    action: "FG_TEST_ENTERED",
    entityType: "finished_goods_qc_test",
    entityId: newTestId,
    route: null,
    requestId: null,
    meta: { bprId, labId: data.labId, testedAt: data.testedAt },
  });

  for (const result of evaluatedResults) {
    if (result.needsOos) {
      await writeAuditRow({
        userId,
        action: "FG_TEST_RESULT_FAILED",
        entityType: "finished_goods_qc_test_result",
        entityId: null,
        route: null,
        requestId: null,
        meta: {
          testId: newTestId,
          specAttributeId: result.specAttributeId,
          reportedValue: result.reportedValue,
          oosInvestigationId: failedOosIds.get(result.specAttributeId) ?? null,
        },
      });
    }
  }

  // 6. Return the full test with results
  const [test] = await db
    .select()
    .from(schema.finishedGoodsQcTests)
    .where(eq(schema.finishedGoodsQcTests.id, newTestId));

  return buildTestWithResults(test!);
}

// ─── 2. listFgQcTests ─────────────────────────────────────────────────────────

export async function listFgQcTests(
  bprId: string,
): Promise<schema.FgQcTestWithResults[]> {
  const tests = await db
    .select()
    .from(schema.finishedGoodsQcTests)
    .where(eq(schema.finishedGoodsQcTests.bprId, bprId))
    .orderBy(desc(schema.finishedGoodsQcTests.createdAt));

  return Promise.all(tests.map(buildTestWithResults));
}

// ─── 3. deleteFgQcTest ────────────────────────────────────────────────────────

export async function deleteFgQcTest(testId: string): Promise<void> {
  const [test] = await db
    .select()
    .from(schema.finishedGoodsQcTests)
    .where(eq(schema.finishedGoodsQcTests.id, testId));

  if (!test) {
    throw Object.assign(new Error("FG QC test not found"), { status: 404 });
  }

  // Guard: BPR must not be QC-reviewed
  const [bpr] = await db
    .select()
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, test.bprId));

  if (bpr && (bpr.status === "APPROVED" || bpr.status === "REJECTED")) {
    throw Object.assign(
      new Error("Cannot delete test: BPR has already been QC reviewed"),
      { status: 409, code: "BPR_ALREADY_REVIEWED" },
    );
  }

  // Cascade delete handles results (onDelete: "cascade" in schema)
  await db
    .delete(schema.finishedGoodsQcTests)
    .where(eq(schema.finishedGoodsQcTests.id, testId));
}

// ─── 4. checkFgTestsGate ──────────────────────────────────────────────────────

export async function checkFgTestsGate(bprId: string): Promise<{
  passed: boolean;
  specVersionId: string | null;
  missingAttributes: Array<{ analyte: string; reason: string }>;
  failingAttributes: Array<{
    analyte: string;
    reportedValue: number;
    spec: string;
    oosInvestigationId: string | null;
  }>;
  expiredLabQualifications: Array<{ labId: string; labName: string; testedAt: string }>;
}> {
  // 1. Look up BPR
  const [bpr] = await db
    .select()
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, bprId));

  if (!bpr) {
    throw Object.assign(new Error("BPR not found"), { status: 404 });
  }

  // 2. Get all tests for this BPR
  const tests = await db
    .select()
    .from(schema.finishedGoodsQcTests)
    .where(eq(schema.finishedGoodsQcTests.bprId, bprId))
    .orderBy(schema.finishedGoodsQcTests.testedAt);

  // 3. Get all results for each test
  type TestResult = schema.FinishedGoodsQcTestResult & { testedAt: string; labId: string };
  const allResults: TestResult[] = [];

  for (const test of tests) {
    const results = await db
      .select()
      .from(schema.finishedGoodsQcTestResults)
      .where(eq(schema.finishedGoodsQcTestResults.testId, test.id));

    for (const r of results) {
      allResults.push({ ...r, testedAt: test.testedAt, labId: test.labId });
    }
  }

  // 4. Check lab accreditation at each test date
  // A lab is accredited at date D if the most recent qualification event where
  // performedAt <= D has eventType = 'QUALIFIED'
  const labIds = [...new Set(tests.map((t) => t.labId))];
  const expiredLabQualifications: Array<{ labId: string; labName: string; testedAt: string }> = [];
  const accreditedLabAtDate = new Map<string, boolean>(); // key: `${labId}::${testedAt}`

  for (const test of tests) {
    const cacheKey = `${test.labId}::${test.testedAt}`;
    if (accreditedLabAtDate.has(cacheKey)) continue;

    const testedAtDate = new Date(test.testedAt);

    // Most recent qualification event at or before test date
    const [latestQualEvent] = await db
      .select()
      .from(schema.labQualifications)
      .where(
        and(
          eq(schema.labQualifications.labId, test.labId),
          // performedAt <= testedAt
          // Use lte comparison — labQualifications.performedAt is a timestamp
        ),
      )
      .orderBy(desc(schema.labQualifications.performedAt))
      .limit(1)
      .then((rows) => rows.filter((r) => r.performedAt <= testedAtDate));

    const isAccredited = latestQualEvent?.eventType === "QUALIFIED";
    accreditedLabAtDate.set(cacheKey, isAccredited);

    if (!isAccredited) {
      const [lab] = await db
        .select({ name: schema.labs.name })
        .from(schema.labs)
        .where(eq(schema.labs.id, test.labId));

      // Avoid duplicates
      if (!expiredLabQualifications.some((e) => e.labId === test.labId && e.testedAt === test.testedAt)) {
        expiredLabQualifications.push({
          labId: test.labId,
          labName: lab?.name ?? test.labId,
          testedAt: test.testedAt,
        });
      }
    }
  }

  // 5. Resolve the active spec at review time (now)
  const activeSpecResult = await getActiveSpec(bpr.productId, new Date());

  if (!activeSpecResult) {
    return {
      passed: false,
      specVersionId: null,
      missingAttributes: [],
      failingAttributes: [],
      expiredLabQualifications,
    };
  }

  const { version: specVersion, attributes: requiredAttributes } = activeSpecResult;
  const specVersionId = specVersion.id;

  // 6. For each REQUIRED attribute, find the latest result by testedAt
  const missingAttributes: Array<{ analyte: string; reason: string }> = [];
  const failingAttributes: Array<{
    analyte: string;
    reportedValue: number;
    spec: string;
    oosInvestigationId: string | null;
  }> = [];

  for (const attr of requiredAttributes.filter((a) => a.required)) {
    // Among all results for this attribute, find the latest by testedAt
    const attrResults = allResults
      .filter((r) => r.specAttributeId === attr.id)
      .sort((a, b) => {
        // Sort by testedAt descending (latest first)
        if (a.testedAt > b.testedAt) return -1;
        if (a.testedAt < b.testedAt) return 1;
        return 0;
      });

    if (attrResults.length === 0) {
      missingAttributes.push({
        analyte: attr.analyte,
        reason: "No test result submitted",
      });
      continue;
    }

    const latestResult = attrResults[0]!;
    const cacheKey = `${latestResult.labId}::${latestResult.testedAt}`;
    const labIsAccredited = accreditedLabAtDate.get(cacheKey) ?? false;

    if (latestResult.passFail === "FAIL") {
      // Build spec description for display
      const specParts: string[] = [];
      if (attr.minValue !== null) specParts.push(`min ${attr.minValue} ${attr.unit}`);
      if (attr.maxValue !== null) specParts.push(`max ${attr.maxValue} ${attr.unit}`);
      if (attr.targetValue !== null && specParts.length === 0) specParts.push(`target ${attr.targetValue} ${attr.unit}`);

      failingAttributes.push({
        analyte: attr.analyte,
        reportedValue: parseFloat(latestResult.reportedValue),
        spec: specParts.join(", ") || `${attr.unit}`,
        oosInvestigationId: latestResult.oosInvestigationId ?? null,
      });
    } else if (latestResult.passFail === "PASS" && !labIsAccredited) {
      missingAttributes.push({
        analyte: attr.analyte,
        reason: "Latest result from non-accredited lab",
      });
    }
    // PASS from accredited lab → OK
  }

  const passed =
    missingAttributes.length === 0 &&
    failingAttributes.length === 0 &&
    expiredLabQualifications.length === 0;

  return {
    passed,
    specVersionId,
    missingAttributes,
    failingAttributes,
    expiredLabQualifications,
  };
}
