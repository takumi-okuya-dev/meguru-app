// 外部媒体展開の読み出しと保存（specs/021-external-media contracts/api.md、research.md R6〜R8）。
// 媒体の決まり（組み立て・自動の直し）は shared の media だけを使う。判定は routes で authorizeAccount を通してから呼ぶ（原則V）。
import {
  MEDIA,
  MEDIA_DEFINITIONS,
  MEDIA_LABELS,
  buildListing,
  refixListing,
  type ListingSource,
  type ListingUpdateRequest,
  type ListingValues,
  type Media,
} from "@meguru/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "../../../kernel/db/client";
import { mediaDefaults, promotionListings, promotions } from "../schema";
import { AppError, itemNotFound } from "../../../kernel/errors";
import type { AccountAccess } from "../../../platform";
import { recordActivity, updatedByOf } from "../../../platform";

/** promotions の行。 */
export type PromotionRow = typeof promotions.$inferSelect;
/** promotion_listings の行。 */
export type ListingRow = typeof promotionListings.$inferSelect;

/** 欄の上限がないときの上限（contracts/api.md）。 */
const FIELD_MAX_DEFAULT = 15000;

/**
 * 媒体の名前を確かめる。
 * @param media - URLの媒体
 * @returns 媒体
 * @throws AppError ITEM_NOT_FOUND（5つのどれでもない）
 */
export function assertMedia(media: string): Media {
  if (!(MEDIA as readonly string[]).includes(media)) throw itemNotFound();
  return media as Media;
}

/**
 * 掲載内容を作る材料（宣伝内容・イベントの情報・媒体の既定値）。
 * @param p - 宣伝内容の行
 * @param defaults - 媒体の既定値
 * @returns 材料
 */
export function sourceOf(p: PromotionRow, defaults: ListingValues): ListingSource {
  return {
    title: p.title,
    content: p.content,
    targetLocation: p.targetLocation ?? "",
    targetPersona: p.targetPersona ?? "",
    targetAgeRange: p.targetAgeRange ?? "",
    cta: p.cta ?? "",
    linkedUrl: p.linkedUrl ?? "",
    event: p.event ?? null,
    defaults,
  };
}

/**
 * 外部媒体展開の一覧（宣伝内容と、行のある媒体の状況）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 宣伝内容の行と、掲載の状況の行
 */
export async function listExternalMedia(db: Db, accountId: string) {
  const [rows, listings] = await Promise.all([
    db.select().from(promotions).where(eq(promotions.accountId, accountId)),
    db
      .select({
        promotionId: promotionListings.promotionId,
        media: promotionListings.media,
        status: promotionListings.status,
        postedUrl: promotionListings.postedUrl,
      })
      .from(promotionListings)
      .where(eq(promotionListings.accountId, accountId)),
  ]);
  // 開催日時の近い順（終わったものは後ろ）、開催日時のないものは最後（contracts/api.md）
  const now = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
  const rank = (p: PromotionRow) => (!p.event ? 2 : p.event.startAt >= now ? 0 : 1);
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.event?.startAt ?? "").localeCompare(b.event?.startAt ?? "") * (rank(a) === 1 ? -1 : 1),
  );
  return rows.map((p) => ({
    row: p,
    listings: MEDIA.flatMap((m) => {
      const l = listings.find((x) => x.promotionId === p.id && x.media === m);
      return l
        ? [{ media: m, status: l.status as ListingRow["status"], postedUrl: l.postedUrl }]
        : [];
    }),
  }));
}

/**
 * 媒体の既定値（なければ空）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param media - 媒体
 * @returns 既定値と version
 */
async function defaultsOf(db: Db | TxDb, accountId: string, media: Media) {
  const [row] = await db
    .select()
    .from(mediaDefaults)
    .where(and(eq(mediaDefaults.accountId, accountId), eq(mediaDefaults.media, media)));
  return { values: row?.values ?? {}, version: row?.version ?? null };
}

/**
 * 入力の画面の中身（宣伝内容・掲載内容・既定値）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param promotionId - promotions.id
 * @param media - 媒体
 * @returns 宣伝内容の行・掲載内容の行（なければ undefined）・既定値
 * @throws AppError ITEM_NOT_FOUND（そのAccountの宣伝内容でない）
 */
