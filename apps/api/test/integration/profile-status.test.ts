// US4：ホームの入力状況（specs/002-strategy-profile FR-017・FR-024b、research.md R11・R14）
import { emptyStrategyValues, jstToday } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, insertSubscription, makeApp, resetDb, setAccount } from "../helpers/app";
import { billingEnv } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

type Status = {
  strategy: { filledCount: number; totalCount: number };
  promotions: { targetableCount: number; totalCount: number };
  research: { referencePostCount: number; keywordCount: number };
  access: { canEdit: boolean; inTrial: boolean; trialEndsAt: string | null; trialDaysLeft: number | null };
};

async function status(accountId: string, user = "u1", billing = false) {
  const res = await call(app, "GET", `/api/accounts/${accountId}/profile-status`, { user, env: billing ? billingEnv() : undefined });
  expect(res.status).toBe(200);
  return (await res.json()) as Status;
}

function yesterday() {
  const d = new Date(`${jstToday(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe("GET /api/accounts/:id/profile-status", () => {
  it("何も入力していなければ、すべて0件", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect(await status(accountId)).toMatchObject({
      strategy: { filledCount: 0, totalCount: 16 },
      promotions: { targetableCount: 0, totalCount: 0 },
      research: { referencePostCount: 0, keywordCount: 0 },
    });
  });

  it("入力済み項目数・宣伝の対象の件数・全件数・参考投稿とキーワードの件数が正しい", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const base = `/api/accounts/${accountId}`;
    await call(app, "PUT", `${base}/strategy`, {
      user: "u1",
      body: { ...emptyStrategyValues(), finalAction: "a", realWorries: "b", profileBioDraft: "下書き", expectedVersion: 0 },
    });
    const promo = { title: "t", content: "c" };
    await call(app, "POST", `${base}/promotions`, { user: "u1", body: promo });
    await call(app, "POST", `${base}/promotions`, { user: "u1", body: { ...promo, status: "paused" } });
    await call(app, "POST", `${base}/promotions`, { user: "u1", body: { ...promo, validUntil: yesterday() } });
    await call(app, "POST", `${base}/reference-posts`, { user: "u1", body: { body: "本文" } });
    await call(app, "POST", `${base}/research-keywords`, { user: "u1", body: { keyword: "AI" } });
    await call(app, "POST", `${base}/research-keywords`, { user: "u1", body: { keyword: "副業" } });
    expect(await status(accountId)).toMatchObject({
      strategy: { filledCount: 2, totalCount: 16 },
      promotions: { targetableCount: 1, totalCount: 3 },
      research: { referencePostCount: 1, keywordCount: 2 },
    });
  });

  it("access（決済ON）：無料体験中は inTrial・trialEndsAt・残りの日数、無料体験の後で契約がなければ canEdit: false、契約すれば true（specs/013）", async () => {
    const trial = await createUserWithAccount("u1");
    const s1 = await status(trial.accountId, "u1", true);
    expect(s1.access).toMatchObject({ canEdit: true, inTrial: true });
    expect(new Date(s1.access.trialEndsAt!).getTime()).toBeGreaterThan(Date.now());
    expect(s1.access.trialDaysLeft).toBeGreaterThanOrEqual(28);

    const after = await createUserWithAccount("u2", { userCreatedAt: AFTER_TRIAL() });
    expect((await status(after.accountId, "u2", true)).access).toMatchObject({ canEdit: false, inTrial: false, trialDaysLeft: null });

    await insertSubscription(after.userId, { status: "active" });
    expect((await status(after.accountId, "u2", true)).access).toMatchObject({ canEdit: true, inTrial: false });
  });

  it("access（決済OFF）：無料体験の表示を出さず、だれでも編集できる", async () => {
    const after = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    expect((await status(after.accountId)).access).toMatchObject({ canEdit: true, inTrial: false, trialDaysLeft: null });
  });

  it("他人のAccountは 404", async () => {
    const { accountId } = await createUserWithAccount("owner");
    await createUserWithAccount("other");
    expect((await call(app, "GET", `/api/accounts/${accountId}/profile-status`, { user: "other" })).status).toBe(404);
  });

  it("needs_reconnect のAccountでも 200 で返る（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    await status(accountId);
  });
});
