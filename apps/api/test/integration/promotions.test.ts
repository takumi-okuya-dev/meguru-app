// US2：宣伝内容と宣伝投稿の割合（specs/002-strategy-profile FR-007〜FR-011・FR-020〜FR-025、research.md R3・R4・R6・R7）
import { jstToday } from "@threads-grower/shared";
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: "10月11日 IT交流会",
    content: "IT業界の方を中心に、ゆるく話せる交流飲み会です。",
    targetLocation: "東京在住",
    targetPersona: "エンジニア",
    targetAgeRange: "20〜40歳",
    cta: "参加したいとコメントする",
    linkedUrl: "https://example.com/events/1",
    priority: 0,
    status: "active",
    validUntil: null,
    ...overrides,
  };
}

type Promotion = { id: string; title: string; version: number; isTargetable: boolean; isExpired: boolean };

async function create(accountId: string, overrides: Record<string, unknown> = {}, user = "u1") {
  const res = await call(app, "POST", `${base(accountId)}/promotions`, { user, body: input(overrides) });
  expect(res.status).toBe(201);
  return (await res.json()) as Promotion;
}

async function list(accountId: string, user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/promotions`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: Promotion[]; limit: number; canEdit: boolean };
}

function daysFromToday(n: number) {
  const d = new Date(`${jstToday(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("宣伝内容", () => {
  it("追加すると状態「有効」・version 1 で返り、一覧に出る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await create(accountId, { status: undefined, priority: undefined });
    expect(p.version).toBe(1);
    expect(p.isTargetable).toBe(true);
    const l = await list(accountId);
    expect(l.items).toHaveLength(1);
    expect(l.limit).toBe(50);
    expect(l.canEdit).toBe(true);
  });

  it("宣伝内容の並び順：FR-009 の順で、isTargetable・isExpired が正しい", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await create(accountId, { title: "A", priority: 0 });
    await create(accountId, { title: "B", priority: 5 });
    await create(accountId, { title: "C", status: "paused", priority: 9 });
    await create(accountId, { title: "D", status: "ended" });
    await create(accountId, { title: "E", validUntil: daysFromToday(-1) });
    await create(accountId, { title: "F", validUntil: daysFromToday(0) });
    const { items } = await list(accountId);
    expect(items.map((p) => p.title)).toEqual(["B", "F", "A", "C", "E", "D"]);
    const byTitle = Object.fromEntries(items.map((p) => [p.title, p]));
    expect(byTitle.E).toMatchObject({ isExpired: true, isTargetable: false });
    expect(byTitle.F).toMatchObject({ isExpired: false, isTargetable: true });
    expect(byTitle.C).toMatchObject({ isExpired: false, isTargetable: false });
  });

  it("管理用タイトル・宣伝したい内容が空白だけ、文字数の超過、URLの形の誤りは 400 で details に項目名", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", `${base(accountId)}/promotions`, {
      user: "u1",
      body: input({ title: "  ", content: "x".repeat(2001), cta: "c".repeat(101), linkedUrl: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { details: string[] } };
    expect(body.error.details).toEqual(expect.arrayContaining(["title", "content", "cta", "linkedUrl"]));
  });

  it("優先度は 0〜100 の整数、掲載期限は実在する日付だけ", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (const bad of [{ priority: 101 }, { priority: -1 }, { priority: 1.5 }, { validUntil: "2026-02-30" }]) {
      const res = await call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: input(bad) });
      expect(res.status).toBe(400);
    }
  });

  it("編集で状態を変えられ、同じ expectedVersion の2回目は 409 で latest が返る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await create(accountId);
    const paused = await call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, {
      user: "u1",
      body: { ...input({ status: "paused" }), expectedVersion: 1 },
    });
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as Promotion).version).toBe(2);
    const stale = await call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, {
      user: "u1",
      body: { ...input({ title: "古いタブ" }), expectedVersion: 1 },
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: { code: string }; latest: Promotion & { status: string } };
    expect(body.error.code).toBe("STALE_UPDATE");
    expect(body.latest).toMatchObject({ version: 2, status: "paused" });
  });

  it("削除済みの行の更新は 404 ITEM_NOT_FOUND、同じ行の2回目の DELETE も 204", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = await create(accountId);
    expect((await call(app, "DELETE", `${base(accountId)}/promotions/${p.id}`, { user: "u1" })).status).toBe(204);
    const put = await call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, {
      user: "u1",
      body: { ...input(), expectedVersion: 1 },
    });
    expect(put.status).toBe(404);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe("ITEM_NOT_FOUND");
    expect((await call(app, "DELETE", `${base(accountId)}/promotions/${p.id}`, { user: "u1" })).status).toBe(204);
  });

  it("件数の上限の同時実行：49件のAccountに2つ同時に追加しても50件を超えない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    await sql`INSERT INTO promotions (account_id, title, content)
      SELECT ${accountId}, 't' || g, 'c' FROM generate_series(1, 49) AS g`;
    const results = await Promise.all(
      [1, 2].map(() => call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: input() })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const limited = results.find((r) => r.status === 409)!;
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("ITEM_LIMIT_REACHED");
    expect((await list(accountId)).items).toHaveLength(50);
  });

  it("別のAccountの行：自分の別のAccountの宣伝内容のIDでは 404 ITEM_NOT_FOUND", async () => {
    const a = await createUserWithAccount("u1", { plan: "multi-account" });
    const b = await createUserWithAccount("u1", { plan: "multi-account" });
    const p = await create(a.accountId);
    const res = await call(app, "PUT", `${base(b.accountId)}/promotions/${p.id}`, {
      user: "u1",
      body: { ...input(), expectedVersion: 1 },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ITEM_NOT_FOUND");
    expect((await call(app, "DELETE", `${base(b.accountId)}/promotions/${p.id}`, { user: "u1" })).status).toBe(204);
    expect((await list(a.accountId)).items).toHaveLength(1);
  });

  it("他人のAccount：一覧・追加・割合は 404 ACCOUNT_NOT_FOUND（FR-023、SC-006）", async () => {
    const { accountId } = await createUserWithAccount("owner");
    await create(accountId, {}, "owner");
    await createUserWithAccount("other");
    for (const [method, p, body] of [
      ["GET", "promotions", undefined],
      ["POST", "promotions", input()],
      ["GET", "promotion-settings", undefined],
      ["PUT", "promotion-settings", { ratioPercent: 50 }],
    ] as const) {
      const res = await call(app, method, `${base(accountId)}/${p}`, { user: "other", body });
      expect(res.status).toBe(404);
    }
    expect((await list(accountId, "owner")).items).toHaveLength(1);
  });

  it("要再接続のAccountでも、宣伝内容と割合を読み書きできる（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    await create(accountId);
    expect((await call(app, "PUT", `${base(accountId)}/promotion-settings`, { user: "u1", body: { ratioPercent: 30 } })).status).toBe(200);
  });

  it("grower機能の判定：無料体験の後のプラン1は書き込みが 403、読み取りは canEdit: false（FR-024、SC-008）", async () => {
    const { accountId } = await createUserWithAccount("u1", { plan: "auto-grower", userCreatedAt: AFTER_TRIAL() });
    const p = await create(accountId);
    await setAccount(accountId, { plan: "auto-only" });
    const writes = [
      call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: input() }),
      call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, { user: "u1", body: { ...input(), expectedVersion: 1 } }),
      call(app, "DELETE", `${base(accountId)}/promotions/${p.id}`, { user: "u1" }),
      call(app, "PUT", `${base(accountId)}/promotion-settings`, { user: "u1", body: { ratioPercent: 30 } }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("GROWER_FEATURE_REQUIRED");
    }
    const l = await list(accountId);
    expect(l.canEdit).toBe(false);
    expect(l.items).toHaveLength(1);
  });
});

describe("宣伝投稿の割合", () => {
  it("既定は20%。0〜100の整数で保存でき、101 と 1.5 は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const get = await call(app, "GET", `${base(accountId)}/promotion-settings`, { user: "u1" });
    expect(await get.json()).toEqual({ ratioPercent: 20, canEdit: true });
    const put = await call(app, "PUT", `${base(accountId)}/promotion-settings`, { user: "u1", body: { ratioPercent: 30 } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { ratioPercent: number }).ratioPercent).toBe(30);
    for (const ratioPercent of [101, 1.5, -1]) {
      const res = await call(app, "PUT", `${base(accountId)}/promotion-settings`, { user: "u1", body: { ratioPercent } });
      expect(res.status).toBe(400);
    }
  });
});
