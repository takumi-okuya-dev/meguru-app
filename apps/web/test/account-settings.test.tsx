// このアカウントの設定の「投稿のルール」（specs/004-review-approval FR-014・FR-019〜FR-021・FR-031・FR-042、contracts/ui-routes.md）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, NgWord, PostingRules, PostingSchedule } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";

const getPostingRules = vi.fn();
const addNgWords = vi.fn();
const deleteNgWord = vi.fn();
const putCoreRules = vi.fn();
const getPostingSchedule = vi.fn();
const putPostingSchedule = vi.fn();
const checkThreads = vi.fn();
const getAutoPost = vi.fn();
const connect = vi.fn();
const accountAccess = vi.fn(async () => OWNER_ACCESS);
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      accountAccess,
      getPostingRules,
      addNgWords,
      deleteNgWord,
      putCoreRules,
      getPostingSchedule,
      putPostingSchedule,
      checkThreads,
      getAutoPost,
      connect,
    },
  };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning, dismiss: vi.fn() },
}));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { AccountSettings } = await import("@/pages/account-settings");

const account: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

const word = (id: string, w: string): NgWord => ({
  id,
  word: w,
  normalized: w,
  createdAt: "2026-10-04T00:00:00.000Z",
});

function rules(overrides: Partial<PostingRules> = {}): PostingRules {
  return {
    ngWords: [],
    ngWordLimit: 200,
    coreRules: "",
    coreRulesVersion: 1,
    canEditCoreRules: true,
    ...overrides,
  };
}

function scheduleResponse(schedule: Partial<PostingSchedule> = {}) {
  return {
    schedule: { enabled: false, slotTimes: [], jitter: true, version: 0, ...schedule },
    limits: { slots: 10, minGapMinutes: 30, jitterMinutes: 10 },
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [{ path: "settings", element: <AccountSettings /> }],
      },
    ],
    { initialEntries: ["/accounts/a1/settings"] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [
    getPostingRules,
    addNgWords,
    deleteNgWord,
    putCoreRules,
    getPostingSchedule,
    putPostingSchedule,
    checkThreads,
    getAutoPost,
    connect,
    toastSuccess,
    toastError,
    toastWarning,
  ])
    fn.mockReset();
  getPostingRules.mockResolvedValue(rules({ ngWords: [word("w1", "絶対")] }));
  getPostingSchedule.mockResolvedValue(scheduleResponse());
  getAutoPost.mockResolvedValue({
    autoPost: { enabled: true, slotCount: 3, stoppedReason: null },
    next: null,
    approvedCount: 0,
    daysLeft: null,
    notices: [],
  });
});

describe("「投稿のルール」の区分（FR-031）", () => {
  it("「Threadsとの接続」より上にあり、NGワードの行に語数と「編集」がある", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    // 「Threadsとの接続」はオーナーの権限を読み込んでから出す（specs/008 FR-041）
    const heading = await screen.findByRole("heading", { name: "Threadsとの接続" });
    expect(
      section.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      await within(section).findByText("この言葉を含む下書きは承認できません。1語"),
    ).toBeInTheDocument();
  });
});

describe("NGワードのダイアログ（FR-014・FR-016a）", () => {
  async function openDialog() {
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    await waitFor(() =>
      expect(within(section).getAllByRole("button", { name: "編集" })[0]).toBeEnabled(),
    );
    await user.click(within(section).getAllByRole("button", { name: "編集" })[0]!);
    return { user, dialog: await screen.findByRole("dialog", { name: "NGワード" }) };
  }

  it("「、」「,」・改行で区切って一度に追加できる。Enterでも追加する", async () => {
    addNgWords.mockResolvedValue({ added: [], duplicates: [], reopenedCount: 0 });
    const { user, dialog } = await openDialog();
    const input = within(dialog).getByRole("textbox", { name: "追加するNGワード" });
    await user.type(input, "絶対、必ず儲かる,神");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(addNgWords).toHaveBeenCalledWith("a1", ["絶対", "必ず儲かる", "神"]);
    await user.type(input, "最強{Enter}");
    expect(addNgWords).toHaveBeenLastCalledWith("a1", ["最強"]);
  });

  it("重複は「すでにあります」、承認済みを戻したらトーストで知らせる", async () => {
    addNgWords.mockResolvedValue({
      added: [word("w2", "神")],
      duplicates: ["絶対"],
      reopenedCount: 2,
    });
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "追加するNGワード" }), "絶対、神");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await within(dialog).findByText("「絶対」はすでにあります")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith(
      "NGワードを含む承認済みの下書き2件を、要確認に戻しました",
    );
  });

  it("チップの×で削除し、トーストの「元に戻す」で足し直す", async () => {
    deleteNgWord.mockResolvedValue(null);
    addNgWords.mockResolvedValue({ added: [word("w3", "絶対")], duplicates: [], reopenedCount: 0 });
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "絶対を削除" }));
    expect(deleteNgWord).toHaveBeenCalledWith("a1", "w1");
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("「絶対」を削除しました", expect.anything()),
    );
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    expect(addNgWords).toHaveBeenCalledWith("a1", ["絶対"]);
  });

  it("200語に達したら入力欄が無効になり、案内が出る", async () => {
    getPostingRules.mockResolvedValue(
      rules({ ngWords: Array.from({ length: 200 }, (_, i) => word(`w${i}`, `語${i}`)) }),
    );
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole("textbox", { name: "追加するNGワード" })).toBeDisabled();
    expect(within(dialog).getByText("上限（200語）に達しています")).toBeInTheDocument();
  });

  it("上限の 409 は案内を出す", async () => {
    addNgWords.mockRejectedValue(new ApiError("ITEM_LIMIT_REACHED", 409));
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "追加するNGワード" }), "新しい語");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(
      await within(dialog).findByText("NGワードは200語まで登録できます。"),
    ).toBeInTheDocument();
  });
});

