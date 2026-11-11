// 課題の画面（specs/002 US1、contracts/ui-routes.md「課題の画面」、docs/ui-design.md 型A）。
// 全項目を1つの画面に区分見出し付きで並べ、上部バーの「保存」1つでまとめて保存する。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  STRATEGY_FIELDS,
  STRATEGY_SECTIONS,
  STRATEGY_TEXT_KEYS,
  STRATEGY_TEXT_MAX,
  STRATEGY_TOTAL,
  TONE_PRESETS,
  SHORT_TIP,
  PURPOSE_KEYS,
  SPARRING_SECTION_IDS,
  buildAxisPrompt,
  buildDeepenPrompt,
  buildOverallPrompt,
  checkStrategy,
  countChars,
  hintOf,
  type Strategy,
  type HintedKey,
  type SparringSectionId,
  type StrategyValues,
  type TonePreset,
} from "@meguru/shared";
import { EllipsisIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConflictDialog } from "@/components/ConflictDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { CopyPromptStatus, CopyPromptTrigger, useCopyPrompt } from "@/components/CopyPromptButton";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { DeepenPanel } from "@/components/strategy/DeepenPanel";
import { FieldCheckBadge } from "@/components/strategy/FieldCheckBadge";
import { HintPanel } from "@/components/strategy/HintPanel";
import { ProgressCard } from "@/components/strategy/ProgressCard";
import { SparringDialog, sparringTitle } from "@/components/strategy/SparringDialog";
import { SectionChips, sectionElementId } from "@/components/strategy/SectionChips";
import { BillingRequiredDialog } from "@/components/billing/BillingRequiredDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { billingReasonOf, isBillingRequired, isStale, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

function pickValues(s: Strategy): StrategyValues {
  const values = Object.fromEntries(STRATEGY_TEXT_KEYS.map((k) => [k, s[k]])) as StrategyValues;
  values.tonePreset = s.tonePreset;
  return values;
}

function sameValues(a: StrategyValues, b: StrategyValues): boolean {
  return a.tonePreset === b.tonePreset && STRATEGY_TEXT_KEYS.every((k) => a[k] === b[k]);
}

/**
 * 項目へ移り、直せる人なら入力欄にカーソルを入れる（次におすすめ。FR-015、SC-003）。
 * @param key - 項目のキー
 * @param focus - 入力欄にカーソルを入れるか
 */
