// 時間差のメンションの設定（specs/023 contracts/ui-routes.md「このアカウントの設定」、tasks.md T010）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MentionSettings } from "@meguru/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mentionSettings: vi.fn(),
  putMentionSettings: vi.fn(),
  addMentionPerson: vi.fn(),
  patchMentionPerson: vi.fn(),
  deleteMentionPerson: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, ...mocks } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MentionSettingsSection } = await import("@/apps/threads/components/settings/MentionSettingsSection");

const SETTINGS: MentionSettings = {
  message: "シェアお願いします",
  delayMinutes: 30,
  version: 1,
  people: [
    { id: "p1", username: "minato_place", label: "港の運営", always: true, pendingCount: 2 },
    { id: "p2", username: "taro", label: "たろう", always: false, pendingCount: 0 },
  ],
  repliesDenied: false,
  blocked: [],
  canEdit: true,
};

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MentionSettingsSection accountId="a1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.mentionSettings.mockResolvedValue(SETTINGS);
  for (const fn of [mocks.putMentionSettings, mocks.addMentionPerson, mocks.patchMentionPerson, mocks.deleteMentionPerson])
    fn.mockResolvedValue(SETTINGS);
});

describe("時間差のメンションの設定", () => {
  it("時間差を選ぶと保存し、ひとことは「変更」→「保存」", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.selectOptions(await screen.findByRole("combobox", { name: "時間差" }), "60");
    expect(mocks.putMentionSettings).toHaveBeenCalledWith("a1", { expectedVersion: 1, message: "シェアお願いします", delayMinutes: 60 });
    await user.click(screen.getByRole("button", { name: "変更" }));
    const box = screen.getByLabelText("ひとこと");
    await user.clear(box);
    await user.type(box, "よろしくお願いします");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(mocks.putMentionSettings).toHaveBeenLastCalledWith("a1", { expectedVersion: 1, message: "よろしくお願いします", delayMinutes: 30 });
  });

  it("人を足す・いつも付けるを切り替える・消す（予定があれば確かめる）。2 / 20人", async () => {
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText("2 / 20人")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "ユーザー名" }), "hanako");
    await user.type(screen.getByRole("textbox", { name: "呼び名" }), "はなこ");
    await user.click(screen.getByRole("button", { name: "足す" }));
    expect(mocks.addMentionPerson).toHaveBeenCalledWith("a1", { username: "hanako", label: "はなこ" });
    const list = screen.getByRole("list", { name: "メンションする人" });
    await user.click(within(list).getAllByRole("checkbox", { name: "いつも付ける" })[1]!);
    expect(mocks.patchMentionPerson).toHaveBeenCalledWith("a1", "p2", { always: true });
    await user.click(screen.getByRole("button", { name: "たろうを消す" }));
    expect(mocks.deleteMentionPerson).toHaveBeenCalledWith("a1", "p2");
    await user.click(screen.getByRole("button", { name: "港の運営を消す" }));
    expect(await screen.findByText(/この人を含む予定のメンションが2件あります/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "外して消す" }));
    expect(mocks.deleteMentionPerson).toHaveBeenLastCalledWith("a1", "p1");
  });

  it("返信の権限がないと注意の帯と作り直し方。変えられない人には操作がない。説明は閉じたトグル", async () => {
    const user = userEvent.setup();
    mocks.mentionSettings.mockResolvedValue({ ...SETTINGS, repliesDenied: true, canEdit: false });
    renderSection();
    expect(await screen.findByText(/今のトークンには返信の権限がありません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "作り直し方" })).toHaveAttribute("href", "/guide/threads-token");
    expect(screen.queryByRole("button", { name: "変更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "足す" })).not.toBeInTheDocument();
    const help = screen.getByRole("button", { name: "時間差のメンションについて" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    await user.click(help);
    expect(within(screen.getByRole("list", { name: "時間差のメンションについて" })).getAllByRole("listitem")).toHaveLength(4);
  });
});
