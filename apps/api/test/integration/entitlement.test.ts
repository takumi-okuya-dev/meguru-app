// アプリ向けの利用権（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 2・6、T001・T004）。
// 新しい loadAppEntitlement(s) が、今の判定（loadEntitlement・機能のOFF・effectiveLimits・運営者）と同じ結果になることを、
// 状態ごとに同じデータで比べる。まとめて読んでも1人ずつと同じこと、見つからない番号は入らないことも確かめる。
import { eq } from "drizzle-orm";
import type { BillingMode } from "../../src/kernel/config";
import { beforeEach, describe, expect, it } from "vitest";
import { registerThreads } from "../../src/apps/threads";
import { loadEntitlement } from "../../src/platform/billing/billing-service";
import { loadAppEntitlement, loadAppEntitlements } from "../../src/platform/entitlement/entitlement";
import { disabledFeaturesSql, featuresFrom } from "../../src/platform/features/feature-sql";
import { effectiveLimits, isOperator, setDefaults, setUserLimits } from "../../src/platform/operator/limit-service";
import { users } from "../../src/platform/schema";
import {
  AFTER_TRIAL,
  createUserWithAccount,
  db,
  endTrial,
  insertSubscription,
  resetDb,
  setBillingExempt,
  testEnv,
} from "../helpers/app";
import { disableFeatures, disableGroupFeatures, makeGroup } from "../helpers/features";

const OPERATOR = "op_clerk";
const env = { ...testEnv, OPERATOR_CLERK_USER_IDS: OPERATOR };
const ON: BillingMode = { enabled: true, testGroups: false, operators: [OPERATOR] };
const ON_GROUPS: BillingMode = { enabled: true, testGroups: true, operators: [OPERATOR] };
const OFF: BillingMode = { enabled: false, testGroups: false, operators: [OPERATOR] };

beforeEach(async () => {
  await resetDb();
  registerThreads();
});

/**
 * 今の判定で、その人の使える状態・機能・上限・運営者を読む。
 * @param userId - users.id
 * @param mode - 決済のモード
 * @returns 今の判定の結果
 */
async function current(userId: string, mode: BillingMode) {
  const billing = await loadEntitlement(db(), userId, mode);
  const [row] = await db()
    .select({ disabled: disabledFeaturesSql(users.id), clerk: users.clerkUserId })
    .from(users)
    .where(eq(users.id, userId));
  const limits = await effectiveLimits(db(), env, userId);
  return {
    billing,
    features: [...featuresFrom(row!.disabled)].sort(),
    limits: { accounts: limits.accountLimit, daily_posts: limits.dailyPostLimit },
    operator: isOperator(env, row!.clerk),
  };
}

/**
 * 新しい判定と今の判定が同じであることを確かめる。
 * @param userId - users.id
 * @param mode - 決済のモード
 * @returns 新しい判定の結果
 */
async function expectSame(userId: string, mode: BillingMode) {
  const now = new Date();
  const next = await loadAppEntitlement(db(), mode, userId, "threads", now);
  const before = await current(userId, mode);
  expect(next).not.toBeNull();
  expect({ ...next!.billing, trialEndsAt: undefined }).toEqual({ ...before.billing!, trialEndsAt: undefined });
  expect([...next!.features].sort()).toEqual(before.features);
  expect(next!.limits).toEqual(before.limits);
  expect(next!.operator).toBe(before.operator);
  return next!;
}

