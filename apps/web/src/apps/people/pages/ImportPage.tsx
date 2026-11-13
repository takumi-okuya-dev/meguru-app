// 「/people/import」：取り込み（specs/people/001-people-memo contracts/ui-routes.md 2、research.md R4・R5・R18）。
// ①ファイルを選ぶ ②どのイベントか ③列の対応と同意の選択肢 ④確かめ ⑤結果。
// 読んだ行はこの画面のメモリー（React の状態）にだけ置き、ブラウザの保存に書かない。画面を離れたら（部品が消えたら）捨てる。
// 取り込みの途中のデータはAPIにも置かない（状態を持たない2段階。プレビュー → 取り込む）。
import { errorMessage } from "@meguru/shared";
import type { ConsentPurpose, ImportColumn, ImportField, ImportPreview, ImportResult } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, describeError } from "@/lib/api-client";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/shell";
import { ConfirmStep } from "../components/import/ConfirmStep";
import { EventStep } from "../components/import/EventStep";
import { FileStep } from "../components/import/FileStep";
import { decisionGroups, groupDecided, keepValidDecisions, toDecisionList, type DecisionMap } from "../components/import/import-state";
import { MappingStep } from "../components/import/MappingStep";
import { ResultStep } from "../components/import/ResultStep";
import { peopleApi } from "../lib/api";
import { peopleQueryKeys } from "../lib/query-keys";

/** 段。 */
type Step = "file" | "event" | "mapping" | "confirm" | "result";

/** 段の名前（上の道しるべ）。 */
const STEPS: { step: Step; label: string }[] = [
  { step: "file", label: "ファイル" },
  { step: "event", label: "イベント" },
  { step: "mapping", label: "列の対応" },
  { step: "confirm", label: "確かめ" },
  { step: "result", label: "結果" },
];

/** 読んだCSV（メモリーにだけ置く）。 */
type Csv = { headers: string[]; rows: string[][]; fileName: string };

/**
 * 決めていない同意の選択肢。
 * @param preview - プレビュー
 * @param choices - 選んだ目的
 * @returns 決めていない選択肢
 */
function pendingChoices(preview: ImportPreview, choices: Record<string, ConsentPurpose>): string[] {
  return preview.unknownConsentChoices.filter((c) => !choices[c]);
}

/**
 * 取り込みの画面。
 * @returns 画面
 */
