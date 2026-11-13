// GET /api/operator/app-registry（specs/meguru/029-threads-pattern1 tasks.md T069）：登録されたアプリの機能と上限の一覧。運営者だけ。
import { ACCOUNT_LIMIT_MAX, DAILY_POST_LIMIT_MAX, FEATURE_LABELS } from "@meguru/shared";
import { THREADS_FEATURES } from "../../src/apps/threads/registry";
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

  it("Threadsの3つの機能と2つの上限を、今の表示名と範囲で返す。ほかのアプリは利用の決まりだけ", async () => {
    const res = await callOp(app, "GET", "/api/operator/app-registry", { user: FEATURE_OPERATOR });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apps: { app: string }[] };
    // Threads のほかのアプリ（集金管理・人物メモなど）は、運営者が開いた人だけが使う。機能のON/OFF・上限は持たない（アプリが増えても書き直さない）
    expect(body.apps.map((a) => a.app)).toEqual(expect.arrayContaining(["collect", "people"]));
    for (const other of body.apps.filter((a) => a.app !== "threads")) {
      expect(other).toEqual({ app: other.app, access: "granted", featureSwitches: false, operatorLimits: false, features: [], limits: [] });
    }
    expect({ apps: body.apps.filter((a) => a.app === "threads") }).toEqual({
      apps: [
        {
          app: "threads",
          // 登録しないアプリはだれでも使える（specs/meguru/030-app-access FR-001・FR-007）
          access: "open",
          featureSwitches: true,
          operatorLimits: true,
          features: [
            { key: "autopost", label: FEATURE_LABELS.autopost, description: THREADS_FEATURES[0]!.description },
            { key: "strategy", label: FEATURE_LABELS.strategy },
            { key: "team", label: FEATURE_LABELS.team },
          ],
          limits: [
            { key: "accounts", label: "アカウントの数", min: 1, max: ACCOUNT_LIMIT_MAX, operatorValue: null, shortLabel: "アカウント", countsUsage: true },
            {
              key: "daily_posts",
              label: "1日の投稿数",
              min: 1,
              max: DAILY_POST_LIMIT_MAX,
              operatorValue: DAILY_POST_LIMIT_MAX,
              shortLabel: "投稿",
              note: "1アカウント",
            },
          ],
        },
      ],
    });
  });
});