describe("今の判定と同じ結果になる（状態ごと）", () => {
  it("決済OFF：すべて使える", async () => {
    const { userId } = await createUserWithAccount("u1");
    const e = await expectSame(userId, OFF);
    expect(e.access).toBe("full");
  });

  it("契約中：すべて使える", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "active" });
    expect((await expectSame(userId, ON)).access).toBe("full");
  });

  it("支払いの失敗：読むだけ", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "past_due" });
    expect((await expectSame(userId, ON)).access).toBe("read_only");
  });

  it("024のあとに登録して契約していない：使えない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().update(users).set({ legacyTrial: false }).where(eq(users.id, userId));
    expect((await expectSame(userId, ON)).access).toBe("none");
  });

  it("024の前の無料体験の途中：すべて使える。終わったら読むだけ", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().update(users).set({ legacyTrial: true }).where(eq(users.id, userId));
    expect((await expectSame(userId, ON)).access).toBe("full");
    await endTrial(userId);
    expect((await expectSame(userId, ON)).access).toBe("read_only");
  });

  it("料金なしの印：すべて使える", async () => {
    const { userId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    await setBillingExempt(userId, true);
    const e = await expectSame(userId, ON);
    expect([e.access, e.billingExempt]).toEqual(["full", true]);
  });

  it("運営者：料金なし・アカウントの数は上限なし・1日の投稿数は最大", async () => {
    const { userId } = await createUserWithAccount(OPERATOR);
    const e = await expectSame(userId, ON);
    expect([e.access, e.operator, e.limits.accounts]).toEqual(["full", true, null]);
  });

  it("テスト用のグループがON：グループに入っていない人は読むだけ、入った人はすべて使える", async () => {
    const { userId: outsider } = await createUserWithAccount("u1");
    // 招待制がONになってから登録した人（signed_up_open = false）
    await db().update(users).set({ signedUpOpen: false }).where(eq(users.id, outsider));
    await insertSubscription(outsider, { status: "active" });
    expect((await expectSame(outsider, ON_GROUPS)).access).toBe("read_only");
    const { userId: member } = await createUserWithAccount("u2");
    await makeGroup("テスター", [member]);
    await expectSame(member, ON_GROUPS);
  });

  it("機能のOFF：人の設定とグループの設定の両方", async () => {
    const { userId } = await createUserWithAccount("u1");
    await disableFeatures(userId, "strategy");
    const groupId = await makeGroup("会社", [userId]);
    await disableGroupFeatures(groupId, "team");
    expect([...(await expectSame(userId, OFF)).features]).toEqual(["autopost"]);
  });

  it("上限：運営者が変えた既定の値と、人ごとの値（両方の表に書かれる）", async () => {
    const { userId } = await createUserWithAccount("u1");
    const { userId: other } = await createUserWithAccount("u2");
    await setDefaults(env, { id: other }, { accountLimit: 7, dailyPostLimit: 15 });
    await expectSame(userId, OFF);
    await setUserLimits(env, { id: other }, userId, { accountLimit: 2, dailyPostLimit: null });
    expect((await expectSame(userId, OFF)).limits).toEqual({ accounts: 2, daily_posts: 15 });
    await setUserLimits(env, { id: other }, userId, { accountLimit: null, dailyPostLimit: null });
    expect((await expectSame(userId, OFF)).limits).toEqual({ accounts: 7, daily_posts: 15 });
  });
});

describe("まとめて読む", () => {
  it("まとめて読んでも1人ずつと同じ。重なった番号は1つにまとめ、見つからない番号は入らない", async () => {
    const { userId: a } = await createUserWithAccount("u1");
    await insertSubscription(a, { status: "active" });
    const { userId: b } = await createUserWithAccount("u2");
    await disableFeatures(b, "autopost");
    const missing = "00000000-0000-4000-8000-000000000000";
    const now = new Date();
    const many = await loadAppEntitlements(db(), ON, [a, b, a, missing], "threads", now);
    expect([...many.keys()].sort()).toEqual([a, b].sort());
    expect(many.get(a)).toEqual(await loadAppEntitlement(db(), ON, a, "threads", now));
    expect(many.get(b)).toEqual(await loadAppEntitlement(db(), ON, b, "threads", now));
    expect(await loadAppEntitlement(db(), ON, missing, "threads", now)).toBeNull();
    expect((await loadAppEntitlements(db(), ON, [], "threads")).size).toBe(0);
  });

  it("登録していないアプリでは、機能も上限も空", async () => {
    const { userId } = await createUserWithAccount("u1");
    const e = await loadAppEntitlement(db(), OFF, userId, "people");
    expect([e!.features.size, e!.limits]).toEqual([0, {}]);
  });
});
