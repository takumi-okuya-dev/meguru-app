// 精算の手順（specs/collect/003-revenue-sharing User Story 4、FR-030〜FR-032、research.md R10、tasks.md T036）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

type Party = {
  key: string;
  name: string;
  kind: string;
  isOwner: boolean;
  holding: number;
  target: number;
};
type Step = { fromKey: string; fromName: string; toKey: string; toName: string; amount: number };
type Settlement = {
  parties: Party[];
  helpers: {
    helperId: string;
    name: string;
    cash: number;
    memberId: string | null;
    chosen: boolean;
  }[];
  steps: Step[];
  done: (Step & { id: string; doneAt: string })[];
  mismatch: number;
};

const app = makeApp();
let event: EventBody;
let token: string;
let helper: { helperId: string; deviceSecret: string };
const people: Record<string, string> = {};
const members: Record<string, string> = {};

const path = (rest = "") => `/api/collect/events/${event.id}${rest}`;
const rid = () => crypto.randomUUID();
const settlement = async (user = "o1") =>
  (await (await call(app, "GET", path("/settlement"), { user })).json()) as Settlement;
const brief = (s: Settlement) => s.steps.map((x) => `${x.fromName}>${x.toName}:${x.amount}`);
const holdings = (s: Settlement) =>
  Object.fromEntries(s.parties.map((p) => [p.name, [p.holding, p.target]]));
const mark = (step: Pick<Step, "fromKey" | "toKey" | "amount">) =>
  call(app, "POST", path("/settlement/transfers"), { user: "o1", body: step });

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  await grantCollect(app, "o2");
  event = await createCollectEvent(app, "o1");
  for (let i = 1; i <= 8; i += 1) {
    const res = await call(app, "POST", path("/roster"), {
      user: "o1",
      body: { name: `参加者${i}`, media: "peatix", priceTierId: event.tiers[0]!.id },
    });
    people[`p${i}`] = ((await res.json()) as { person: { id: string } }).person.id;
  }
  const link = (
    (await (await call(app, "POST", path("/link"), { user: "o1" })).json()) as {
      link: { url: string };
    }
  ).link;
  token = link.url.split("/collect/r/")[1]!;
  helper = (await (
    await call(app, "POST", `/api/collect/r/${token}/join`, { body: { name: "井上" } })
  ).json()) as typeof helper;
  // 主催者：PayPay 5人（15,000）。手伝う人の井上：現金 3人（9,000）
  for (let i = 1; i <= 5; i += 1)
    await call(app, "PUT", path(`/reception/${people[`p${i}`]}`), {
      user: "o1",
      body: { method: "paypay", clientRequestId: rid() },
    });
  for (let i = 6; i <= 8; i += 1) {
    await call(app, "PUT", `/api/collect/r/${token}/reception/${people[`p${i}`]}`, {
      headers: { "X-Collect-Device": helper.deviceSecret },
      body: { method: "cash", clientRequestId: rid() },
    });
  }
  // 経費 4,000（立て替えた人なし＝主催者が払った）→ 残る額 20,000
  await call(app, "POST", path("/expenses"), {
    user: "o1",
    body: { name: "会場代", amount: 4000 },
  });
  for (const name of ["井上", "木村", "佐藤"]) {
    const s = (await (
      await call(app, "POST", path("/members"), { user: "o1", body: { name, role: "member" } })
    ).json()) as { members: { id: string; name: string; isOwner: boolean }[] };
    members[name] = s.members.find((m) => m.name === name)!.id;
    members.owner = s.members.find((m) => m.isOwner)!.id;
  }
});

