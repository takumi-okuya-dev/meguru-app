// US13：1投稿の文字数と、短文・中文・長文の割合（specs/014-strategy-guidance FR-140〜FR-142、SC-019）
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { POST_LENGTH_DEFAULTS, type PostLengthSettings } from "@threads-grower/shared";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";
import { Link, Outlet } from "react-router";
import { account, listResponse, promptResponse, renderAccountRoutes } from "./helpers/stock";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const accountAccess = vi.fn(async () => OWNER_ACCESS);
const toastSuccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, accountAccess, listPostDrafts, getPrompt, putPromptSettings } };
});
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }));

const { CreatePage } = await import("@/pages/create");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");

const CUSTOM: PostLengthSettings = { target: 200, shortLength: 70, mediumLength: 135, longLength: 180, shortRatio: 35, mediumRatio: 45, longRatio: 20 };

function withSettings(length: PostLengthSettings, version = 1) {
  return { ...promptResponse(), settings: { postCount: 30, length, version } };
}

function renderCreate() {
  return renderAccountRoutes([{ path: "create", element: <CreatePage /> }], "/accounts/a1/create");
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /文字数と長さの割合/ }));
  return within(screen.getByRole("region", { name: "文字数と長さの割合" }));
}

beforeEach(() => {
  accountAccess.mockResolvedValue(OWNER_ACCESS);
  listPostDrafts.mockReset().mockResolvedValue(listResponse());
  getPrompt.mockReset().mockResolvedValue(withSettings({ ...POST_LENGTH_DEFAULTS }));
  putPromptSettings.mockReset();
  toastSuccess.mockReset();
});

