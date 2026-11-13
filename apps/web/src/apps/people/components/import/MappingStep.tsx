// 取り込みの③列の対応と同意の選択肢（specs/people/001-people-memo contracts/ui-routes.md 2、research.md R6・R7）。
// 1列を1行で出す（見出し・最初の3つの値の見本・項目の選択）。覚えた対応・初めから当てた対応には小さな印。
// LINE名の列が選ばれていなければ「LINE名の列を選んでください」を出して次へ進めない。
import { CONSENT_PURPOSES, IMPORT_FIELD_LABELS, IMPORT_FIELDS, type ConsentPurpose, type ImportColumn, type ImportField } from "@meguru/shared/people";
import { Button } from "@/components/ui/button";
import { fieldClass } from "../EventForm";
import { mappingProblems } from "./import-state";

/** 同意の選択肢の目的の名前。 */
export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  invite: "交流会への誘いに同意",
  work: "仕事の相談先へのつなぎに同意",
  decline: "個別の案内は希望しない",
  ignore: "同意に関わらない",
};

/** 対応の印。 */
const SOURCE_MARKS: Partial<Record<ImportColumn["source"], string>> = { remembered: "覚えた", preset: "初めから当てた" };

/**
 * 列の見本（最初の3つの空でない値）。
 * @param rows - 行
 * @param index - 列の番号
 * @returns 見本
 */
function samplesOf(rows: readonly string[][], index: number): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const v = r[index] ?? "";
    if (v !== "") out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * 列の対応の段。
 * @param props - headers・rows：読んだCSV、suggested：プレビューが返した列の対応（印に使う）、columns：今の対応、onColumns：対応を変えたとき、
 *   unknownChoices：対応のない同意の選択肢、consentChoices：選んだ目的、onConsentChoices：目的を変えたとき、
 *   notice：上に出す知らせ、pending：次へ進む処理の途中、error：失敗の文言、onBack：戻る、onNext：次へ
 * @returns 列の対応の段
 */
export function MappingStep({
  headers,
  rows,
  suggested,
  columns,
  onColumns,
  unknownChoices,
  consentChoices,
  onConsentChoices,
  notice,
  pending,
  error,
  onBack,
  onNext,
}: {
  headers: string[];
  rows: string[][];
  suggested: ImportColumn[];
  columns: (ImportField | null)[];
  onColumns: (next: (ImportField | null)[]) => void;
  unknownChoices: string[];
  consentChoices: Record<string, ConsentPurpose>;
  onConsentChoices: (next: Record<string, ConsentPurpose>) => void;
  notice: string | null;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const { problems, duplicated } = mappingProblems(columns);
  const consentPending = unknownChoices.some((c) => !consentChoices[c]);
  return (
    <div className="space-y-6">
      {notice && (
        <p role="status" className="rounded-xl border bg-warning-bg px-3 py-2 text-sm text-warning">
          {notice}
        </p>
      )}
      <section aria-labelledby="mapping-heading" className="space-y-2">
        <h3 id="mapping-heading" className="text-sm font-medium">
          列ごとに、何の答えかを選んでください
        </h3>
        <ul className="divide-y rounded-2xl border bg-card">
          {headers.map((h, i) => {
            const s = suggested[i];
            const mark = s && s.field !== null && s.field === columns[i] ? SOURCE_MARKS[s.source] : undefined;
            const samples = samplesOf(rows, i);
            return (
              <li key={i} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4" data-testid="mapping-row">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="break-words text-sm font-medium">{h || `（見出しのない列 ${i + 1}）`}</div>
                  <div className="truncate text-xs text-muted-foreground">{samples.length > 0 ? `例：${samples.join(" ／ ")}` : "（答えがありません）"}</div>
                </div>
                <div className="flex items-center gap-2 md:w-64">
                  <select
                    aria-label={`「${h}」の項目`}
                    className={fieldClass}
                    value={columns[i] ?? ""}
                    onChange={(e) => {
                      const next = [...columns];
                      next[i] = (e.target.value || null) as ImportField | null;
                      onColumns(next);
                    }}
                  >
                    <option value="">選んでください</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {IMPORT_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  {mark && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{mark}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {unknownChoices.length > 0 && (
        <section aria-labelledby="consent-heading" className="space-y-2">
          <h3 id="consent-heading" className="text-sm font-medium">
            個別の案内の同意の選択肢が、どの目的かを選んでください
          </h3>
          <ul className="divide-y rounded-2xl border bg-card">
            {unknownChoices.map((c) => (
              <li key={c} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
                <div className="min-w-0 flex-1 break-words text-sm">{c}</div>
                <select
                  aria-label={`「${c}」の目的`}
                  className={`${fieldClass} md:w-64`}
                  value={consentChoices[c] ?? ""}
                  onChange={(e) => {
                    const next = { ...consentChoices };
                    if (e.target.value) next[c] = e.target.value as ConsentPurpose;
                    else delete next[c];
                    onConsentChoices(next);
                  }}
                >
                  <option value="">選んでください</option>
                  {CONSENT_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {CONSENT_PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-1 text-sm text-destructive" role="alert">
        {problems.includes("line_name_missing") && <p>LINE名の列を選んでください</p>}
        {problems.includes("duplicate_field") && <p>同じ項目に2つ以上の列が選ばれています：{duplicated.map((f) => IMPORT_FIELD_LABELS[f]).join("、")}</p>}
        {problems.includes("unselected") && <p>項目を選んでいない列があります（どれにもあたらなければ「そのほか」を選んでください）</p>}
        {consentPending && <p>同意の選択肢の目的を選んでください</p>}
        {error && <p>{error}</p>}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="outline" className="h-11 rounded-full md:h-10" onClick={onBack}>
          戻る
        </Button>
        <Button className="h-11 rounded-full md:h-10" disabled={problems.length > 0 || consentPending || pending} onClick={onNext}>
          次へ
        </Button>
      </div>
    </div>
  );
}
