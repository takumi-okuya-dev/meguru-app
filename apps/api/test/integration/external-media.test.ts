// 外部媒体展開のAPI（specs/021-external-media contracts/api.md、tasks.md T007・T025・T044・T052）
import { neon } from "@neondatabase/serverless";
import type { ListingDetail } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { disableFeatures } from "../helpers/features";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

const EVENT = {
  startAt: "2026-11-25T20:00",
  endAt: "2026-11-25T22:00",
  format: "venue",
  venueName: "バー SHITEN",
  prefecture: "東京都",
  address: "台東区上野4-1-8",
  station: "御徒町駅 徒歩3分",
  capacity: 25,
  feeYen: 5000,
  cancelPolicy: "当日キャンセル：100%",
};
const CONTENT = "ゆるく繋がる飲み会です\nhttps://maps.app.goo.gl/abc\n参加費のご案内はLINEでします";

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: string[] } }).error;

const base = (accountId: string) => `/api/accounts/${accountId}`;
const listingPath = (accountId: string, promotionId: string, media = "peatix") =>
  `${base(accountId)}/external-media/${promotionId}/${media}`;

async function promotion(accountId: string, over: Record<string, unknown> = {}, user = "u1") {
  const res = await call(app, "POST", `${base(accountId)}/promotions`, {
    user,
    body: {
      title: "IT交流会 ゆるく繋がる飲み会",
      content: CONTENT,
      linkedUrl: "https://example.com/e/1",
      event: EVENT,
      ...over,
    },
  });
  return json<{ id: string; version: number }>(res, 201);
}

const generate = (
  accountId: string,
  promotionId: string,
  expectedVersion: number | null = null,
  media = "peatix",
  user = "u1",
) =>
  call(app, "POST", `${listingPath(accountId, promotionId, media)}/generate`, {
    user,
    body: { expectedVersion },
  });
const put = (
  accountId: string,
  promotionId: string,
  body: Record<string, unknown>,
  media = "peatix",
  user = "u1",
) => call(app, "PUT", listingPath(accountId, promotionId, media), { user, body });

beforeEach(async () => {
  await resetDb();
});

describe("守り（contracts/api.md「守り」）", () => {
  it("オーナーと担当の人は読める。見せてもらっている人は ROLE_FORBIDDEN、関わりのない人は ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1", shared: true });
    const p = await promotion(accountId, {}, "o1");
    await createUserWithAccount("x1");
    expect(
      (await call(app, "GET", `${base(accountId)}/external-media`, { user: "o1" })).status,
    ).toBe(200);
    expect((await call(app, "GET", listingPath(accountId, p.id), { user: "e1" })).status).toBe(200);
    const viewer = await call(app, "GET", `${base(accountId)}/external-media`, { user: "a1" });
    expect([viewer.status, (await errorOf(viewer)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const stranger = await call(app, "GET", `${base(accountId)}/external-media`, { user: "x1" });
    expect([stranger.status, (await errorOf(stranger)).code]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
  });

  it("戦略がOFFなら FEATURE_DISABLED、決済で読むだけなら書けない", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId);
    await endTrial(userId);
    const billing = await call(app, "POST", `${listingPath(accountId, p.id)}/generate`, {
      user: "u1",
      body: { expectedVersion: null },
      env: { ...testEnv, BILLING_ENABLED: "true" } as typeof testEnv,
    });
    expect([billing.status, (await errorOf(billing)).code]).toEqual([403, "BILLING_REQUIRED"]);
    await disableFeatures(userId, "strategy");
    const off = await call(app, "GET", `${base(accountId)}/external-media`, { user: "u1" });
    expect([off.status, (await errorOf(off)).code]).toEqual([403, "FEATURE_DISABLED"]);
  });

  it("ほかのAccountの宣伝内容・知らない媒体は ITEM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { accountId: other } = await createUserWithAccount("u2");
    const p = await promotion(other, {}, "u2");
    const res = await call(app, "GET", listingPath(accountId, p.id), { user: "u1" });
    expect([res.status, (await errorOf(res)).code]).toEqual([404, "ITEM_NOT_FOUND"]);
    const mine = await promotion(accountId);
    const bad = await call(app, "GET", listingPath(accountId, mine.id, "twitter"), { user: "u1" });
    expect([bad.status, (await errorOf(bad)).code]).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});

