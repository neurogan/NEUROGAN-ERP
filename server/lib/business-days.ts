import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

let cachedHolidays: Set<string> | null = null;

async function getHolidays(): Promise<Set<string>> {
  if (cachedHolidays) return cachedHolidays;
  const [row] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "usFederalHolidaysJson"));
  const dates: string[] = row ? (JSON.parse(row.value) as string[]) : [];
  cachedHolidays = new Set(dates);
  return cachedHolidays;
}

// Exported for tests that need to inject a holiday set without hitting the DB.
export function _setHolidayCache(holidays: string[]): void {
  cachedHolidays = new Set(holidays);
}

export function _clearHolidayCache(): void {
  cachedHolidays = null;
}

function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function isBusinessDay(date: Date): Promise<boolean> {
  if (isWeekend(date)) return false;
  const holidays = await getHolidays();
  return !holidays.has(toIsoDate(date));
}

// Returns a new Date that is `businessDays` business days after `from`.
export async function addBusinessDays(from: Date, businessDays: number): Promise<Date> {
  const holidays = await getHolidays();
  let count = 0;
  let current = new Date(from);
  while (count < businessDays) {
    current = new Date(current.getTime() + 86_400_000);
    if (!isWeekend(current) && !holidays.has(toIsoDate(current))) {
      count++;
    }
  }
  return current;
}

// Returns how many business days have elapsed between `from` and `to` (exclusive of `from`, inclusive of `to`).
export async function businessDaysElapsed(from: Date, to: Date): Promise<number> {
  const holidays = await getHolidays();
  let count = 0;
  let current = new Date(from);
  while (current < to) {
    current = new Date(current.getTime() + 86_400_000);
    if (!isWeekend(current) && !holidays.has(toIsoDate(current))) {
      count++;
    }
  }
  return count;
}

// Returns how many business days remain until `due` from `now`. Negative means overdue.
export async function businessDaysUntil(now: Date, due: Date): Promise<number> {
  const holidays = await getHolidays();
  const sign = due >= now ? 1 : -1;
  const [start, end] = due >= now ? [now, due] : [due, now];
  let count = 0;
  let current = new Date(start);
  while (current < end) {
    current = new Date(current.getTime() + 86_400_000);
    if (!isWeekend(current) && !holidays.has(toIsoDate(current))) {
      count++;
    }
  }
  return sign * count;
}
