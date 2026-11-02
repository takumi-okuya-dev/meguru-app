// CSVで書き出す（specs/006-performance-feedback FR-028〜FR-030、contracts/ui-routes.md・csv.md、research.md R7）。
// APIから200件ずつ読み、ブラウザでCSVに組み立てて保存させる。
import {
  PERFORMANCE_MESSAGES,
  POST_EXPORT_HEADER,
  SNAPSHOT_EXPORT_HEADER,
  csvFileName,
  postExportCells,
  snapshotExportCells,
  toCsv,
  type CsvCell,
  type PostExportRow,
  type SnapshotExportRow,
} from "@threads-grower/shared";
import { ChevronDownIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";

type Kind = "posts" | "snapshots";

/**
 * 書き出しの行をすべて読み、CSVの全文を作る。
 * @param accountId - AccountのID
 * @param kind - 投稿ごとか取り込みごとか
 * @returns CSVの全文
 */
async function buildCsv(accountId: string, kind: Kind): Promise<string> {
  const cells: CsvCell[][] = [];
  let before: string | undefined;
  do {
    const page = await api.exportPerformance(accountId, kind, before);
    for (const row of page.rows) {
      cells.push(
        kind === "posts" ? postExportCells(row as PostExportRow) : snapshotExportCells(row as SnapshotExportRow),
      );
    }
    before = page.nextCursor ?? undefined;
  } while (before);
  return toCsv(kind === "posts" ? POST_EXPORT_HEADER : SNAPSHOT_EXPORT_HEADER, cells);
}

/**
 * ファイルを保存させる。
 * @param text - 中身
 * @param fileName - ファイル名
 */
function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 「CSVで書き出す」のメニュー。スマートフォンではアイコンだけのボタンにする。
 * @param props - accountId：AccountのID、username：ファイル名に使う名前（Threadsのユーザー名。なければアカウントの名前。specs/012）
 * @returns メニュー
 */
export function CsvExportMenu({ accountId, username }: { accountId: string; username: string }) {
  const [busy, setBusy] = useState(false);
  const run = async (kind: Kind) => {
    setBusy(true);
    try {
      download(await buildCsv(accountId, kind), csvFileName(username, kind, new Date()));
    } catch {
      toast.error(PERFORMANCE_MESSAGES.exportFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full" disabled={busy} aria-label="CSVで書き出す">
          <DownloadIcon className="size-4" aria-hidden="true" />
          <span className="hidden md:inline"><SwapLabel labels={{ idle: "CSVで書き出す", busy: "書き出し中…" }} show={busy ? "busy" : "idle"} /></span>
          <ChevronDownIcon className="hidden size-3.5 md:inline" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuItem onSelect={() => void run("posts")} className="flex flex-col items-start gap-0.5">
          <span className="font-semibold">投稿ごと</span>
          <span className="text-xs text-muted-foreground">1投稿1行。確定（または最新）の値と、24時間時点の値・投稿時点のフォロワー数など</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run("snapshots")} className="flex flex-col items-start gap-0.5">
          <span className="font-semibold">取り込みごと</span>
          <span className="text-xs text-muted-foreground">取り込み1回1行。投稿からの経過時間ごとの伸び方（推移）を見るとき</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
