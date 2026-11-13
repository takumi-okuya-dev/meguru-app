// 取り込み（specs/people/001-people-memo tasks.md T028、contracts/ui-routes.md 2、research.md R4・R18）。
// ファイル → イベント → 列の対応（印・LINE名がなければ進めない）→ 同意の選択肢 → 確かめ → 取り込む → 結果。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWERS, EVENT_1011, HEADERS, MAPPED_COLUMNS, csvText, makePreview, renderRoutes } from "./helpers";

const api = { events: vi.fn(), createEvent: vi.fn(), previewImport: vi.fn(), commitImport: vi.fn() };
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { ImportPage } = await import("@/apps/people/pages/ImportPage");

const ROWS = [
  ["2026/10/11 21:03:12", "たろう", "山田太郎", "参加したい", "交流会の案内がほしい"],
  ["2026/10/11 21:05:00", "はなこ", "", "未定", ""],
  ["2026/10/11 21:06:00", "", "名無し", "", ""],
  ["2026/10/11 21:07:00", "じろう", "", "", ""],
  ["2026/10/11 21:08:00", "さぶろう", "", "", ""],
];

/** 初めのプレビュー：LINE名の列がわからない・知らない同意の選択肢がある。 */
const FIRST = makePreview([], {
  columns: [
    { header: HEADERS[0]!, field: "submitted_at", source: "preset" },
    { header: HEADERS[1]!, field: null, source: "none" },
    { header: HEADERS[2]!, field: "real_name", source: "remembered" },
    { header: HEADERS[3]!, field: "next_attendance", source: "preset" },
    { header: HEADERS[4]!, field: "contact_consent", source: "preset" },
  ],
  mappingErrors: [{ code: "line_name_missing" }],
  unknownConsentChoices: ["交流会の案内がほしい"],
});

/** 列の対応を決めたあとのプレビュー。 */
const MAPPED = makePreview([
  { row: 0, status: "new", lineName: "たろう", realName: "山田太郎", answers: ANSWERS },
  { row: 1, status: "new", lineName: "はなこ", realName: null },
  { row: 2, status: "invalid", invalidReason: "line_name_empty" },
  { row: 3, status: "already_imported", lineName: "じろう" },
  { row: 4, status: "erased" },
]);

const routes = [
  { path: "/people/import", element: <ImportPage /> },
  { path: "/people/events/:eventId", element: <p>イベントのページ</p> },
];

/**
 * ファイルを選ぶ。
 * @param user - userEvent
 * @param file - ファイル
 */
async function upload(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText(/CSVのファイルを選ぶ/), file);
}

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.events.mockResolvedValue([EVENT_1011]);
  setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => setItem.mockRestore());

