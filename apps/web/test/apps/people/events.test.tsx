// イベントの画面（specs/people/001-people-memo tasks.md T037、contracts/ui-routes.md 1、research.md R14）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PeopleEventDetail } from "@meguru/shared/people";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1011, EVENT_1125, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  events: vi.fn(),
  createEvent: vi.fn(),
  event: vi.fn(),
  attendees: vi.fn(),
  updateEvent: vi.fn(),
  undoPreview: vi.fn(),
  undoImport: vi.fn(),
  eventDeletePreview: vi.fn(),
  deleteEvent: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { EventsPage } = await import("@/apps/people/pages/EventsPage");
const { EventNewPage } = await import("@/apps/people/pages/EventNewPage");
const { EventPage } = await import("@/apps/people/pages/EventPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [
  { path: "/people/events", element: <EventsPage /> },
  { path: "/people/events/new", element: <EventNewPage /> },
  { path: "/people/events/:eventId", element: <EventPage /> },
];

const DETAIL: PeopleEventDetail = {
  event: { id: "e1", name: "10月11日 IT交流会", heldOn: "2026-10-11", isOwn: true },
  stats: { attendeeCount: 2, erasedCount: 0 },
  imports: [{ id: "i1", createdAt: "2026-10-12T03:00:00.000Z", rowCount: 3, importedCount: 2, createdPeopleCount: 2, linkedCount: 0, skippedCount: 1 }],
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.event.mockResolvedValue(DETAIL);
  api.attendees.mockResolvedValue([
    { personId: "p1", displayName: "たろう", lineName: "たろう", via: "response" },
    { personId: "p2", displayName: "山田はなこ", lineName: "はな", via: "response" },
  ]);
});

describe("イベントの一覧", () => {
  it("開催日の新しい順に、自分の会の印と参加者数を出し、「イベントを作る」を置く", async () => {
    api.events.mockResolvedValue([EVENT_1011, EVENT_1125]);
    renderRoutes(ROUTES, "/people/events");
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("11月25日 もくもく会");
    expect(items[0]).toHaveTextContent("参加 10人");
    expect(items[0]).not.toHaveTextContent("自分の会");
    expect(items[1]).toHaveTextContent("10月11日 IT交流会");
    expect(items[1]).toHaveTextContent("自分の会");
    expect(within(items[1]!).getByRole("link")).toHaveAttribute("href", "/people/events/e1");
    expect(screen.getByRole("link", { name: /イベントを作る/ })).toHaveAttribute("href", "/people/events/new");
  });
});

