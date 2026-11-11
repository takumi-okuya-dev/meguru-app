// 外部媒体展開の一覧（/accounts/:accountId/external-media。specs/021-external-media contracts/ui-routes.md 2、
// モック https://claude.ai/artifact/78VBSVeE19t3EqqvjckMRZ ）。イベントを選び、5つの媒体の状況を見て、入力の画面へ移る。
// 使いながらシンプルにしていく（spec Clarifications）。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LISTING_STATUS_LABELS,
  MEDIA,
  MEDIA_DEFINITIONS,
  MEDIA_DESCRIPTIONS,
  MEDIA_LABELS,
  formatEventShortDate,
  type ExternalMediaList,
  type ListingStatus,
  type Media,
} from "@meguru/shared";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { PageBody, PageHeader } from "@/shell";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { saveErrorMessage } from "@/lib/save-error";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/apps/threads/pages/account-layout";

/** 状況の印の色（今ある色だけ）。 */
const STATUS_STYLE: Record<ListingStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  drafting: "bg-warning-bg text-warning",
  posted: "bg-success-bg text-success",
  stopped: "border border-dashed border-muted-foreground/60 text-muted-foreground",
};

/**
 * 見せてもらっている人が開いたとき（view がない）の画面。
 * @returns 画面
 */
export function ExternalMediaForbidden() {
  return (
    <>
      <PageHeader title="外部媒体展開" />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          この画面は、オーナーと担当の人だけが使えます。
        </p>
      </PageBody>
    </>
  );
}

/**
 * 状況の印。
 * @param props - status：状況
 * @returns 印
 */
export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        STATUS_STYLE[status],
      )}
    >
      {LISTING_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * イベントの選択肢の文（例：11/25(水) タイトル ［掲載済み：Peatix・YOUTRUST］）。
 * @param p - 宣伝内容
 * @returns 文
 */
function optionLabel(p: ExternalMediaList["promotions"][number]): string {
  const posted = p.listings.filter((l) => l.status === "posted").map((l) => MEDIA_LABELS[l.media]);
  return `${p.event ? formatEventShortDate(p.event.startAt) : ""} ${p.title}${posted.length > 0 ? `\u3000［掲載済み：${posted.join("・")}］` : ""}`;
}

/**
 * 媒体の既定値（閉じたトグル。spec FR-002）。
 * @param props - accountId：Account、canEdit：直せるか
 * @returns 区分
 */
function MediaDefaultsSection({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: queryKeys.mediaDefaults(accountId),
    queryFn: () => api.mediaDefaults(accountId),
    enabled: open,
  });
  const [draft, setDraft] = useState<Partial<Record<Media, Record<string, string>>>>({});
  const save = useMutation({
    mutationFn: ({
      media,
      version,
      values,
    }: {
      media: Media;
      version: number | null;
      values: Record<string, string>;
    }) => api.putMediaDefaults(accountId, media, version, values),
    onSuccess: (_r, { media }) => {
      setDraft((d) => ({ ...d, [media]: undefined }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaDefaults(accountId) });
      toast.success("保存しました");
    },
    onError: (err) => {
      toast.error(saveErrorMessage(err));
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaDefaults(accountId) });
    },
  });
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent"
      >
        <ChevronRightIcon
          className={cn("size-4 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        媒体の既定値（事務局名・連絡先・主催グループ）
      </button>
      {open && (
        <div id={panelId} className="space-y-3 rounded-2xl bg-muted/60 px-4 py-3.5">
          {list.isPending ? (
            <LoadingSkeleton />
          ) : list.isError ? (
            <ApiErrorScreen error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            MEDIA.map((m) => {
              const row = list.data.items.find((i) => i.media === m)!;
              const fields = MEDIA_DEFINITIONS[m].fields.filter((f) => f.defaultable);
              const values = draft[m] ?? row.values;
              return (
                <section key={m} aria-label={`${MEDIA_LABELS[m]}の既定値`} className="space-y-2">
                  <h3 className="text-[13px] font-semibold">{MEDIA_LABELS[m]}</h3>
                  {fields.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1 text-[13px]">
                      {f.label}
                      <input
                        type="text"
                        value={values[f.key] ?? ""}
                        readOnly={!canEdit}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [m]: { ...values, [f.key]: e.target.value } }))
                        }
                        className="h-10 rounded-lg border border-input bg-card px-2.5"
                      />
                    </label>
                  ))}
                  {canEdit && (
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={!draft[m] || save.isPending}
                      onClick={() => save.mutate({ media: m, version: row.version, values })}
                    >
                      保存
                    </Button>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 外部媒体展開の一覧の画面。
 * @returns 画面
 */
export function ExternalMediaPage() {
  const account = useCurrentAccount();
  const [params, setParams] = useSearchParams();
  const list = useQuery({
    queryKey: queryKeys.externalMedia(account.id),
    queryFn: () => api.externalMedia(account.id),
  });
  const selectId = useId();

  if (list.isPending) return <LoadingSkeleton />;
  if (list.isError) {
    if (list.error instanceof ApiError && list.error.code === "ROLE_FORBIDDEN")
      return <ExternalMediaForbidden />;
    return <ApiErrorScreen error={list.error} onRetry={() => void list.refetch()} />;
  }
  const selectable = list.data.promotions.filter((p) => p.event !== null);
  const current = selectable.find((p) => p.id === params.get("p")) ?? selectable[0];

  return (
    <>
      <PageHeader title="外部媒体展開" />
      <PageBody className="max-w-3xl space-y-5">
        {selectable.length === 0 ? (
          <div className="space-y-2 rounded-2xl border px-4 py-4 text-sm">
            <p>宣伝内容に、イベントの情報を入れると使えます。</p>
            <Button asChild variant="outline" className="rounded-full">
              <Link to={`/accounts/${account.id}/promotions`}>宣伝内容を開く</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor={selectId} className="font-medium">
                イベント
              </label>
              <select
                id={selectId}
                value={current!.id}
                onChange={(e) => setParams({ p: e.target.value }, { replace: true })}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
              >
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {optionLabel(p)}
                  </option>
                ))}
              </select>
              <p className="text-[13px] text-muted-foreground">
                宣伝内容のうち、イベントの情報（開催日時）があるものを選べます
              </p>
            </div>

            <section aria-labelledby="media-heading" className="space-y-2.5">
              <h2 id="media-heading" className="font-medium">
                媒体
              </h2>
              <ul aria-label="媒体" className="divide-y overflow-hidden rounded-2xl border">
                {MEDIA.map((m) => {
                  const l = current!.listings.find((x) => x.media === m);
                  const status = l?.status ?? "not_started";
                  return (
                    <li key={m} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
                      <span className="flex min-w-44 flex-1 flex-col">
                        <span className="font-medium">{MEDIA_LABELS[m]}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {MEDIA_DESCRIPTIONS[m]}
                        </span>
                      </span>
                      <ListingStatusBadge status={status} />
                      <Button asChild variant="outline" className="h-10 rounded-full md:h-9">
                        <Link to={`/accounts/${account.id}/external-media/${current!.id}/${m}`}>
                          {l ? "開く" : "掲載内容を作る"}
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
        <MediaDefaultsSection accountId={account.id} canEdit={list.data.canEdit} />
      </PageBody>
    </>
  );
}
