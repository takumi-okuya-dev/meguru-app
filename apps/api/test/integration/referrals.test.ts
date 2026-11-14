// 紹介リンク（specs/017-referral-links contracts/api.md、FR-004〜FR-011、SC-002〜SC-006）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb, testEnv } from "../helpers/app";
import { makeTeam } from "../helpers/team";
import { callOn, createGroup, groupsEnv as groupsEnvForTest, join } from "../helpers/test-groups";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
});

type Referral = { url: string; referredCount: number };

/** 本人の紹介リンクを開き（作り）、紹介の文字列を返す。 */
async function codeOf(user: string): Promise<string> {
  const res = await call(app, "GET", "/api/me/referral", { user });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as Referral).url.split("/r/")[1]!;
}

/** users の紹介の列（clerk_user_id から）。紹介した人は clerk_user_id で返す。 */
async function referralRow(clerkUserId: string) {
  const [r] = (await sql()`
    SELECT r.clerk_user_id AS referred_by, u.referred_at
    FROM users u LEFT JOIN users r ON r.id = u.referred_by_user_id
    WHERE u.clerk_user_id = ${clerkUserId}`) as [{ referred_by: string | null; referred_at: string | null } | undefined];
  return r;
}

/** 紹介の見出しを付けて呼ぶ。 */
const withCode = (method: string, path: string, user: string, code: string, body?: unknown) =>
  call(app, method, path, { user, body, headers: { "X-Referral-Code": code } });

describe("紹介の記録（新しく登録した人だけ）", () => {
  it("持ち主のいる文字列を付けて、新しい人が初めて呼ぶと、紹介した人が記録される", async () => {
    const code = await codeOf("a");
    expect((await withCode("GET", "/api/me", "b", code)).status).toBe(200);
    const row = await referralRow("b");
    expect(row?.referred_by).toBe("a");
    expect(row?.referred_at).not.toBeNull();
  });

  it("すでに行がある人は、付けても記録されない・変わらない", async () => {
    const a = await codeOf("a");
    const c = await codeOf("c");
    await withCode("GET", "/api/me", "b", a);
    await withCode("GET", "/api/me", "b", c);
    expect((await referralRow("b"))?.referred_by).toBe("a");
    await call(app, "GET", "/api/me", { user: "d" });
    await withCode("GET", "/api/me", "d", a);
    expect((await referralRow("d"))?.referred_by).toBeNull();
  });

  it("持ち主が自分の文字列を付けても、記録されない", async () => {
    const code = await codeOf("a");
    await withCode("GET", "/api/me", "a", code);
    expect((await referralRow("a"))?.referred_by).toBeNull();
  });

  it("形に合わない・持ち主のいない文字列なら、紹介なしで行ができる", async () => {
    for (const [user, code] of [
      ["b", "nope"],
      ["c", `r_${"z".repeat(22)}`],
    ] as const) {
      expect((await withCode("GET", "/api/me", user, code)).status).toBe(200);
      expect((await referralRow(user))?.referred_by).toBeNull();
    }
  });

  it("紹介で登録しても、使える状態は紹介なしと同じ（特典なし）", async () => {
    const code = await codeOf("a");
    type Me = { billing: { trialEndsAt: string }; accountLimit: unknown };
    const referred = (await (await withCode("GET", "/api/me", "b", code)).json()) as Me;
    const plain = (await (await call(app, "GET", "/api/me", { user: "c" })).json()) as Me;
    // 無料体験の終わりは登録の時刻から決まるので、ミリ秒の差のほかは同じ（延びない）
    const { trialEndsAt: t1, ...r } = referred.billing;
    const { trialEndsAt: t2, ...p } = plain.billing;
    expect(r).toEqual(p);
    expect(Math.abs(Date.parse(t1) - Date.parse(t2))).toBeLessThan(60_000);
    expect(referred.accountLimit).toEqual(plain.accountLimit);
  });

  it("チームの招待から始めても、紹介の記録が残り、チームの招待はそのまま使える", async () => {
    const code = await codeOf("a");
    const { token } = await makeTeam("admin", []);
    const res = await withCode("GET", `/api/threads/invites/${token}`, "b", code);
    expect(res.status).toBe(200);
    expect((await referralRow("b"))?.referred_by).toBe("a");
  });
});