describe("取り込みの流れ", () => {
  it("ファイル → イベント → 列の対応 → 同意の選択肢 → 確かめ → 取り込む → 結果。読んだ行はブラウザに保存しない", async () => {
    const user = userEvent.setup();
    api.previewImport.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(MAPPED);
    api.commitImport.mockResolvedValue({ import: { id: "i1", rowCount: 5, importedCount: 2, createdPeopleCount: 2, linkedCount: 0, skippedCount: 3 } });
    renderRoutes(routes, "/people/import");

    // ① ファイル
    const input = screen.getByLabelText(/CSVのファイルを選ぶ/);
    expect(input).toHaveAttribute("accept", ".csv,text/csv");
    await upload(user, new File([csvText(ROWS)], "answers.csv", { type: "text/csv" }));

    // ② イベント
    const select = await screen.findByLabelText("どのイベントのアンケートですか");
    expect(screen.getByText("answers.csv（5行・5列）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    await screen.findByRole("option", { name: "10月11日 IT交流会（2026年10月11日）" });
    await user.selectOptions(select, "e1");
    await user.click(screen.getByRole("button", { name: "次へ" }));
    // 初めのプレビューは列の対応を送らない（APIが覚えたもの → 用意した質問文の順で埋める）
    expect(api.previewImport.mock.calls[0]![0]).toEqual({ eventId: "e1", headers: HEADERS, rows: ROWS });

    // ③ 列の対応：1列1行・見本の値・印
    const rows = await screen.findAllByTestId("mapping-row");
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent("LINE名を教えてください");
    expect(rows[1]).toHaveTextContent("例：たろう ／ はなこ ／ じろう");
    expect(rows[2]).toHaveTextContent("覚えた");
    expect(rows[0]).toHaveTextContent("初めから当てた");
    expect(rows[1]).not.toHaveTextContent("覚えた");
    expect(screen.getByText("LINE名の列を選んでください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("「LINE名を教えてください」の項目"), "line_name");
    expect(screen.queryByText("LINE名の列を選んでください")).not.toBeInTheDocument();
    // 知らない同意の選択肢の目的を選ぶまで進めない
    expect(screen.getByText("同意の選択肢の目的を選んでください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("「交流会の案内がほしい」の目的"), "invite");
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(api.previewImport.mock.calls[1]![0]).toEqual({
      eventId: "e1",
      headers: HEADERS,
      rows: ROWS,
      columns: MAPPED_COLUMNS.map((c) => c.field),
      consentChoices: { 交流会の案内がほしい: "invite" },
    });

    // ④ 確かめ：数
    const counts = await screen.findByRole("heading", { name: "取り込む前に確かめてください" });
    const list = within(counts.parentElement!);
    expect(list.getByText("新しく入る人").nextSibling).toHaveTextContent("2人");
    expect(list.getByText("同じ人の候補").nextSibling).toHaveTextContent("0組");
    expect(list.getByText("取り込めない行（LINE名が空）").nextSibling).toHaveTextContent("1件");
    expect(list.getByText("もう取り込んだ行").nextSibling).toHaveTextContent("1件");
    expect(list.getByText("消した人の行（取り込みません）").nextSibling).toHaveTextContent("1件");
    await user.click(screen.getByRole("button", { name: "取り込む" }));

    // ⑤ 結果
    expect(await screen.findByRole("heading", { name: "取り込みました" })).toBeInTheDocument();
    expect(api.commitImport.mock.calls[0]![0]).toEqual({
      eventId: "e1",
      headers: HEADERS,
      rows: ROWS,
      columns: MAPPED_COLUMNS.map((c) => c.field),
      consentChoices: { 交流会の案内がほしい: "invite" },
      decisions: [],
    });
    expect(screen.getByText("新しく入った人").nextSibling).toHaveTextContent("2人");
    expect(screen.getByRole("link", { name: "イベントのページを見る" })).toHaveAttribute("href", "/people/events/e1");
    // 読んだ行（名前・答え）をブラウザの保存に書かない（R18）
    const written = (setItem.mock.calls as string[][]).map((c) => c.join(" ")).join("\n");
    for (const v of ["たろう", "山田太郎", "はなこ", "LINE名を教えてください"]) expect(written).not.toContain(v);
    expect(sessionStorage.length).toBe(0);
    expect(Object.keys(localStorage).every((k) => !localStorage.getItem(k)?.includes("たろう"))).toBe(true);
    // 結果の画面では、読んだ行をもう持たない（ファイルの名前も出さない）
    expect(screen.queryByText(/answers\.csv/)).not.toBeInTheDocument();
  });

  it("イベントは、取り込みの画面の中で作れる", async () => {
    const user = userEvent.setup();
    api.createEvent.mockResolvedValue({ id: "e9", name: "12月6日 IT交流会", heldOn: "2026-12-06", isOwn: true });
    renderRoutes(routes, "/people/import");
    await upload(user, new File([csvText(ROWS)], "answers.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: /新しいイベントを作る/ }));
    await user.type(screen.getByLabelText("イベントの名前"), "12月6日 IT交流会");
    await user.click(screen.getByRole("button", { name: "作る" }));
    await waitFor(() => expect(screen.getByLabelText("どのイベントのアンケートですか")).toHaveValue("e9"));
    expect(api.createEvent.mock.calls[0]![0]).toMatchObject({ name: "12月6日 IT交流会", isOwn: true });
    expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();
  });
});

describe("読めないファイル（research.md R4）", () => {
  it("ZIPのまま上げたら、展開するか、スプレッドシートからCSVで書き出すよう案内する", async () => {
    const user = userEvent.setup();
    renderRoutes(routes, "/people/import");
    await upload(user, new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])], "answers.csv", { type: "text/csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ZIPのまま上げられました");
    expect(screen.getByRole("alert")).toHaveTextContent("カンマ区切り形式（.csv）");
    expect(api.events).not.toHaveBeenCalled();
  });

  it("UTF-8でもShift_JISでも読めなければ、CSV形式でダウンロードしたファイルを上げるよう案内する", async () => {
    const user = userEvent.setup();
    renderRoutes(routes, "/people/import");
    await upload(user, new File([new Uint8Array([0xff, 0xfe, 0xfd])], "answers.csv", { type: "text/csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Googleフォームの回答のスプレッドシートから『CSV形式でダウンロード』したファイルを上げてください",
    );
  });

  it("1MBを超えるファイルは読まずに「ファイルが大きすぎます（1MBまで）」", async () => {
    const user = userEvent.setup();
    renderRoutes(routes, "/people/import");
    const big = new File([new Uint8Array(1_000_001)], "answers.csv", { type: "text/csv" });
    const read = vi.spyOn(big, "arrayBuffer");
    await upload(user, big);
    expect(await screen.findByRole("alert")).toHaveTextContent("ファイルが大きすぎます（1MBまで）");
    expect(read).not.toHaveBeenCalled();
  });

  it("Shift_JIS（Excelで保存し直したもの）も読める", async () => {
    const user = userEvent.setup();
    renderRoutes(routes, "/people/import");
    // 「名前\r\nたろう」を Shift_JIS で
    const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x0d, 0x0a, 0x82, 0xbd, 0x82, 0xeb, 0x82, 0xa4]);
    await upload(user, new File([sjis], "answers.csv", { type: "text/csv" }));
    expect(await screen.findByText("answers.csv（1行・1列）")).toBeInTheDocument();
  });
});
