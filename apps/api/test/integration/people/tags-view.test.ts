// タグ・来てくれそう度・並べ方（specs/people/002-sales-list tasks.md T202・T205、FR-101〜FR-103・FR-107）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Item = { id: string; displayName: string; tags: { id: string; name: string }[]; likelihood: number | null; firstMetOn: string | null };
type List = { persons: Item[]; total: number };

let ids: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  const oct = await makeEvent("u1", "10月の会", "2026-10-11");
  const nov = await makeEvent("u1", "11月の会", "2026-11-25");
  await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ", consent: "個別の案内は希望しない" }, 2)]);
  await commitForm("u1", nov, [formRow({ line: "あきら", at: "2026/11/25 21:00:00" }, 1)]);
  ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
});

/**
 * 人の一覧の表示名。
 * @param query - クエリ
 * @param path - 道筋
 * @returns 表示名
 */
async function names(query = "", path = "/persons"): Promise<string[]> {
  const [status, body] = await read<List>(await callPeople("GET", `${path}?${query}`, "u1"));
  expect(status).toBe(200);
  return body.persons.map((p) => p.displayName);
}

describe("タグ", () => {
  it("作る・直す・消す。同じ名前（ひらがなとカタカナを区別しない）は1つ。一覧に人数", async () => {
    const [s1, b1] = await read<{ tag: { id: string; name: string } }>(await callPeople("POST", "/tags", "u1", { name: "じょうれん" }));
    expect([s1, b1.tag.name]).toEqual([201, "じょうれん"]);
    expect((await callPeople("POST", "/tags", "u1", { name: "ジョウレン" })).status).toBe(409);
    expect((await callPeople("POST", "/tags", "u1", { name: "あ".repeat(31) })).status).toBe(400);
    expect((await callPeople("POST", "/tags", "u1", { name: "​" })).status).toBe(400);
    await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { tagIds: [b1.tag.id] });
    expect(await read(await callPeople("GET", "/tags", "u1"))).toEqual([200, { tags: [{ id: b1.tag.id, name: "じょうれん", personCount: 1 }] }]);
    expect((await callPeople("PATCH", `/tags/${b1.tag.id}`, "u1", { name: "常連" })).status).toBe(200);
    const [, d] = await read<{ person: { tags: { name: string }[] } }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d.person.tags.map((t) => t.name)).toEqual(["常連"]);
    expect((await callPeople("DELETE", `/tags/${b1.tag.id}`, "u1")).status).toBe(204);
    const [, d2] = await read<{ person: { tags: unknown[] } }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d2.person.tags).toEqual([]);
  });

  it("人のタグを置き換える。新しい名前は作って付ける（同じ名前があればそれを使う）。20まで。ほかの作り手のタグ・人は404", async () => {
    const [, a] = await read<{ tag: { id: string } }>(await callPeople("POST", "/tags", "u1", { name: "常連" }));
    const [status, body] = await read<{ tags: { name: string }[] }>(
      await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { tagIds: [a.tag.id], newTagNames: ["登壇", "じょうれん", "常連"] }),
    );
    expect(status).toBe(200);
    expect(body.tags.map((t) => t.name).sort()).toEqual(["じょうれん", "常連", "登壇"].sort());
    const [, tags] = await read<{ tags: unknown[] }>(await callPeople("GET", "/tags", "u1"));
    expect(tags.tags).toHaveLength(3);
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { newTagNames: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    await grantPeople("u2");
    const [, theirs] = await read<{ tag: { id: string } }>(await callPeople("POST", "/tags", "u2", { name: "よその" }));
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { tagIds: [theirs.tag.id] })).status).toBe(404);
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u2", { tagIds: [theirs.tag.id] })).status).toBe(404);
    expect((await callPeople("PATCH", `/tags/${a.tag.id}`, "u2", { name: "x" })).status).toBe(404);
  });

  it("一覧と誘う候補をタグで絞る（どれかを持つ）。候補では同意の絞り込みはそのまま", async () => {
    const [, a] = await read<{ tag: { id: string } }>(await callPeople("POST", "/tags", "u1", { name: "常連" }));
    const [, b] = await read<{ tag: { id: string } }>(await callPeople("POST", "/tags", "u1", { name: "登壇" }));
    await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { tagIds: [a.tag.id] });
    await callPeople("PUT", `/persons/${ids["はなこ"]}/tags`, "u1", { tagIds: [a.tag.id] });
    await callPeople("PUT", `/persons/${ids["あきら"]}/tags`, "u1", { tagIds: [b.tag.id] });
    expect((await names(`tag=${a.tag.id}`)).sort()).toEqual(["たろう", "はなこ"]);
    expect((await names(`tag=${a.tag.id}&tag=${b.tag.id}`)).length).toBe(3);
    expect(await names(`purpose=invite&tag=${a.tag.id}`, "/candidates")).toEqual(["たろう"]);
  });
});

describe("来てくれそう度と並べ方", () => {
  it("来てくれそう度を付けて絞る・候補を来てくれそう度の順に並べる", async () => {
    await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { likelihood: 1 });
    await callPeople("PATCH", `/persons/${ids["あきら"]}`, "u1", { likelihood: 3 });
    expect((await callPeople("PATCH", `/persons/${ids["あきら"]}`, "u1", { likelihood: 4 })).status).toBe(400);
    expect(await names("likelihood=3")).toEqual(["あきら"]);
    expect((await names("likelihood=3&likelihood=1")).sort()).toEqual(["あきら", "たろう"]);
    expect(await names("purpose=invite&sort=likelihood", "/candidates")).toEqual(["あきら", "たろう"]);
  });

  it("並べ方：最後に会った順・初めて会った順・更新順・あいうえお順。行に初めて会った日", async () => {
    await callPeople("PATCH", `/persons/${ids["はなこ"]}`, "u1", { memoTalk: "直した" });
    expect(await names("sort=last_met")).toEqual(["あきら", "たろう", "はなこ"]);
    expect(await names("sort=first_met")).toEqual(["たろう", "はなこ", "あきら"]);
    expect((await names("sort=updated"))[0]).toBe("はなこ");
    expect(await names("sort=kana")).toEqual(["あきら", "たろう", "はなこ"]);
    const [, list] = await read<List>(await callPeople("GET", "/persons?sort=kana", "u1"));
    expect(list.persons.map((p) => p.firstMetOn)).toEqual(["2026-11-25", "2026-10-11", "2026-10-11"]);
    expect((await callPeople("GET", "/persons?sort=nope", "u1")).status).toBe(400);
  });

  it("並べ方とまとめた表示を覚える（初めは最後に会った順・まとめない）", async () => {
    const [, first] = await read<{ personView: unknown }>(await callPeople("GET", "/settings", "u1"));
    expect(first.personView).toEqual({ sort: "last_met", group: "none" });
    expect((await callPeople("PUT", "/settings", "u1", { personView: { sort: "kana", group: "tag" } })).status).toBe(200);
    const [, after] = await read<{ personView: unknown }>(await callPeople("GET", "/settings", "u1"));
    expect(after.personView).toEqual({ sort: "kana", group: "tag" });
    expect((await callPeople("PUT", "/settings", "u1", { personView: { sort: "kana", group: "x" } })).status).toBe(400);
  });
});