describe("一覧と入力の画面", () => {
  it("一覧は開催日時の近い順、開催日時のない宣伝内容は最後。listings は行のある媒体だけ", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await promotion(accountId, { title: "イベントなし", event: null });
    const later = await promotion(accountId, {
      title: "あと",
      event: { ...EVENT, startAt: "2099-12-01T20:00", endAt: null },
    });
    await promotion(accountId, {
      title: "先",
      event: { ...EVENT, startAt: "2099-11-01T20:00", endAt: null },
    });
    expect((await generate(accountId, later.id)).status).toBe(200);
    const list = await json<{
      promotions: { title: string; listings: { media: string; status: string }[] }[];
    }>(await call(app, "GET", `${base(accountId)}/external-media`, { user: "u1" }));
    expect(list.promotions.map((p) => p.title)).toEqual(["先", "あと", "イベントなし"]);
    expect(list.promotions[1]!.listings).toEqual([
      { media: "peatix", status: "drafting", postedUrl: null },
    ]);
  });

  it("まだ作っていなければ fields は null で、既定値が返る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId);
    await json(
      await call(app, "PUT", `${base(accountId)}/media-defaults/peatix`, {
        user: "u1",
        body: { expectedVersion: null, values: { emergencyTel: "03-0000-0000" } },
      }),
    );
    const d = await json<ListingDetail>(
      await call(app, "GET", listingPath(accountId, p.id), { user: "u1" }),
    );
    expect([d.listing.fields, d.listing.status, d.defaults]).toEqual([
      null,
      "not_started",
      { emergencyTel: "03-0000-0000" },
    ]);
  });
});

describe("作る・保存", () => {
  it("作ると欄と自動で直した内容が入り、状況が作成中になる。既定値が入り、操作の記録が残る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1");
    const p = await promotion(accountId);
    await json(
      await call(app, "PUT", `${base(accountId)}/media-defaults/peatix`, {
        user: "u1",
        body: { expectedVersion: null, values: { emergencyTel: "03-0000-0000" } },
      }),
    );
    const d = await json<ListingDetail>(await generate(accountId, p.id));
    expect(d.listing.status).toBe("drafting");
    expect(d.listing.fields!.title).toContain("IT交流会");
    expect(d.listing.fields!.emergencyTel).toBe("03-0000-0000");
    expect(d.listing.fields!.body).not.toMatch(/maps\.app|LINE/);
    expect(d.listing.fixes).toHaveLength(2);
    expect(d.listing.sourceVersion).toBe(p.version);
    expect((await activityRows(accountId)).map((r) => r.action)).toContain("listing_generated");
  });

  it("開催日時のない宣伝内容は 422 VALIDATION_FAILED（details は event）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId, { event: null });
    const res = await generate(accountId, p.id);
    expect([res.status, (await errorOf(res)).details]).toEqual([422, ["event"]]);
  });

  it("欄を直して保存する。禁止の行を貼ると外れて fixes に足される。知らない key・上限超え・古い version は断る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId);
    const d = await json<ListingDetail>(await generate(accountId, p.id));
    const saved = await json<ListingDetail>(
      await put(accountId, p.id, {
        expectedVersion: d.listing.version,
        fields: { body: "よい会です\nhttps://other.example.com" },
      }),
    );
    expect(saved.listing.fields!.body).toBe("よい会です");
    expect(saved.listing.fixes).toHaveLength(3);
    expect(
      (
        await put(accountId, p.id, {
          expectedVersion: saved.listing.version,
          fields: { nope: "x" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put(accountId, p.id, {
          expectedVersion: saved.listing.version,
          fields: { title: "あ".repeat(46) },
        })
      ).status,
    ).toBe(400);
    const stale = await put(accountId, p.id, {
      expectedVersion: d.listing.version,
      fields: { title: "古い" },
    });
    expect([stale.status, (await errorOf(stale)).code]).toEqual([409, "STALE_UPDATE"]);
  });

  it("掲載内容を直しても宣伝内容は1文字も変わらず、宣伝内容を直しても掲載内容は変わらない（SC-004）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId);
    const before = (
      await sql()`SELECT title, content, event FROM threads.promotions WHERE id = ${p.id}`
    )[0];
    const d = await json<ListingDetail>(await generate(accountId, p.id));
    await json(
      await put(accountId, p.id, {
        expectedVersion: d.listing.version,
        fields: { title: "変えたタイトル", body: "変えた本文" },
      }),
    );
    expect(
      (await sql()`SELECT title, content, event FROM threads.promotions WHERE id = ${p.id}`)[0],
    ).toEqual(before);
    await json(
      await call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, {
        user: "u1",
        body: { title: "宣伝内容を直した", content: "直した", expectedVersion: p.version },
      }),
    );
    const after = await json<ListingDetail>(
      await call(app, "GET", listingPath(accountId, p.id), { user: "u1" }),
    );
    expect(after.listing.fields!.title).toBe("変えたタイトル");
    expect(after.sourceChanged).toBe(true);
  });
});

