// 仕事の相談先へのつなぎの声かけ（specs/people/001-people-memo tasks.md T087、contracts/api.md 5、research.md R16、FR-023）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Outreach = { id: string; purpose: string; targetName: string | null; event: unknown; stage: string; approvedAt: string | null; connectedAt: string | null };

let hanako: string;
let taro: string;
let jiro: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  const oct = await makeEvent("u1", "10月の会", "2026-10-11");
  await commitForm("u1", oct, [
    formRow({ line: "はなこ", consent: "転職・求人情報" }, 1),
    formRow({ line: "たろう", consent: "交流会・勉強会の案内" }, 2),
    formRow({ line: "じろう", consent: "転職・求人情報, 個別の案内は希望しない" }, 3),
  ]);
  const ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
  hanako = ids["はなこ"]!;
  taro = ids["たろう"]!;
  jiro = ids["じろう"]!;
});

/**
 * 仕事のつなぎの声かけを始める。
 * @param personId - 人
 * @param targetName - 相談先
 * @returns 状態と本文
 */
async function start(personId: string, targetName: string): Promise<[number, { outreach: Outreach; error?: { code: string } }]> {
  return read(await callPeople("POST", "/outreaches", "u1", { personId, purpose: "work", targetName }));
}

/**
 * 進み具合を変える。
 * @param id - 声かけ
 * @param stage - 進み具合
 * @returns 状態と本文
 */
async function move(id: string, stage: string): Promise<[number, { outreach: Outreach; error?: { code: string } }]> {
  return read(await callPeople("PATCH", `/outreaches/${id}`, "u1", { stage }));
}

describe("仕事のつなぎの候補", () => {
  it("仕事のつなぎの同意が真の人だけ（「希望しない」の人・誘いだけの同意の人は出ない）", async () => {
    const [, body] = await read<{ persons: { displayName: string }[] }>(await callPeople("GET", "/candidates?purpose=work", "u1"));
    expect(body.persons.map((p) => p.displayName)).toEqual(["はなこ"]);
  });

  it("候補の行の outreach は、その人の最新の仕事のつなぎの声かけ", async () => {
    await start(hanako, "相談先A");
    await new Promise((r) => setTimeout(r, 5));
    const [, b] = await start(hanako, "相談先B");
    const [, body] = await read<{ persons: { outreach: Outreach | null }[] }>(await callPeople("GET", "/candidates?purpose=work", "u1"));
    expect(body.persons[0]!.outreach).toMatchObject({ id: b.outreach.id, targetName: "相談先B", stage: "asked" });
  });
});

describe("声かけを始める", () => {
  it("asked から始まる。同じ人で同じ相談先（ひらがなとカタカナ・全角と半角を区別しない）なら 200 で今のもの", async () => {
    const [s1, b1] = await start(hanako, "ミナト");
    expect([s1, b1.outreach.purpose, b1.outreach.targetName, b1.outreach.event, b1.outreach.stage]).toEqual([201, "work", "ミナト", null, "asked"]);
    const [s2, b2] = await start(hanako, " みなと ");
    expect([s2, b2.outreach.id, (b2 as { created?: boolean }).created, (b1 as { created?: boolean }).created]).toEqual([200, b1.outreach.id, false, true]);
  });

  it("同意がなければ 409 OUTREACH_NO_CONSENT。相談先が空・101文字は 400", async () => {
    expect((await start(taro, "相談先"))[1].error?.code).toBe("OUTREACH_NO_CONSENT");
    expect((await start(jiro, "相談先"))[1].error?.code).toBe("OUTREACH_NO_CONSENT");
    expect((await start(hanako, ""))[0]).toBe(400);
    expect((await start(hanako, "\u200b"))[0]).toBe(400);
    expect((await start(hanako, "あ".repeat(101)))[0]).toBe(400);
    expect((await start(hanako, "🌸".repeat(100)))[0]).toBe(201);
  });
});

describe("進み具合（FR-023）", () => {
  it("OKをもらう前に「つないだ」にすると 409 OUTREACH_NEEDS_APPROVAL。表の check でも止まる", async () => {
    const [, { outreach }] = await start(hanako, "相談先");
    const [status, body] = await move(outreach.id, "connected");
    expect([status, body.error?.code]).toEqual([409, "OUTREACH_NEEDS_APPROVAL"]);
    await expect(rawSql()`UPDATE people.outreaches SET stage = 'connected' WHERE id = ${outreach.id}`).rejects.toThrow();
  });

  it("approved → connected で日時が残る。戻すと先の日時が空になる。誘いの進み具合は 400", async () => {
    const [, { outreach }] = await start(hanako, "相談先");
    const [, a] = await move(outreach.id, "approved");
    expect([a.outreach.stage, a.outreach.approvedAt !== null, a.outreach.connectedAt]).toEqual(["approved", true, null]);
    const [, c] = await move(outreach.id, "connected");
    expect([c.outreach.stage, c.outreach.approvedAt, c.outreach.connectedAt !== null]).toEqual(["connected", a.outreach.approvedAt, true]);
    const [, back] = await move(outreach.id, "asked");
    expect([back.outreach.stage, back.outreach.approvedAt, back.outreach.connectedAt]).toEqual(["asked", null, null]);
    expect((await move(outreach.id, "link_sent"))[0]).toBe(400);
  });

  it("人のページの outreaches に、相談先と日時が出る", async () => {
    const [, { outreach }] = await start(hanako, "相談先");
    await move(outreach.id, "approved");
    const [, detail] = await read<{ outreaches: Outreach[] }>(await callPeople("GET", `/persons/${hanako}`, "u1"));
    expect(detail.outreaches).toEqual([expect.objectContaining({ purpose: "work", targetName: "相談先", stage: "approved" })]);
  });
});
