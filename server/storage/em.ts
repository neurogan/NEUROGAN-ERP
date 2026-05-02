import { eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { createNonconformance } from "./capa";

// ─── Sites ──────────────────────────────────────────────────────────────────

export async function listSites(includeInactive = false) {
  return db
    .select()
    .from(schema.emSites)
    .where(includeInactive ? undefined : eq(schema.emSites.isActive, true))
    .orderBy(schema.emSites.area, schema.emSites.name);
}

export async function getSite(id: string) {
  const [site] = await db.select().from(schema.emSites).where(eq(schema.emSites.id, id));
  if (!site) throw Object.assign(new Error("EM site not found"), { status: 404, code: "NOT_FOUND" });

  const schedule = await db
    .select()
    .from(schema.emSchedules)
    .where(and(eq(schema.emSchedules.siteId, id), eq(schema.emSchedules.isActive, true)))
    .then((rows) => rows[0] ?? null);

  const limits = await db
    .select()
    .from(schema.emLimits)
    .where(eq(schema.emLimits.siteId, id))
    .orderBy(schema.emLimits.organism);

  const lastResult = await db
    .select()
    .from(schema.emResults)
    .where(eq(schema.emResults.siteId, id))
    .orderBy(desc(schema.emResults.sampledAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  return { ...site, schedule, limits, lastResult };
}

export async function createSite(input: {
  name: string;
  area: string;
  siteType: schema.EmSiteType;
  createdByUserId: string;
  requestId: string;
  route: string;
}) {
  const [site] = await db
    .insert(schema.emSites)
    .values({ name: input.name, area: input.area, siteType: input.siteType, createdByUserId: input.createdByUserId })
    .returning();

  await db.insert(schema.auditTrail).values({
    userId:     input.createdByUserId,
    action:     "EM_SITE_CREATED",
    entityType: "em_site",
    entityId:   site!.id,
    before:     null,
    after:      site as Record<string, unknown>,
    route:      input.route,
    requestId:  input.requestId,
  });

  return site!;
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export async function upsertSchedule(input: {
  siteId: string;
  frequency: schema.EmFrequency;
  organismTargets: string[];
  createdByUserId: string;
}) {
  // Deactivate existing schedules for this site, then insert new one.
  await db
    .update(schema.emSchedules)
    .set({ isActive: false })
    .where(eq(schema.emSchedules.siteId, input.siteId));

  const [schedule] = await db
    .insert(schema.emSchedules)
    .values({
      siteId:          input.siteId,
      frequency:       input.frequency,
      organismTargets: input.organismTargets,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  return schedule!;
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export async function upsertLimit(input: {
  siteId: string;
  organism: string;
  alertLimit: string | null;
  actionLimit: string | null;
  unit: string;
  createdByUserId: string;
}) {
  // ON CONFLICT (site_id, organism) handled by deleting existing then inserting.
  await db
    .delete(schema.emLimits)
    .where(and(eq(schema.emLimits.siteId, input.siteId), eq(schema.emLimits.organism, input.organism)));

  const [limit] = await db
    .insert(schema.emLimits)
    .values({
      siteId:          input.siteId,
      organism:        input.organism,
      alertLimit:      input.alertLimit,
      actionLimit:     input.actionLimit,
      unit:            input.unit,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  return limit!;
}

// ─── Results ─────────────────────────────────────────────────────────────────

export async function enterResult(input: {
  siteId: string;
  sampledAt: string;
  organism: string;
  cfuCount: string | null;
  isBelowLod: boolean;
  testedByLab?: string | null;
  notes?: string | null;
  enteredByUserId: string;
  requestId: string;
  route: string;
}): Promise<{ result: schema.EmResult; excursions: schema.EmExcursion[] }> {
  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(schema.emResults)
      .values({
        siteId:          input.siteId,
        sampledAt:       new Date(input.sampledAt),
        organism:        input.organism,
        cfuCount:        input.cfuCount,
        isBelowLod:      input.isBelowLod,
        testedByLab:     input.testedByLab ?? null,
        notes:           input.notes ?? null,
        enteredByUserId: input.enteredByUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId:     input.enteredByUserId,
      action:     "EM_RESULT_ENTERED",
      entityType: "em_result",
      entityId:   result!.id,
      before:     null,
      after:      result as Record<string, unknown>,
      route:      input.route,
      requestId:  input.requestId,
    });

    const excursions: schema.EmExcursion[] = [];

    // Skip excursion check for <LOD results
    if (!input.isBelowLod && input.cfuCount !== null) {
      const cfu = parseFloat(input.cfuCount);
      const [limit] = await tx
        .select()
        .from(schema.emLimits)
        .where(and(
          eq(schema.emLimits.siteId, input.siteId),
          eq(schema.emLimits.organism, input.organism),
        ));

      if (limit) {
        // Check action limit first (worse), then alert limit
        const actionVal = limit.actionLimit ? parseFloat(limit.actionLimit) : null;
        const alertVal  = limit.alertLimit  ? parseFloat(limit.alertLimit)  : null;

        let limitType: schema.EmLimitType | null = null;
        let limitValue: number | null = null;

        if (actionVal !== null && cfu > actionVal) {
          limitType  = "ACTION";
          limitValue = actionVal;
        } else if (alertVal !== null && cfu > alertVal) {
          limitType  = "ALERT";
          limitValue = alertVal;
        }

        if (limitType && limitValue !== null) {
          // Create excursion record
          const [excursion] = await tx
            .insert(schema.emExcursions)
            .values({
              resultId:   result!.id,
              siteId:     input.siteId,
              organism:   input.organism,
              limitType,
              cfuCount:   input.cfuCount!,
              limitValue: String(limitValue),
            })
            .returning();

          await tx.insert(schema.auditTrail).values({
            userId:     input.enteredByUserId,
            action:     "EM_EXCURSION_CREATED",
            entityType: "em_excursion",
            entityId:   excursion!.id,
            before:     null,
            after:      excursion as Record<string, unknown>,
            route:      input.route,
            requestId:  input.requestId,
          });

          // Auto-open CAPA nonconformance for ACTION limit breaches
          if (limitType === "ACTION") {
            const site = await tx
              .select({ name: schema.emSites.name })
              .from(schema.emSites)
              .where(eq(schema.emSites.id, input.siteId))
              .then((r) => r[0]);

            const nc = await createNonconformance({
              type:            "EM_EXCURSION",
              severity:        "MAJOR",
              title:           `EM action limit exceeded — ${input.organism} at ${site?.name ?? input.siteId}`,
              description:     `CFU count ${cfu} exceeded action limit of ${limitValue} ${limit.unit}. Sampled ${input.sampledAt}.`,
              sourceType:      "em_excursion",
              sourceId:        excursion!.id,
              createdByUserId: input.enteredByUserId,
              requestId:       input.requestId,
              route:           input.route,
            });

            await tx
              .update(schema.emExcursions)
              .set({ ncId: nc.id })
              .where(eq(schema.emExcursions.id, excursion!.id));

            excursions.push({ ...excursion!, ncId: nc.id });
          } else {
            excursions.push(excursion!);
          }
        }
      }
    }

    return { result: result!, excursions };
  });
}

export async function listResults(filters: {
  siteId?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const conditions = [];
  if (filters.siteId) conditions.push(eq(schema.emResults.siteId, filters.siteId));
  if (filters.from)   conditions.push(gte(schema.emResults.sampledAt, new Date(filters.from)));
  if (filters.to)     conditions.push(lte(schema.emResults.sampledAt, new Date(filters.to)));

  const rows = await db
    .select({
      result:    schema.emResults,
      siteName:  schema.emSites.name,
    })
    .from(schema.emResults)
    .innerJoin(schema.emSites, eq(schema.emResults.siteId, schema.emSites.id))
    .where(conditions.length ? and(...(conditions as [typeof conditions[0], ...typeof conditions])) : undefined)
    .orderBy(desc(schema.emResults.sampledAt))
    .limit(filters.limit ?? 200);

  // Fetch excursions for these results in one batch
  const resultIds = rows.map((r) => r.result.id);
  const excursions = resultIds.length
    ? await db
        .select()
        .from(schema.emExcursions)
        .where(eq(schema.emExcursions.resultId, resultIds[0]!))
        .then(async () =>
          (await Promise.all(
            resultIds.map((id) =>
              db.select().from(schema.emExcursions).where(eq(schema.emExcursions.resultId, id)),
            ),
          )).flat(),
        )
    : [];

  return rows.map((r) => {
    const excursion = excursions.find((e) => e.resultId === r.result.id) ?? null;
    let status: schema.EmResultWithStatus["status"] = "PASS";
    if (r.result.isBelowLod) status = "BELOW_LOD";
    else if (excursion?.limitType === "ACTION") status = "ACTION";
    else if (excursion?.limitType === "ALERT")  status = "ALERT";
    return { ...r.result, siteName: r.siteName, excursion, status };
  });
}

// ─── Dashboard: due sites ────────────────────────────────────────────────────

export async function getDueSites() {
  const sites = await db
    .select()
    .from(schema.emSites)
    .where(eq(schema.emSites.isActive, true));

  const now = new Date();
  const results = await Promise.all(
    sites.map(async (site) => {
      const schedule = await db
        .select()
        .from(schema.emSchedules)
        .where(and(eq(schema.emSchedules.siteId, site.id), eq(schema.emSchedules.isActive, true)))
        .then((r) => r[0] ?? null);

      if (!schedule) return null;

      const lastResult = await db
        .select({ sampledAt: schema.emResults.sampledAt })
        .from(schema.emResults)
        .where(eq(schema.emResults.siteId, site.id))
        .orderBy(desc(schema.emResults.sampledAt))
        .limit(1)
        .then((r) => r[0] ?? null);

      const freqDays = schedule.frequency === "WEEKLY" ? 7
        : schedule.frequency === "MONTHLY" ? 30
        : 90;

      const nextDue = lastResult
        ? new Date(lastResult.sampledAt.getTime() + freqDays * 86_400_000)
        : new Date(0); // overdue immediately if never sampled

      const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / 86_400_000);

      // Due = within next 7 days or already overdue
      if (daysUntilDue > 7) return null;

      return {
        site,
        schedule,
        nextDue: nextDue.toISOString(),
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
      };
    }),
  );

  return results
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

// ─── Trend data ──────────────────────────────────────────────────────────────

export async function getSiteTrend(siteId: string, months = 12) {
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  const [site] = await db.select().from(schema.emSites).where(eq(schema.emSites.id, siteId));
  if (!site) throw Object.assign(new Error("EM site not found"), { status: 404, code: "NOT_FOUND" });

  const limits = await db
    .select()
    .from(schema.emLimits)
    .where(eq(schema.emLimits.siteId, siteId));

  const results = await db
    .select()
    .from(schema.emResults)
    .where(and(
      eq(schema.emResults.siteId, siteId),
      gte(schema.emResults.sampledAt, from),
    ))
    .orderBy(asc(schema.emResults.sampledAt));

  return { site, limits, results };
}

// ─── Recent excursions ───────────────────────────────────────────────────────

export async function listRecentExcursions(limitCount = 20) {
  return db
    .select({
      excursion: schema.emExcursions,
      siteName:  schema.emSites.name,
    })
    .from(schema.emExcursions)
    .innerJoin(schema.emSites, eq(schema.emExcursions.siteId, schema.emSites.id))
    .orderBy(desc(schema.emExcursions.createdAt))
    .limit(limitCount);
}
