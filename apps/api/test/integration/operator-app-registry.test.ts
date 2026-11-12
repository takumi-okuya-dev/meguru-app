// GET /api/operator/app-registry（specs/meguru/029-threads-pattern1 tasks.md T069）：登録されたアプリの機能と上限の一覧。運営者だけ。
import { ACCOUNT_LIMIT_MAX, DAILY_POST_LIMIT_MAX, FEATURE_LABELS } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { callOp, FEATURE_OPERATOR } from "../helpers/features";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/operator/app-registry", () => {
  it("運営者でなければ403", async () => {
    await createUserWithAccount("u1");
    const res = await callOp(app, "GET", "/api/operator/app-registry", { user: "u1" });
    expect(res.status).toBe(403);
  });

  it("Threadsの3つの機能と2つの上限を、今の表示名と範囲で返す", async () => {
    const res = await callOp(app, "GET", "/api/operator/app-registry", { user: FEATURE_OPERATOR });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      apps: [
        {
          app: "threads",
          features: [
            { key: "autopost", label: FEATURE_LABELS.autopost, description: "自動投稿は、投稿をつくる・投稿ストック・パフォーマンスのまとまりです" },
            { key: "strategy", label: FEATURE_LABELS.strategy },
            { key: "team", label: FEATURE_LABELS.team },
          ],
          limits: [
            { key: "accounts", label: "アカウントの数", min: 1, max: ACCOUNT_LIMIT_MAX, operatorValue: null },
            { key: "daily_posts", label: "1日の投稿数", min: 1, max: DAILY_POST_LIMIT_MAX, operatorValue: DAILY_POST_LIMIT_MAX },
          ],
        },
      ],
    });
  });
});
