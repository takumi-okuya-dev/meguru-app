// 誘いの文と目標の画面（specs/people/001-people-memo tasks.md T081、contracts/ui-routes.md 1、research.md R17）。
// 型の見本・初めの型に戻す（null を送る）・文字の数（500文字まで）・目標の確かめ（1〜10,000、空は目標なし）。
import { DEFAULT_INVITE_TEMPLATE } from "@meguru/shared/people";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = { settings: vi.fn(), updateSettings: vi.fn() };
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { SettingsPage } = await import("@/apps/people/pages/SettingsPage");

const ROUTES = [{ path: "/people/settings", element: <SettingsPage /> }];

/**
 * 欄の中身を入れ替える（「{」は userEvent.type では特別な文字なので、貼り付けで入れる）。
 * @param user - userEvent
 * @param el - 欄
 * @param text - 入れる文字
 */
async function replaceText(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
  await user.clear(el);
  if (text !== "") await user.click(el);
  if (text !== "") await user.paste(text);
}

beforeEach(() => {
  api.settings.mockReset();
  api.updateSettings.mockReset();
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null });
  api.updateSettings.mockImplementation(async (input: object) => ({ inviteTemplate: null, repeaterGoal: null, ...input }));
});

describe("誘いの文の型", () => {
  it("差し込みの3つを説明し、初めの型と、見本の値を入れた文を出す", async () => {
    renderRoutes(ROUTES, "/people/settings");
    const box = await screen.findByLabelText("型");
    expect(box).toHaveValue(DEFAULT_INVITE_TEMPLATE);
    for (const key of ["{名前}", "{会の名前}", "{日にち}"]) expect(screen.getByText(key)).toBeInTheDocument();
    expect(screen.getByTestId("invite-preview")).toHaveTextContent("山田はなこさん、12月13日（日）のIT交流会、もしご興味あれば一緒にいかがですか？");
    expect(screen.getByRole("button", { name: "初めの型に戻す" })).toBeDisabled();
  });

  it("型を変えると見本がすぐ変わり、保存で送る", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const box = await screen.findByLabelText("型");
    await replaceText(user, box, "{名前}さん、{会の名前}（{日にち}）どうですか？");
    expect(screen.getByTestId("invite-preview")).toHaveTextContent("山田はなこさん、IT交流会（12月13日（日））どうですか？");
    await user.click(screen.getAllByRole("button", { name: "保存" })[0]!);
    expect(api.updateSettings).toHaveBeenCalledWith({ inviteTemplate: "{名前}さん、{会の名前}（{日にち}）どうですか？" });
  });

  it("「初めの型に戻す」は null を送り、欄を初めの型に戻す", async () => {
    const user = userEvent.setup();
    api.settings.mockResolvedValue({ inviteTemplate: "{名前}さん、来てね", repeaterGoal: null });
    renderRoutes(ROUTES, "/people/settings");
    const box = await screen.findByLabelText("型");
    expect(box).toHaveValue("{名前}さん、来てね");
    await user.click(screen.getByRole("button", { name: "初めの型に戻す" }));
    expect(api.updateSettings).toHaveBeenCalledWith({ inviteTemplate: null });
    await waitFor(() => expect(box).toHaveValue(DEFAULT_INVITE_TEMPLATE));
  });

  it("「初めの型に戻す」の保存が失敗したら、作り手の型を欄に残す", async () => {
    const user = userEvent.setup();
    api.settings.mockResolvedValue({ inviteTemplate: "{名前}さん、来てね", repeaterGoal: null });
    api.updateSettings.mockRejectedValue(new Error("network"));
    renderRoutes(ROUTES, "/people/settings");
    const box = await screen.findByLabelText("型");
    await user.click(screen.getByRole("button", { name: "初めの型に戻す" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(box).toHaveValue("{名前}さん、来てね");
  });

  it("文字の数を出し（絵文字も1文字）、500文字を超えると保存できない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const box = await screen.findByLabelText("型");
    await replaceText(user, box, "🌸".repeat(500));
    expect(screen.getByText("500/500")).toBeInTheDocument();
    expect(screen.queryByText("500文字以内で入力してください")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "保存" })[0]).toBeEnabled();
    await user.type(box, "あ");
    expect(screen.getByText("501/500")).toBeInTheDocument();
    expect(screen.getByText("500文字以内で入力してください")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "保存" })[0]).toBeDisabled();
  });
});

describe("リピーターの目標", () => {
  it("1〜10,000の数だけ保存できる。範囲の外は文言を出して送らない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const goal = await screen.findByLabelText("目標の人数");
    const save = screen.getAllByRole("button", { name: "保存" })[1]!;
    await replaceText(user, goal, "0");
    await user.click(save);
    expect(screen.getByText("1〜10,000の数を入れてください。")).toBeInTheDocument();
    await replaceText(user, goal, "10001");
    await user.click(save);
    expect(api.updateSettings).not.toHaveBeenCalled();
    await replaceText(user, goal, "10");
    await user.click(save);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ repeaterGoal: 10 }));
  });

  it("数として読めない入力（abc・-・e）は、目標を消さずに文言を出す。全角の数字は読む", async () => {
    const user = userEvent.setup();
    api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: 10 });
    renderRoutes(ROUTES, "/people/settings");
    const goal = await screen.findByLabelText("目標の人数");
    const save = screen.getAllByRole("button", { name: "保存" })[1]!;
    for (const bad of ["abc", "-", "e", "1.5"]) {
      await replaceText(user, goal, bad);
      await user.click(save);
      expect(screen.getByText("1〜10,000の数を入れてください。")).toBeInTheDocument();
    }
    expect(api.updateSettings).not.toHaveBeenCalled();
    await replaceText(user, goal, "２０");
    await user.click(save);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ repeaterGoal: 20 }));
  });

  it("空にして保存すると、目標なし（null）を送る", async () => {
    const user = userEvent.setup();
    api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: 10 });
    renderRoutes(ROUTES, "/people/settings");
    const goal = await screen.findByLabelText("目標の人数");
    expect(goal).toHaveValue("10");
    await user.clear(goal);
    await user.click(screen.getAllByRole("button", { name: "保存" })[1]!);
    expect(api.updateSettings).toHaveBeenCalledWith({ repeaterGoal: null });
  });
});
