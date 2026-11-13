// /api/collect/settings と /api/collect/settings/paypay-qr（specs/collect/001-event-day-collection contracts/api.md 7、research.md R10）。
import { COLLECT_LIMITS, putCollectSettingsRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { deleteQr, getSettings, loadQr, saveBankText, saveQr, validateQrImage } from "./settings-service";

/**
 * 既定値の道筋を作る。
 * @param owner - 主催者の関所（collectOwner）
 * @returns Hono のアプリ
 */
export function settingsRoutes(owner: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/settings", owner, async (c) => {
      return c.json(await getSettings(createDb(c.env.DATABASE_URL), c.get("user").id));
    })
    .put("/settings", owner, async (c) => {
      const { bankText } = await parseBody(putCollectSettingsRequestSchema, c.req.json());
      return c.json(await saveBankText(createDb(c.env.DATABASE_URL), c.get("user").id, bankText));
    })
    .put("/settings/paypay-qr", owner, async (c) => {
      // 本文を読む前に、言われた大きさで大きすぎるものを断る（読んだあとにも確かめる）
      const declared = Number(c.req.header("Content-Length") ?? "0");
      if (declared > COLLECT_LIMITS.paypayQrBytes) throw new AppError("IMAGE_TOO_LARGE", 413, "image too large");
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const type = validateQrImage(c.req.header("Content-Type"), bytes);
      const db = createDb(c.env.DATABASE_URL);
      await saveQr(db, c.get("user").id, bytes, type);
      return c.json(await getSettings(db, c.get("user").id));
    })
    .get("/settings/paypay-qr", owner, async (c) => {
      const qr = await loadQr(createDb(c.env.DATABASE_URL), c.get("user").id);
      if (!qr) throw new AppError("ITEM_NOT_FOUND", 404, "no paypay qr");
      return c.body(new Uint8Array(qr.bytes), 200, { "Content-Type": qr.type, "Cache-Control": "private, no-store" });
    })
    .delete("/settings/paypay-qr", owner, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      await deleteQr(db, c.get("user").id);
      return c.json(await getSettings(db, c.get("user").id));
    });
}
