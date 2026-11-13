// 会ごとの声かけの一覧・自由な項目・SNS のリンク・書き出し（specs/people/002-sales-list tasks.md T206〜T208、FR-108〜FR-111）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

let oct: string;
let dec: string;
let ids: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  dec = await makeEvent("u1", "12月の会", "2099-12-13");
  await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2), formRow({ line: "=じろう" }, 3)]);
  ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
});

describe("会ごとの声かけの一覧", () => {
  it("進み具合ごとに人と声かけを並べる", async () => {
    const start = async (personId: string) =>
      (await read<{ outreach: { id: string } }>(await callPeople("POST", "/outreaches", "u1", { personId, purpose: "invite", eventId: dec })))[1].outreach.id;
    await start(ids["たろう"]!);
    const h = await start(ids["はなこ"]!);
    await callPeople("PATCH", `/outreaches/${h}`, "u1", { stage: "link_sent" });
    const [status, body] = await read<{ event: { id: string }; stages: Record<string, { displayName: string; outreach: { stage: string } }[]> }>(
      await callPeople("GET", `/events/${dec}/outreach-board`, "u1"),
    );
    expect(status).toBe(200);
    expect(body.event.id).toBe(dec);
    expect(Object.fromEntries(Object.entries(body.stages).map(([k, v]) => [k, v.map((r) => r.displayName)]))).toEqual({ asked: ["たろう"], link_sent: ["はなこ"], attended: [] });
  });

  it("自分の会でない会は 400、ほかの作り手の会は 404", async () => {
    const other = await makeEvent("u1", "よその会", "2099-12-20", false);
    expect((await callPeople("GET", `/events/${other}/outreach-board`, "u1")).status).toBe(400);
    await grantPeople("u2");
    expect((await callPeople("GET", `/events/${dec}/outreach-board`, "u2")).status).toBe(404);
  });
});

describe("自由な項目", () => {
  it("足す・直す・並べ替え・消す（値も消える）。値を入れて探せる。同じ名前は1つ", async () => {
    const add = async (label: string) => (await read<{ field: { id: string } }>(await callPeople("POST", "/fields", "u1", { label })))[1].field.id;
    const like = await add("好きなもの");
    const book = await add("紹介された本");
    expect((await callPeople("POST", "/fields", "u1", { label: "すきなもの" })).status).toBe(201);
    expect((await callPeople("POST", "/fields", "u1", { label: "好きなもの" })).status).toBe(409);
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/fields`, "u1", { values: [{ fieldId: like, value: "カレー" }, { fieldId: book, value: "あ".repeat(501) }] })).status).toBe(400);
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/fields`, "u1", { values: [{ fieldId: like, value: "カレー" }, { fieldId: book, value: "リーダブルコード" }] })).status).toBe(200);
    const [, found] = await read<{ persons: { displayName: string }[] }>(await callPeople("GET", `/persons?q=${encodeURIComponent("リーダブル")}`, "u1"));
    expect(found.persons.map((p) => p.displayName)).toEqual(["たろう"]);
    const [, fields] = await read<{ fields: { id: string; label: string }[] }>(await callPeople("GET", "/fields", "u1"));
    const order = [book, ...fields.fields.map((f) => f.id).filter((x) => x !== book)];
    expect((await callPeople("PUT", "/fields/order", "u1", { fieldIds: order })).status).toBe(200);
    const [, d] = await read<{ fields: { label: string; value: string | null }[] }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d.fields.slice(0, 2)).toEqual([
      { fieldId: book, label: "紹介された本", value: "リーダブルコード" },
      { fieldId: like, label: "好きなもの", value: "カレー" },
    ]);
    expect((await callPeople("PATCH", `/fields/${like}`, "u1", { label: "好物" })).status).toBe(200);
    expect((await callPeople("DELETE", `/fields/${book}`, "u1")).status).toBe(204);
    const [, d2] = await read<{ fields: { label: string; value: string | null }[] }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d2.fields.map((f) => [f.label, f.value])).toEqual([
      ["好物", "カレー"],
      ["すきなもの", null],
    ]);
    // 空の値は消す
    await callPeople("PUT", `/persons/${ids["たろう"]}/fields`, "u1", { values: [{ fieldId: like, value: " " }] });
    const [n] = (await rawSql()`SELECT count(*)::int AS n FROM people.person_field_values`) as { n: number }[];
    expect(n!.n).toBe(0);
  });

  it("ほかの作り手の項目・人は 404", async () => {
    await grantPeople("u2");
    const [, theirs] = await read<{ field: { id: string } }>(await callPeople("POST", "/fields", "u2", { label: "よその" }));
    expect((await callPeople("PUT", `/persons/${ids["たろう"]}/fields`, "u1", { values: [{ fieldId: theirs.field.id, value: "x" }] })).status).toBe(404);
    expect((await callPeople("PATCH", `/fields/${theirs.field.id}`, "u1", { label: "x" })).status).toBe(404);
  });
});

describe("SNS のリンク", () => {
  it("そのサービスの https の URL だけ残る。null で外す", async () => {
    const put = (body: unknown) => callPeople("PUT", `/persons/${ids["たろう"]}/links`, "u1", body);
    expect((await put({ instagram: "https://www.instagram.com/taro/", x: "https://x.com/taro" })).status).toBe(200);
    const [, d] = await read<{ links: Record<string, string> }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d.links).toEqual({ instagram: "https://www.instagram.com/taro/", x: "https://x.com/taro" });
    for (const bad of [{ x: "HTTPS://x.com/taro" }, { x: "http://x.com/taro" }, { x: "https://evil.example/x.com" }, { facebook: "https://user@facebook.com/a" }, { instagram: "javascript:alert(1)" }]) {
      expect((await put(bad)).status).toBe(400);
    }
    await put({ instagram: null, facebook: "https://facebook.com/taro" });
    const [, d2] = await read<{ links: Record<string, string> }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d2.links).toEqual({ x: "https://x.com/taro", facebook: "https://facebook.com/taro" });
  });
});

describe("書き出し", () => {
  it("BOM つきの CSV。絞り込みが効く。式の頭の文字は逃がす。消した人は入らない", async () => {
    const [, tag] = await read<{ tag: { id: string } }>(await callPeople("POST", "/tags", "u1", { name: "常連" }));
    await callPeople("PUT", `/persons/${ids["たろう"]}/tags`, "u1", { tagIds: [tag.tag.id] });
    await callPeople("PUT", `/persons/${ids["=じろう"]}/tags`, "u1", { tagIds: [tag.tag.id] });
    await callPeople("DELETE", `/persons/${ids["はなこ"]}`, "u1", { confirmName: "はなこ" });
    const res = await callPeople("POST", "/persons/export", "u1", { tag: [tag.tag.id] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="people-\d{8}\.csv"/);
    expect(res.headers.get("x-export-truncated")).toBe("false");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(buf.slice(3));
    const lines = text.trim().split("\r\n");
    expect(lines[0]!.split(",").slice(0, 4)).toEqual(['"名前"', '"LINE名"', '"別名"', '"タグ"']);
    expect(lines).toHaveLength(3);
    expect(text).toContain("'=じろう");
    expect(text).not.toContain("はなこ");
  });

  it("ほかの作り手の人は入らない。形の違う本文は 400", async () => {
    await grantPeople("u2");
    const res = await callPeople("POST", "/persons/export", "u2", {});
    expect((await res.text()).trim().split("\r\n")).toHaveLength(1);
    expect((await callPeople("POST", "/persons/export", "u1", { sort: "x" })).status).toBe(400);
  });
});