export function ImportPage() {
  const queryClient = useQueryClient();
  const oneAtATime = !useMediaQuery(MD_QUERY);
  const [step, setStep] = useState<Step>("file");
  const [csv, setCsv] = useState<Csv | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // プレビューが初めに返した列の対応（覚えた・初めから当てたの印に使う）
  const [suggested, setSuggested] = useState<ImportColumn[]>([]);
  const [columns, setColumns] = useState<(ImportField | null)[]>([]);
  const [consentChoices, setConsentChoices] = useState<Record<string, ConsentPurpose>>({});
  // 同意の選択肢を選ぶ欄に出すもの（一度出したものは、選び終わっても出しておく）
  const [shownChoices, setShownChoices] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<DecisionMap>(new Map());
  const [groupIndex, setGroupIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const showChoices = (p: ImportPreview) => setShownChoices((prev) => [...new Set([...prev, ...p.unknownConsentChoices])]);

  /**
   * プレビューを読む（列の対応を決めたあとは、決めた対応と同意の選択肢も送る）。
   * @param withColumns - 決めた対応を送るか
   * @returns プレビュー
   */
  const runPreview = (withColumns: boolean) =>
    peopleApi.previewImport({
      eventId: eventId!,
      headers: csv!.headers,
      rows: csv!.rows,
      ...(withColumns ? { columns, consentChoices } : {}),
    });

  /**
   * 新しいプレビューで、確かめの段の決めを読み直す。
   * @param next - 新しいプレビュー
   * @returns 残した決め
   */
  const adoptPreview = (next: ImportPreview) => {
    const kept = keepValidDecisions(preview, next, decisions);
    setPreview(next);
    setDecisions(kept);
    const first = decisionGroups(next).findIndex((g) => !groupDecided(g, kept));
    setGroupIndex(first >= 0 ? first : 0);
    return kept;
  };

  // ②→③：初めのプレビュー（列の対応は、覚えたもの → 初めから用意した質問文の順でAPIが埋める）
  const firstPreview = useMutation({
    mutationFn: () => runPreview(false),
    onSuccess: (p) => {
      setPreview(p);
      setSuggested(p.columns);
      setColumns(p.columns.map((c) => c.field));
      setDecisions(new Map());
      showChoices(p);
      setNotice(null);
      setStep("mapping");
    },
  });

  // ③→④：決めた対応でプレビューをやり直す
  const mappedPreview = useMutation({
    mutationFn: () => runPreview(true),
    onSuccess: (p) => {
      showChoices(p);
      if (p.mappingErrors.length > 0 || pendingChoices(p, consentChoices).length > 0) {
        setPreview(p);
        setNotice(p.mappingErrors.length > 0 ? errorMessage("IMPORT_MAPPING_INVALID").message : "同意の選択肢の目的を選んでください");
        return;
      }
      adoptPreview(p);
      setNotice(null);
      setStep("confirm");
    },
  });

  // ④：取り込む。409（プレビューのあとで人が増えた）なら読み直して、決めていない組に戻す
  const commit = useMutation({
    mutationFn: () =>
      peopleApi.commitImport({ eventId: eventId!, headers: csv!.headers, rows: csv!.rows, columns, consentChoices, decisions: toDecisionList(decisions) }),
    onSuccess: async (r) => {
      setResult(r);
      // 取り込みが終わったら、読んだ行を捨てる（R18）
      setCsv(null);
      setPreview(null);
      setDecisions(new Map());
      setStep("result");
      await queryClient.invalidateQueries({ queryKey: peopleQueryKeys.all });
    },
    onError: async (err) => {
      if (!(err instanceof ApiError)) return;
      if (err.code === "IMPORT_MAPPING_INVALID") {
        setNotice(describeError(err));
        setStep("mapping");
        return;
      }
      if (err.code !== "IMPORT_DECISIONS_REQUIRED") return;
      const next = await runPreview(true).catch(() => null);
      if (!next) return;
      showChoices(next);
      if (pendingChoices(next, consentChoices).length > 0 || next.mappingErrors.length > 0) {
        setPreview(next);
        setNotice(errorMessage("IMPORT_DECISIONS_REQUIRED").message);
        setStep("mapping");
        return;
      }
      adoptPreview(next);
      setNotice("取り込みの準備のあとで人が増えました。決めていない組を選び直してください。");
    },
  });

  const reset = () => {
    setStep("file");
    setCsv(null);
    setPreview(null);
    setSuggested([]);
    setColumns([]);
    setConsentChoices({});
    setShownChoices([]);
    setDecisions(new Map());
    setGroupIndex(0);
    setNotice(null);
    setResult(null);
    firstPreview.reset();
    mappedPreview.reset();
    commit.reset();
  };

  const current = STEPS.findIndex((s) => s.step === step);
  const commitError = commit.isError && !(commit.error instanceof ApiError && commit.error.code === "IMPORT_DECISIONS_REQUIRED") ? describeError(commit.error) : null;

  return (
    <>
      <PageHeader title="取り込み" />
      <PageBody className="space-y-6">
        <ol className="flex gap-1 text-xs" aria-label="取り込みの段">
          {STEPS.map((s, i) => (
            <li
              key={s.step}
              aria-current={i === current ? "step" : undefined}
              className={cn(
                "flex-1 border-t-2 pt-1.5 text-center",
                i <= current ? "border-foreground text-foreground" : "border-muted text-muted-foreground",
                i === current && "font-semibold",
              )}
            >
              {s.label}
            </li>
          ))}
        </ol>
        {csv && step !== "file" && (
          <p className="text-sm text-muted-foreground">
            {csv.fileName}（{csv.rows.length}行・{csv.headers.length}列）
          </p>
        )}

        {step === "file" && (
          <FileStep
            onRead={(read) => {
              setCsv(read);
              setPreview(null);
              setSuggested([]);
              setColumns([]);
              setConsentChoices({});
              setShownChoices([]);
              setDecisions(new Map());
              setStep("event");
            }}
          />
        )}
        {step === "event" && (
          <EventStep
            eventId={eventId}
            onSelect={setEventId}
            pending={firstPreview.isPending}
            error={firstPreview.isError ? describeError(firstPreview.error) : null}
            onBack={() => setStep("file")}
            onNext={() => firstPreview.mutate()}
          />
        )}
        {step === "mapping" && csv && (
          <MappingStep
            headers={csv.headers}
            rows={csv.rows}
            suggested={suggested}
            columns={columns}
            onColumns={setColumns}
            unknownChoices={shownChoices}
            consentChoices={consentChoices}
            onConsentChoices={setConsentChoices}
            notice={notice}
            pending={mappedPreview.isPending}
            error={mappedPreview.isError ? describeError(mappedPreview.error) : null}
            onBack={() => setStep("event")}
            onNext={() => mappedPreview.mutate()}
          />
        )}
        {step === "confirm" && preview && (
          <ConfirmStep
            preview={preview}
            decisions={decisions}
            onDecisions={setDecisions}
            oneAtATime={oneAtATime}
            index={groupIndex}
            onIndex={setGroupIndex}
            notice={notice}
            pending={commit.isPending}
            error={commitError}
            onBack={() => {
              setNotice(null);
              setStep("mapping");
            }}
            onCommit={() => commit.mutate()}
          />
        )}
        {step === "result" && result && eventId && <ResultStep result={result} eventId={eventId} onAgain={reset} />}
      </PageBody>
    </>
  );
}
