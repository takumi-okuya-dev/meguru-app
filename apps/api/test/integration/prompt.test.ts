// US1：プロンプトの取得と作る件数（specs/003-prompt-bulk-register FR-001〜FR-008・FR-024、research.md R1・R10・R11）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;

type PromptResponse = {
  prompt: string;
  count: number;
  summary: { strategyFilledCount: number; promotionCount: number; referencePostCount: number; recentDraftCount: number; length: number };
};

async function getPrompt(accountId: string, query = "", user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/prompt${query}`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as PromptResponse;
}

async function addDrafts(accountId: string, bodies: string[], createdAt: string) {
  const sql = neon(testEnv.DATABASE_URL);
  const [b] = (await sql`
    INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found, created_at)
    VALUES (${accountId}, gen_random_uuid(), ${bodies.length}, true, ${createdAt})
    RETURNING id`) as [{ id: string }];
  for (const [i, body] of bodies.entries()) {
    await sql`INSERT INTO post_drafts (account_id, batch_id, position, body) VALUES (${accountId}, ${b.id}, ${i}, ${body})`;
  }
}

describe("GET /prompt", () => {
  it("保存済みの課題・宣伝の対象・参考投稿・直近の下書きを反映し、count 省略時は保存済みの件数（既定30）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const strategy = await call(app, "GET", `${base(accountId)}/strategy`, { user: "u1" });
    const current = (await strategy.json()) as Record<string, unknown>;
    const { canEdit: _c, filledCount: _f, totalCount: _t, updatedAt: _u, version, ...values } = current;
    const put = await call(app, "PUT", `${base(accountId)}/strategy`, {
      user: "u1",
      body: { ...values, targetPersona: "28歳の会社員", tonePreset: "polite_warm", profileBioDraft: "プロフィール案", expectedVersion: version },
    });
    expect(put.status).toBe(200);
    for (const [title, status] of [
      ["有効", "active"],
      ["停止", "paused"],
    ] as const) {
      const res = await call(app, "POST", `${base(accountId)}/promotions`, {
        user: "u1",
        body: { title, content: `${title}の宣伝`, status, cta: "DMで申し込み" },
      });
      expect(res.status).toBe(201);
    }
    const ref = await call(app, "POST", `${base(accountId)}/reference-posts`, {
      user: "u1",
      body: { body: "参考投稿の本文", keyword: "転職", whyGood: "数字から入る" },
    });
    expect(ref.status).toBe(201);
    await addDrafts(accountId, ["古い下書き"], "2026-01-01T00:00:00Z");
    await addDrafts(accountId, ["新しい下書きA", "新しい下書きB"], "2026-02-01T00:00:00Z");

    const { prompt, count, summary } = await getPrompt(accountId);
    expect(count).toBe(30);
    expect(prompt).toContain("Threadsに投稿する文章を30件作ってください。");
    expect(prompt).toContain("ターゲット: 28歳の会社員");
    expect(prompt).toContain("人柄(近い人間性): 丁寧・温かい");
    expect(prompt).not.toContain("プロフィール案");
    expect(prompt).toContain("1. 有効の宣伝 / 行動喚起: DMで申し込み");
    expect(prompt).not.toContain("停止の宣伝");
    expect(prompt).toContain("[検索語:転職] 元の投稿(参考: 内容はコピーしない): 参考投稿の本文");
    expect(prompt).toContain("1. 新しい下書きA\n2. 新しい下書きB\n3. 古い下書き");
    expect(summary).toMatchObject({ strategyFilledCount: 2, promotionCount: 1, referencePostCount: 1, recentDraftCount: 3 });
  });

  it("表示名がなければ @ユーザー名 を話者にする", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toMatch(/表示名: @u1_\d+/);
  });

  it("count を指定するとその件数で作る。0・51・1.5・数字でない値は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect((await getPrompt(accountId, "?count=5")).count).toBe(5);
    for (const q of ["0", "51", "1.5", "abc"]) {
      const res = await call(app, "GET", `${base(accountId)}/prompt?count=${q}`, { user: "u1" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: ["count"] } });
    }
  });
});

describe("PUT /prompt-settings", () => {
  it("保存した件数が次の GET /prompt と GET /post-drafts の promptPostCount に反映される", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount: 10 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postCount: 10 });
    expect((await getPrompt(accountId)).count).toBe(10);
    const drafts = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    expect(await drafts.json()).toMatchObject({ promptPostCount: 10, canGeneratePrompt: true });
  });

  it("0・51・1.5 は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (const postCount of [0, 51, 1.5]) {
      const res = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount } });
      expect(res.status).toBe(400);
    }
  });
});

describe("プランと権限", () => {
  it("無料体験の後のプラン1は GET /prompt・PUT /prompt-settings が 403、GET /post-drafts は canGeneratePrompt: false で 200", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    const get = await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" });
    expect(get.status).toBe(403);
    expect(await get.json()).toMatchObject({ error: { code: "GROWER_FEATURE_REQUIRED" } });
    const put = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount: 10 } });
    expect(put.status).toBe(403);
    const drafts = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    expect(drafts.status).toBe(200);
    expect(await drafts.json()).toMatchObject({ items: [], limit: 500, canGeneratePrompt: false, promptPostCount: 30 });
  });

  it("無料体験の後でもプラン2なら使える", async () => {
    const { accountId } = await createUserWithAccount("u1", { plan: "auto-grower", userCreatedAt: AFTER_TRIAL() });
    expect((await getPrompt(accountId)).count).toBe(30);
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    for (const [method, path, body] of [
      ["GET", "/prompt", undefined],
      ["PUT", "/prompt-settings", { postCount: 10 }],
      ["GET", "/post-drafts", undefined],
    ] as const) {
      const res = await call(app, method, `${base(accountId)}${path}`, { user: "u2", body });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
    }
  });

  it("要再接続のAccountでも 200（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    expect((await getPrompt(accountId)).count).toBe(30);
    const put = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount: 3 } });
    expect(put.status).toBe(200);
  });
});
