// 取り込みの①ファイルを選ぶ（specs/people/001-people-memo contracts/ui-routes.md 2、research.md R4・R18）。
// 読んだ見出しと行は、親の画面のメモリーにだけ渡す。
import { useId, useState } from "react";
import { readCsvFile } from "../../lib/read-csv-file";

/**
 * ファイルを選ぶ段。
 * @param props - onRead：読めたとき（見出し・行・ファイルの名前）
 * @returns ファイルを選ぶ段
 */
export function FileStep({ onRead }: { onRead: (csv: { headers: string[]; rows: string[][]; fileName: string }) => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Googleフォームの回答のスプレッドシートから「ファイル → ダウンロード → カンマ区切り形式（.csv）」で書き出したファイルを選んでください。ファイルはこの端末の中で読み、そのままは送りません。
      </p>
      <label
        htmlFor={id}
        className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed bg-card px-4 py-6 text-center text-sm hover:bg-accent"
      >
        <span className="font-medium">CSVのファイルを選ぶ</span>
        <span className="text-muted-foreground">1MBまで・500行まで</span>
      </label>
      <input
        id={id}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={reading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // 同じファイルを選び直しても読めるよう、選んだものを空にする
          e.target.value = "";
          if (!file) return;
          setReading(true);
          setError(null);
          const result = await readCsvFile(file).catch(() => ({ ok: false as const, message: "ファイルを読めませんでした。もう一度選んでください" }));
          setReading(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onRead({ headers: result.headers, rows: result.rows, fileName: file.name });
        }}
      />
      {reading && <p className="text-sm text-muted-foreground">読んでいます…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
