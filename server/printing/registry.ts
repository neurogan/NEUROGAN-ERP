import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
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
  const rows = await db.select().from(schema.appSettingsKv)
    .where(inArray(schema.appSettingsKv.key, ["labelPrintAdapter", "labelPrintHost", "labelPrintPort"]));
  const kv = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
  if (kv["labelPrintAdapter"] === "ZPL_TCP") {
    const host = kv["labelPrintHost"] ?? "";
    const port = parseInt(kv["labelPrintPort"] ?? "9100", 10);
    return new ZplOverTcpAdapter(host, port);
  }
  return new StubAdapter();
}
