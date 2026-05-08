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
  const rows = await db.select().from(schema.appSettingsKv)
    .where(inArray(schema.appSettingsKv.key, ["labelPrintAdapter", "labelPrintHost", "labelPrintPort", "labelPrintUrl"]));
  const kv = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));

  // HTTP adapter — for Cloudflare Tunnel (or any HTTP endpoint) sending ZPL to Zebra web server
  if (kv["labelPrintAdapter"] === "ZPL_HTTP" && kv["labelPrintUrl"]) {
    return new ZplOverHttpAdapter(kv["labelPrintUrl"]);
  }
  // TCP adapter — for direct LAN access to printer port 9100
  if (kv["labelPrintAdapter"] === "ZPL_TCP" && kv["labelPrintHost"]) {
    const port = parseInt(kv["labelPrintPort"] ?? "9100", 10);
    return new ZplOverTcpAdapter(kv["labelPrintHost"], port);
  }
  return new StubAdapter();
}
