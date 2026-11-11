// 外部媒体展開の入力の画面と作業の画面（/accounts/:accountId/external-media/:promotionId/:media、作業は ?view=work。
// specs/021-external-media contracts/ui-routes.md 3・4、モック https://claude.ai/artifact/78VBSVeE19t3EqqvjckMRZ ）。
// 媒体の決まり（組み立て・ルールのチェック・STEP・プロンプト）は shared の media を呼ぶだけで、画面では決めない。作業の画面は保存しない。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IMAGE_STYLES,
  LISTING_STATUSES,
  LISTING_STATUS_LABELS,
  MEDIA,
  MEDIA_DEFINITIONS,
  MEDIA_LABELS,
  buildListing,
  checkListing,
  formatEventFee,
  formatEventPlace,
  formatEventWhen,
  imagePrompt,
  listingAsText,
  listingBodyKey,
  refixListing,
  workSteps,
  type ImageStyle,
  type ListingDetail,
  type ListingSource,
  type ListingStatus,
  type ListingValues,
  type Media,
  type Promotion,
} from "@meguru/shared";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConflictDialog } from "@/components/ConflictDialog";
import { CopyValueButton } from "@/apps/threads/components/external-media/CopyValueButton";
import { FieldCard } from "@/apps/threads/components/external-media/FieldCard";
import { PolishDialog } from "@/apps/threads/components/external-media/PolishDialog";
import { RuleCheck } from "@/apps/threads/components/external-media/RuleCheck";
import { WorkSteps } from "@/apps/threads/components/external-media/WorkSteps";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageBody, PageHeader } from "@/shell";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { isStale, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/apps/threads/pages/account-layout";
import { ExternalMediaForbidden } from "@/apps/threads/pages/external-media";
import { NotFound } from "@/shell";

/**
 * 宣伝内容と既定値から、掲載内容を作る材料にする。
 * @param p - 宣伝内容
 * @param defaults - 媒体の既定値
 * @returns 材料
 */
function sourceOf(p: Promotion, defaults: ListingValues): ListingSource {
  return {
    title: p.title,
    content: p.content,
    targetLocation: p.targetLocation,
    targetPersona: p.targetPersona,
    targetAgeRange: p.targetAgeRange,
    cta: p.cta,
    linkedUrl: p.linkedUrl,
    event: p.event,
    defaults,
  };
}

/** 画面で直している内容（保存の前）。 */
type Draft = {
  fields: ListingValues;
  status: ListingStatus;
  postedUrl: string;
  imageStyle: ImageStyle;
};

/**
 * 応答から、直す前の内容を作る。
 * @param d - 応答
 * @returns 内容
 */
const draftOf = (d: ListingDetail): Draft => ({
  fields: d.listing.fields ?? {},
  status: d.listing.status,
  postedUrl: d.listing.postedUrl ?? "",
  imageStyle: d.listing.imageStyle,
});

/**
 * 宣伝内容の元の情報（読むだけ。スマートフォンでは閉じたトグル）。
 * @param props - promotion：宣伝内容
 * @returns 枠
 */
function SourcePanel({ promotion }: { promotion: Promotion }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const e = promotion.event;
  const rows: [string, string][] = [
    ["タイトル", promotion.title],
    ...(e
      ? ([
          ["開催日時", formatEventWhen(e)],
          ["場所", formatEventPlace(e)],
          [
            "定員・参加費",
            [e.capacity ? `${e.capacity}名` : "", formatEventFee(e)].filter(Boolean).join("・"),
          ],
        ] as [string, string][])
      : []),
    ["宣伝したい内容", promotion.content],
  ];
  return (
    <aside aria-label="宣伝内容の元の情報" className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent md:hidden"
      >
        <ChevronRightIcon
          className={cn("size-4 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        宣伝内容（変わりません）
      </button>
      <div
        id={panelId}
        className={cn(
          "space-y-2.5 rounded-2xl bg-muted/60 px-4 py-3.5 text-[13px] md:block",
          !open && "max-md:hidden",
        )}
      >
        <p className="hidden font-semibold md:block">宣伝内容（変わりません）</p>
        {rows.map(([k, v]) => (
          <p key={k} className="whitespace-pre-wrap">
            <span className="block text-muted-foreground">{k}</span>
            {v}
          </p>
        ))}
      </div>
    </aside>
  );
}

/**
 * 外部媒体展開の入力の画面と作業の画面。
 * @returns 画面
 */
export function ExternalMediaListingPage() {
  const account = useCurrentAccount();
  const { promotionId = "", media: mediaParam = "" } = useParams<{
    promotionId: string;
    media: string;
  }>();
  const media = (MEDIA as readonly string[]).includes(mediaParam) ? (mediaParam as Media) : null;
  const [params, setParams] = useSearchParams();
  const work = params.get("view") === "work";
  const queryClient = useQueryClient();
  const key = queryKeys.listing(account.id, promotionId, mediaParam);
  const detail = useQuery({
    queryKey: key,
    queryFn: () => api.listing(account.id, promotionId, media!),
    enabled: media !== null,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ version: number | null; by: string | null } | null>(
    null,
  );
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [polishOpen, setPolishOpen] = useState(false);
  const statusId = useId();
  const urlId = useId();

  // 読み込んだら（読み込み直したら）、直す前の内容をそろえる
  useEffect(() => {
    if (!detail.data) return;
    setDraft(draftOf(detail.data));
    setBaseVersion(detail.data.listing.version);
  }, [detail.data]);

  const saved = detail.data ? draftOf(detail.data) : null;
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);

  const source = useMemo(
    () => (detail.data ? sourceOf(detail.data.promotion, detail.data.defaults) : null),
    [detail.data],
  );
  const built = useMemo(
    () => (media && source ? buildListing(media, source) : null),
    [media, source],
  );

  const afterSave = (d: ListingDetail) => {
    queryClient.setQueryData(key, d);
    void queryClient.invalidateQueries({ queryKey: queryKeys.externalMedia(account.id) });
  };
  const generate = useMutation({
    mutationFn: () => api.generateListing(account.id, promotionId, media!, baseVersion),
    onSuccess: (d) => {
      afterSave(d);
      toast.success("掲載内容を作りました");
    },
    onError: (err) => {
      if (isStale(err)) return void detail.refetch();
      toast.error(saveErrorMessage(err));
    },
  });
  const save = useMutation({
    mutationFn: (version: number | null) =>
      api.updateListing(account.id, promotionId, media!, {
        expectedVersion: version,
        status: draft!.status,
        postedUrl: draft!.postedUrl === "" ? null : draft!.postedUrl,
        imageStyle: draft!.imageStyle,
        ...(detail.data?.listing.fields ? { fields: draft!.fields } : {}),
      }),
    onSuccess: (d) => {
      setConflict(null);
      afterSave(d);
      toast.success("保存しました");
    },
    onError: (err) => {
      if (isStale(err)) {
        const latest = (err.latest ?? null) as { version?: number } | null;
        return setConflict({ version: latest?.version ?? null, by: err.updatedBy?.name ?? null });
      }
      toast.error(saveErrorMessage(err));
    },
  });

  if (media === null) return <NotFound message="この媒体はありません" />;
  if (detail.isPending || draft === null || !source || !built) {
    if (detail.isError) {
      if (detail.error instanceof ApiError && detail.error.code === "ROLE_FORBIDDEN")
        return <ExternalMediaForbidden />;
      return <ApiErrorScreen error={detail.error} onRetry={() => void detail.refetch()} />;
    }
    return <LoadingSkeleton />;
  }
  const d = detail.data!;
  const def = MEDIA_DEFINITIONS[media];
  const generated = d.listing.fields !== null;
  const canEdit = d.canEdit;
  const values = draft.fields;
  // 直している値で、自動の直しとルールのチェックを出し直す（保存しない。research.md R5）
  const preview = generated ? refixListing(media, values, source) : null;
  const fixes = [...d.listing.fixes, ...(preview?.fixes ?? [])];
  const checks = generated ? checkListing(media, values, source, fixes.length) : [];
  const setField = (k: string, v: string) =>
    setDraft((cur) => (cur ? { ...cur, fields: { ...cur.fields, [k]: v } } : cur));
  const back = (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="size-10 md:size-9"
      aria-label={work ? "入力の画面に戻る" : "外部媒体展開に戻る"}
    >
      <Link
        to={work ? `?` : `/threads/accounts/${account.id}/external-media?p=${promotionId}`}
        onClick={
          work
            ? (e) => {
                e.preventDefault();
                setParams({});
              }
            : undefined
        }
      >
        <ArrowLeftIcon className="size-5" />
      </Link>
    </Button>
  );

  if (work && generated) {
    return (
      <>
        <PageHeader title={`${MEDIA_LABELS[media]}に載せる`} actions={back} />
        <PageBody className="max-w-2xl">
          <WorkSteps
            media={media}
            steps={workSteps(media, values)}
            checks={checks}
            imagePromptText={imagePrompt(media, source, draft.imageStyle)}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={MEDIA_LABELS[media]}
        actions={
          <span className="flex items-center gap-1">
            {back}
            {canEdit && generated && (
              <Button
                className="h-10 rounded-full px-4 md:h-9"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(baseVersion)}
              >
                保存
              </Button>
            )}
          </span>
        }
      />
      <PageBody className="max-w-5xl space-y-5">
        {!generated ? (
          <div className="space-y-3 rounded-2xl border px-4 py-4 text-sm">
            <p>
              {d.promotion.title} の、{MEDIA_LABELS[media]}の掲載内容をまだ作っていません。
            </p>
            {canEdit && (
              <Button
                className="rounded-full"
                disabled={generate.isPending}
                onClick={() => generate.mutate()}
              >
                掲載内容を作る
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label htmlFor={statusId} className="flex flex-col gap-1.5 text-[13px] font-medium">
                状況
                <select
                  id={statusId}
                  value={draft.status}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as ListingStatus })}
                  className="h-10 rounded-xl border border-input bg-card px-2.5 text-sm"
                >
                  {LISTING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LISTING_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label
                htmlFor={urlId}
                className="flex min-w-64 flex-1 flex-col gap-1.5 text-[13px] font-medium"
              >
                掲載URL（{MEDIA_LABELS[media]}に載せたあとのページ）
                <input
                  id={urlId}
                  type="url"
                  value={draft.postedUrl}
                  readOnly={!canEdit}
                  placeholder="https://"
                  onChange={(e) => setDraft({ ...draft, postedUrl: e.target.value })}
                  className="h-10 rounded-xl border border-input bg-card px-3 text-sm"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-10 rounded-full px-5 md:h-9"
                onClick={() => setParams({ view: "work" })}
              >
                作業を始める
              </Button>
              {canEdit && (
                <Button
                  variant="outline"
                  className="h-10 rounded-full md:h-9"
                  onClick={() => setPolishOpen(true)}
                >
                  AIと整える
                </Button>
              )}
              <CopyValueButton
                text={listingAsText(media, values)}
                label="掲載内容"
                idleText="まとめてコピー"
                className="h-10 px-4 text-sm md:h-9"
              />
              {canEdit && (
                <Button
                  variant="ghost"
                  className="h-10 rounded-full text-muted-foreground md:h-9"
                  onClick={() => setConfirmRegenerate(true)}
                >
                  作り直す
                </Button>
              )}
            </div>
            {d.sourceChanged && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-bg px-4 py-2.5 text-sm"
              >
                <span className="min-w-48 flex-1">
                  宣伝内容が変わりました。作り直すと、今の宣伝内容で作り直せます
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setConfirmRegenerate(true)}
                  >
                    作り直す
                  </Button>
                )}
              </div>
            )}
            <RuleCheck checks={checks} fixes={fixes} />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start">
              <SourcePanel promotion={d.promotion} />
              <div className="min-w-0 space-y-5">
                {def.steps.map((step, i) => (
                  <section key={step} aria-label={step} className="space-y-2.5">
                    <h2 className="text-[15px] font-semibold text-perf-poor-fg">{step}</h2>
                    {def.fields
                      .filter((f) => f.step === i)
                      .map((f) => (
                        <FieldCard
                          key={f.key}
                          field={f}
                          value={values[f.key] ?? ""}
                          mediaLabel={MEDIA_LABELS[media]}
                          reason={built.reasons[f.key]}
                          candidates={f.key === "title" ? built.titleCandidates : []}
                          canEdit={canEdit}
                          onChange={(v) => setField(f.key, v)}
                        />
                      ))}
                  </section>
                ))}
                <section aria-label="画像" className="space-y-2.5">
                  <h2 className="text-[15px] font-semibold text-perf-poor-fg">画像</h2>
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3">
                    <span className="min-w-56 flex-1 text-[13px] text-muted-foreground">
                      {def.image.size}。画像に、URL・QRコード・連絡先・口座は入れません
                    </span>
                    <span role="radiogroup" aria-label="画像の種類" className="flex gap-1.5">
                      {IMAGE_STYLES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={draft.imageStyle === s}
                          disabled={!canEdit}
                          onClick={() => setDraft({ ...draft, imageStyle: s })}
                          className={cn(
                            "rounded-full border px-3 py-1 text-[13px]",
                            draft.imageStyle === s
                              ? "border-foreground bg-foreground text-background"
                              : "text-muted-foreground",
                          )}
                        >
                          {s === "illustration" ? "イラスト" : "写真を使う"}
                        </button>
                      ))}
                    </span>
                    <CopyValueButton
                      text={imagePrompt(media, source, draft.imageStyle)}
                      label="画像のプロンプト"
                      idleText="画像のプロンプトをコピー"
                    />
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </PageBody>

      {polishOpen && (
        <PolishDialog
          media={media}
          source={source}
          values={values}
          onRequestClose={() => setPolishOpen(false)}
          onApply={({ title, body }) => {
            setDraft((cur) =>
              cur
                ? {
                    ...cur,
                    fields: {
                      ...cur.fields,
                      ...(title !== null ? { title } : {}),
                      ...(body !== null ? { [listingBodyKey(media)]: body } : {}),
                    },
                  }
                : cur,
            );
            setPolishOpen(false);
          }}
        />
      )}
      {confirmRegenerate && (
        <ConfirmDialog
          title="掲載内容を作り直しますか？"
          confirmLabel="作り直す"
          pending={generate.isPending}
          onConfirm={() => {
            setConfirmRegenerate(false);
            generate.mutate();
          }}
          onCancel={() => setConfirmRegenerate(false)}
        >
          <p className="text-sm text-muted-foreground">
            直したところは消えて、今の宣伝内容から作り直します。状況と掲載URLは変わりません。
          </p>
        </ConfirmDialog>
      )}
      <ConflictDialog
        open={conflict !== null}
        updatedAt={null}
        updatedByName={conflict?.by ?? null}
        onReload={() => {
          setConflict(null);
          void detail.refetch();
        }}
        onOverwrite={() => save.mutate(conflict?.version ?? null)}
        onCancel={() => setConflict(null)}
      />
    </>
  );
}
