// 経費・運営メンバー・分配（specs/collect/003-revenue-sharing User Story 1・2、FR-001〜FR-016、tasks.md T016）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { asParticipant, createCollectEvent, errorOf, grantCollect, selfToken, type EventBody } from "../../helpers/collect";

type Snap = {
  revenue: { paid: number; awaiting: number; awaitingConfirmation: number };
  expenses: { id: string; name: string; amount: number; payer: { memberId: string | null; name: string } | null }[];
  expenseTotal: number;
  members: { id: string; name: string; role: string; ratioTenths: number | null; isOwner: boolean; linked: boolean; invite: unknown }[];
  maxRatioTenths: number | null;
  current: { amount: number; deficit: boolean; shares: { memberId: string; base: number; remainder: number; total: number }[]; remainderTo: string | null };
  projected: { amount: number; shares: { memberId: string; total: number }[] };
  reimbursements: { memberId: string | null; name: string; amount: number }[];
};

const app = makeApp();
let event: EventBody;
const ids: Record<string, string> = {};

const path = (rest = "") => `/api/collect/events/${event.id}${rest}`;
const snap = async (user = "o1") => (await (await call(app, "GET", path("/sharing"), { user })).json()) as Snap;
const send = async (method: string, rest: string, body?: object) => {
  const res = await call(app, method, path(rest), { user: "o1", ...(body ? { body } : {}) });
  return res;
};
const json = async (res: Response) => (await res.json()) as Snap;
const record = (name: string, method: string) =>
  call(app, "PUT", path(`/reception/${ids[name]}`), { user: "o1", body: { method, clientRequestId: crypto.randomUUID() } });
const totals = (s: Snap) => Object.fromEntries(s.current.shares.map((x) => [s.members.find((m) => m.id === x.memberId)!.name, x.total]));

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  await grantCollect(app, "o2");
  event = await createCollectEvent(app, "o1");
  for (const name of ["松本", "井上", "木村", "佐藤"]) {
    const res = await call(app, "POST", path("/roster"), { user: "o1", body: { name, media: "peatix", priceTierId: event.tiers[0]!.id } });
    ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
  }
});

