// 集金管理の名簿の画面（specs/collect/001-event-day-collection User Story 1、FR-020〜FR-027、tasks.md T023）。
// 名前＋Enterで足して欄が空になる・媒体と区分を引き継ぐ・候補を選ぶと名前とふりがなが入る・
// まとめて貼ると確かめの一覧（名前ではなさそうな行は最初から外れている・行を直せる）が出てから足す・同じ名前の知らせ。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectEvent, RosterPerson } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: vi.fn(),
  roster: vi.fn(),
  addPerson: vi.fn(),
  addPeopleBulk: vi.fn(),
  pastAttendees: vi.fn(),
  updatePerson: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/apps/collect/lib/api", () => ({
  collectApi: {
    event: mocks.event,
    roster: mocks.roster,
    addPerson: mocks.addPerson,
    addPeopleBulk: mocks.addPeopleBulk,
    pastAttendees: mocks.pastAttendees,
    updatePerson: mocks.updatePerson,
    deletePerson: vi.fn(),
    referrers: () => Promise.resolve({ names: ["井上"] }),
  },
}));
vi.mock("sonner", () => ({ toast: { info: mocks.toastInfo, error: mocks.toastError, success: vi.fn() } }));

const { RosterPage } = await import("@/apps/collect/pages/RosterPage");

const EVENT: CollectEvent = {
  id: "e1",
  name: "IT交流会",
  startsAt: "2026-11-20T10:00:00.000Z",
  endsAt: null,
  venue: "渋谷",
  capacity: null,
  methods: ["cash", "paypay", "transfer"],
  tiers: [
    { id: "t1", name: "通常", amount: 3000, position: 0 },
    { id: "t2", name: "早割", amount: 2500, position: 1 },
  ],
  checkInMode: "roster",
  closedAt: null,
  sourceThreadsPromotionId: null,
  sourceChangedAt: null,
  sourceDeletedAt: null,
  version: 0,
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z",
};

const person = (over: Partial<RosterPerson>): RosterPerson => ({
  id: "p1",
  number: 1,
  name: "松本 れい",
  kana: null,
  media: "peatix",
  priceTierId: "t1",
  memo: null,
  referrer: null,
  tierUndecided: false,
  selfEntered: false,
  createdAt: "2026-11-13T00:00:00.000Z",
  ...over,
});

/**
 * 名簿の画面を描く。
 */
