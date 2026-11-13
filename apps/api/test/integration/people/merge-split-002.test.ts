// まとめる・分ける・退会と、002 の持ち物（specs/people/002-sales-list tasks.md T209、spec Edge Cases）。
import { beforeEach, describe, expect, it } from "vitest";
import { onUserWithdrawn } from "../../../src/apps/people/inbox/withdrawal";
import type { PlatformEvent } from "../../../src/platform";
import { resetDb, testEnv } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Detail = {
  person: { tags: { name: string }[]; likelihood: number | null; nextAction: unknown; birthdayMd: string | null };
  contactLogs: { note: string }[];
  fields: { label: string; value: string | null }[];
  links: Record<string, string>;
  attendances: { event: { name: string }; responses: { id: string }[] }[];
};

let taro: string;
let taro2: string;
let fieldId: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  const oct = await makeEvent("u1", "10月の会", "2026-10-11");
  const nov = await makeEvent("u1", "11月の会", "2026-11-25");
  await commitForm("u1", oct, [formRow({ line: "たろう" })]);
  await commitForm("u1", nov, [formRow({ line: "タロー", at: "2026/11/25 21:00:00" })], [{ row: 0, action: "new" }]);
  const rows = (await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[];
  taro = rows.find((r) => r.line_name === "たろう")!.id;
  taro2 = rows.find((r) => r.line_name === "タロー")!.id;
  fieldId = (await read<{ field: { id: string } }>(await callPeople("POST", "/fields", "u1", { label: "好きなもの" })))[1].field.id;
});

/**
 * 人のページを読む。
 * @param id - 人
 * @returns 人のページ
 */
async function detail(id: string): Promise<Detail> {
  return (await read<Detail>(await callPeople("GET", `/persons/${id}`, "u1")))[1];
}

describe("まとめる", () => {
  it("タグは合わせ、連絡の記録は移す。来てくれそう度・次にやること・誕生日・自由な項目・リンクは残す人にあればそれ、なければ相手", async () => {
    await callPeople("PUT", `/persons/${taro}/tags`, "u1", { newTagNames: ["常連"] });
    await callPeople("PUT", `/persons/${taro2}/tags`, "u1", { newTagNames: ["常連", "登壇"] });
    await callPeople("PATCH", `/persons/${taro}`, "u1", { likelihood: 2 });
    await callPeople("PATCH", `/persons/${taro2}`, "u1", { likelihood: 3, nextActionOn: "2099-01-01", nextActionNote: "案内", birthdayMd: "05-05" });
    await callPeople("POST", `/persons/${taro2}/contact-logs`, "u1", { contactedOn: "2026-11-26", channel: "line", note: "お礼" });
    await callPeople("PUT", `/persons/${taro2}/fields`, "u1", { values: [{ fieldId, value: "カレー" }] });
    await callPeople("PUT", `/persons/${taro}/links`, "u1", { x: "https://x.com/taro" });
    await callPeople("PUT", `/persons/${taro2}/links`, "u1", { x: "https://x.com/taro2", instagram: "https://instagram.com/taro2" });
    expect((await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2 })).status).toBe(200);
    const d = await detail(taro);
    expect(d.person.tags.map((t) => t.name).sort()).toEqual(["常連", "登壇"]);
    expect([d.person.likelihood, d.person.nextAction, d.person.birthdayMd]).toEqual([2, { on: "2099-01-01", note: "案内" }, "05-05"]);
    expect(d.contactLogs.map((l) => l.note)).toEqual(["お礼"]);
    expect(d.fields).toEqual([{ fieldId, label: "好きなもの", value: "カレー" }]);
    expect(d.links).toEqual({ x: "https://x.com/taro", instagram: "https://instagram.com/taro2" });
  });
});

describe("分ける", () => {
  it("新しい人には、タグ・次にやること・連絡の記録・自由な項目・リンクを付けない（元の人に残る）", async () => {
    await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2 });
    await callPeople("PUT", `/persons/${taro}/tags`, "u1", { newTagNames: ["常連"] });
    await callPeople("PATCH", `/persons/${taro}`, "u1", { likelihood: 3, nextActionOn: "2099-01-01", nextActionNote: "案内" });
    await callPeople("POST", `/persons/${taro}/contact-logs`, "u1", { contactedOn: "2026-11-26", channel: "line", note: "お礼" });
    const before = await detail(taro);
    const novResponse = before.attendances.find((a) => a.event.name === "11月の会")!.responses[0]!.id;
    const [, split] = await read<{ person: { id: string } }>(await callPeople("POST", `/responses/${novResponse}/split`, "u1"));
    const fresh = await detail(split.person.id);
    expect([fresh.person.tags, fresh.person.likelihood, fresh.person.nextAction, fresh.contactLogs]).toEqual([[], null, null, []]);
    const orig = await detail(taro);
    expect([orig.person.tags.map((t) => t.name), orig.contactLogs.length]).toEqual([["常連"], 1]);
  });
});

describe("退会", () => {
  it("タグ・自由な項目も消える（人に付いたものは人と一緒に消える）", async () => {
    const [user] = (await rawSql()`SELECT user_id FROM people.persons LIMIT 1`) as { user_id: string }[];
    await callPeople("PUT", `/persons/${taro}/tags`, "u1", { newTagNames: ["常連"] });
    await callPeople("POST", `/persons/${taro}/contact-logs`, "u1", { contactedOn: "2026-11-26", channel: "line", note: "お礼" });
    const event = { id: crypto.randomUUID(), type: "user.withdrawn", payload: { userId: user!.user_id }, createdAt: new Date() } as unknown as PlatformEvent<"user.withdrawn">;
    await onUserWithdrawn(event, testEnv);
    const [left] = (await rawSql()`SELECT
      (SELECT count(*) FROM people.tags)::int AS tags,
      (SELECT count(*) FROM people.person_tags)::int AS person_tags,
      (SELECT count(*) FROM people.custom_fields)::int AS fields,
      (SELECT count(*) FROM people.contact_logs)::int AS logs`) as Record<string, number>[];
    expect(left).toEqual({ tags: 0, person_tags: 0, fields: 0, logs: 0 });
  });
});
