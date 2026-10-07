// Accountの削除で戦略プロファイルと投稿ストック・投稿のルールも消える（specs/002 FR-026、specs/003 FR-026、specs/004 FR-036）
import { eq } from "drizzle-orm";
import { emptyStrategyValues } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  draftBatches,
  ngWords,
  postDrafts,
  promotions,
  postingSchedules,
  publishAttempts,
  referencePosts,
  researchKeywords,
  strategyDesigns,
} from "../../src/db/schema";
import { TEST_APP_SECRET } from "../env";
import { call, connectNew, db, fake, makeApp, resetDb } from "../helpers/app";
import { makeSignedRequest } from "../helpers/signed-request";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

/**
 * 課題・宣伝内容・参考投稿・キーワード・登録のまとまりを1件ずつ、下書きを3件（要確認・承認済み・却下）、
 * NGワード・投稿ルールを持つ Account を作る（004 FR-036）
 */
async function accountWithProfile() {
  await connectNew(app, "u1", "1001");
  const [a] = await db().select().from(accounts);
  const base = `/api/accounts/${a!.id}`;
  await call(app, "PUT", `${base}/strategy`, {
    user: "u1",
    body: { ...emptyStrategyValues(), finalAction: "x", expectedVersion: 0 },
  });
  await call(app, "POST", `${base}/promotions`, { user: "u1", body: { title: "t", content: "c" } });
  await call(app, "POST", `${base}/reference-posts`, { user: "u1", body: { body: "本文" } });
  await call(app, "POST", `${base}/research-keywords`, { user: "u1", body: { keyword: "AI" } });
  const reg = await call(app, "POST", `${base}/draft-batches`, {
    user: "u1",
    body: { clientRequestId: crypto.randomUUID(), text: "下書き\n@@@\n承認\n@@@\n却下" },
  });
  const [, approved, rejected] = ((await reg.json()) as { drafts: { id: string }[] }).drafts;
  await call(app, "POST", `${base}/post-drafts/review`, {
    user: "u1",
    body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: approved!.id, expectedVersion: 1 }] },
  });
  await call(app, "POST", `${base}/post-drafts/review`, {
    user: "u1",
    body: { requestId: crypto.randomUUID(), action: "reject", items: [{ id: rejected!.id, expectedVersion: 1 }], reject: { reasons: ["tone"], note: "" } },
  });
  await call(app, "POST", `${base}/ng-words`, { user: "u1", body: { words: ["絶対"] } });
  await call(app, "PUT", `${base}/core-rules`, { user: "u1", body: { text: "断定口調は使わない", expectedVersion: 1 } });
  await db().insert(postingSchedules).values({ accountId: a!.id, enabled: true, slotMinutes: [720] });
  await db().insert(publishAttempts).values({ accountId: a!.id, slotAt: new Date(), slotDate: "2026-10-06", slotMinute: 720, state: "skipped", skipReason: "no_drafts" });
  await db().update(postDrafts).set({ status: "publishing" }).where(eq(postDrafts.id, approved!.id));
  await db().insert(publishAttempts).values({ accountId: a!.id, draftId: approved!.id, slotAt: new Date(Date.now() + 60_000), slotDate: "2026-10-06", slotMinute: 721, state: "in_progress" });
  for (const t of [strategyDesigns, promotions, referencePosts, researchKeywords, draftBatches, ngWords, postingSchedules]) {
    expect(await db().select().from(t)).toHaveLength(1);
  }
  expect((await db().select().from(postDrafts)).map((d) => d.status).sort()).toEqual(["needs_review", "publishing", "rejected"]);
  expect(await db().select().from(publishAttempts)).toHaveLength(2);
  return a!;
}

async function expectProfileGone() {
  for (const t of [strategyDesigns, promotions, referencePosts, researchKeywords, draftBatches, postDrafts, ngWords, postingSchedules, publishAttempts]) {
    expect(await db().select().from(t)).toHaveLength(0);
  }
}

describe("Accountの削除と戦略プロファイル", () => {
  it("DELETE /api/accounts/:id で、課題・宣伝内容・参考投稿・キーワード・登録のまとまり・下書きの行がすべて消える", async () => {
    const a = await accountWithProfile();
    const res = await call(app, "DELETE", `/api/accounts/${a.id}`, { user: "u1", body: { confirmUsername: "takumi" } });
    expect(res.status).toBe(204);
    await expectProfileGone();
  });

  it("Metaのデータ削除要求の処理でも、同じく消える", async () => {
    await accountWithProfile();
    const res = await call(app, "POST", "/api/threads/webhooks/data-deletion", {
      body: new URLSearchParams({ signed_request: await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 }) }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(200);
    expect(await db().select().from(accounts)).toHaveLength(0);
    await expectProfileGone();
  });
});
