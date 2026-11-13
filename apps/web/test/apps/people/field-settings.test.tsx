// 設定の自由な項目：足す・名前を直す・並べ替える（上へ・下へ）・消す（specs/people/002-sales-list tasks.md T216・T221、spec US6 AS1、FR-109）。
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  settings: vi.fn(),
  tags: vi.fn(),
  fields: vi.fn(),
  createField: vi.fn(),
  renameField: vi.fn(),
  reorderFields: vi.fn(),
  deleteField: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { SettingsPage } = await import("@/apps/people/pages/SettingsPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [{ path: "/people/settings", element: <SettingsPage /> }];
const FIELDS = [
  { id: "f1", label: "好きなもの", position: 0 },
  { id: "f2", label: "紹介された本", position: 1 },
  { id: "f3", label: "出身", position: 2 },
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "last_met", group: "none" } });
  api.tags.mockResolvedValue([]);
  api.fields.mockResolvedValue(FIELDS);
  api.createField.mockResolvedValue({ id: "f4", label: "趣味", position: 3 });
  api.renameField.mockResolvedValue(FIELDS[0]);
  api.reorderFields.mockImplementation(async (ids: string[]) => ids.map((id, i) => ({ ...FIELDS.find((f) => f.id === id)!, position: i })));
  api.deleteField.mockResolvedValue(null);
});

describe("自由な項目の設定", () => {
  it("項目を足す（前後の空白を外す）。30文字を超える名前は足せない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    await screen.findByRole("list", { name: "自由な項目の一覧" });
    const box = screen.getByLabelText("項目を足す");
    await user.type(box, "あ".repeat(31));
    expect(screen.getByText("項目の名前は30文字までです。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^足す/ })).toBeDisabled();
    await user.clear(box);
    await user.type(box, " 趣味 ");
    await user.click(screen.getByRole("button", { name: /^足す/ }));
    expect(api.createField).toHaveBeenCalledWith("趣味");
  });

  it("上へ・下へで並べ替え、すべての項目の順を送る。いちばん上の「上へ」と、いちばん下の「下へ」は押せない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "自由な項目の一覧" });
    expect(within(list).getByRole("button", { name: "「好きなもの」を上へ" })).toBeDisabled();
    expect(within(list).getByRole("button", { name: "「出身」を下へ" })).toBeDisabled();
    await user.click(within(list).getByRole("button", { name: "「出身」を上へ" }));
    expect(api.reorderFields).toHaveBeenCalledWith(["f1", "f3", "f2"]);
    await user.click(await within(list).findByRole("button", { name: "「好きなもの」を下へ" }));
    expect(api.reorderFields).toHaveBeenLastCalledWith(["f2", "f1", "f3"]);
  });

  it("名前を直す。同じ名前があれば（409 PEOPLE_NAME_TAKEN）「同じ名前がもうあります。」", async () => {
    const user = userEvent.setup();
    api.renameField.mockRejectedValueOnce(new ApiError("PEOPLE_NAME_TAKEN", 409));
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "自由な項目の一覧" });
    await user.click(within(list).getByRole("button", { name: "「好きなもの」の名前を直す" }));
    const box = within(list).getByLabelText("「好きなもの」の新しい名前");
    await user.clear(box);
    await user.type(box, "出身");
    await user.click(within(list).getByRole("button", { name: "保存" }));
    expect(api.renameField).toHaveBeenCalledWith("f1", "出身");
    expect(await within(list).findByRole("alert")).toHaveTextContent("同じ名前がもうあります。");
  });

  it("足すときに同じ名前があれば（409）、その文言を出す", async () => {
    const user = userEvent.setup();
    api.createField.mockRejectedValue(new ApiError("PEOPLE_NAME_TAKEN", 409));
    renderRoutes(ROUTES, "/people/settings");
    await screen.findByRole("list", { name: "自由な項目の一覧" });
    await user.type(screen.getByLabelText("項目を足す"), "出身");
    await user.click(screen.getByRole("button", { name: /^足す/ }));
    expect(await screen.findByText("同じ名前がもうあります。")).toBeInTheDocument();
  });

  it("消すときは、全員の値も消えることを確かめる", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "自由な項目の一覧" });
    await user.click(within(list).getByRole("button", { name: "「紹介された本」を消す" }));
    const confirm = within(list).getByRole("group", { name: "「紹介された本」を消す確かめ" });
    expect(confirm).toHaveTextContent("全員の「紹介された本」の値も消えます");
    await user.click(within(confirm).getByRole("button", { name: "項目を消す" }));
    expect(api.deleteField).toHaveBeenCalledWith("f2");
  });
});
