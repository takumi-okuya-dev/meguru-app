// Threads のイベントの候補から作る（specs/people/003-threads-event-candidates spec.md US1、FR-008、tasks.md T009）。
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PeopleThreadsCandidate } from "@meguru/shared/people";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = { events: vi.fn(), createEvent: vi.fn(), threadsCandidates: vi.fn() };
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { EventNewPage } = await import("@/apps/people/pages/EventNewPage");

const ROUTES = [
  { path: "/people/events/new", element: <EventNewPage /> },
  { path: "/people/events/:eventId", element: <p>イベントのページ</p> },
  { path: "/people/events", element: <p>イベントの一覧</p> },
];

/** 日本時間の 12月20日 19:00 に始まる会。 */
const DEC: PeopleThreadsCandidate = { promotionId: "pr-1", name: "12月の交流会", startsAt: "2099-12-20T10:00:00.000Z", usedByEventId: null };
/** 日本時間では 1月1日 0:30（UTC ではまだ 12月31日）。 */
const NEW_YEAR: PeopleThreadsCandidate = { promotionId: "pr-2", name: "新年会", startsAt: "2099-12-31T15:30:00.000Z", usedByEventId: null };
const USED: PeopleThreadsCandidate = { promotionId: "pr-3", name: "11月の交流会", startsAt: "2099-11-20T10:00:00.000Z", usedByEventId: "e1" };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.createEvent.mockResolvedValue({ id: "e9", name: "12月の交流会", heldOn: "2099-12-20", isOwn: true });
});

describe("Threadsのイベントから作る", () => {
  it("候補を選ぶと名前と開催日（日本時間の日付）が入り、元の番号を付けて作る", async () => {
    const user = userEvent.setup();
    api.threadsCandidates.mockResolvedValue([DEC, NEW_YEAR, USED]);
    const router = renderRoutes(ROUTES, "/people/events/new");
    await user.click(await screen.findByRole("button", { name: /新年会/ }));
    expect(screen.getByLabelText("イベントの名前")).toHaveValue("新年会");
    expect(screen.getByLabelText("開催日")).toHaveValue("2100-01-01");
    await user.click(screen.getByRole("button", { name: /12月の交流会/ }));
    expect(screen.getByRole("button", { name: /12月の交流会/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("イベントの名前")).toHaveValue("12月の交流会");
    expect(screen.getByLabelText("開催日")).toHaveValue("2099-12-20");
    expect(screen.getByRole("checkbox", { name: /自分の会/ })).toBeChecked();
    // 名前は直してから作れる
    await user.type(screen.getByLabelText("イベントの名前"), "（第2回）");
    await user.click(screen.getByRole("button", { name: "作る" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/events/e9"));
    expect(api.createEvent.mock.calls[0]![0]).toEqual({ name: "12月の交流会（第2回）", heldOn: "2099-12-20", isOwn: true, sourceThreadsPromotionId: "pr-1" });
  });

  it("作った候補は「作った」で選べない。選ぶのをやめると、元の番号を付けずに作る", async () => {
    const user = userEvent.setup();
    api.threadsCandidates.mockResolvedValue([DEC, USED]);
    renderRoutes(ROUTES, "/people/events/new");
    const used = await screen.findByRole("button", { name: /11月の交流会/ });
    expect(used).toBeDisabled();
    expect(used).toHaveTextContent("作った");
    await user.click(screen.getByRole("button", { name: /12月の交流会/ }));
    await user.click(screen.getByRole("button", { name: "選ぶのをやめる" }));
    expect(screen.getByLabelText("イベントの名前")).toHaveValue("");
    await user.type(screen.getByLabelText("イベントの名前"), "手で作る会");
    await user.click(screen.getByRole("button", { name: "作る" }));
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    expect(api.createEvent.mock.calls[0]![0]).not.toHaveProperty("sourceThreadsPromotionId");
  });

  it("候補がないときは、Threadsで開催日時を入れて保存すると出ることを案内する", async () => {
    api.threadsCandidates.mockResolvedValue([]);
    renderRoutes(ROUTES, "/people/events/new");
    expect(await screen.findByText(/宣伝内容に開催日時を入れて保存すると、ここに出ます/)).toBeInTheDocument();
  });

  it("候補を読めなかったときは候補の欄を出さず、手で作れる", async () => {
    api.threadsCandidates.mockRejectedValue(new Error("network"));
    renderRoutes(ROUTES, "/people/events/new");
    await waitFor(() => expect(api.threadsCandidates).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Threadsのイベントから作る" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("イベントの名前")).toBeInTheDocument();
  });
});