describe("文字数と長さの割合", () => {
  it("初めは閉じていて、1行のまとめを出す", async () => {
    renderCreate();
    const toggle = await screen.findByRole("button", { name: /文字数と長さの割合/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("目標 150字・短文 55字 35%・中文 100字 45%・長文 135字 20%");
  });

  it("入力のたびに、作る件数の内訳（合計は作る件数）が変わる（FR-141）", async () => {
    const user = userEvent.setup();
    renderCreate();
    const s = await openSettings(user);
    expect(s.getByText("30件の内訳：短文11件・中文13件・長文6件")).toBeInTheDocument();
    fireEvent.change(s.getByRole("slider", { name: "短文の割合" }), { target: { value: "50" } });
    fireEvent.change(s.getByRole("slider", { name: "中文の割合" }), { target: { value: "30" } });
    expect(s.getByText("30件の内訳：短文15件・中文9件・長文6件")).toBeInTheDocument();
  });

  it("割合の合計が100%でない・長さが目標を超えるときは、理由を出して保存できない（FR-142）", async () => {
    const user = userEvent.setup();
    renderCreate();
    const s = await openSettings(user);
    fireEvent.change(s.getByRole("slider", { name: "長文の割合" }), { target: { value: "30" } });
    expect(s.getByText("割合の合計を100%にしてください（今は110%）")).toBeInTheDocument();
    expect(s.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(s.getByRole("slider", { name: "長文の割合" }), { target: { value: "20" } });
    await user.clear(s.getByRole("spinbutton", { name: "長文の文字数" }));
    await user.type(s.getByRole("spinbutton", { name: "長文の文字数" }), "160");
    expect(s.getByText("長文の文字数は、目標の150字以下にしてください")).toBeInTheDocument();
    expect(s.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("「保存」で作る件数と一緒に送り、プロンプトを作り直す。「初期値に戻す」で初めの値に戻す（保存はしない）", async () => {
    const user = userEvent.setup();
    getPrompt.mockResolvedValue(withSettings(CUSTOM));
    putPromptSettings.mockResolvedValue({ postCount: 30, length: POST_LENGTH_DEFAULTS, version: 2 });
    renderCreate();
    const s = await openSettings(user);
    expect(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" })).toHaveValue(200);
    await user.click(s.getByRole("button", { name: "初期値に戻す" }));
    expect(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" })).toHaveValue(150);
    expect(putPromptSettings).not.toHaveBeenCalled();
    await user.click(s.getByRole("button", { name: "保存" }));
    expect(putPromptSettings).toHaveBeenCalledWith("a1", 30, 1, POST_LENGTH_DEFAULTS);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("文字数と割合を保存しました"));
    await waitFor(() => expect(getPrompt.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("作る件数の保存中は文字数と割合を保存できず、文字数と割合の保存中は件数の保存を待ち、新しい版で送る（PR #17 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    let finishCount: (v: unknown) => void = () => {};
    let finishLength: (v: unknown) => void = () => {};
    putPromptSettings.mockImplementation((_a: string, n: number, v: number, length?: PostLengthSettings) =>
      length
        ? new Promise((r) => (finishLength = () => r({ postCount: n, length, version: v + 1 })))
        : new Promise((r) => (finishCount = () => r({ postCount: n, length: POST_LENGTH_DEFAULTS, version: v + 1 }))),
    );
    renderCreate();
    const s = await openSettings(user);
    // 件数の保存中
    const count = screen.getByRole("spinbutton", { name: "作る件数" });
    await user.clear(count);
    await user.type(count, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10, 1), { timeout: 2000 });
    fireEvent.change(s.getByRole("slider", { name: "短文の割合" }), { target: { value: "40" } });
    fireEvent.change(s.getByRole("slider", { name: "中文の割合" }), { target: { value: "40" } });
    expect(s.getByRole("button", { name: "保存" })).toBeDisabled();
    finishCount({});
    await waitFor(() => expect(s.getByRole("button", { name: "保存" })).toBeEnabled());
    await user.click(s.getByRole("button", { name: "保存" }));
    expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 10, 2, expect.objectContaining({ shortRatio: 40 }));
    // 文字数と割合の保存中に件数を変えても、終わるまで送らない
    await user.clear(count);
    await user.type(count, "12");
    await new Promise((r) => setTimeout(r, 700));
    expect(putPromptSettings).toHaveBeenCalledTimes(2);
    finishLength({});
    await waitFor(() => expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 12, 3));
  });

  it("文字数と割合の保存中は、欄を変えられない（PR #17 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockImplementation(() => new Promise(() => {}));
    renderCreate();
    const s = await openSettings(user);
    fireEvent.change(s.getByRole("slider", { name: "短文の割合" }), { target: { value: "40" } });
    fireEvent.change(s.getByRole("slider", { name: "中文の割合" }), { target: { value: "40" } });
    await user.click(s.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" })).toBeDisabled());
    expect(s.getByRole("slider", { name: "長文の割合" })).toBeDisabled();
  });

  it("文字数と割合の保存が 409 なら、作る件数も最新の値にして、次の保存では最新の件数を送る（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const user = userEvent.setup();
    putPromptSettings
      .mockRejectedValueOnce(
        new ApiError("STALE_UPDATE", 409, [], { postCount: 12, length: POST_LENGTH_DEFAULTS, version: 5 }, { name: "田中 健" }),
      )
      .mockResolvedValue({ postCount: 12, length: CUSTOM, version: 6 });
    renderCreate();
    const s = await openSettings(user);
    await user.clear(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" }));
    await user.type(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" }), "200");
    await user.click(s.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "作る件数" })).toHaveValue(12));
    const again = within(screen.getByRole("region", { name: "文字数と長さの割合" }));
    await user.clear(again.getByRole("spinbutton", { name: "1投稿の文字数の目標" }));
    await user.type(again.getByRole("spinbutton", { name: "1投稿の文字数の目標" }), "200");
    await user.click(again.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 12, 5, expect.objectContaining({ target: 200 })));
    expect(putPromptSettings).not.toHaveBeenCalledWith("a1", 12, expect.anything());
  });

  it("作る件数の保存が 409 なら、最新の文字数と割合もすぐ欄に入れる（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], { postCount: 30, length: CUSTOM, version: 5 }, null));
    getPrompt.mockResolvedValueOnce(withSettings({ ...POST_LENGTH_DEFAULTS })).mockImplementation(() => new Promise(() => {}));
    renderCreate();
    const count = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(count);
    await user.type(count, "10");
    await waitFor(() => expect(screen.getByRole("button", { name: /文字数と長さの割合/ })).toHaveTextContent("目標 200字"), {
      timeout: 2000,
    });
  });

  it("作る件数の保存が 409 でも、文字数と割合の未保存の入力は残す。入力していなければ最新の値にする（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], { postCount: 30, length: CUSTOM, version: 5 }, null));
    getPrompt.mockResolvedValueOnce(withSettings({ ...POST_LENGTH_DEFAULTS })).mockImplementation(() => new Promise(() => {}));
    renderCreate();
    const s = await openSettings(user);
    await user.clear(s.getByRole("spinbutton", { name: "短文の文字数" }));
    await user.type(s.getByRole("spinbutton", { name: "短文の文字数" }), "60");
    const count = screen.getByRole("spinbutton", { name: "作る件数" });
    await user.clear(count);
    await user.type(count, "10");
    await waitFor(() => expect(screen.getByRole("button", { name: /文字数と長さの割合/ })).toHaveTextContent("目標 200字"), {
      timeout: 2000,
    });
    // 入力していた短文の文字数は残り、入力していない目標は最新の値になる
    expect(s.getByRole("spinbutton", { name: "短文の文字数" })).toHaveValue(60);
  });

  it("文字数と割合の保存が 409 なら、読み直しを待たずに最新の文字数と割合を欄に入れる（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(new ApiError("STALE_UPDATE", 409, [], { postCount: 30, length: CUSTOM, version: 5 }, null));
    getPrompt.mockResolvedValueOnce(withSettings({ ...POST_LENGTH_DEFAULTS })).mockImplementation(() => new Promise(() => {}));
    renderCreate();
    const s = await openSettings(user);
    fireEvent.change(s.getByRole("slider", { name: "短文の割合" }), { target: { value: "40" } });
    fireEvent.change(s.getByRole("slider", { name: "中文の割合" }), { target: { value: "40" } });
    await user.click(s.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /文字数と長さの割合/ })).toHaveTextContent("目標 200字"));
  });

  it("文字数と割合の保存中に作る件数を変えていたら、409 でもその件数を残し、最新の版で保存し直す（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const user = userEvent.setup();
    let fail: (e: unknown) => void = () => {};
    putPromptSettings
      .mockImplementationOnce(() => new Promise((_, r) => (fail = r)))
      .mockImplementation(async (_a: string, n: number, v: number) => ({ postCount: n, length: POST_LENGTH_DEFAULTS, version: v + 1 }));
    renderCreate();
    const s = await openSettings(user);
    fireEvent.change(s.getByRole("slider", { name: "短文の割合" }), { target: { value: "40" } });
    fireEvent.change(s.getByRole("slider", { name: "中文の割合" }), { target: { value: "40" } });
    await user.click(s.getByRole("button", { name: "保存" }));
    const count = screen.getByRole("spinbutton", { name: "作る件数" });
    await user.clear(count);
    await user.type(count, "15");
    fail(new ApiError("STALE_UPDATE", 409, [], { postCount: 12, length: POST_LENGTH_DEFAULTS, version: 5 }, null));
    await waitFor(() => expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 15, 5), { timeout: 2000 });
    expect(count).toHaveValue(15);
  });

  it("文字数と割合を保存せずに移動しようとすると、未保存の確認が出る（PR #17 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    renderAccountRoutes(
      [
        { index: true, element: <p>ホームの中身</p> },
        { path: "create", element: <CreatePage /> },
      ],
      "/accounts/a1/create",
      <UnsavedChangesProvider>
        <Link to="/accounts/a1">ホームへ</Link>
        <Outlet context={{ account }} />
      </UnsavedChangesProvider>,
    );
    const s = await openSettings(user);
    await user.clear(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" }));
    await user.type(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" }), "200");
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
  });

  it("オーナー以外は、見られるが保存できない（SC-019）", async () => {
    accountAccess.mockResolvedValue(EDITOR_ACCESS);
    const user = userEvent.setup();
    renderCreate();
    const s = await openSettings(user);
    expect(s.getByText("文字数と割合を保存できるのは、オーナーだけです")).toBeInTheDocument();
    expect(s.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(s.getByRole("spinbutton", { name: "1投稿の文字数の目標" })).toBeDisabled();
  });
});
