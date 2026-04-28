import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import type { LabelPrintAdapter } from "./adapter";
import { StubAdapter } from "./stub-adapter";
import { ZplOverTcpAdapter } from "./zpl-tcp-adapter";

let override: LabelPrintAdapter | null = null;

export function setLabelPrintAdapter(adapter: LabelPrintAdapter): void {
  override = adapter;
}

export function resetLabelPrintAdapter(): void {
  override = null;
}

export async function getLabelPrintAdapter(): Promise<LabelPrintAdapter> {
  if (override) return override;
  const rows = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "labelPrintAdapter"))
    .limit(1);
  const adapterType = rows[0]?.value ?? "STUB";
  if (adapterType === "ZPL_TCP") {
    const hostRow = await db
      .select()
      .from(schema.appSettingsKv)
      .where(eq(schema.appSettingsKv.key, "labelPrintHost"))
      .limit(1);
    const portRow = await db
      .select()
      .from(schema.appSettingsKv)
      .where(eq(schema.appSettingsKv.key, "labelPrintPort"))
      .limit(1);
    const host = hostRow[0]?.value ?? "";
    const port = parseInt(portRow[0]?.value ?? "9100", 10);
    return new ZplOverTcpAdapter(host, port);
  }
  return new StubAdapter();
}
