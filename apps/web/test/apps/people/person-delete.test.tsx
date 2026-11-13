// この人を消す（specs/people/001-people-memo tasks.md T066、contracts/ui-routes.md 4、research.md R13、US7 AS1）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDetail, makeListItem, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  persons: vi.fn(),
  facets: vi.fn(),
  events: vi.fn(),
  person: vi.fn(),
  deletePerson: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PeopleListPage } = await import("@/apps/people/pages/PeopleListPage");
const { PersonPage } = await import("@/apps/people/pages/PersonPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [
  { path: "/people/list", element: <PeopleListPage /> },
  { path: "/people/list/:personId", element: <PersonPage /> },
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.person.mockResolvedValue(makeDetail());
  api.persons.mockResolvedValue({ persons: [makeListItem({ id: "p2", displayName: "たろう" })], total: 1 });
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.events.mockResolvedValue([]);
});

/**
 * 人のページを開いて「この人を消す」を押す。
 * @returns 確かめのダイアログ
 */
async function openDelete() {
  const user = userEvent.setup();
  const router = renderRoutes(ROUTES, "/people/list/p1");
  await user.click(await screen.findByRole("button", { name: /この人を消す/ }));
  const dialog = await screen.findByRole("dialog");
  return { user, router, dialog };
}

describe("この人を消す", () => {
  it("確かめの画面に「元に戻せません」・消えるもの・残るものを出す", async () => {
    const { dialog } = await openDelete();
    expect(within(dialog).getByRole("heading", { name: "この人を消しますか？" })).toBeInTheDocument();
    expect(within(dialog).getByText("元に戻せません。")).toBeInTheDocument();
    expect(within(dialog).getByText("アンケートの回答")).toBeInTheDocument();
    expect(within(dialog).getByText(/メモ（見た目の特徴・話したこと）/)).toBeInTheDocument();
    expect(within(dialog).getByText("同意の記録")).toBeInTheDocument();
    expect(within(dialog).getByText(/別名/)).toBeInTheDocument();
    expect(within(dialog).getByText(/会ごとの参加者数/)).toBeInTheDocument();
  });

  it("名前を入れるまで「消す」は押せない", async () => {
    const { user, dialog } = await openDelete();
    const confirm = within(dialog).getByRole("button", { name: "消す" });
    expect(confirm).toBeDisabled();
    const input = within(dialog).getByLabelText(/この人の名前「山田はなこ」を入れてください/);
    await user.type(input, "   ");
    expect(confirm).toBeDisabled();
    await user.type(input, "山田はなこ");
    expect(confirm).toBeEnabled();
  });

  it("名前が表示名と合うまで「消す」は押せない。カタカナで入れても押せる", async () => {
    const { user, dialog } = await openDelete();
    await user.type(within(dialog).getByLabelText(/この人の名前/), "山田");
    expect(within(dialog).getByRole("button", { name: "消す" })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/この人の名前/));
    await user.type(within(dialog).getByLabelText(/この人の名前/), "山田ハナコ");
    expect(within(dialog).getByRole("button", { name: "消す" })).toBeEnabled();
  });

  it("APIが名前の違い（400 CONFIRMATION_MISMATCH）を返せば、そう伝えて消さない", async () => {
    api.deletePerson.mockRejectedValue(new ApiError("CONFIRMATION_MISMATCH", 400));
    const { user, router, dialog } = await openDelete();
    await user.type(within(dialog).getByLabelText(/この人の名前/), "山田はなこ");
    await user.click(within(dialog).getByRole("button", { name: "消す" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("名前が違います。「山田はなこ」と入れてください。");
    expect(router.state.location.pathname).toBe("/people/list/p1");
  });

  it("名前を入れて消すと、人の一覧へ戻る", async () => {
    api.deletePerson.mockResolvedValue(undefined);
    const { user, router, dialog } = await openDelete();
    await user.type(within(dialog).getByLabelText(/この人の名前/), " 山田はなこ ");
    await user.click(within(dialog).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(api.deletePerson).toHaveBeenCalledWith("p1", "山田はなこ"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/list"));
    expect(await screen.findByText("たろう")).toBeInTheDocument();
    // 消した人のページは読み直さない
    expect(api.person).toHaveBeenCalledTimes(1);
  });

  it("「キャンセル」で閉じれば何もしない", async () => {
    const { user, dialog } = await openDelete();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.deletePerson).not.toHaveBeenCalled();
  });
});