describe("GET /api/me/referral", () => {
  it("初めて開くと紹介リンクを作り、2回目も同じ。人数は紹介で登録した人の数", async () => {
    const first = (await (await call(app, "GET", "/api/me/referral", { user: "a" })).json()) as Referral;
    expect(first.url).toMatch(new RegExp(`^${testEnv.WEB_ORIGIN}/r/r_[A-Za-z0-9_-]{22}$`));
    expect(first.referredCount).toBe(0);
    const code = first.url.split("/r/")[1]!;
    await withCode("GET", "/api/me", "b", code);
    await withCode("GET", "/api/me", "c", code);
    const second = (await (await call(app, "GET", "/api/me/referral", { user: "a" })).json()) as Referral;
    expect(second).toEqual({ url: first.url, referredCount: 2 });
  });

  it("応答は url と referredCount だけ（紹介された人が誰かわかるものを返さない）", async () => {
    const code = await codeOf("a");
    await withCode("GET", "/api/me", "b", code);
    const body = (await (await call(app, "GET", "/api/me/referral", { user: "a" })).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["referredCount", "url"]);
  });

  it("ログインしていなければ 401", async () => {
    expect((await call(app, "GET", "/api/me/referral")).status).toBe(401);
  });
});

describe("退会（US2）", () => {
  const withdraw = (user: string) => call(app, "POST", "/api/me/withdraw", { user, body: { confirmEmail: `${user}@example.com` } });

  it("紹介された人が退会すると、人数から外れる", async () => {
    const code = await codeOf("a");
    await withCode("GET", "/api/me", "b", code);
    await withCode("GET", "/api/me", "c", code);
    expect((await withdraw("b")).status).toBe(204);
    const body = (await (await call(app, "GET", "/api/me/referral", { user: "a" })).json()) as Referral;
    expect(body.referredCount).toBe(1);
  });

  it("紹介した人が退会すると、紹介された人の記録から消え、そのリンクでは記録されなくなる", async () => {
    const code = await codeOf("a");
    await withCode("GET", "/api/me", "b", code);
    expect((await withdraw("a")).status).toBe(204);
    const row = await referralRow("b");
    expect(row?.referred_by).toBeNull();
    expect(row?.referred_at).not.toBeNull();
    await withCode("GET", "/api/me", "c", code);
    expect((await referralRow("c"))?.referred_by).toBeNull();
  });
});

describe("退会の途中（US2）", () => {
  const startWithdrawal = (clerk: string) => sql()`UPDATE users SET withdrawal_requested_at = now() WHERE clerk_user_id = ${clerk}`;

  it("持ち主が退会の途中なら、そのリンクで登録しても記録しない", async () => {
    const code = await codeOf("a");
    await startWithdrawal("a");
    await withCode("GET", "/api/me", "b", code);
    expect((await referralRow("b"))?.referred_by).toBeNull();
  });

  it("紹介された人が退会の途中なら、人数に数えない", async () => {
    const code = await codeOf("a");
    await withCode("GET", "/api/me", "b", code);
    await withCode("GET", "/api/me", "c", code);
    await startWithdrawal("b");
    const body = (await (await call(app, "GET", "/api/me/referral", { user: "a" })).json()) as Referral;
    expect(body.referredCount).toBe(1);
  });
});

describe("テスト用のグループがONの環境（US3）", () => {
  it("紹介の記録は残るが、紹介リンクだけではテスト版に入れない。グループの招待から入っても記録は変わらない", async () => {
    await call(app, "GET", "/api/me", { user: "a" });
    const code = await codeOf("a");
    const me = await call(app, "GET", "/api/me", { user: "b", headers: { "X-Referral-Code": code }, env: groupsEnvForTest() });
    expect(((await me.json()) as { testGroups: { admitted: boolean } }).testGroups.admitted).toBe(false);
    expect((await referralRow("b"))?.referred_by).toBe("a");
    expect((await callOn(app, "GET", "/api/me/referral", { user: "b" })).status).toBe(403);
    const { token } = await createGroup(app);
    expect((await join(app, "b", token)).status).toBe(200);
    expect((await callOn(app, "GET", "/api/me/referral", { user: "b" })).status).toBe(200);
    expect((await referralRow("b"))?.referred_by).toBe("a");
  });

  it("GET /api/referral-page は、認証なしでON/OFFを返す", async () => {
    expect(await (await callOn(app, "GET", "/api/referral-page")).json()).toEqual({ testGroups: true });
    expect(await (await call(app, "GET", "/api/referral-page")).json()).toEqual({ testGroups: false });
  });
});

describe("CORS", () => {
  it("紹介の見出しを許す", async () => {
    const res = await app.request(
      "/api/me",
      {
        method: "OPTIONS",
        headers: { Origin: testEnv.WEB_ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-referral-code" },
      },
      testEnv,
    );
    expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("x-referral-code");
  });
});
