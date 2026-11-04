// US1：プロンプトの取得と作る件数（specs/003-prompt-bulk-register FR-001〜FR-008・FR-024、research.md R1・R10・R11）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

import { confirmedMetrics, db, publishedDrafts, setSchedule } from "../helpers/auto-post";

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
    // 下書きは014から、投稿の方向性の軸として入る（specs/014 FR-113）
    expect(prompt).toContain("- プロフィール文:\nプロフィール案");
    expect(prompt).toContain("1. 【有効】(期限なし) 有効の宣伝 / 行動喚起: DMで申し込み");
    expect(prompt).not.toContain("停止の宣伝");
    expect(prompt).toContain("元の投稿(参考: 内容はコピーしない) [検索語:転職・投稿日不明]\n   > 参考投稿の本文");
    expect(prompt).toContain("1. 新しい下書きA\n2. 新しい下書きB\n3. 古い下書き");
    expect(summary).toMatchObject({ strategyFilledCount: 2, promotionCount: 1, referencePostCount: 1, recentDraftCount: 3 });
  });

  it("話者はアカウントの名前（Threadsの表示名・ユーザー名は使わない。specs/012 FR-037）", async () => {
    const { accountId } = await createUserWithAccount("u1", { name: "カフェの公式" });
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toContain("表示名: カフェの公式");
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
    const res = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount: 10, expectedVersion: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ postCount: 10, version: 2 });
    expect((await getPrompt(accountId)).count).toBe(10);
    const drafts = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    expect(await drafts.json()).toMatchObject({ promptPostCount: 10, canGeneratePrompt: true });
  });

  it("0・51・1.5 は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (const postCount of [0, 51, 1.5]) {
      const res = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount, expectedVersion: 1 } });
      expect(res.status).toBe(400);
    }
  });
});

describe("プランと権限", () => {
  it("無料体験の後でも決済OFFなら使える", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    expect((await getPrompt(accountId)).count).toBe(30);
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    for (const [method, path, body] of [
      ["GET", "/prompt", undefined],
      ["PUT", "/prompt-settings", { postCount: 10, expectedVersion: 1 }],
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
    const put = await call(app, "PUT", `${base(accountId)}/prompt-settings`, { user: "u1", body: { postCount: 3, expectedVersion: 1 } });
    expect(put.status).toBe(200);
  });
});

describe("CORE RULES・NGワード・却下の反映（specs/004-review-approval FR-022〜FR-025）", () => {
  it("投稿ルール・NGワード・却下の下書き（新しく却下した順、理由の表示名つき）が入り、要約に件数が入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "PUT", `${base(accountId)}/core-rules`, {
      user: "u1",
      body: { text: "断定口調は使わない\n\n医療の効果をうたわない\n", expectedVersion: 1 },
    });
    await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対", "必ず儲かる"] } });
    const reg = await call(app, "POST", `${base(accountId)}/draft-batches`, {
      user: "u1",
      body: { clientRequestId: crypto.randomUUID(), text: "却下1\n@@@\n却下2\n@@@\n承認する下書き\n@@@\n戻す下書き" },
    });
    const [d1, d2, d3, d4] = ((await reg.json()) as { drafts: { id: string }[] }).drafts;
    const review = (body: unknown) => call(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "u1", body });
    await review({ requestId: crypto.randomUUID(), action: "reject", items: [{ id: d1!.id, expectedVersion: 1 }], reject: { reasons: ["tone"], note: "" } });
    await review({ requestId: crypto.randomUUID(), action: "reject", items: [{ id: d2!.id, expectedVersion: 1 }], reject: { reasons: [], note: "語尾がきつい" } });
    await review({ requestId: crypto.randomUUID(), action: "approve", items: [{ id: d3!.id, expectedVersion: 1 }] });
    await review({ requestId: crypto.randomUUID(), action: "reject", items: [{ id: d4!.id, expectedVersion: 1 }], reject: { reasons: ["thin"], note: "" } });
    await review({ requestId: crypto.randomUUID(), action: "reopen", items: [{ id: d4!.id, expectedVersion: 2 }] });

    const { prompt, summary } = await getPrompt(accountId);
    expect(prompt).toContain("・断定口調は使わない\n・医療の効果をうたわない\n・次の言葉は使わないこと: 絶対、必ず儲かる");
    expect(prompt).toContain(
      "■過去に却下された投稿(この傾向は繰り返さないこと)\n1. 却下2(却下理由: 語尾がきつい)\n2. 却下1(却下理由: トーンが違う)",
    );
    // 要確認に戻した却下は入らない。承認済みは「直近の下書き」に入る
    expect(prompt).not.toContain("戻す下書き(却下理由");
    expect(prompt).toMatch(/投稿ストックにある直近の下書き[^■]*承認する下書き/);
    expect(summary).toMatchObject({ coreRuleCount: 2, ngWordCount: 2, rejectedCount: 2 });
  });
});


