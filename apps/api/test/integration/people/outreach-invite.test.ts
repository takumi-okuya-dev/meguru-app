// 交流会への誘いの声かけ（specs/people/001-people-memo tasks.md T071、contracts/api.md 5、research.md R15・R16、FR-021・FR-022）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Outreach = { id: string; personId: string; stage: string; askedAt: string; linkSentAt: string | null; attendedAt: string | null; event: { id: string } | null };

let oct: string;
let dec: string;
let taro: string;
let jiro: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  dec = await makeEvent("u1", "12月の会", "2026-12-13");
  await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "じろう", consent: "個別の案内は希望しない" }, 2)]);
  const rows = (await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[];
  taro = rows.find((r) => r.line_name === "たろう")!.id;
  jiro = rows.find((r) => r.line_name === "じろう")!.id;
});

/**
 * 声かけを始める。
 * @param personId - 人
 * @param eventId - 誘う会
 * @returns 状態と声かけ
 */
async function start(personId = taro, eventId = dec): Promise<[number, { outreach: Outreach }]> {
  return read<{ outreach: Outreach }>(await callPeople("POST", "/outreaches", "u1", { personId, purpose: "invite", eventId }));
}

/**
 * その人の声かけ（人のページから読む）。
 * @param personId - 人
 * @returns 声かけ
 */
async function outreachesOf(personId = taro): Promise<Outreach[]> {
  const [, body] = await read<{ outreaches: Outreach[] }>(await callPeople("GET", `/persons/${personId}`, "u1"));
  return body.outreaches;
}

describe("声かけを始める", () => {
  it("新しければ 201 で asked から。同じ人・同じ誘う会なら 200 で今のものを返す", async () => {
    const [s1, b1] = await start();
    expect([s1, b1.outreach.stage, b1.outreach.event?.id, b1.outreach.linkSentAt]).toEqual([201, "asked", dec, null]);
    const [s2, b2] = await start();
    expect([s2, b2.outreach.id]).toEqual([200, b1.outreach.id]);
    expect(await outreachesOf()).toHaveLength(1);
  });

  it("同意がなければ 409 OUTREACH_NO_CONSENT。ほかの作り手の人・会は 404。仕事のつなぎの同意がない人も 409", async () => {
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("POST", "/outreaches", "u1", { personId: jiro, purpose: "invite", eventId: dec }));
    expect([status, body.error.code]).toEqual([409, "OUTREACH_NO_CONSENT"]);
    await grantPeople("u2");
    const theirs = await makeEvent("u2", "よその会", "2026-12-20");
    expect((await callPeople("POST", "/outreaches", "u1", { personId: taro, purpose: "invite", eventId: theirs })).status).toBe(404);
    expect((await callPeople("POST", "/outreaches", "u2", { personId: taro, purpose: "invite", eventId: theirs })).status).toBe(404);
    expect((await callPeople("POST", "/outreaches", "u1", { personId: taro, purpose: "work", targetName: "相談先" })).status).toBe(409);
  });

  it("誘えるのは自分の会だけ（よその会は 400）", async () => {
    const other = await makeEvent("u1", "よその会", "2026-12-20", false);
    expect((await callPeople("POST", "/outreaches", "u1", { personId: taro, purpose: "invite", eventId: other })).status).toBe(400);
  });
});

describe("進み具合", () => {
  it("link_sent・attended へ進め、1つ戻すと先の日時が空になる。ほかの目的の進み具合は 400", async () => {
    const [, { outreach }] = await start();
    const [s1, b1] = await read<{ outreach: Outreach }>(await callPeople("PATCH", `/outreaches/${outreach.id}`, "u1", { stage: "attended" }));
    expect([s1, b1.outreach.stage, b1.outreach.linkSentAt !== null, b1.outreach.attendedAt !== null]).toEqual([200, "attended", true, true]);
    const [, b2] = await read<{ outreach: Outreach }>(await callPeople("PATCH", `/outreaches/${outreach.id}`, "u1", { stage: "link_sent" }));
    expect([b2.outreach.stage, b2.outreach.linkSentAt !== null, b2.outreach.attendedAt]).toEqual(["link_sent", true, null]);
    const [, b3] = await read<{ outreach: Outreach }>(await callPeople("PATCH", `/outreaches/${outreach.id}`, "u1", { stage: "asked" }));
    expect([b3.outreach.stage, b3.outreach.linkSentAt, b3.outreach.askedAt]).toEqual(["asked", null, outreach.askedAt]);
    expect((await callPeople("PATCH", `/outreaches/${outreach.id}`, "u1", { stage: "approved" })).status).toBe(400);
  });

  it("消せる（204）。ほかの作り手の声かけは 404", async () => {
    const [, { outreach }] = await start();
    await grantPeople("u2");
    expect((await callPeople("PATCH", `/outreaches/${outreach.id}`, "u2", { stage: "link_sent" })).status).toBe(404);
    expect((await callPeople("DELETE", `/outreaches/${outreach.id}`, "u2")).status).toBe(404);
    expect((await callPeople("DELETE", `/outreaches/${outreach.id}`, "u1")).status).toBe(204);
    expect(await outreachesOf()).toEqual([]);
  });
});