describe("投稿ルール（CORE RULES）のダイアログ（FR-019〜FR-021）", () => {
  async function openCoreRules() {
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    await waitFor(() =>
      expect(within(section).getAllByRole("button", { name: /^(編集|見る)$/ })[1]).toBeEnabled(),
    );
    await user.click(within(section).getAllByRole("button", { name: /^(編集|見る)$/ })[1]!);
    return {
      user,
      section,
      dialog: await screen.findByRole("dialog", { name: "投稿ルール（CORE RULES）" }),
    };
  }

  it("行に件数（または未入力）と「編集」がある", async () => {
    getPostingRules.mockResolvedValue(
      rules({ coreRules: "断定口調は使わない\n\n医療の効果をうたわない" }),
    );
    renderPage();
    expect(
      await screen.findByText("AIプロンプトに「絶対に守るルール」として入ります。2件"),
    ).toBeInTheDocument();
  });

  it("書いて保存すると putCoreRules に本文と版が渡る", async () => {
    putCoreRules.mockResolvedValue({ coreRules: "断定口調は使わない", coreRulesVersion: 2 });
    const { user, dialog } = await openCoreRules();
    await user.type(
      within(dialog).getByRole("textbox", { name: /投稿ルール/ }),
      "断定口調は使わない",
    );
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    expect(putCoreRules).toHaveBeenCalledWith("a1", {
      text: "断定口調は使わない",
      expectedVersion: 1,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("409 では「他の場所で更新されています」のダイアログが出る", async () => {
    putCoreRules.mockRejectedValue(
      new ApiError("STALE_UPDATE", 409, [], { coreRules: "他で書いた", coreRulesVersion: 3 }),
    );
    const { user, dialog } = await openCoreRules();
    await user.type(within(dialog).getByRole("textbox", { name: /投稿ルール/ }), "A");
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    expect(await screen.findByText("他の場所で更新されています")).toBeInTheDocument();
  });

  it("grower機能を使えないAccountでは「見る」になり、読み取り専用で案内が出る（FR-020）", async () => {
    getPostingRules.mockResolvedValue(
      rules({ coreRules: "断定口調は使わない", canEditCoreRules: false }),
    );
    const { section, dialog } = await openCoreRules();
    expect(within(section).getAllByRole("button", { name: "見る", hidden: true })).toHaveLength(2);
    expect(within(dialog).getByRole("textbox", { name: /投稿ルール/ })).toHaveAttribute("readonly");
    expect(
      within(dialog).getByText(/投稿ルールはAIプロンプトの生成（プラン2以上）で使われます/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });
});

describe("Threadsの規約への備え（FR-042・FR-043）", () => {
  it("「見る」で規約上のルール6つ・4つの分類・版の日付が出て、編集の手段はない", async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    await user.click(within(section).getAllByRole("button", { name: "見る" }).at(-1)!);
    const dialog = await screen.findByRole("dialog", { name: "Threadsの規約への備え" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(6 + 4);
    for (const label of [
      "見返りでの反応集め",
      "反応しないと見られない形",
      "収益・成果の断定",
      "健康・医療の効果",
    ]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(
      within(dialog).getByText("2026-10-04時点のMetaコミュニティ規定をもとにしています"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });
});

// ---- 投稿のスケジュール（specs/005-auto-post FR-001〜FR-004・FR-001b・FR-002a・FR-002b）----

describe("「投稿のスケジュール」の区分", () => {
  it("「投稿のルール」より上にあり、3つの行に保存済みの値が出る", async () => {
    getPostingSchedule.mockResolvedValue(scheduleResponse({ enabled: true, slotTimes: ["07:30", "12:00", "21:00"], version: 2 }));
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のスケジュール" });
    const rulesSection = screen.getByRole("region", { name: "投稿のルール" });
    expect(section.compareDocumentPosition(rulesSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(section).findByText("7:30・12:00・21:00（1日3件）")).toBeInTheDocument();
    expect(within(section).getByText("承認済みの下書きを、下の時刻に1件ずつ投稿します")).toBeInTheDocument();
    expect(within(section).getAllByText("オン")).toHaveLength(2);
  });

  it("時刻が未設定なら「未設定」", async () => {
    renderPage();
    expect(await screen.findByText("未設定")).toBeInTheDocument();
  });
});

describe("投稿のスケジュールのダイアログ", () => {
  async function openDialog() {
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のスケジュール" });
    await waitFor(() => expect(within(section).getByRole("button", { name: "編集" })).toBeEnabled());
    await user.click(within(section).getByRole("button", { name: "編集" }));
    return { user, dialog: await screen.findByRole("dialog", { name: "投稿のスケジュール" }) };
  }

  /** 時刻の入力に値を入れて「追加」を押す。 */
  async function addTime(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, t: string) {
    fireEvent.change(within(dialog).getByLabelText("追加する時刻"), { target: { value: t } });
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
  }

  const saveButton = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!;

  it("時刻を3つ足してオンにして保存できる（SC-007）。通知に、承認済みを用意する案内が添えられる", async () => {
    putPostingSchedule.mockResolvedValue({
      schedule: { enabled: true, slotTimes: ["07:30", "12:00", "21:00"], jitter: true, version: 1 },
      connectionCheck: { status: "ok", quotaUsage: 0, quotaTotal: 250 },
    });
    getAutoPost.mockResolvedValue({
      autoPost: { enabled: true, slotCount: 3, stoppedReason: null },
      next: null,
      approvedCount: 0,
      daysLeft: null,
      notices: [{ kind: "no_approved", nextSlotAt: "2026-10-06T03:00:00.000Z" }],
    });
    const { user, dialog } = await openDialog();
    for (const t of ["21:00", "07:30", "12:00"]) await addTime(user, dialog, t);
    expect(within(dialog).getByText("1日 3件 投稿します")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("switch", { name: "自動投稿" }));
    await user.click(saveButton(dialog));
    expect(putPostingSchedule).toHaveBeenCalledWith("a1", {
      enabled: true,
      slotTimes: ["07:30", "12:00", "21:00"],
      jitter: true,
      expectedVersion: 0,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("投稿のスケジュールを保存しました。承認済みの下書きを用意してください"),
    );
  });

  it("検証の文言：30分未満の間は too_close で保存できない。同じ時刻は足せない。オンで時刻0件は保存できない", async () => {
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("switch", { name: "自動投稿" }));
    expect(within(dialog).getByText("自動投稿をオンにするには、時刻を1つ以上追加してください")).toBeInTheDocument();
    expect(saveButton(dialog)).toBeDisabled();

    await addTime(user, dialog, "07:00");
    await addTime(user, dialog, "07:00");
    expect(within(dialog).getByText("同じ時刻がすでにあります")).toBeInTheDocument();
    await addTime(user, dialog, "07:29");
    expect(
      within(dialog).getByText("時刻を少しずらすときは、時刻どうしを30分以上あけてください（7:00と7:29）"),
    ).toBeInTheDocument();
    expect(saveButton(dialog)).toBeDisabled();
    // ずらさなければ通る
    await user.click(within(dialog).getByRole("switch", { name: "時刻を少しずらす" }));
    expect(saveButton(dialog)).toBeEnabled();
  });

  it("10件に達したら入力を無効にし、上限の案内を出す", async () => {
    getPostingSchedule.mockResolvedValue(
      scheduleResponse({ slotTimes: Array.from({ length: 10 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`) }),
    );
    const { dialog } = await openDialog();
    expect(within(dialog).getByLabelText("追加する時刻")).toBeDisabled();
    expect(within(dialog).getByText("時刻は10件まで登録できます")).toBeInTheDocument();
  });

  it("深夜（2:00〜4:59）の時刻にだけ案内が出て、保存はできる（FR-001b）", async () => {
    putPostingSchedule.mockResolvedValue({
      schedule: { enabled: false, slotTimes: ["01:59", "02:00", "04:59", "05:00"], jitter: false, version: 1 },
      connectionCheck: null,
    });
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("switch", { name: "時刻を少しずらす" }));
    for (const t of ["01:59", "02:00", "04:59", "05:00"]) await addTime(user, dialog, t);
    expect(within(dialog).getAllByText("深夜の時間帯です。見られにくい可能性があります")).toHaveLength(2);
    expect(saveButton(dialog)).toBeEnabled();
    await user.click(saveButton(dialog));
    expect(putPostingSchedule).toHaveBeenCalled();
  });

  it("409 STALE_UPDATE では「他の場所で更新されています」のダイアログが出る", async () => {
    putPostingSchedule.mockRejectedValue(
      new ApiError("STALE_UPDATE", 409, [], { enabled: true, slotTimes: ["08:00"], jitter: true, version: 3 }),
    );
    const { user, dialog } = await openDialog();
    await addTime(user, dialog, "08:30");
    await user.click(saveButton(dialog));
    expect(await screen.findByText("他の場所で更新されています")).toBeInTheDocument();
  });

  it("オンにする保存の 409 THREADS_NOT_READY では、閉じずに理由と「再接続」を出す（FR-002a）", async () => {
    putPostingSchedule.mockRejectedValue(new ApiError("THREADS_NOT_READY", 409, ["no_publish_permission"]));
    connect.mockResolvedValue({ authorizeUrl: "https://threads.example/authorize" });
    const { user, dialog } = await openDialog();
    await addTime(user, dialog, "08:30");
    await user.click(within(dialog).getByRole("switch", { name: "自動投稿" }));
    await user.click(saveButton(dialog));
    expect(
      await within(dialog).findByText("Threadsへの投稿の権限がありません。再接続して、投稿の許可をオンにしてください"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "再接続" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "投稿のスケジュール" })).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("確かめられなかった（unknown）ときは、保存して閉じ、注意の通知を出す", async () => {
    putPostingSchedule.mockResolvedValue({
      schedule: { enabled: true, slotTimes: ["08:30"], jitter: true, version: 1 },
      connectionCheck: { status: "unknown" },
    });
    const { user, dialog } = await openDialog();
    await addTime(user, dialog, "08:30");
    await user.click(within(dialog).getByRole("switch", { name: "自動投稿" }));
    await user.click(saveButton(dialog));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        "保存しました。Threadsとの接続は確認できませんでした。「接続を確かめる」で、あとで確かめてください",
      ),
    );
  });
});

describe("「接続を確かめる」（FR-002b）", () => {
  async function runCheck(result: unknown) {
    checkThreads.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のスケジュール" });
    // 「接続を確かめる」は設定の権限を読み込んでから出す（specs/008 FR-041）
    await user.click(await within(section).findByRole("button", { name: "接続を確かめる" }));
    return section;
  }

  it("投稿できる状態なら、直近24時間の投稿数を出す", async () => {
    const section = await runCheck({ status: "ok", quotaUsage: 3, quotaTotal: 250 });
    expect(await within(section).findByText("投稿できる状態です（直近24時間の投稿 3/250件）")).toBeInTheDocument();
  });

  it("権限なし・要再接続は理由と「再接続」、確かめられなければその旨", async () => {
    const s1 = await runCheck({ status: "no_publish_permission" });
    expect(
      await within(s1).findByText("Threadsへの投稿の権限がありません。再接続して、投稿の許可をオンにしてください"),
    ).toBeInTheDocument();
    expect(within(s1).getByRole("button", { name: "再接続" })).toBeInTheDocument();
  });

  it("要再接続", async () => {
    const s = await runCheck({ status: "needs_reconnect" });
    expect(await within(s).findByText("Threadsとの接続が切れています。再接続してください")).toBeInTheDocument();
  });

  it("確かめられなかった", async () => {
    const s = await runCheck({ status: "unknown" });
    expect(await within(s).findByText("Threadsとの接続を確認できませんでした。時間をおいてもう一度お試しください")).toBeInTheDocument();
  });

  it("確かめている間はボタンを無効にする", async () => {
    let resolve: (v: unknown) => void = () => {};
    checkThreads.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のスケジュール" });
    // 「接続を確かめる」は設定の権限を読み込んでから出す（specs/008 FR-041）
    await user.click(await within(section).findByRole("button", { name: "接続を確かめる" }));
    expect(within(section).getByRole("button", { name: "確かめています…" })).toBeDisabled();
    await act(async () => resolve({ status: "ok", quotaUsage: 0, quotaTotal: 250 }));
  });
});
