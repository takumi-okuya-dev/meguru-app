// テスト版に入れないオーナーの自動投稿・反応の取り込み（specs/016-test-groups FR-014、research.md R4、T008）
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions, users } from "../../src/db/schema";
import { runAutoPost } from "../../src/apps/threads/publish/auto-post-runner";
import { entitlementFromFacts, fullAccessSql, loadOwnerEntitlement } from "../../src/platform/billing/billing-service";
import { createUserWithAccount, db, fake, insertSubscription, makeApp, resetDb } from "../helpers/app";
import { addMin, approvedDrafts, attempts, connectedAccount, db as sqlDb, draftRow, jst, setSchedule } from "../helpers/auto-post";
import { OPERATOR, createGroup, groupsEnv, join } from "../helpers/test-groups";

const app = makeApp();
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

async function ownerIdOf(accountId: string) {
  const [r] = (await sqlDb()`SELECT user_id FROM memberships WHERE account_id = ${accountId} AND role = 'owner'`) as [{ user_id: string }];
  return r.user_id;
}

/** テスト用のグループONで定期処理を1回動かす（関所を消してから）。 */
async function runOn(now: Date) {
  const env = groupsEnv();
  await env.AUTOPOST_KV.delete("autopost:gate");
  return runAutoPost(env, now, undefined, () => now);
}

describe("自動投稿", () => {
  it("入れないオーナーのアカウントは、時刻が来ても投稿せず、承認済みのまま", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await sqlDb()`UPDATE users SET signed_up_open = false WHERE id = ${await ownerIdOf(accountId)}`;
    await runOn(addMin(NOON, 1));
    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(accountId)).toHaveLength(0);
    expect((await draftRow(id!)).status).toBe("approved");
  });

  it("グループに入れば、次の時刻から投稿する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await sqlDb()`UPDATE users SET signed_up_open = false WHERE id = ${await ownerIdOf(accountId)}`;
    const { token } = await createGroup(app);
    expect((await join(app, "u1", token)).status).toBe(200);
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("前からいたオーナー（signed_up_open）は、今までどおり投稿する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("運営者は、グループに入っていなくても投稿する", async () => {
    const { accountId } = await connectedAccount(OPERATOR, app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await sqlDb()`UPDATE users SET signed_up_open = false WHERE id = ${await ownerIdOf(accountId)}`;
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("投稿の直前の確かめ（loadOwnerEntitlement）でも、入れないオーナーは読むだけ", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const owner = await ownerIdOf(accountId);
    await sqlDb()`UPDATE users SET signed_up_open = false WHERE id = ${owner}`;
    const on = await loadOwnerEntitlement(db(), accountId, { enabled: false, testGroups: true });
    expect(on).toMatchObject({ fullAccess: false, readOnlyReason: "test_access" });
    const off = await loadOwnerEntitlement(db(), accountId, { enabled: false, testGroups: false });
    expect(off?.fullAccess).toBe(true);
  });
});

describe("SQLの条件と関数の判定が同じ（fullAccessSql と entitlementFromFacts）", () => {
  const now = new Date();
  it.each([
    [false, false, "trialing"],
    [true, false, null],
    [false, true, null],
    [true, true, "past_due"],
    [true, true, null],
  ] as const)("決済%s・入れる%s・契約%s", async (billingOn, admitted, status) => {
    const { userId } = await createUserWithAccount("p1");
    await sqlDb()`UPDATE users SET signed_up_open = ${admitted} WHERE id = ${userId}`;
    if (status) await insertSubscription(userId, { status });
    for (const mode of [
      { enabled: billingOn, testGroups: true },
      { enabled: billingOn, testGroups: false },
    ]) {
      const cond = fullAccessSql(mode, now);
      const rows = await db()
        .select({ id: users.id })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(cond ? and(eq(users.id, userId), cond) : eq(users.id, userId));
      const [facts] = await db()
        .select({ createdAt: users.createdAt, legacyTrial: users.legacyTrial, billingExempt: users.billingExempt, status: subscriptions.status, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(eq(users.id, userId));
      const expected = entitlementFromFacts(mode, { ...facts!, testAccess: admitted }, now).fullAccess;
      expect(rows.length === 1, JSON.stringify(mode)).toBe(expected);
    }
  });
});