function renderRoster() {
  const router = createMemoryRouter([{ path: "/collect/events/:eventId/roster", element: <RosterPage /> }], { initialEntries: ["/collect/events/e1/roster"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.event.mockResolvedValue(EVENT);
  mocks.roster.mockResolvedValue({ people: [], version: 0 });
  mocks.pastAttendees.mockResolvedValue({ candidates: [] });
  mocks.addPerson.mockResolvedValue({ person: person({}), sameNameAs: null, version: 1 });
});

describe("続けて入れる", () => {
  it("名前＋Enterで足して欄が空になる。媒体と区分は前の人の値を引き継ぐ", async () => {
    const user = userEvent.setup();
    renderRoster();
    const name = await screen.findByRole("textbox", { name: "名前" });
    await user.type(name, "松本 れい{Enter}");
    await waitFor(() => expect(mocks.addPerson).toHaveBeenCalledWith("e1", { name: "松本 れい", kana: null, media: "peatix", priceTierId: "t1" }));
    await waitFor(() => expect(name).toHaveValue(""));

    await user.click(within(screen.getByRole("radiogroup", { name: "媒体" })).getByRole("radio", { name: "こくちーずプロ" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "料金の区分" })).getByRole("radio", { name: /早割/ }));
    await user.type(name, "井上 そら{Enter}");
    await waitFor(() => expect(mocks.addPerson).toHaveBeenLastCalledWith("e1", { name: "井上 そら", kana: null, media: "kokuchpro", priceTierId: "t2" }));
    await waitFor(() => expect(name).toHaveValue(""));
    await user.type(name, "木村{Enter}");
    await waitFor(() => expect(mocks.addPerson).toHaveBeenLastCalledWith("e1", { name: "木村", kana: null, media: "kokuchpro", priceTierId: "t2" }));
  });

  it("返事を待つ間に打ち始めた次の名前は消さない", async () => {
    let resolve: (v: unknown) => void = () => {};
    mocks.addPerson.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderRoster();
    const name = await screen.findByRole("textbox", { name: "名前" });
    await user.type(name, "松本 れい{Enter}");
    await user.clear(name);
    await user.type(name, "井上");
    resolve({ person: person({}), sameNameAs: null, version: 1 });
    await waitFor(() => expect(mocks.addPerson).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(name).toHaveValue("井上");
  });

  it("同じ名前の人がいれば知らせる", async () => {
    mocks.addPerson.mockResolvedValue({ person: person({ number: 2 }), sameNameAs: { number: 1, media: "kokuchpro" }, version: 2 });
    const user = userEvent.setup();
    renderRoster();
    await user.type(await screen.findByRole("textbox", { name: "名前" }), "松本 れい{Enter}");
    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(expect.stringContaining("No.1・こくちーずプロ")));
  });

  it("候補を選ぶと、名前とふりがなが入る", async () => {
    mocks.pastAttendees.mockResolvedValue({
      candidates: [{ name: "松本 れい", kana: "まつもと れい", lastEventName: "10月の会", lastEventStartsAt: "2026-10-10T10:00:00.000Z" }],
    });
    const user = userEvent.setup();
    renderRoster();
    await user.type(await screen.findByRole("textbox", { name: "名前" }), "まつ");
    const option = await screen.findByRole("button", { name: /松本 れい.*10月の会/ });
    await waitFor(() => expect(mocks.pastAttendees).toHaveBeenCalledWith("e1", "まつ"));
    await user.click(option);
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("松本 れい");
    expect(screen.getByRole("textbox", { name: "ふりがな" })).toHaveValue("まつもと れい");
    expect(screen.queryByRole("list", { name: "前回の参加者" })).toBeNull();
  });
});

describe("まとめて貼る", () => {
  it("確かめの一覧（名前ではなさそうな行は最初から外れている・行を直せる）が出てから足す", async () => {
    mocks.addPeopleBulk.mockResolvedValue({ people: [person({}), person({ id: "p2", number: 2 })], version: 1 });
    const user = userEvent.setup();
    renderRoster();
    await user.click(await screen.findByRole("button", { name: /まとめて貼る|貼る/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("textbox", { name: "貼る文" }));
    await user.paste("申込日 11/20\n1. 松本 れい 様 matsumoto@example.com\n\n2. 井上 そら 様 090-1234-5678\n3. 木村 ゆうき さん");
    await user.click(within(dialog).getByRole("button", { name: "確かめる" }));

    expect(within(dialog).getByText("3人を足します")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /申込日/ })).not.toBeChecked();
    // 行を外す・直す
    await user.click(within(dialog).getByRole("checkbox", { name: "木村 ゆうきを足す" }));
    const second = within(dialog).getByRole("textbox", { name: "4行目の名前" });
    await user.clear(second);
    await user.type(second, "井上 空");
    await user.click(within(dialog).getByRole("button", { name: "2人を足す" }));
    await waitFor(() => expect(mocks.addPeopleBulk).toHaveBeenCalledWith("e1", { names: ["松本 れい", "井上 空"], media: "peatix", priceTierId: "t1", referrer: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("名簿の表", () => {
  it("名簿なしのイベントでは、参加者が入れると増えることを知らせ、区分が未定の人に「区分を確かめる」（specs/collect/004、tasks.md T033）", async () => {
    mocks.event.mockResolvedValue({ ...EVENT, checkInMode: "rosterless" });
    mocks.roster.mockResolvedValue({ people: [person({ tierUndecided: true, selfEntered: true, priceTierId: "t2" })], version: 1 });
    renderRoster();
    expect(await screen.findByText(/名簿なしの受付です/)).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "区分を確かめる" })).toBeInTheDocument();
  });

  it("受付番号・名前・媒体・区分を出す", async () => {
    mocks.roster.mockResolvedValue({ people: [person({ kana: "まつもと れい", memo: "紹介：井上" }), person({ id: "p3", number: 3, name: "井上 そら", media: "minato", priceTierId: "t2" })], version: 3 });
    renderRoster();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[2]!).getByText("井上 そら")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("港")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("早割")).toBeInTheDocument();
    expect(screen.getByText("名簿 2人")).toBeInTheDocument();
  });

  it("紹介した人を行に出し、直すダイアログで直せる（候補が出る）", async () => {
    mocks.roster.mockResolvedValue({ people: [person({ referrer: "井上", memo: "初参加" })], version: 3 });
    mocks.updatePerson.mockResolvedValue({ person: person({ referrer: "木村" }), version: 4 });
    renderRoster();
    expect(await screen.findByText("紹介：井上・初参加")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "No.1 松本 れいを直す" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("紹介した人");
    expect(input).toHaveValue("井上");
    await userEvent.clear(input);
    await userEvent.type(input, "木村");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mocks.updatePerson).toHaveBeenCalledWith("e1", "p1", expect.objectContaining({ referrer: "木村", memo: "初参加" })));
  });
});