it("005：オフでも設定した時刻の数を宣伝の文面とsummaryに反映する", async () => {
  const { accountId } = await createUserWithAccount("u1");
  expect((await getPrompt(accountId)).summary).toMatchObject({ dailyPostCount: 0 });
  await setSchedule(accountId, { slotMinutes: [450, 720, 1080, 1260], enabled: false });
  await call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: { title: "サービス", content: "サービス内容" } });
  await neon(testEnv.DATABASE_URL)`UPDATE accounts SET promotion_ratio_percent = 25 WHERE id = ${accountId}`;
  const result = await getPrompt(accountId);
  expect(result.summary).toMatchObject({ dailyPostCount: 4 });
  expect(result.prompt).toContain("1日の投稿は4件の設定で、そのうち1件程度");
});

describe("反応が低かった投稿の反映（specs/006 FR-025〜FR-027、SC-003）", () => {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  const HEADING = "■反応が低かった投稿(このアカウントで閲覧数が基準の半分以下だった投稿。同じ書き方・切り口は避けること)";

  it("外していない低調の新しい5件がメモ付きで入り、外した投稿・好調・普通・確定待ちは入らない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const poor = await publishedDrafts(
      accountId,
      [200, 201, 202, 203, 204, 205, 206].map((h, i) => ({ body: `低調${i + 1}`, publishedAt: ago(h) })),
    );
    for (const [i, d] of poor.entries()) {
      await confirmedMetrics(accountId, d.id, 10, i === 6 ? "late_confirmed" : "confirmed");
      await db()`UPDATE post_metrics SET judgment = 'poor', judgment_ratio = 0.2, judgment_baseline = 50 WHERE draft_id = ${d.id}`;
    }
    await db()`UPDATE post_metrics SET feedback_memo = '前置きが長い' WHERE draft_id = ${poor[1]!.id}`;
    await db()`UPDATE post_metrics SET include_in_prompt = false WHERE draft_id = ${poor[0]!.id}`;
    const [good, normal, pending] = await publishedDrafts(accountId, [
      { body: "好調", publishedAt: ago(150) },
      { body: "普通", publishedAt: ago(151) },
      { body: "確定待ち", publishedAt: ago(10) },
    ]);
    await confirmedMetrics(accountId, good!.id, 100);
    await db()`UPDATE post_metrics SET judgment = 'good', judgment_ratio = 2, judgment_baseline = 50 WHERE draft_id = ${good!.id}`;
    await confirmedMetrics(accountId, normal!.id, 50);
    await db()`UPDATE post_metrics SET judgment = 'normal', judgment_ratio = 1, judgment_baseline = 50 WHERE draft_id = ${normal!.id}`;
    void pending;

    const { prompt, summary } = (await getPrompt(accountId)) as PromptResponse & { summary: { poorPostCount: number } };
    expect(prompt).toContain(
      `${HEADING}\n1. 低調2(傾向メモ: 前置きが長い)\n2. 低調3\n3. 低調4\n4. 低調5\n5. 低調6`,
    );
    for (const body of ["低調1", "低調7", "好調", "普通", "確定待ち"]) expect(prompt).not.toContain(`. ${body}`);
    expect(summary.poorPostCount).toBe(5);
  });

  it("低調の投稿がなければ節ごと省く", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { prompt } = await getPrompt(accountId);
    expect(prompt).not.toContain("■反応が低かった投稿");
  });
});

describe("宣伝内容のイベントの情報（specs/021 FR-001a）", () => {
  it("イベントの情報があるときだけ、プロンプトの宣伝内容に1行が入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "POST", `${base(accountId)}/promotions`, {
      user: "u1",
      body: { title: "IT交流会", content: "飲み会です", event: { startAt: "2099-11-25T20:00", format: "venue", venueName: "バー", feeYen: 5000, capacity: 25 } },
    });
    const res = await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" });
    const { prompt } = (await res.json()) as { prompt: string };
    expect(prompt).toContain("(イベント: 日時: 2099年11月25日(水) 20:00 〜 / 場所: バー / 参加費: 5,000円 / 定員: 25名)");
  });
});
