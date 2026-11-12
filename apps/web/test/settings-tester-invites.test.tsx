// 設定 > 運営 > テスター招待（specs/024-tester-invite-connect contracts/ui-routes.md 5、US2・US5、T023・T060）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorTesterApplication, OperatorTesterApplications } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";
import { WithApps } from "./helpers/apps";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  operatorTesterApplications: vi.fn(),
  operateTesterApplication: vi.fn(),
  setTesterSlotCapacity: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { SettingsLayout } = await import("@/shell/settings/settings-layout");
const { TesterInvitesPage } = await import("@/apps/threads/pages/settings/tester-invites");

const ME = {
  user: { id: "u", email: "op@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["app" as const, "token" as const],
  teams: [],
  ...ME_BILLING_OFF,
};

const item = (over: Partial<OperatorTesterApplication> = {}): OperatorTesterApplication => ({
  id: "ap1",
  threadsUsername: "shop_tokyo",
  status: "pending",
  removalReason: null,
  applicant: { userId: "u1", name: "山田 花子", email: "hanako@example.com" },
  connectedUsername: null,
  declineReason: null,
  duplicate: false,
  alreadyConnected: false,
  createdAt: "2026-11-07T03:00:00.000Z",
  statusChangedAt: "2026-11-07T03:00:00.000Z",
  ...over,
});

const LIST = (over: Partial<OperatorTesterApplications> = {}): OperatorTesterApplications => ({
  enabled: true,
  threadsAppId: "1367107908637398",
  slots: { used: 9, capacity: 25 },
  counts: { pending: 2, invited: 3, connected: 5, removable: 1 },
  items: [item(), item({ id: "ap2", threadsUsername: "cafe_minato", duplicate: true })],
  ...over,
});

function renderAt(path = "/settings/tester-invites") {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "appearance", element: <p>外観の中身</p> },
          { path: "tester-invites", element: <TesterInvitesPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WithApps>
        <RouterProvider router={router} />
      </WithApps>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.me.mockResolvedValue({ ...ME, operator: true });
  mocks.operatorTesterApplications.mockImplementation(async (view: string) =>
    view === "removable"
      ? LIST({ items: [item({ id: "ap9", status: "withdrawn", removalReason: "account_deleted", applicant: null })] })
      : LIST(),
  );
  mocks.operateTesterApplication.mockResolvedValue(item({ status: "invited" }));
});

describe("「運営」の区分", () => {
  it("運営者には「テスター招待」を出す", async () => {
    renderAt("/settings/appearance");
    expect(await screen.findByRole("link", { name: "テスター招待" })).toHaveAttribute("href", "/settings/tester-invites");
  });

  it("運営者でなければ出さず、直接開くと「運営者だけ」", async () => {
    mocks.me.mockResolvedValue({ ...ME, operator: false });
    mocks.operatorTesterApplications.mockRejectedValue(new ApiError("OPERATOR_ONLY", 403));
    renderAt();
    expect(await screen.findByText("この画面は運営者だけが使えます。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "テスター招待" })).not.toBeInTheDocument();
  });
});

describe("一覧", () => {
  it("枠・Metaのリンク・タブと件数・行（申し込んだ人・注意）", async () => {
    renderAt();
    expect(await screen.findByText("9 / 25")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Metaでテスターを加える/ })).toHaveAttribute(
      "href",
      "https://developers.facebook.com/apps/1367107908637398/roles/roles/",
    );
    expect(screen.getByRole("tab", { name: "申し込み中 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "外してよい 1" })).toBeInTheDocument();
    expect(screen.getByText("@shop_tokyo")).toBeInTheDocument();
    expect(screen.getAllByText(/山田 花子・hanako@example.com/)).toHaveLength(2);
    expect(screen.getByText("同じユーザー名の申し込みがあります")).toBeInTheDocument();
  });

  it("アプリIDがなければ Meta のリンクを出さない", async () => {
    mocks.operatorTesterApplications.mockResolvedValue(LIST({ threadsAppId: null }));
    renderAt();
    await screen.findByText("9 / 25");
    expect(screen.queryByRole("link", { name: /Metaでテスターを加える/ })).not.toBeInTheDocument();
  });

  it("外してよいのタブは理由と「外した」。退会した人は「退会した利用者」", async () => {
    renderAt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "外してよい 1" }));
    expect(await screen.findByText("アカウントが消されました")).toBeInTheDocument();
    expect(screen.getByText("退会した利用者")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "外した" }));
    await waitFor(() => expect(mocks.operateTesterApplication).toHaveBeenCalledWith("ap9", "removed", {}));
  });
});

describe("操作", () => {
  it("「招待した」を送る", async () => {
    renderAt();
    const user = userEvent.setup();
    const row = (await screen.findByText("@shop_tokyo")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "招待した" }));
    await waitFor(() => expect(mocks.operateTesterApplication).toHaveBeenCalledWith("ap1", "invite", {}));
  });

  it("枠がいっぱいなら確認のダイアログを出し、「続ける」で force を付けて送る", async () => {
    mocks.operateTesterApplication.mockRejectedValueOnce(new ApiError("TESTER_SLOTS_FULL", 409, ["25", "25"]));
    renderAt();
    const user = userEvent.setup();
    const row = (await screen.findByText("@shop_tokyo")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "招待した" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/テスター枠がいっぱいです（25 \/ 25）/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "続ける" }));
    await waitFor(() => expect(mocks.operateTesterApplication).toHaveBeenLastCalledWith("ap1", "invite", { force: true }));
  });

  it("「見送る」は理由を入れるダイアログ", async () => {
    renderAt();
    const user = userEvent.setup();
    const row = (await screen.findByText("@shop_tokyo")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "見送る" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("理由（任意）"), "今は枠がありません");
    await user.click(within(dialog).getByRole("button", { name: "見送る" }));
    await waitFor(() => expect(mocks.operateTesterApplication).toHaveBeenCalledWith("ap1", "decline", { reason: "今は枠がありません" }));
  });

  it("枠の数を変える", async () => {
    mocks.setTesterSlotCapacity.mockResolvedValue({ used: 9, capacity: 40 });
    renderAt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "枠の数を変える" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("テスター枠の数");
    await user.clear(input);
    await user.type(input, "40");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.setTesterSlotCapacity).toHaveBeenCalledWith(40));
  });
});

describe("招待の管理がOFFの環境（US5）", () => {
  it("「この環境では招待の管理を使っていません」と出し、操作のボタンを出さない", async () => {
    mocks.operatorTesterApplications.mockResolvedValue(LIST({ enabled: false }));
    renderAt();
    expect(await screen.findByText("この環境では招待の管理を使っていません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "招待した" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "枠の数を変える" })).not.toBeInTheDocument();
  });
});