describe("自動で「来た」（FR-022）", () => {
  it("誘った会の回答を取り込んで同じ人につなぐと attended になる", async () => {
    await start();
    await commitForm("u1", dec, [formRow({ line: "たろう", at: "2026/12/13 21:00:00" })], [{ row: 0, action: "link", personId: taro }]);
    expect((await outreachesOf())[0]).toMatchObject({ stage: "attended" });
  });

  it("会ったイベントを足すと attended になる", async () => {
    await start();
    await callPeople("POST", `/persons/${taro}/attendances`, "u1", { eventId: dec });
    expect((await outreachesOf())[0]).toMatchObject({ stage: "attended" });
  });

  it("会ったイベントを外すと、自動で「来た」にした声かけは「参加リンクを送った」に戻る", async () => {
    await start();
    await callPeople("POST", `/persons/${taro}/attendances`, "u1", { eventId: dec });
    expect((await callPeople("DELETE", `/persons/${taro}/attendances/${dec}`, "u1")).status).toBe(204);
    expect((await outreachesOf())[0]).toMatchObject({ stage: "link_sent", attendedAt: null });
  });

  it("まとめても、残す人の、相手と関係のない会の声かけは変えない（手で戻したものを「来た」にしない）", async () => {
    const [, mine] = await start(taro, dec);
    await callPeople("POST", `/persons/${taro}/attendances`, "u1", { eventId: dec });
    await callPeople("PATCH", `/outreaches/${mine.outreach.id}`, "u1", { stage: "link_sent" });
    const [, other] = await read<{ person: { id: string } }>(await callPeople("POST", "/persons", "u1", { lineName: "べつじん", consent: { invite: false, work: false } }));
    await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: other.person.id });
    expect((await outreachesOf())[0]).toMatchObject({ stage: "link_sent" });
  });

  it("まとめると、相手の誘った会への回答で attended になる。同じ声かけが両方にあれば、進み具合の先の方が残る", async () => {
    // 12月の会の回答が、別の人「タロー」として入った
    await commitForm("u1", dec, [formRow({ line: "タロー", at: "2026/12/13 21:00:00" })], [{ row: 0, action: "new" }]);
    const [taro2] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'タロー'`) as { id: string }[];
    const nov = await makeEvent("u1", "11月の会", "2026-11-25");
    // 11月の会への声かけ：たろうは asked、タローは link_sent
    await start(taro, nov);
    const [, other] = await start(taro2!.id, nov);
    await callPeople("PATCH", `/outreaches/${other.outreach.id}`, "u1", { stage: "link_sent" });
    // 12月の会への声かけ：たろうは asked
    await start(taro, dec);
    expect((await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2!.id })).status).toBe(200);
    const list = await outreachesOf();
    expect(list.map((o) => [o.event?.id, o.stage]).sort()).toEqual(
      [
        [dec, "attended"],
        [nov, "link_sent"],
      ].sort(),
    );
  });
});

describe("消えるとき", () => {
  it("誘う会を消すと声かけも消える。人を消すと声かけも消える", async () => {
    await start();
    const nov = await makeEvent("u1", "11月の会", "2026-11-25");
    await start(taro, nov);
    expect((await callPeople("DELETE", `/events/${dec}`, "u1", {})).status).toBe(200);
    expect((await outreachesOf()).map((o) => o.event?.id)).toEqual([nov]);
    await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "たろう" });
    const [n] = (await rawSql()`SELECT count(*)::int AS n FROM people.outreaches`) as { n: number }[];
    expect(n!.n).toBe(0);
  });

  it("声かけのある人は、取り消しの確かめで書き足しのある人に入る。イベントを消す見積もりに声かけの数が出る", async () => {
    await start(taro, dec);
    const [, preview] = await read<{ outreachCount: number }>(await callPeople("GET", `/events/${dec}/delete-preview`, "u1"));
    expect(preview.outreachCount).toBe(1);
    const [imp] = (await rawSql()`SELECT id FROM people.imports WHERE event_id = ${oct}`) as { id: string }[];
    const [, undo] = await read<{ peopleWithNotes: { displayName: string; notes: string[] }[] }>(await callPeople("GET", `/imports/${imp!.id}/undo-preview`, "u1"));
    expect(undo.peopleWithNotes).toEqual([expect.objectContaining({ displayName: "たろう", notes: ["outreach"] })]);
  });
});