describe("状況と掲載URL（US4）", () => {
  it("状況と掲載URLを保存し、記録 listing_status_changed。URLの形が違えば 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1");
    const p = await promotion(accountId);
    const d = await json<ListingDetail>(await generate(accountId, p.id));
    const posted = await json<ListingDetail>(
      await put(accountId, p.id, {
        expectedVersion: d.listing.version,
        status: "posted",
        postedUrl: "https://peatix.com/event/1",
      }),
    );
    expect([posted.listing.status, posted.listing.postedUrl]).toEqual([
      "posted",
      "https://peatix.com/event/1",
    ]);
    expect((await activityRows(accountId)).map((r) => r.action)).toContain(
      "listing_status_changed",
    );
    expect(
      (
        await put(accountId, p.id, {
          expectedVersion: posted.listing.version,
          postedUrl: "ftp://x",
        })
      ).status,
    ).toBe(400);
  });

  it("作り直すと欄が入れ直され、状況は変わらない。宣伝内容を消すと掲載内容も消える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await promotion(accountId);
    const d = await json<ListingDetail>(await generate(accountId, p.id));
    const posted = await json<ListingDetail>(
      await put(accountId, p.id, {
        expectedVersion: d.listing.version,
        status: "posted",
        fields: { title: "直した" },
      }),
    );
    const again = await json<ListingDetail>(
      await generate(accountId, p.id, posted.listing.version),
    );
    expect([again.listing.status, again.listing.fields!.title!.includes("IT交流会")]).toEqual([
      "posted",
      true,
    ]);
    expect(
      (await call(app, "DELETE", `${base(accountId)}/promotions/${p.id}`, { user: "u1" })).status,
    ).toBe(204);
    expect(await sql()`SELECT 1 FROM threads.promotion_listings`).toEqual([]);
  });
});

describe("媒体の既定値", () => {
  it("既定値にできる欄だけ保存でき、古い version は断る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const first = await json<{ version: number }>(
      await call(app, "PUT", `${base(accountId)}/media-defaults/kokuchpro`, {
        user: "u1",
        body: { expectedVersion: null, values: { officeName: "港" } },
      }),
    );
    const bad = await call(app, "PUT", `${base(accountId)}/media-defaults/kokuchpro`, {
      user: "u1",
      body: { expectedVersion: first.version, values: { title: "x" } },
    });
    expect(bad.status).toBe(400);
    const stale = await call(app, "PUT", `${base(accountId)}/media-defaults/kokuchpro`, {
      user: "u1",
      body: { expectedVersion: null, values: { officeName: "別" } },
    });
    expect(stale.status).toBe(409);
    const list = await json<{ items: { media: string; values: Record<string, string> }[] }>(
      await call(app, "GET", `${base(accountId)}/media-defaults`, { user: "u1" }),
    );
    expect(list.items.find((i) => i.media === "kokuchpro")!.values).toEqual({ officeName: "港" });
  });
});
