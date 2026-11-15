// 機能のON/OFFは、アプリの行だけを読み書きする（specs/meguru/029-threads-pattern1 tasks.md T027、PR #92 のセルフレビュー）。
// 2本目のアプリが同じ表に同じ名前の行を足しても、Threads の判定と運営の画面に混ざらない。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { db } from "../helpers/auto-post";
import { callOp, FEATURE_OPERATOR } from "../helpers/features";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await callOp(app, "GET", "/api/me", { user: FEATURE_OPERATOR });
});

describe("機能のON/OFFのアプリの範囲", () => {
  it("ほかのアプリの行は、ログインした人の features にも運営の画面にも出ない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().query(`INSERT INTO feature_disables (user_id, app, feature) VALUES ($1, 'people', 'team')`, [userId]);

    const me = (await (await call(app, "GET", "/api/threads/me", { user: "u1" })).json()) as { features: string[] };
    expect(me.features).toContain("team");

    const found = (await (await callOp(app, "GET", "/api/operator/users?email=u1@example.com", { user: FEATURE_OPERATOR })).json()) as {
      disabled: string[];
    };
    expect(found.disabled).toEqual([]);
  });

  it("運営者がONに戻しても、ほかのアプリの行は消さない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().query(`INSERT INTO feature_disables (user_id, app, feature) VALUES ($1, 'people', 'team'), ($1, 'threads', 'team')`, [userId]);
    const res = await callOp(app, "PUT", `/api/operator/feature-settings/${userId}`, {
      user: FEATURE_OPERATOR,
      body: { features: { autopost: true, strategy: true, team: true } },
    });
    expect(res.status).toBe(200);
    const rows = (await db().query(`SELECT app, feature FROM feature_disables WHERE user_id = $1 ORDER BY app`, [userId])) as { app: string; feature: string }[];
    expect(rows).toEqual([{ app: "people", feature: "team" }]);
  });
});
