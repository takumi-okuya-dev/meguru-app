// /api/collect/settings と /api/collect/settings/paypay-qr（specs/collect/001-event-day-collection contracts/api.md 7、research.md R10）。
import { COLLECT_LIMITS, putCollectSettingsRequestSchema } from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { createDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { parseBody } from "../../../kernel/validate";
import type { AppEnv } from "../../../platform";
import { deleteQr, getSettings, loadQr, saveBankText, saveQr, validateQrImage } from "./settings-service";

/**
 * 本文を、上限のバイト数まで読む。上限を超えたら、その場で読むのをやめて 413 IMAGE_TOO_LARGE（大きな本文を全部メモリに載せない）。
 * @param body - 本文の流れ（なければ空）
 * @param limit - 上限のバイト数
 * @returns 読んだバイト列
 * @throws AppError IMAGE_TOO_LARGE
 */
export async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError("IMAGE_TOO_LARGE", 413, "image too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

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
      // 本文を読む前に、言われた大きさで大きすぎるものを断る。言われていなくても、上限を超えたところで読むのをやめる
      const declared = Number(c.req.header("Content-Length") ?? "0");
      if (declared > COLLECT_LIMITS.paypayQrBytes) throw new AppError("IMAGE_TOO_LARGE", 413, "image too large");
      const bytes = await readLimited(c.req.raw.body, COLLECT_LIMITS.paypayQrBytes);
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
