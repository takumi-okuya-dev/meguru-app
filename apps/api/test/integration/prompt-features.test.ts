// まとまりがOFFのときのプロンプト（specs/019-feature-switches research.md R4、FR-007・FR-015）。
// 戦略が使えなければ課題・宣伝内容・参考投稿を入れない。NGワード・CORE RULES・却下の理由・低調な投稿は入れ続ける。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { confirmedMetrics, db, publishedDrafts } from "../helpers/auto-post";
import { disableFeatures } from "../helpers/features";

const app = makeApp();
const base = (id: string) => `/api/accounts/${id}`;

beforeEach(async () => {
  await resetDb();
});

type Prompt = {
  prompt: string;
  materials: unknown;
  summary: { strategyFilledCount: number; promotionCount: number; referencePostCount: number; poorPostCount: number };
};

async function getPrompt(accountId: string, user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/prompt`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as Prompt;
}

/** 課題（ターゲット・口調・目的・プロフィールの下書き）・宣伝内容・参考投稿・NGワード・却下を入れる。 */
async function fillMaterials(accountId: string) {
  const current = (await (await call(app, "GET", `${base(accountId)}/strategy`, { user: "u1" })).json()) as Record<string, unknown>;
  const { canEdit: _c, filledCount: _f, totalCount: _t, updatedAt: _u, version, ...values } = current;
  const put = await call(app, "PUT", `${base(accountId)}/strategy`, {
    user: "u1",
    body: {
      ...values,
      targetPersona: "28歳の会社員",
      tonePreset: "polite_warm",
      purposeOrigin: "転職で悩んだ",
      profileBioDraft: "プロフィール案",
      expectedVersion: version,
    },
  });
  expect(put.status).toBe(200);
  const promo = await call(app, "POST", `${base(accountId)}/promotions`, {
    user: "u1",
    body: { title: "春のセミナー", content: "セミナーの宣伝", status: "active", cta: "DMで申し込み" },
  });
  expect(promo.status).toBe(201);
  const ref = await call(app, "POST", `${base(accountId)}/reference-posts`, {
    user: "u1",
    body: { body: "参考投稿の本文", keyword: "転職", whyGood: "数字から入る" },
  });
  expect(ref.status).toBe(201);
  expect((await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対儲かる"] } })).status).toBe(200);
  const batch = await call(app, "POST", `${base(accountId)}/draft-batches`, {
    user: "u1",
    body: { clientRequestId: crypto.randomUUID(), text: "却下する下書き" },
  });
  const { drafts } = (await batch.json()) as { drafts: { id: string }[] };
  const reject = await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
    user: "u1",
    body: { requestId: crypto.randomUUID(), action: "reject", items: [{ id: drafts[0]!.id, expectedVersion: 1 }], reject: { reasons: ["tone"], note: "" } },
  });
  expect(reject.status).toBe(200);
}

/** 低調と判定された投稿を1件作る。 */
async function poorPost(accountId: string) {
  const [d] = await publishedDrafts(accountId, [{ body: "低調だった投稿", publishedAt: new Date(Date.now() - 200 * 3600_000) }]);
  await confirmedMetrics(accountId, d!.id, 10);
  await db()`UPDATE post_metrics SET judgment = 'poor', judgment_ratio = 0.2, judgment_baseline = 50 WHERE draft_id = ${d!.id}`;
}

const STRATEGY_HEADINGS = ["■アカウントの戦略設計", "■活動の目的・在り方", "■現在のプロフィールと固定投稿", "■今回組み込む宣伝内容", "■リサーチで見つけた"];

describe("戦略がOFF（FR-007）", () => {
  it("課題・目的・下書き・宣伝内容・参考投稿の節が入らず、materials は null、戦略の数は0", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await fillMaterials(accountId);
    const on = await getPrompt(accountId);
    for (const h of STRATEGY_HEADINGS) expect(on.prompt, h).toContain(h);

    await disableFeatures(userId, "strategy");
    const off = await getPrompt(accountId);
    for (const h of STRATEGY_HEADINGS) expect(off.prompt, h).not.toContain(h);
    // 口調の初期値だけの節も残らない
    expect(off.prompt).not.toContain("丁寧・温かい");
    expect(off.prompt).not.toContain("28歳の会社員");
    expect(off.materials).toBeNull();
    expect(off.summary).toMatchObject({ strategyFilledCount: 0, promotionCount: 0, referencePostCount: 0 });
  });

  it("NGワード・CORE RULES・却下の理由・低調な投稿は入る（FR-015。パフォーマンスは自動投稿のまとまり）", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await fillMaterials(accountId);
    await poorPost(accountId);
    await disableFeatures(userId, "strategy");
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toContain("■絶対に守るルール(CORE RULES)");
    expect(prompt).toContain("絶対儲かる");
    expect(prompt).toContain("■過去に却下された投稿");
    expect(prompt).toContain("■反応が低かった投稿");
  });
});