describe("精算の手順（User Story 4）", () => {
  it("spec の例：主催者 PayPay 15,000（経費 4,000 を払った）・井上 現金 9,000 → 全員の受け取りが分配額と合う手順", async () => {
    const s = await settlement();
    expect(s.mismatch).toBe(0);
    expect(holdings(s)).toEqual({
      主催者: [11_000, 6_002],
      井上: [9_000, 4_666],
      木村: [0, 4_666],
      佐藤: [0, 4_666],
    });
    // 手伝う人の井上は、名前の形が同じ運営メンバーの井上とみなす
    expect(s.helpers).toEqual([
      {
        helperId: helper.helperId,
        name: "井上",
        cash: 9_000,
        memberId: members.井上,
        chosen: false,
      },
    ]);
    expect(brief(s)).toEqual(["主催者>木村:4666", "井上>佐藤:4334", "主催者>佐藤:332"]);
    expect(s.done).toEqual([]);
  });

  it("「渡した」を押すと印と時刻が付き、残りの手順を出し直す。取り消すと元に戻る", async () => {
    const first = (await settlement()).steps[0]!;
    const res = await mark(first);
    expect(res.status).toBe(201);
    const after = (await res.json()) as Settlement;
    expect(after.done).toEqual([
      {
        id: expect.any(String),
        fromKey: first.fromKey,
        fromName: "主催者",
        toKey: first.toKey,
        toName: "木村",
        amount: 4666,
        doneAt: expect.any(String),
      },
    ]);
    expect(brief(after)).toEqual(["井上>佐藤:4334", "主催者>佐藤:332"]);
    expect(holdings(after).木村).toEqual([4_666, 4_666]);

    const undo = (await (
      await call(app, "DELETE", path(`/settlement/transfers/${after.done[0]!.id}`), { user: "o1" })
    ).json()) as Settlement;
    expect(undo.done).toEqual([]);
    expect(brief(undo)).toEqual(["主催者>木村:4666", "井上>佐藤:4334", "主催者>佐藤:332"]);
  });

  it("手伝う人を「運営メンバーでない」にすると、その人の現金は主催者に全額渡す手順になる", async () => {
    const res = await call(app, "PUT", path(`/settlement/helpers/${helper.helperId}`), {
      user: "o1",
      body: { memberId: null },
    });
    const s = (await res.json()) as Settlement;
    expect(s.helpers[0]).toMatchObject({ memberId: null, chosen: true });
    expect(s.parties.find((p) => p.kind === "helper")).toMatchObject({
      key: `h:${helper.helperId}`,
      name: "井上",
      holding: 9_000,
      target: 0,
    });
    expect(brief(s)[0]).toBe("井上>主催者:9000");
    // 選び直せる
    const back = (await (
      await call(app, "PUT", path(`/settlement/helpers/${helper.helperId}`), {
        user: "o1",
        body: { memberId: members.木村 },
      })
    ).json()) as Settlement;
    expect(back.helpers[0]).toMatchObject({ memberId: members.木村, chosen: true });
    expect(holdings(back).木村).toEqual([9_000, 4_666]);
  });

  it("001 で主催者と「精算した」手伝う人の現金は、主催者が持つ", async () => {
    await call(app, "PUT", path(`/settlements/${helper.helperId}`), {
      user: "o1",
      body: { countedAmount: 9000, settled: true },
    });
    const s = await settlement();
    expect(holdings(s)).toMatchObject({ 主催者: [20_000, 6_002], 井上: [0, 4_666] });
    expect(brief(s)).toEqual(["主催者>井上:4666", "主催者>木村:4666", "主催者>佐藤:4666"]);
  });

  it("運営メンバーでない人が立て替えた経費は、その人への戻しの手順になる", async () => {
    await call(app, "POST", path("/expenses"), {
      user: "o1",
      body: { name: "飲み物", amount: 2000, payerName: "山田" },
    });
    const s = await settlement();
    expect(s.parties.find((p) => p.kind === "payer")).toMatchObject({
      key: "p:山田",
      name: "山田",
      holding: 0,
      target: 2_000,
    });
    expect(s.mismatch).toBe(0);
    expect(s.steps.filter((x) => x.toKey === "p:山田").reduce((sum, x) => sum + x.amount, 0)).toBe(
      2_000,
    );
  });

  it("渡したあとで運営メンバーを消すと、その人は受け取りすぎとして主催者に返す手順になり、その手順にも印を付けられる", async () => {
    await mark({ fromKey: `m:${members.owner}`, toKey: `m:${members.木村}`, amount: 4666 });
    await call(app, "DELETE", path(`/members/${members.木村}`), { user: "o1" });
    const s = await settlement();
    expect(s.parties.find((p) => p.key === `m:${members.木村}`)).toMatchObject({
      name: "木村",
      kind: "former",
      holding: 4_666,
      target: 0,
    });
    const back = s.steps.find((x) => x.fromKey === `m:${members.木村}`)!;
    expect(back).toMatchObject({ toKey: `m:${members.owner}`, amount: 4_666 });
    expect((await mark(back)).status).toBe(201);
  });

  it("ほかの主催者のイベント・知らない人・ほかのイベントの手伝う人は 404、同じ人どうしは 400", async () => {
    expect(await errorOf(await call(app, "GET", path("/settlement"), { user: "o2" }))).toEqual([
      404,
      "ITEM_NOT_FOUND",
    ]);
    expect(
      await errorOf(
        await mark({ fromKey: `m:${crypto.randomUUID()}`, toKey: `m:${members.owner}`, amount: 1 }),
      ),
    ).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(
      await errorOf(await mark({ fromKey: "p:だれか", toKey: `m:${members.owner}`, amount: 1 })),
    ).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(
      (await mark({ fromKey: `m:${members.owner}`, toKey: `m:${members.owner}`, amount: 1 }))
        .status,
    ).toBe(400);
    const other = await createCollectEvent(app, "o1");
    expect(
      await errorOf(
        await call(
          app,
          "PUT",
          `/api/collect/events/${other.id}/settlement/helpers/${helper.helperId}`,
          { user: "o1", body: { memberId: null } },
        ),
      ),
    ).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(
      await errorOf(
        await call(app, "PUT", path(`/settlement/helpers/${helper.helperId}`), {
          user: "o1",
          body: { memberId: crypto.randomUUID() },
        }),
      ),
    ).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(
      await errorOf(
        await call(app, "DELETE", path(`/settlement/transfers/${crypto.randomUUID()}`), {
          user: "o1",
        }),
      ),
    ).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});