describe("分配の画面", () => {
  it("はじめて開くと主催者の行（リーダー・1.2倍・つながっている）ができ、売上がなければ 0 円", async () => {
    const s = await snap();
    expect(s.members).toEqual([{ id: expect.any(String), name: "主催者", role: "leader", ratioTenths: 12, isOwner: true, linked: true, invite: null }]);
    expect(s.current).toMatchObject({ amount: 0, deficit: true });
    expect(s.maxRatioTenths).toBeNull();
    // 2回開いても1行
    expect((await snap()).members).toHaveLength(1);
  });

  it("ほかの主催者のイベントは 404。利用の許可がなければ 403", async () => {
    expect(await errorOf(await call(app, "GET", path("/sharing"), { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect((await call(app, "GET", path("/sharing"), { user: "o3" })).status).toBe(403);
  });
});

describe("経費と残る額（User Story 1）", () => {
  it("支払い済みから今の額、振込待ちを足して見込みの額。確かめ待ちはどちらにも入れない", async () => {
    await record("松本", "cash");
    await record("井上", "paypay");
    await record("木村", "transfer_later");
    const token = await selfToken(app, "o1", event.id);
    await asParticipant(app, "POST", `/api/collect/s/${token}/declare`, "66666666-6666-4666-8666-666666666666", {
      personId: ids["佐藤"],
      method: "cash",
      clientRequestId: crypto.randomUUID(),
    });
    let s = await json(await send("POST", "/expenses", { name: "会場費", amount: 2000 }));
    expect(s.revenue).toEqual({ paid: 6000, awaiting: 3000, awaitingConfirmation: 3000 });
    expect(s.expenseTotal).toBe(2000);
    expect(s.current.amount).toBe(4000);
    expect(s.projected.amount).toBe(7000);

    // 直す・消す
    const expenseId = s.expenses[0]!.id;
    s = await json(await send("PATCH", `/expenses/${expenseId}`, { amount: 2500 }));
    expect(s.current.amount).toBe(3500);
    s = await json(await send("DELETE", `/expenses/${expenseId}`));
    expect(s.expenses).toEqual([]);
    expect(s.current.amount).toBe(6000);
  });

  it("立て替えた人：運営メンバーか名前のどちらか。両方は 400。ほかのイベントの運営メンバーは 404", async () => {
    const owner = (await snap()).members[0]!;
    let s = await json(await send("POST", "/expenses", { name: "会場費", amount: 20000, payerMemberId: owner.id }));
    expect(s.expenses[0]!.payer).toEqual({ memberId: owner.id, name: "主催者" });
    s = await json(await send("POST", "/expenses", { name: "飲食", amount: 5000, payerName: "会場の人" }));
    expect(s.reimbursements).toEqual([
      { memberId: owner.id, name: "主催者", amount: 20000 },
      { memberId: null, name: "会場の人", amount: 5000 },
    ]);
    expect((await send("POST", "/expenses", { name: "x", amount: 1, payerMemberId: owner.id, payerName: "a" })).status).toBe(400);
    const other = await createCollectEvent(app, "o2");
    const otherOwner = ((await (await call(app, "GET", `/api/collect/events/${other.id}/sharing`, { user: "o2" })).json()) as Snap).members[0]!;
    expect(await errorOf(await send("POST", "/expenses", { name: "x", amount: 1, payerMemberId: otherOwner.id }))).toEqual([404, "ITEM_NOT_FOUND"]);
    // 金額の範囲
    expect((await send("POST", "/expenses", { name: "x", amount: 0 })).status).toBe(400);
    expect((await send("POST", "/expenses", { name: "x", amount: 1_000_000 })).status).toBe(400);
  });

  it("経費は1イベント100件まで", async () => {
    for (let i = 0; i < 100; i++) expect((await send("POST", "/expenses", { name: `e${i}`, amount: 1 })).status).toBe(201);
    expect(await errorOf(await send("POST", "/expenses", { name: "101", amount: 1 }))).toEqual([409, "ITEM_LIMIT_REACHED"]);
  });
});

describe("運営メンバーと分配（User Story 2）", () => {
  /** 売上を 20,000 円にする（現金 3,000×4 ＋ 経費をマイナスにはできないので、区分の額で合わせる）。 */
  async function revenue20000() {
    for (const name of ["松本", "井上", "木村", "佐藤"]) await record(name, "cash");
    // 12,000 円。経費は引かずに、もとの額を 20,000 円にするために名簿を足す
    for (const name of ["a", "b"]) {
      const res = await call(app, "POST", path("/roster"), { user: "o1", body: { name, media: "peatix", priceTierId: event.tiers[0]!.id } });
      ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
      await record(name, "cash");
    }
    const res = await call(app, "POST", path("/roster"), { user: "o1", body: { name: "c", media: "peatix", priceTierId: event.tiers[1]!.id } });
    ids["c"] = ((await res.json()) as { person: { id: string } }).person.id;
    await record("c", "cash");
    // 3,000×6 ＋ 2,500 ＝ 20,500。経費 500 円で残る額 20,000 円
    await send("POST", "/expenses", { name: "備品", amount: 500 });
  }

  it("spec の例：残る額 20,000円・4人・リーダー1人・1.2倍 → リーダー 6,002円・メンバー各 4,666円。1.5倍で 7,502円・4,166円", async () => {
    await revenue20000();
    for (const name of ["井上", "木村", "佐藤"]) await send("POST", "/members", { name, role: "member" });
    let s = await snap();
    expect(s.current.amount).toBe(20000);
    expect(totals(s)).toEqual({ 主催者: 6002, 井上: 4666, 木村: 4666, 佐藤: 4666 });
    expect(s.current.remainderTo).toBe(s.members[0]!.id);
    expect(s.maxRatioTenths).toBe(40);
    s = await json(await send("PATCH", `/members/${s.members[0]!.id}`, { ratioTenths: 15 }));
    expect(totals(s)).toEqual({ 主催者: 7502, 井上: 4166, 木村: 4166, 佐藤: 4166 });
  });

  it("傾斜の上限を超えると 400 RATIO_TOO_HIGH。メンバーを消して崩れるときも止める", async () => {
    const s = await json(await send("POST", "/members", { name: "井上", role: "member" }));
    const ownerId = s.members[0]!.id;
    const inoue = s.members[1]!.id;
    // 2人なら上限 2.0倍
    expect((await send("PATCH", `/members/${ownerId}`, { ratioTenths: 20 })).status).toBe(200);
    expect(await errorOf(await send("PATCH", `/members/${ownerId}`, { ratioTenths: 21 }))).toEqual([400, "RATIO_TOO_HIGH"]);
    await send("POST", "/members", { name: "木村", role: "member" });
    await send("PATCH", `/members/${ownerId}`, { ratioTenths: 30 });
    // 3人で 3.0倍 → 1人消すと 2人で上限 2.0倍を超える
    expect(await errorOf(await send("DELETE", `/members/${inoue}`))).toEqual([400, "RATIO_TOO_HIGH"]);
    // 範囲の外は 400
    expect((await send("PATCH", `/members/${ownerId}`, { ratioTenths: 9 })).status).toBe(400);
  });

  it("役割を変えると傾斜が変わる（メンバーは傾斜なし、リーダーは既定 1.2倍）。運営メンバーは20人まで", async () => {
    let s = await json(await send("POST", "/members", { name: "井上", role: "member" }));
    const inoue = s.members[1]!.id;
    s = await json(await send("PATCH", `/members/${inoue}`, { role: "leader" }));
    expect(s.members[1]).toMatchObject({ role: "leader", ratioTenths: 12 });
    s = await json(await send("PATCH", `/members/${inoue}`, { role: "member" }));
    expect(s.members[1]).toMatchObject({ role: "member", ratioTenths: null });
    for (let i = 3; i <= 20; i++) expect((await send("POST", "/members", { name: `m${i}`, role: "member" })).status).toBe(201);
    expect(await errorOf(await send("POST", "/members", { name: "21人め", role: "member" }))).toEqual([409, "ITEM_LIMIT_REACHED"]);
  });

  it("立て替えた運営メンバーを消すと、名前で立て替えた人として残る。主催者の行のつながりは外せない", async () => {
    let s = await json(await send("POST", "/members", { name: "井上", role: "member" }));
    const inoue = s.members[1]!.id;
    await send("POST", "/expenses", { name: "飲食", amount: 3000, payerMemberId: inoue });
    s = await json(await send("DELETE", `/members/${inoue}`));
    expect(s.expenses[0]!.payer).toEqual({ memberId: null, name: "井上" });
    expect(s.reimbursements).toEqual([{ memberId: null, name: "井上", amount: 3000 }]);
    expect(await errorOf(await send("DELETE", `/members/${s.members[0]!.id}/link`))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("赤字なら deficit と負担の目安", async () => {
    await send("POST", "/members", { name: "井上", role: "member" });
    const s = await json(await send("POST", "/expenses", { name: "会場費", amount: 10000 }));
    expect(s.current).toMatchObject({ amount: -10000, deficit: true });
    expect(s.current.shares.reduce((a, x) => a + x.total, 0)).toBe(10000);
  });
});
