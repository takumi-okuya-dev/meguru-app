// 時間差のメンションの設定と守り（specs/023-delayed-mention contracts/api.md、tasks.md T005・T009）
import { neon } from "@neondatabase/serverless";
import type { MentionSettings } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { disableFeatures } from "../helpers/features";
import { draftOf } from "../helpers/mention";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);
const base = (accountId: string) => `/api/accounts/${accountId}`;

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

const addPerson = (accountId: string, username: string, label = "呼び名", always = false, user = "u1") =>
  call(app, "POST", `${base(accountId)}/mention-people`, { user, body: { username, label, always } });

beforeEach(async () => {
  await resetDb();
});

describe("守り（T005）", () => {
  it("オーナーと担当の人は読める。見せてもらっている人・関わりのない人・自動投稿OFFは読めない", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1", shared: true });
    await createUserWithAccount("x1");
    expect((await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "o1" })).status).toBe(200);
    expect((await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "e1" })).status).toBe(200);
    const viewer = await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "a1" });
    expect([viewer.status, (await errorOf(viewer)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const stranger = await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "x1" });
    expect([stranger.status, (await errorOf(stranger)).code]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    await disableFeatures(userId, "autopost");
    const off = await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "o1" });
    expect([off.status, (await errorOf(off)).code]).toEqual([403, "FEATURE_DISABLED"]);
  });

  it("担当の編集者は設定を変えられない。決済で読むだけは書けない", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1" });
    const put = await call(app, "PUT", `${base(accountId)}/mention-settings`, {
      user: "e1",
      body: { expectedVersion: null, message: "a", delayMinutes: 30 },
    });
    expect([put.status, (await errorOf(put)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const add = await addPerson(accountId, "taro", "たろう", false, "e1");
    expect([add.status, (await errorOf(add)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    await endTrial(userId);
    const billing = await call(app, "POST", `${base(accountId)}/mention-people`, {
      user: "o1",
      body: { username: "taro", label: "たろう" },
      env: { ...testEnv, BILLING_ENABLED: "true" } as typeof testEnv,
    });
    expect([billing.status, (await errorOf(billing)).code]).toEqual([403, "BILLING_REQUIRED"]);
  });
});

describe("設定（T009）", () => {
  it("初めの値・保存・衝突・NGワード・操作の記録", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1");
    const first = await json<MentionSettings>(await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "o1" }));
    expect(first).toMatchObject({ message: "", delayMinutes: 30, version: null, people: [], repliesDenied: false, canEdit: true });
    const saved = await json<MentionSettings>(
      await call(app, "PUT", `${base(accountId)}/mention-settings`, {
        user: "o1",
        body: { expectedVersion: null, message: " よければシェアお願いします ", delayMinutes: 60 },
      }),
    );
    expect(saved).toMatchObject({ message: "よければシェアお願いします", delayMinutes: 60, version: 1 });
    const stale = await call(app, "PUT", `${base(accountId)}/mention-settings`, {
      user: "o1",
      body: { expectedVersion: null, message: "a", delayMinutes: 30 },
    });
    expect([stale.status, (await errorOf(stale)).code]).toEqual([409, "STALE_UPDATE"]);
    const bad = await call(app, "PUT", `${base(accountId)}/mention-settings`, {
      user: "o1",
      body: { expectedVersion: 1, message: "a", delayMinutes: 45 },
    });
    expect(bad.status).toBe(400);
    await call(app, "POST", `${base(accountId)}/ng-words`, { user: "o1", body: { words: ["絶対"] } });
    const ng = await call(app, "PUT", `${base(accountId)}/mention-settings`, {
      user: "o1",
      body: { expectedVersion: 1, message: "絶対シェアして", delayMinutes: 30 },
    });
    expect([ng.status, (await errorOf(ng)).details]).toEqual([400, ["message"]]);
    expect((await activityRows(accountId)).map((r) => r.action)).toContain("mention_settings_updated");
  });

  it("人を足す：@と大文字をそろえる。形が違う・同じ人・自分・21人目は足せない。いつも付ける・呼び名を変える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const added = await json<MentionSettings>(await addPerson(accountId, " @Minato_Place ", "港の運営", true), 201);
    expect(added.people).toMatchObject([{ username: "minato_place", label: "港の運営", always: true, pendingCount: 0 }]);
    for (const u of ["あいう", "minato_place"]) expect((await addPerson(accountId, u)).status).toBe(400);
    const [acc] = (await sql()`SELECT username FROM threads.accounts WHERE id = ${accountId}`) as [{ username: string }];
    expect((await addPerson(accountId, acc.username)).status).toBe(400);
    for (let i = 0; i < 19; i++) await addPerson(accountId, `p${i}`);
    const over = await addPerson(accountId, "p99");
    expect([over.status, (await errorOf(over)).details]).toEqual([400, ["limit"]]);
    const id = added.people[0]!.id;
    const patched = await json<MentionSettings>(
      await call(app, "PATCH", `${base(accountId)}/mention-people/${id}`, { user: "u1", body: { always: false, label: "港" } }),
    );
    expect(patched.people[0]).toMatchObject({ always: false, label: "港" });
  });

  it("人を消す：要確認からは外れ、承認済みは要確認に戻り、投稿済みの予定は文を変えずに「やめた」になる（research.md R6）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const s = await json<MentionSettings>(await addPerson(accountId, "a"), 201);
    await addPerson(accountId, "b");
    const [review, approved, only, published] = [
      await draftOf(accountId),
      await draftOf(accountId, "approved"),
      await draftOf(accountId),
      await draftOf(accountId, "published"),
    ];
    const ins = (draftId: string, usernames: string[], text: string, sendAfter: string | null = null) =>
      sql()`INSERT INTO threads.post_mentions (draft_id, account_id, usernames, text, delay_minutes, send_after)
        VALUES (${draftId}, ${accountId}, ${usernames}, ${text}, ${sendAfter ? null : 30}, ${sendAfter})`;
    await ins(review, ["a", "b"], "シェアを\n@a @b");
    await ins(approved, ["a", "b"], "シェアを\n@a @b");
    await ins(only, ["a"], "@a");
    await ins(published, ["a", "b"], "シェアを\n@a @b", new Date().toISOString());
    const listed = await json<MentionSettings>(await call(app, "GET", `${base(accountId)}/mention-settings`, { user: "u1" }));
    expect(listed.people.find((p) => p.username === "a")!.pendingCount).toBe(4);
    await json(await call(app, "DELETE", `${base(accountId)}/mention-people/${s.people[0]!.id}`, { user: "u1" }));
    const rows = (await sql()`SELECT m.draft_id, m.usernames, m.text, m.state, d.status FROM threads.post_mentions m
      JOIN threads.post_drafts d ON d.id = m.draft_id`) as { draft_id: string; usernames: string[]; text: string; state: string; status: string }[];
    const by = new Map(rows.map((r) => [r.draft_id, r]));
    expect(by.get(review)).toMatchObject({ usernames: ["b"], text: "シェアを\n@b", state: "pending", status: "needs_review" });
    expect(by.get(approved)).toMatchObject({ usernames: ["b"], text: "シェアを\n@b", status: "needs_review" });
    expect(by.has(only)).toBe(false);
    expect(by.get(published)).toMatchObject({ usernames: ["a", "b"], text: "シェアを\n@a @b", state: "canceled" });
  });
});
