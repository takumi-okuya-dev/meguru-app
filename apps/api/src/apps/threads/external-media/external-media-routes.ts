// /api/threads/accounts/:accountId/external-media と /media-defaults（specs/021-external-media contracts/api.md）。
// 読むのは view（オーナーと担当の人）、書くのは content。どれも機能のまとまり「戦略」（019）。見せてもらっている人には出さない（research.md R7）。
import {
  listingGenerateRequestSchema,
  listingUpdateRequestSchema,
  mediaDefaultsUpdateSchema,
  type Listing,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb, withTransaction } from "../../../kernel/db/client";
import { parseBody } from "../../../kernel/validate";
import { authorizeAccount } from "../access/access";
import {
  assertMedia,
  generateListing,
  listExternalMedia,
  listMediaDefaults,
  loadListing,
  saveMediaDefaults,
  updateListing,
  type ListingRow,
  type PromotionRow,
} from "./external-media-service";
import { assertItemId } from "../strategy/item-service";
import { deliverPromotionEvents } from "../strategy/promotion-events";
import { toPromotion } from "../strategy/promotion-routes";

/**
 * 掲載内容の行を、レスポンスの形にする（行がなければ未着手）。
 * @param row - promotion_listings の行
 * @returns 掲載内容と状況
 */
function toListing(row: ListingRow | undefined): Listing {
  return {
    status: (row?.status ?? "not_started") as Listing["status"],
    postedUrl: row?.postedUrl ?? null,
    imageStyle: (row?.imageStyle ?? "illustration") as Listing["imageStyle"],
    fields: row?.fields ?? null,
    fixes: row?.fixes ?? [],
    generatedAt: row?.generatedAt?.toISOString() ?? null,
    sourceVersion: row?.sourceVersion ?? null,
    version: row?.version ?? null,
  };
}

/**
 * 入力の画面の応答。
 * @param r - 宣伝内容・掲載内容・既定値
 * @param r.promotion - 宣伝内容の行
 * @param r.listing - 掲載内容の行
 * @param r.defaults - 既定値
 * @param media - 媒体
 * @param canEdit - content があるか
 * @returns 応答
 */
function detail(
  r: { promotion: PromotionRow; listing?: ListingRow; defaults: Record<string, string> },
  media: string,
  canEdit: boolean,
) {
  const listing = toListing(r.listing);
  return {
    promotion: toPromotion(r.promotion, new Date()),
    media,
    listing,
    defaults: r.defaults,
    sourceChanged: listing.sourceVersion !== null && listing.sourceVersion !== r.promotion.version,
    canEdit,
  };
}

/**
 * 外部媒体展開のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function externalMediaRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/external-media", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", {
        feature: "strategy",
      });
      const rows = await listExternalMedia(db, access.account.id);
      c.header("Cache-Control", "no-store");
      return c.json({
        promotions: rows.map((r) => ({
          id: r.row.id,
          title: r.row.title,
          version: r.row.version,
          event: r.row.event ?? null,
          listings: r.listings,
        })),
        canEdit: access.permissions.has("content"),
      });
    })
    .get("/accounts/:accountId/external-media/:promotionId/:media", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", {
        feature: "strategy",
      });
      const media = assertMedia(c.req.param("media"));
      const r = await loadListing(
        db,
        access.account.id,
        assertItemId(c.req.param("promotionId")),
        media,
      );
      c.header("Cache-Control", "no-store");
      return c.json(detail(r, media, access.permissions.has("content")));
    })
    .post("/accounts/:accountId/external-media/:promotionId/:media/generate", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(
        db,
        c.get("user"),
        c.req.param("accountId"),
        "content",
        { feature: "strategy" },
      );
      const media = assertMedia(c.req.param("media"));
      const promotionId = assertItemId(c.req.param("promotionId"));
      const { expectedVersion } = await parseBody(listingGenerateRequestSchema, c.req.json());
      const r = await withTransaction(c.env.DATABASE_URL, (tx) =>
        generateListing(tx, access, promotionId, media, expectedVersion),
      );
      return c.json(detail(r, media, true));
    })
    .put("/accounts/:accountId/external-media/:promotionId/:media", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(
        db,
        c.get("user"),
        c.req.param("accountId"),
        "content",
        { feature: "strategy" },
      );
      const media = assertMedia(c.req.param("media"));
      const promotionId = assertItemId(c.req.param("promotionId"));
      const req = await parseBody(listingUpdateRequestSchema, c.req.json());
      const r = await withTransaction(c.env.DATABASE_URL, (tx) =>
        updateListing(tx, access, promotionId, media, req),
      );
      // 掲載済みの媒体が変わったときの出来事を、トランザクションのあとですぐ届ける
      await deliverPromotionEvents(c.env, r.eventIds);
      return c.json(detail(r, media, true));
    })
    .get("/accounts/:accountId/media-defaults", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", {
        feature: "strategy",
      });
      c.header("Cache-Control", "no-store");
      return c.json({
        items: await listMediaDefaults(db, access.account.id),
        canEdit: access.permissions.has("content"),
      });
    })
    .put("/accounts/:accountId/media-defaults/:media", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(
        db,
        c.get("user"),
        c.req.param("accountId"),
        "content",
        { feature: "strategy" },
      );
      const media = assertMedia(c.req.param("media"));
      const req = await parseBody(mediaDefaultsUpdateSchema, c.req.json());
      return c.json(
        await withTransaction(c.env.DATABASE_URL, (tx) =>
          saveMediaDefaults(tx, access, media, req),
        ),
      );
    });
}
