import { db } from "../db";
import * as schema from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { LabelPrintAdapter } from "./adapter";
import { StubAdapter } from "./stub-adapter";
import { ZplOverTcpAdapter } from "./zpl-tcp-adapter";
import { ZplOverHttpAdapter } from "./zpl-http-adapter";

let override: LabelPrintAdapter | null = null;

export function setLabelPrintAdapter(adapter: LabelPrintAdapter): void {
  override = adapter;
}

export function resetLabelPrintAdapter(): void {
  override = null;
}

export async function getLabelPrintAdapter(): Promise<LabelPrintAdapter> {
  if (override) return override;

  // Environment variables take precedence over DB settings (easier to configure in Railway dashboard)
  const envAdapter = process.env.LABEL_PRINT_ADAPTER;
  const envUrl     = process.env.LABEL_PRINT_URL;
  const envHost    = process.env.LABEL_PRINT_HOST;
  const envPort    = process.env.LABEL_PRINT_PORT;
  if (envAdapter === "ZPL_HTTP" && envUrl) return new ZplOverHttpAdapter(envUrl);
  if (envAdapter === "ZPL_TCP"  && envHost) return new ZplOverTcpAdapter(envHost, parseInt(envPort ?? "9100", 10));

  // Fall back to DB settings
  const rows = await db.select().from(schema.appSettingsKv)
    .where(inArray(schema.appSettingsKv.key, ["labelPrintAdapter", "labelPrintHost", "labelPrintPort", "labelPrintUrl"]));
  const kv = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
  if (kv["labelPrintAdapter"] === "ZPL_HTTP" && kv["labelPrintUrl"]) return new ZplOverHttpAdapter(kv["labelPrintUrl"]);
  if (kv["labelPrintAdapter"] === "ZPL_TCP"  && kv["labelPrintHost"]) {
    return new ZplOverTcpAdapter(kv["labelPrintHost"], parseInt(kv["labelPrintPort"] ?? "9100", 10));
  }
  return new StubAdapter();
}
