// 活動の目的・在り方の6項目（specs/014-strategy-guidance FR-050・FR-054・FR-055・FR-071、SC-006、research.md R3）。
import { PURPOSE_KEYS, emptyStrategyValues } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const path = (accountId: string) => `/api/accounts/${accountId}/strategy`;

type StrategyBody = Record<string, unknown> & { version: number; filledCount: number };

async function getStrategy(accountId: string, user = "u1") {
  const res = await call(app, "GET", path(accountId), { user });
  expect(res.status).toBe(200);
  return (await res.json()) as StrategyBody;
}

/** 目的の6キーを省いた、014の前の画面と同じ形の保存の本文。 */
function withoutPurpose(values: ReturnType<typeof emptyStrategyValues>) {
  const body: Record<string, unknown> = { ...values };
  for (const k of PURPOSE_KEYS) delete body[k];
  return body;
}

describe("活動の目的・在り方の保存", () => {
  it("6項目を保存して読み直せ、入力済み項目数（n/16）は変わらない。チームのアカウントなら操作の記録に残る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1" });
    const values = emptyStrategyValues();
    values.purposeOrigin = "上京して、休日に誰とも話さない日があった";
    values.purposeStance = "無理に誘わない";
    values.activityAxis = "ひとりで頑張る人を、ひとりにしない";
    const put = await call(app, "PUT", path(accountId), { user: "u1", body: { ...values, expectedVersion: 0 } });
    expect(put.status).toBe(200);
    const s = await getStrategy(accountId);
    expect(s.purposeOrigin).toBe("上京して、休日に誰とも話さない日があった");
    expect(s.purposeSelf).toBe("");
    expect(s.activityAxis).toBe("ひとりで頑張る人を、ひとりにしない");
    expect(s.filledCount).toBe(0);
    expect((await activityRows(accountId)).map((r) => r.action)).toContain("strategy_saved");
  });

  it("6キーを省いた保存では、今の目的の値が残る（014の前の画面。FR-054）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const values = emptyStrategyValues();
    values.purposeFuture = "上京した人が孤立しない街";
    await call(app, "PUT", path(accountId), { user: "u1", body: { ...values, expectedVersion: 0 } });
    const old = withoutPurpose({ ...emptyStrategyValues(), finalAction: "公式LINEに登録" });
    const put = await call(app, "PUT", path(accountId), { user: "u1", body: { ...old, expectedVersion: 1 } });
    expect(put.status).toBe(200);
    const s = await getStrategy(accountId);
    expect(s.finalAction).toBe("公式LINEに登録");
    expect(s.purposeFuture).toBe("上京した人が孤立しない街");
    expect(s.version).toBe(2);
  });

  it("行がまだないときに6キーを省いて保存すると、目的は空で作られる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const put = await call(app, "PUT", path(accountId), {
      user: "u1",
      body: { ...withoutPurpose(emptyStrategyValues()), expectedVersion: 0 },
    });
    expect(put.status).toBe(200);
    expect((await getStrategy(accountId)).purposeOrigin).toBe("");
  });

  it("版が違えば 409 STALE_UPDATE（ほかの項目と同じ衝突の扱い）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "PUT", path(accountId), { user: "u1", body: { ...emptyStrategyValues(), expectedVersion: 0 } });
    const res = await call(app, "PUT", path(accountId), {
      user: "u1",
      body: { ...emptyStrategyValues(), purposeSelf: "頼られる", expectedVersion: 5 },
    });
    expect(res.status).toBe(409);
  });

  it("見せてもらっている人も目的を読める（FR-055）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { admin: "a1", shared: true });
    const values = emptyStrategyValues();
    values.purposeOthers = "友達を連れてきてくれる";
    await call(app, "PUT", path(accountId), { user: "o1", body: { ...values, expectedVersion: 0 } });
    const s = await getStrategy(accountId, "a1");
    expect(s.purposeOthers).toBe("友達を連れてきてくれる");
  });

  it("読むだけ（013）のオーナーの保存は 403 BILLING_REQUIRED（FR-071）", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await endTrial(userId);
    const res = await callBilling(app, "PUT", path(accountId), {
      user: "o1",
      body: { ...emptyStrategyValues(), purposeOrigin: "書いた", expectedVersion: 0 },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BILLING_REQUIRED");
  });
});