describe("イベントを作る", () => {
  it("名前・開催日・自分の会か（初めはON）を入れて作ると、イベントのページへ移る", async () => {
    const user = userEvent.setup();
    api.createEvent.mockResolvedValue({ id: "e9", name: "12月6日 IT交流会", heldOn: "2026-12-06", isOwn: true });
    const router = renderRoutes(ROUTES, "/people/events/new");
    expect(screen.getByRole("checkbox", { name: /自分の会/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "作る" }));
    expect(screen.getByText("名前を入れてください")).toBeInTheDocument();
    expect(api.createEvent).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("イベントの名前"), "12月6日 IT交流会");
    const date = screen.getByLabelText("開催日");
    await user.clear(date);
    await user.type(date, "2026-12-06");
    await user.click(screen.getByRole("button", { name: "作る" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/events/e9"));
    expect(api.createEvent.mock.calls[0]![0]).toEqual({ name: "12月6日 IT交流会", heldOn: "2026-12-06", isOwn: true });
  });
});

describe("イベントのページ", () => {
  it("参加者数・来た人の名前・取り込みの一覧を出す。来た人は人のページへのリンク", async () => {
    renderRoutes(ROUTES, "/people/events/e1");
    expect(await screen.findByText("参加者 2人")).toBeInTheDocument();
    expect(await screen.findByText("たろう")).toBeInTheDocument();
    expect(screen.getByText("山田はなこ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /たろう/ })).toHaveAttribute("href", "/people/list/p1");
    expect(screen.getByRole("link", { name: /山田はなこ/ })).toHaveAttribute("href", "/people/list/p2");
    expect(screen.getByText(/3行のうち 2件を取り込み/)).toBeInTheDocument();
    // 消した人がいなければ出さない
    expect(screen.queryByText(/消した人/)).not.toBeInTheDocument();
  });

  it("消した人がいれば「消した人 n人」を出す", async () => {
    api.event.mockResolvedValue({ ...DETAIL, stats: { attendeeCount: 3, erasedCount: 1 } });
    renderRoutes(ROUTES, "/people/events/e1");
    expect(await screen.findByText("参加者 3人")).toBeInTheDocument();
    expect(screen.getByText("消した人 1人")).toBeInTheDocument();
  });

  it("「取り消す」は書き足しのある人を出し、残すか消すかを選ぶまで押せない。選ぶと取り消す", async () => {
    const user = userEvent.setup();
    api.undoPreview.mockResolvedValue({ responseCount: 2, removedPeopleCount: 2, peopleWithNotes: [{ personId: "p2", displayName: "山田はなこ", notes: ["memo"] }] });
    api.undoImport.mockResolvedValue({ removedPeopleCount: 1, keptPeopleCount: 1 });
    renderRoutes(ROUTES, "/people/events/e1");
    await user.click(await screen.findByRole("button", { name: "取り消す" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("元に戻せません。")).toBeInTheDocument();
    expect(within(dialog).getByText("回答 2件が消えます")).toBeInTheDocument();
    expect(within(dialog).getByText("山田はなこ")).toBeInTheDocument();
    expect(within(dialog).getByText(/メモ/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "取り消す" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: /残す/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.undoImport).toHaveBeenCalledWith("i1", true));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("イベントを消す：書き足しのある人がいなければ、そのまま消して一覧へ戻る", async () => {
    const user = userEvent.setup();
    api.events.mockResolvedValue([]);
    api.eventDeletePreview.mockResolvedValue({ responseCount: 2, removedPeopleCount: 2, peopleWithNotes: [], importCount: 1, outreachCount: 0 });
    api.deleteEvent.mockResolvedValue({ removedPeopleCount: 2, keptPeopleCount: 0 });
    const router = renderRoutes(ROUTES, "/people/events/e1");
    await user.click(await screen.findByRole("button", { name: /このイベントを消す/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("取り込み 1件を取り消します")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(api.deleteEvent).toHaveBeenCalledWith("e1", undefined));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/events"));
  });

  it("消す途中で書き足しのある人が増えたら（409）、確かめを読み直して選ばせる", async () => {
    const user = userEvent.setup();
    api.eventDeletePreview
      .mockResolvedValueOnce({ responseCount: 2, removedPeopleCount: 2, peopleWithNotes: [], importCount: 1, outreachCount: 0 })
      .mockResolvedValue({ responseCount: 2, removedPeopleCount: 2, peopleWithNotes: [{ personId: "p1", displayName: "たろう", notes: ["outreach"] }], importCount: 1, outreachCount: 1 });
    api.deleteEvent.mockRejectedValueOnce(new ApiError("PEOPLE_CONFIRM_REQUIRED", 409));
    renderRoutes(ROUTES, "/people/events/e1");
    await user.click(await screen.findByRole("button", { name: /このイベントを消す/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "消す" }));
    expect(await within(dialog).findByRole("radio", { name: /この人たちも消す/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "消す" })).toBeDisabled();
  });

  it("名前・開催日・自分の会かを直せる", async () => {
    const user = userEvent.setup();
    api.updateEvent.mockResolvedValue({ ...DETAIL.event, name: "10月11日 IT交流会（渋谷）" });
    renderRoutes(ROUTES, "/people/events/e1");
    await user.click(await screen.findByRole("button", { name: "イベントを直す" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("イベントの名前");
    await user.clear(name);
    await user.type(name, "10月11日 IT交流会（渋谷）");
    await user.click(within(dialog).getByRole("checkbox", { name: /自分の会/ }));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledWith("e1", { name: "10月11日 IT交流会（渋谷）", heldOn: "2026-10-11", isOwn: false }));
  });
});
