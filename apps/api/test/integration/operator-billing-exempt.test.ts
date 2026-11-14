// テスト版では、運営者を「料金なし」として扱う（無料体験の表示を出さない）。本番（テスト用のグループOFF）では印だけ。
// billingExemptSql（test-group-service.ts）を、使える状態の判定の全部（me・権限・定期処理の条件）が使うことを確かめる。
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions, users } from "../../src/db/schema";
import { billingModeOf } from "../../src/kernel/config";
import { fullAccessSql, loadEntitlement } from "../../src/platform/billing/billing-service";
import { call, createUserWithAccount, db, makeApp, resetDb } from "../helpers/app";
import { billingEnv } from "../helpers/billing";
import { OPERATOR, groupsEnv } from "../helpers/test-groups";

const app = makeApp();
// 無料体験が終わった頃に登録した（印がなければ読むだけになる）
const LONG_AGO = new Date("2020-01-01T00:00:00Z");

const bothOn = () => groupsEnv({ BILLING_ENABLED: "true" });

beforeEach(async () => {
  await resetDb();
});

type Me = { billing: { state: string; readOnlyReason: string | null } };

describe("運営者の料金なし", () => {
  it("決済とテスト用のグループがONなら、運営者は料金なし（無料体験・読むだけにならない）", async () => {
    await createUserWithAccount(OPERATOR, { userCreatedAt: LONG_AGO });
    const me = (await (await call(app, "GET", "/api/me", { user: OPERATOR, env: bothOn() })).json()) as Me;
    expect(me.billing.state).toBe("exempt");
    expect(me.billing.readOnlyReason).toBeNull();
  });

  it("運営者でない人は、今までどおり（無料体験が終われば読むだけ）", async () => {
    await createUserWithAccount("u1", { userCreatedAt: LONG_AGO });
    const me = (await (await call(app, "GET", "/api/me", { user: "u1", env: bothOn() })).json()) as Me;
    expect(me.billing.state).not.toBe("exempt");
    expect(me.billing.readOnlyReason).not.toBeNull();
  });

  it("テスト用のグループがOFF（本番）でも、運営者は料金なし（specs/024 FR-023）。リストから外れると、ほかの人と同じ", async () => {
    await createUserWithAccount(OPERATOR, { userCreatedAt: LONG_AGO });
    const env = billingEnv({ OPERATOR_CLERK_USER_IDS: OPERATOR });
    const me = (await (await call(app, "GET", "/api/me", { user: OPERATOR, env })).json()) as Me;
    expect(me.billing.state).toBe("exempt");
    const other = (await (await call(app, "GET", "/api/me", { user: OPERATOR, env: billingEnv({ OPERATOR_CLERK_USER_IDS: "someone" }) })).json()) as Me;
    expect(other.billing.state).not.toBe("exempt");
  });

  it("アカウントの権限の判定（オーナーを別名で読む）でも、運営者のアカウントは読むだけにならない", async () => {
    const { accountId } = await createUserWithAccount(OPERATOR, { userCreatedAt: LONG_AGO });
    const res = await call(app, "GET", `/api/threads/accounts/${accountId}/access`, { user: OPERATOR, env: bothOn() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { readOnly: unknown }).readOnly).toBeNull();
    // 招待制がOFF（本番）でも読むだけにならない（specs/024 FR-023）
    const off = await call(app, "GET", `/api/threads/accounts/${accountId}/access`, { user: OPERATOR, env: billingEnv({ OPERATOR_CLERK_USER_IDS: OPERATOR }) });
    expect(((await off.json()) as { readOnly: unknown }).readOnly).toBeNull();
  });

  it("定期処理の条件（fullAccessSql）と、関数の判定（loadEntitlement）が同じ", async () => {
    const { userId } = await createUserWithAccount(OPERATOR, { userCreatedAt: LONG_AGO });
    for (const env of [bothOn(), billingEnv({ OPERATOR_CLERK_USER_IDS: OPERATOR })]) {
      const mode = billingModeOf(env);
      const cond = fullAccessSql(mode, new Date())!;
      const rows = await db()
        .select({ id: users.id })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(and(eq(users.id, userId), cond));
      const e = await loadEntitlement(db(), userId, mode);
      expect(rows.length === 1, JSON.stringify(mode)).toBe(e!.fullAccess);
    }
  });
});