export async function loadListing(
  db: Db | TxDb,
  accountId: string,
  promotionId: string,
  media: Media,
) {
  const [row] = await db
    .select({ promotion: promotions, listing: promotionListings })
    .from(promotions)
    .leftJoin(
      promotionListings,
      and(eq(promotionListings.promotionId, promotions.id), eq(promotionListings.media, media)),
    )
    .where(and(eq(promotions.id, promotionId), eq(promotions.accountId, accountId)));
  if (!row) throw itemNotFound();
  const defaults = await defaultsOf(db, accountId, media);
  return { promotion: row.promotion, listing: row.listing ?? undefined, defaults: defaults.values };
}

/**
 * 掲載内容の行を、version を確かめてから書く（行がなければ作る。research.md R8）。
 * @param tx - トランザクション
 * @param key - 宣伝内容・Account・媒体
 * @param expectedVersion - 画面が持っている version（行がなければ null）
 * @param values - 書く値
 * @returns 書いた行
 * @throws AppError STALE_UPDATE（ほかで先に保存された）
 */
async function writeListing(
  tx: TxDb,
  key: { promotionId: string; accountId: string; media: Media },
  expectedVersion: number | null,
  values: Partial<typeof promotionListings.$inferInsert>,
): Promise<ListingRow> {
  const stale = async () => {
    const [current] = await tx
      .select()
      .from(promotionListings)
      .where(
        and(
          eq(promotionListings.promotionId, key.promotionId),
          eq(promotionListings.media, key.media),
        ),
      );
    throw new AppError(
      "STALE_UPDATE",
      409,
      "updated elsewhere",
      current ? { version: current.version } : null,
      undefined,
      {
        updatedBy: current ? await updatedByOf(tx, current.updatedByUserId) : null,
      },
    );
  };
  if (expectedVersion === null) {
    const [inserted] = await tx
      .insert(promotionListings)
      .values({ ...key, ...values })
      .onConflictDoNothing()
      .returning();
    return inserted ?? (await stale());
  }
  const [updated] = await tx
    .update(promotionListings)
    .set({ ...values, version: sql`${promotionListings.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(promotionListings.promotionId, key.promotionId),
        eq(promotionListings.media, key.media),
        eq(promotionListings.version, expectedVersion),
      ),
    )
    .returning();
  return updated ?? (await stale());
}

/**
 * 掲載内容を作る（作り直す）。状況が未着手なら作成中にする（spec FR-050）。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（content）
 * @param promotionId - promotions.id
 * @param media - 媒体
 * @param expectedVersion - 画面が持っている version
 * @returns 書いた行
 * @throws AppError VALIDATION_FAILED（開催日時がない）、STALE_UPDATE、ITEM_NOT_FOUND
 */
export async function generateListing(
  tx: TxDb,
  access: AccountAccess,
  promotionId: string,
  media: Media,
  expectedVersion: number | null,
) {
  const { promotion, listing, defaults } = await loadListing(
    tx,
    access.account.id,
    promotionId,
    media,
  );
  if (!promotion.event)
    throw new AppError("VALIDATION_FAILED", 422, "event required", undefined, ["event"]);
  const built = buildListing(media, sourceOf(promotion, defaults));
  const row = await writeListing(
    tx,
    { promotionId, accountId: access.account.id, media },
    expectedVersion,
    {
      fields: built.fields,
      fixes: built.fixes,
      generatedAt: new Date(),
      sourceVersion: promotion.version,
      status: !listing || listing.status === "not_started" ? "drafting" : listing.status,
      updatedByUserId: access.actor.id,
    },
  );
  await recordActivity(tx, access, {
    kind: "content",
    action: "listing_generated",
    summary: `${promotion.title}（${MEDIA_LABELS[media]}）`,
  });
  return { promotion, listing: row, defaults };
}

/**
 * 欄・状況・掲載URL・画像の種類を保存する。欄を送ったときは、自動の直しをもう一度通す（spec FR-012a・FR-022）。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（content）
 * @param promotionId - promotions.id
 * @param media - 媒体
 * @param req - リクエスト
 * @returns 書いた行
 * @throws AppError VALIDATION_FAILED（知らない欄・上限を超える）、STALE_UPDATE、ITEM_NOT_FOUND
 */
export async function updateListing(
  tx: TxDb,
  access: AccountAccess,
  promotionId: string,
  media: Media,
  req: ListingUpdateRequest,
) {
  const { promotion, listing, defaults } = await loadListing(
    tx,
    access.account.id,
    promotionId,
    media,
  );
  const def = MEDIA_DEFINITIONS[media];
  const values: Partial<typeof promotionListings.$inferInsert> = {
    updatedByUserId: access.actor.id,
  };
  if (req.fields) {
    for (const [k, v] of Object.entries(req.fields)) {
      const f = def.fields.find((x) => x.key === k);
      if (!f) throw new AppError("VALIDATION_FAILED", 400, `unknown field ${k}`, undefined, [k]);
      if ([...v].length > (f.max ?? FIELD_MAX_DEFAULT))
        throw new AppError("VALIDATION_FAILED", 400, `too long ${k}`, undefined, [k]);
    }
    const r = refixListing(
      media,
      { ...(listing?.fields ?? {}), ...req.fields },
      sourceOf(promotion, defaults),
    );
    values.fields = r.fields;
    values.fixes = [...(listing?.fixes ?? []), ...r.fixes];
  }
  if (req.status !== undefined) values.status = req.status;
  if (req.postedUrl !== undefined) values.postedUrl = req.postedUrl === "" ? null : req.postedUrl;
  if (req.imageStyle !== undefined) values.imageStyle = req.imageStyle;
  const row = await writeListing(
    tx,
    { promotionId, accountId: access.account.id, media },
    req.expectedVersion,
    values,
  );
  const statusChanged =
    req.status !== undefined && req.status !== (listing?.status ?? "not_started");
  await recordActivity(tx, access, {
    kind: "content",
    action: statusChanged ? "listing_status_changed" : "listing_saved",
    summary: `${promotion.title}（${MEDIA_LABELS[media]}）`,
    ...(statusChanged
      ? { details: { from: listing?.status ?? "not_started", to: req.status } }
      : {}),
  });
  return { promotion, listing: row, defaults };
}

/**
 * 5つの媒体の既定値。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 媒体ごとの値と version
 */
export async function listMediaDefaults(db: Db, accountId: string) {
  const rows = await db.select().from(mediaDefaults).where(eq(mediaDefaults.accountId, accountId));
  return MEDIA.map((m) => {
    const r = rows.find((x) => x.media === m);
    return { media: m, values: r?.values ?? {}, version: r?.version ?? null };
  });
}

/**
 * 媒体の既定値を保存する（既定値にできる欄の key だけ）。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（content）
 * @param media - 媒体
 * @param req - 既定値と version
 * @returns 保存した値と version
 * @throws AppError VALIDATION_FAILED（既定値にできない欄）、STALE_UPDATE
 */
export async function saveMediaDefaults(
  tx: TxDb,
  access: AccountAccess,
  media: Media,
  req: { expectedVersion: number | null; values: Record<string, string> },
) {
  const allowed = new Set(
    MEDIA_DEFINITIONS[media].fields.filter((f) => f.defaultable).map((f) => f.key),
  );
  for (const k of Object.keys(req.values)) {
    if (!allowed.has(k))
      throw new AppError("VALIDATION_FAILED", 400, `not defaultable ${k}`, undefined, [k]);
  }
  const accountId = access.account.id;
  const stale = async () => {
    const current = await defaultsOf(tx, accountId, media);
    throw new AppError("STALE_UPDATE", 409, "updated elsewhere", current, undefined);
  };
  if (req.expectedVersion === null) {
    const [row] = await tx
      .insert(mediaDefaults)
      .values({ accountId, media, values: req.values, updatedByUserId: access.actor.id })
      .onConflictDoNothing()
      .returning();
    if (!row) return stale();
    return { media, values: row.values, version: row.version };
  }
  const [row] = await tx
    .update(mediaDefaults)
    .set({
      values: req.values,
      version: sql`${mediaDefaults.version} + 1`,
      updatedByUserId: access.actor.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaDefaults.accountId, accountId),
        eq(mediaDefaults.media, media),
        eq(mediaDefaults.version, req.expectedVersion),
      ),
    )
    .returning();
  if (!row) return stale();
  return { media, values: row.values, version: row.version };
}