function goToField(key: string, focus: boolean) {
  document.getElementById(`field-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  if (focus) document.getElementById(`strategy-${key}`)?.focus({ preventScroll: true });
}

/**
 * 課題の画面。
 * @returns 課題の画面
 */
export function StrategyPage() {
  const account = useCurrentAccount();
  const query = useQuery({ queryKey: queryKeys.strategy(account.id), queryFn: () => api.getStrategy(account.id) });

  if (query.isError) return <ApiErrorScreen error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <>
        <PageHeader title="課題" />
        <PageBody>
          <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        </PageBody>
      </>
    );
  }
  // 読み込んだ課題ごとに編集の状態を作り直す（key で入れ替える）
  return <StrategyEditor key={`${account.id}`} accountId={account.id} initial={query.data} />;
}

function StrategyEditor({ accountId, initial }: { accountId: string; initial: Strategy }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<Strategy>(initial);
  const [values, setValues] = useState<StrategyValues>(() => pickValues(initial));
  const [canEdit, setCanEdit] = useState(initial.canEdit);
  const [conflict, setConflict] = useState<Strategy | null>(null);
  // 先に保存した人（specs/008 FR-007）
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  const [billingReason, setBillingReason] = useState<string | null>(null);
  // AIと深掘りする欄を開いている項目（同時に1つだけ。FR-031）
  const [deepenKey, setDeepenKey] = useState<string | null>(null);
  // 深掘りの欄に、まだ反映していない答えがあるか。あれば閉じる・切り替えの前に確かめる（PR #17 のCodexレビュー）
  const [deepenDirty, setDeepenDirty] = useState(false);
  const [confirmDeepen, setConfirmDeepen] = useState<{ next: string | null } | null>(null);
  // 「AIと考える」のポップアップを開いている区分（specs/018。2026-11-04に区分ごとにした）。深掘りの欄とは別に持つ
  const [sparringSection, setSparringSection] = useState<SparringSectionId | null>(null);
  const [sparringDirty, setSparringDirty] = useState(false);
  const [confirmSparring, setConfirmSparring] = useState(false);
  const closeSparring = () => {
    if (sparringDirty) return setConfirmSparring(true);
    setSparringSection(null);
  };

  // 深掘りの欄を開く・閉じる・切り替える
  const requestDeepen = (next: string | null) => {
    if (deepenDirty && next !== deepenKey) return setConfirmDeepen({ next });
    setDeepenKey(next);
  };

  // ほかの画面の「編集」（#field-<key>）から来たら、その項目へ移る（specs/014 FR-122）
  const { hash } = useLocation();
  const editable = initial.canEdit;
  useEffect(() => {
    const key = /^#field-(\w+)$/.exec(hash)?.[1];
    if (key) goToField(key, editable);
  }, [hash, editable]);

  const baseline = pickValues(saved);
  const dirty = canEdit && !sameValues(values, baseline);
  useUnsavedChanges(dirty);
  // 「全体をAIと整理する」。結果の文はカードの下に出す（ボタンを動かさない）
  const overall = useCopyPrompt({ getText: () => buildOverallPrompt(values) });
  const overLimit = STRATEGY_TEXT_KEYS.some((k) => countChars(values[k]) > STRATEGY_TEXT_MAX);
  // 自動チェック（入力のたびに、保存を待たずに求める。FR-012）
  const check = checkStrategy(values);
  const nextField = check.next ? STRATEGY_FIELDS.find((f) => f.key === check.next) : undefined;
  // 活動の軸の「5問からAIと整理する」は、5問のどれかに答えがあるときだけ押せる（FR-036）
  const purposeAnswered = PURPOSE_KEYS.some((k) => k !== "activityAxis" && values[k].trim() !== "");

  const applySaved = (s: Strategy, keepInput = false) => {
    setSaved(s);
    if (!keepInput) setValues(pickValues(s));
    queryClient.setQueryData(queryKeys.strategy(accountId), s);
  };

  // 送った内容（payload）を変数として持ち、保存中に入力が続いても、その分を消さない
  const save = useMutation({
    mutationFn: ({ payload, expectedVersion }: { payload: StrategyValues; expectedVersion: number }) =>
      api.putStrategy(accountId, { ...payload, expectedVersion }),
    onSuccess: (s, { payload }) => {
      setSaved(s);
      queryClient.setQueryData(queryKeys.strategy(accountId), s);
      // 保存中に入力が続いていなければ、保存後の値（空白だけの項目は空になる）に合わせる。
      // 続いていれば、その入力は残す（保存後の値との差分として、未保存の変更のまま）
      setValues((current) => (sameValues(current, payload) ? pickValues(s) : current));
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileStatus(accountId) });
      toast.success("保存しました");
    },
    onError: (err) => {
      if (isStale(err)) {
        setConflictBy(err.updatedBy?.name ?? null);
        // サーバーの latest には canEdit がないことがあるので、いまの値で補う（保存できた＝編集できる）
        setConflict({ ...(err.latest as Strategy), canEdit: true });
      } else if (isBillingRequired(err)) {
        setBillingReason(billingReasonOf(err) ?? "");
      } else {
        toast.error(saveErrorMessage(err), { action: { label: "もう一度保存", onClick: () => submit(saved.version) } });
      }
    },
  });

  const submit = (expectedVersion: number) => save.mutate({ payload: values, expectedVersion });

  const set = <K extends keyof StrategyValues>(key: K, value: StrategyValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const actions = canEdit ? (
    <>
      <span className="hidden text-[13px] text-muted-foreground md:inline">
        完了 {check.done}/{STRATEGY_TOTAL} ・ 要確認 {check.review} ・ 目的 {check.purposeDone}/5問
      </span>
      {saved.updatedAt && (
        <span className="hidden text-[13px] text-muted-foreground lg:inline">
          最終更新：{formatDateTime(saved.updatedAt)}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="hidden size-9 md:inline-flex" aria-label="その他の操作">
            <EllipsisIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!dirty} onSelect={() => setValues(baseline)}>
            変更を破棄
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        className="h-9 rounded-full px-4 md:px-5"
        disabled={!dirty || overLimit || save.isPending}
        onClick={() => submit(saved.version)}
      >
        保存
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader title="課題" actions={actions} toolbar={<SectionChips check={check} />} />
      <PageBody className="pb-24">
        <p className={cn("text-[15px] text-muted-foreground", !canEdit && "mt-4")}>
          ここに書いた内容が、投稿づくりの材料になります。空欄があっても保存できます。
        </p>
        <ProgressCard
          check={check}
          nextLabel={nextField?.label ?? null}
          onNext={() => check.next && goToField(check.next, canEdit)}
          actions={
            canEdit && (
              <>
                <CopyPromptTrigger
                  variant="outline"
                  label="全体をAIと整理する"
                  disabled={overall.loading}
                  onClick={() => void overall.copy()}
                />
              </>
            )
          }
          below={
            <>
              <CopyPromptStatus
                state={overall.state}
                copiedMessage="コピーしました。ChatGPTやClaudeに貼り付けて送ると、項目どうしの重複・矛盾・抜けを質問の形で返してくれます"
              />

            </>
          }
        />
        <div className="mt-9 space-y-11">
          {STRATEGY_SECTIONS.map((section) => (
            <section key={section.id} id={sectionElementId(section.id)} className="scroll-mt-36 space-y-5">
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{section.title}</h2>
                {/* 区分ごとに「AIと考える」（下書きは対象にしない。specs/018 FR-006）。押すとポップアップ */}
                {canEdit && isSparringSection(section.id) && <ThinkButton section={section.id} onOpen={setSparringSection} />}
              </div>
              {section.id === "purpose" && (
                <p className="-mt-3 text-[13px] text-muted-foreground">
                  何のために発信するかを先に決めると、ほかの項目が書きやすくなります。ここに書いた内容も、投稿づくりの材料になります。
                </p>
              )}
              {section.id === "drafts" && (
                <p className="-mt-3 text-[13px] text-muted-foreground">
                  Threadsには自動で反映されない下書きです。投稿づくりでは、投稿の方向性の軸として使います。
                </p>
              )}
              {STRATEGY_FIELDS.filter((f) => f.section === section.id).map((f) => {
                const hint = hintOf(f.key);
                const item = (check.items as Partial<typeof check.items>)[f.key as keyof typeof check.items];
                return (
                  <div key={f.key} id={`field-${f.key}`} className="scroll-mt-36">
                    {f.key === "tonePreset" ? (
                      <ToneSelect
                        label={f.label}
                        description={f.description}
                        value={values.tonePreset}
                        disabled={!canEdit}
                        onChange={(v) => set("tonePreset", v)}
                        badge={item && <FieldCheckBadge status={item.status} />}
                      >
                        {hint && <HintPanel hint={hint} className="pt-1" />}
                      </ToneSelect>
                    ) : (
                      <FieldWithCounter
                        id={`strategy-${f.key}`}
                        label={f.label}
                        description={f.description}
                        placeholder={f.placeholder}
                        rows={f.rows}
                        max={STRATEGY_TEXT_MAX}
                        value={values[f.key as keyof typeof values] as string}
                        readOnly={!canEdit}
                        onChange={(v) => set(f.key as (typeof STRATEGY_TEXT_KEYS)[number], v)}
                        hint={item?.status === "short" ? (hint?.shortTip ?? SHORT_TIP) : undefined}
                        labelExtra={
                          <>
                            {hint?.star && (
                              <span className="rounded-full bg-foreground px-2 py-px text-[11px] font-medium text-background">
                                ★ 特に大事
                              </span>
                            )}
                            {f.key === "activityAxis" && (
                              <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">任意</span>
                            )}
                            {item && <FieldCheckBadge status={item.status} />}
                          </>
                        }
                        aside={
                          hint?.starNote && (
                            <p className="rounded-xl bg-muted/60 px-3 py-2 text-[13px] leading-relaxed">{hint.starNote}</p>
                          )
                        }
                      >
                        {(hint || canEdit) && (
                          <HintPanel
                            hint={hint}
                            className="pt-1"
                            actions={
                              canEdit && f.key === "activityAxis" ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={!purposeAnswered}
                                    aria-expanded={deepenKey === f.key}
                                    onClick={() => requestDeepen(deepenKey === f.key ? null : f.key)}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-accent disabled:opacity-50"
                                  >
                                    <SparklesIcon className="size-4" aria-hidden="true" />
                                    5問からAIと整理する
                                  </button>
                                  {!purposeAnswered && (
                                    <span className="self-center text-[13px] text-muted-foreground">
                                      先にQ1〜Q5のどれかに答えてください
                                    </span>
                                  )}
                                </>
                              ) : (
                                canEdit &&
                                hint && (
                                <button
                                  type="button"
                                  aria-expanded={deepenKey === f.key}
                                  onClick={() => requestDeepen(deepenKey === f.key ? null : f.key)}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-accent"
                                >
                                  <SparklesIcon className="size-4" aria-hidden="true" />
                                  AIと深掘り
                                </button>
                                )
                              )
                            }
                            below={
                              canEdit &&
                              deepenKey === f.key &&
                              (hint || f.key === "activityAxis") && (
                                <DeepenPanel
                                  getPrompt={() =>
                                    f.key === "activityAxis" ? buildAxisPrompt(values) : buildDeepenPrompt(f.key as HintedKey, values)
                                  }
                                  steps={
                                    f.key === "activityAxis"
                                      ? [
                                          "「プロンプトをコピーする」を押す",
                                          "ChatGPTやClaudeに貼り付けて送り、3つの案から選ぶ（直してもらってもよい）",
                                          "決めた一言を、答えごと下に貼り付けて「この内容を反映する」",
                                        ]
                                      : undefined
                                  }
                                  onApply={(text) => {
                                    set(f.key as (typeof STRATEGY_TEXT_KEYS)[number], text);
                                    setDeepenDirty(false);
                                    setDeepenKey(null);
                                  }}
                                  onClose={() => requestDeepen(null)}
                                  onDirtyChange={setDeepenDirty}
                                />
                              )
                            }
                          />
                        )}
                      </FieldWithCounter>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </PageBody>

      {canEdit && sparringSection && (
        <SparringDialog
          section={sparringSection}
          values={values}
          check={check}
          onApply={(patch) => {
            setValues((v) => ({ ...v, ...patch }));
            setSparringDirty(false);
            setSparringSection(null);
          }}
          onRequestClose={closeSparring}
          onDirtyChange={setSparringDirty}
        />
      )}
      <UnsavedChangesDialog
        open={confirmSparring}
        title="貼り付けたAIの答えがあります。破棄しますか？"
        description="まだ入力欄に反映していません。破棄すると失われます。"
        discardLabel="破棄して閉じる"
        onStay={() => setConfirmSparring(false)}
        onDiscard={() => {
          setConfirmSparring(false);
          setSparringDirty(false);
          setSparringSection(null);
        }}
      />
      <UnsavedChangesDialog
        open={confirmDeepen !== null}
        title="貼り付けたAIの答えがあります。破棄しますか？"
        description="まだ入力欄に反映していません。破棄すると失われます。"
        discardLabel="破棄して閉じる"
        onStay={() => setConfirmDeepen(null)}
        onDiscard={() => {
          const next = confirmDeepen?.next ?? null;
          setConfirmDeepen(null);
          setDeepenDirty(false);
          setDeepenKey(next);
        }}
      />
      <ConflictDialog
        open={conflict !== null}
        updatedAt={conflict?.updatedAt ?? null}
        updatedByName={conflictBy}
        onCancel={() => setConflict(null)}
        onReload={() => {
          if (conflict) applySaved(conflict);
          setConflict(null);
        }}
        onOverwrite={() => {
          if (conflict) {
            // 入力内容はそのままに、最新の version で保存し直す
            applySaved(conflict, true);
            submit(conflict.version);
          }
          setConflict(null);
        }}
      />
      <BillingRequiredDialog
        reason={billingReason}
        onClose={() => {
          setBillingReason(null);
          setCanEdit(false);
          // 読むだけになったら、「AIと考える」も閉じる（直せないので、貼った答えは使えない）
          setSparringSection(null);
          setSparringDirty(false);
        }}
      />
    </>
  );
}

/**
 * 「AIと考える」を置く区分か（下書きは対象にしない。specs/018 FR-006）。
 * @param id - 区分の ID
 * @returns 置くなら true
 */
function isSparringSection(id: string): id is SparringSectionId {
  return (SPARRING_SECTION_IDS as readonly string[]).includes(id);
}

/**
 * 区分の見出しの横の「AIと考える」（今ある「AIと壁打ちして埋める」と同じ枠線のボタン。押すとポップアップ）。
 * @param props - section：区分、onOpen：開く
 * @returns ボタン
 */
function ThinkButton({ section, onOpen }: { section: SparringSectionId; onOpen: (s: SparringSectionId) => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-9 shrink-0 rounded-full px-3.5 text-[13px]"
      aria-label={sparringTitle(section)}
      onClick={() => onOpen(section)}
    >
      AIと考える
    </Button>
  );
}

function ToneSelect({
  label,
  description,
  value,
  disabled,
  onChange,
  badge,
  children,
}: {
  label: string;
  description: string;
  value: TonePreset | null;
  disabled: boolean;
  onChange: (v: TonePreset | null) => void;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor="strategy-tonePreset" className="font-medium">
          {label}
        </label>
        {badge}
      </div>
      <p className="text-[13px] text-muted-foreground">{description}</p>
      <div className="pt-1">
        <select
          id="strategy-tonePreset"
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange((e.target.value || null) as TonePreset | null)}
          className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:w-80 md:text-[15px]"
        >
          <option value="">（未選択）</option>
          {TONE_PRESETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {children}
    </div>
  );
}
