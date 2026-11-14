// まとまりで守るAPI（specs/019-feature-switches contracts/api.md「守るAPI」、FR-005・FR-009・FR-010、SC-002・SC-004）。
// どのAPIも、権限の判定の前に入力を読まないので、本文は空でも判定の結果を確かめられる。
import type { Feature } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { disableFeatures, enableAll } from "../helpers/features";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (id: string) => `/api/threads/accounts/${id}`;
const UUID = "00000000-0000-4000-8000-000000000000";

/** まとまりごとの、守るAPI（contracts/api.md の表のとおり。オーナーの設定で判定する）。 */
const GUARDED: Record<Feature, [string, (id: string) => string][]> = {
  autopost: [
    ["GET", (id) => `${base(id)}/prompt`],
    ["PUT", (id) => `${base(id)}/prompt-settings`],
    ["GET", (id) => `${base(id)}/post-drafts`],
    ["GET", (id) => `${base(id)}/post-drafts/published`],
    ["GET", (id) => `${base(id)}/post-drafts/counts`],
    ["POST", (id) => `${base(id)}/draft-batches`],
    ["DELETE", (id) => `${base(id)}/draft-batches/${UUID}`],
    ["PUT", (id) => `${base(id)}/post-drafts/${UUID}`],
    ["POST", (id) => `${base(id)}/post-drafts/delete`],
    ["POST", (id) => `${base(id)}/post-drafts/${UUID}/prioritize`],
    ["POST", (id) => `${base(id)}/post-drafts/review`],
    ["GET", (id) => `${base(id)}/performance`],
    ["PATCH", (id) => `${base(id)}/performance/${UUID}/feedback`],
    ["GET", (id) => `${base(id)}/performance/export?kind=posts`],
    ["GET", (id) => `${base(id)}/posting-schedule`],
    ["PUT", (id) => `${base(id)}/posting-schedule`],
    ["GET", (id) => `${base(id)}/posting-rules`],
    ["POST", (id) => `${base(id)}/ng-words`],
    ["DELETE", (id) => `${base(id)}/ng-words/${UUID}`],
    ["PUT", (id) => `${base(id)}/core-rules`],
    ["GET", (id) => `${base(id)}/auto-post`],
    ["POST", (id) => `${base(id)}/auto-post/notices/blocked/dismiss`],
  ],
  strategy: [
    ["GET", (id) => `${base(id)}/strategy`],
    ["PUT", (id) => `${base(id)}/strategy`],
    ["GET", (id) => `${base(id)}/promotion-settings`],
    ["PUT", (id) => `${base(id)}/promotion-settings`],
    ["GET", (id) => `${base(id)}/promotions`],
    ["POST", (id) => `${base(id)}/promotions`],
    ["PUT", (id) => `${base(id)}/promotions/${UUID}`],
    ["DELETE", (id) => `${base(id)}/promotions/${UUID}`],
    ["GET", (id) => `${base(id)}/reference-posts`],
    ["POST", (id) => `${base(id)}/reference-posts`],
    ["POST", (id) => `${base(id)}/reference-posts/batch`],
    ["GET", (id) => `${base(id)}/reference-posts/explain-prompt`],
    ["POST", (id) => `${base(id)}/reference-posts/explanations`],
    ["PUT", (id) => `${base(id)}/reference-posts/${UUID}`],
    ["DELETE", (id) => `${base(id)}/reference-posts/${UUID}`],
    ["GET", (id) => `${base(id)}/research-keywords`],
    ["POST", (id) => `${base(id)}/research-keywords`],
    ["GET", (id) => `${base(id)}/research-keywords/idea-prompt`],
    ["POST", (id) => `${base(id)}/research-keywords/batch`],
    ["PUT", (id) => `${base(id)}/research-keywords/${UUID}`],
    ["DELETE", (id) => `${base(id)}/research-keywords/${UUID}`],
  ],
  team: [
    ["GET", (id) => `${base(id)}/team`],
    ["GET", (id) => `${base(id)}/activity`],
  ],
};

/** どのまとまりがOFFでも通るAPI（ホームと設定）。 */
const ALWAYS: [string, (id: string) => string][] = [
  ["GET", (id) => `${base(id)}`],
  ["GET", (id) => `${base(id)}/access`],
  // ホームの準備の一覧と「次にやること」が使う（数だけで中身は返さない。research.md R3）
  ["GET", (id) => `${base(id)}/profile-status`],
];

async function errorOf(res: Response) {
  return ((await res.clone().json().catch(() => ({}))) as { error?: { code: string; details?: string[] } }).error;
}

describe.each(Object.keys(GUARDED) as Feature[])("%s がOFF", (feature) => {
  it("そのまとまりのAPIは、どれも 403 FEATURE_DISABLED", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await disableFeatures(userId, feature);
    for (const [method, path] of GUARDED[feature]) {
      const res = await call(app, method, path(accountId), { user: "o1", body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(res.status, `${method} ${path(accountId)}`).toBe(403);
      expect(await errorOf(res), `${method} ${path(accountId)}`).toMatchObject({ code: "FEATURE_DISABLED", details: [feature] });
    }
  });

  it("ホームと設定のAPIは通る", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await disableFeatures(userId, feature);
    for (const [method, path] of ALWAYS) {
      const res = await call(app, method, path(accountId), { user: "o1" });
      expect(res.status, `${method} ${path(accountId)}`).toBe(200);
    }
  });
});

it("ほかのまとまりのAPIは、OFFのまとまりに引きずられない", async () => {
  const { userId, accountId } = await createUserWithAccount("o1");
  await disableFeatures(userId, "strategy", "team");
  expect((await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "o1" })).status).toBe(200);
  expect((await call(app, "GET", `${base(accountId)}/prompt`, { user: "o1" })).status).toBe(200);
});

it("OFFにしても書いた内容は消えず、ONに戻すと前と同じ値が返る（FR-010、SC-004）", async () => {
  const { userId, accountId } = await createUserWithAccount("o1");
  const current = (await (await call(app, "GET", `${base(accountId)}/strategy`, { user: "o1" })).json()) as Record<string, unknown>;
  const { canEdit: _c, filledCount: _f, totalCount: _t, updatedAt: _u, version, ...values } = current;
  const put = await call(app, "PUT", `${base(accountId)}/strategy`, {
    user: "o1",
    body: { ...values, targetPersona: "飲食店のオーナー", expectedVersion: version },
  });
  expect(put.status).toBe(200);
  const promo = await call(app, "POST", `${base(accountId)}/promotions`, {
    user: "o1",
    body: { title: "春のセミナー", content: "セミナーの宣伝", status: "active", cta: "DMで申し込み" },
  });
  expect(promo.status).toBe(201);
  const before = await (await call(app, "GET", `${base(accountId)}/strategy`, { user: "o1" })).json();
  const promotionsBefore = await (await call(app, "GET", `${base(accountId)}/promotions`, { user: "o1" })).json();

  await disableFeatures(userId, "strategy");
  expect((await call(app, "GET", `${base(accountId)}/strategy`, { user: "o1" })).status).toBe(403);
  await enableAll(userId);

  expect(await (await call(app, "GET", `${base(accountId)}/strategy`, { user: "o1" })).json()).toEqual(before);
  expect(await (await call(app, "GET", `${base(accountId)}/promotions`, { user: "o1" })).json()).toEqual(promotionsBefore);
});
