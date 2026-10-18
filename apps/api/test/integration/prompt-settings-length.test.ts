// 1投稿の文字数と、短文・中文・長文の割合の保存（specs/014-strategy-guidance FR-140〜FR-142、contracts/api.md）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;
const DEFAULTS = { target: 150, shortLength: 55, mediumLength: 100, longLength: 135, shortRatio: 35, mediumRatio: 45, longRatio: 20 };
const CUSTOM = { target: 200, shortLength: 70, mediumLength: 135, longLength: 180, shortRatio: 35, mediumRatio: 45, longRatio: 20 };
type ErrorBody = { error: { code: string; details?: string[]; reason?: string }; latest?: unknown };

const put = (accountId: string, body: unknown, user = "u1") => call(app, "PUT", `${base(accountId)}/prompt-settings`, { user, body });

describe("PUT /prompt-settings の length", () => {
  it("保存すると返し、GET /prompt の settings とプロンプトの数字が変わる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await put(accountId, { postCount: 10, length: CUSTOM, expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postCount: 10, length: CUSTOM, version: 2 });
    const got = (await (await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" })).json()) as {
      prompt: string;
      settings: unknown;
    };
    expect(got.settings).toEqual({ postCount: 10, length: CUSTOM, version: 2 });
    expect(got.prompt).toContain("③ 1件は200文字以内");
    expect(got.prompt).toContain("- 長文(だいたい180文字(144〜200文字))");
  });

  it("length を省略すると、文字数・割合は変えない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await put(accountId, { postCount: 10, length: CUSTOM, expectedVersion: 1 });
    const res = await put(accountId, { postCount: 12, expectedVersion: 2 });
    expect(await res.json()).toEqual({ postCount: 12, length: CUSTOM, version: 3 });
  });

  it.each([
    ["割合の合計が100でない", { ...DEFAULTS, longRatio: 15 }, "length.longRatio", "ratio_sum"],
    ["長文が目標を超える", { ...DEFAULTS, longLength: 160 }, "length.longLength", "length_over_target"],
    ["目標が10字刻みでない", { ...DEFAULTS, target: 155 }, "length.target", undefined],
    ["割合が5%刻みでない", { ...DEFAULTS, shortRatio: 33, mediumRatio: 47 }, "length.shortRatio", undefined],
  ])("%s は 400 で、項目名と理由", async (_label, length, field, reason) => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await put(accountId, { postCount: 10, length, expectedVersion: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details).toContain(field);
    if (reason) expect(body.error.reason).toBe(reason);
  });

  it("古い版なら 409 で、latest に length", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await put(accountId, { postCount: 10, length: CUSTOM, expectedVersion: 1 });
    const res = await put(accountId, { postCount: 10, length: DEFAULTS, expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).latest).toEqual({ postCount: 10, length: CUSTOM, version: 2 });
  });

  it("担当の人は保存できない（オーナーだけ）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1", editor: "e1" });
    expect((await put(accountId, { postCount: 10, length: CUSTOM, expectedVersion: 1 }, "e1")).status).toBe(403);
  });

  it("操作の記録：文字数・割合が変われば prompt_length_saved、件数が変われば prompt_count_saved", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1" });
    await put(accountId, { postCount: 30, length: CUSTOM, expectedVersion: 1 });
    let rows = await activityRows(accountId);
    expect(rows.map((r) => r.action)).toEqual(["prompt_length_saved"]);
    expect(rows[0]!.summary).toBe("200字・35/45/20%");
    await put(accountId, { postCount: 12, length: CUSTOM, expectedVersion: 2 });
    rows = await activityRows(accountId);
    expect(rows.map((r) => r.action)).toEqual(["prompt_count_saved", "prompt_length_saved"]);
  });
});
