// すべてのアプリ（/apps。specs/028-meguru-shell contracts/ui-routes.md 4）。
// サイドバーなしの1カラムに「使っているアプリ」と「足せるアプリ」を並べる。名前・説明・料金は @meguru/shared のアプリの一覧、
// アイコンと「使い始める」の行き先は登録したアプリの入口から取る。登録していないアプリは出さない。
import { appById, errorMessage, isErrorCode, type AppCatalogEntry } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, SettingsIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useAppRegistry, type AppModule } from "../app-module";

type Row = { app: AppModule; entry: AppCatalogEntry };

/**
 * アプリの行。使っているアプリには「開く」、足せるアプリには料金・「詳しく見る」・「使い始める」を出す。
 * @param props - row：アプリ、using：使っているか
 * @returns アプリの行
 */
function AppRow({ row, using }: { row: Row; using: boolean }) {
  const [open, setOpen] = useState(false);
  const { app, entry } = row;
  const Icon = app.icon;
  const detailsId = `app-details-${app.id}`;
  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold">{entry.name}</h3>
          <p className="text-sm text-muted-foreground">{entry.summary}</p>
          {!using && <p className="text-sm">{entry.priceLabel}</p>}
        </div>
        {using && (
          <Button asChild variant="outline" className="h-9 shrink-0 rounded-full">
            <Link to={app.basePath}>開く</Link>
          </Button>
        )}
      </div>
      {!using && (
        <>
          {open && (
            <ul id={detailsId} className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {entry.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-full"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
            >
              詳しく見る {open ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
            </Button>
            <Button asChild className="h-9 rounded-full">
              <Link to={app.startPath}>使い始める</Link>
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * すべてのアプリの画面。
 * @returns 画面
 */
export function AppsPage() {
  const apps = useAppRegistry();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  // 入口（/）から ?error=… つきで移ってきたときは、エラーをトーストで出す（Threadsのホームと同じ）
  const [params] = useSearchParams();
  const error = params.get("error");
  const shown = useRef(false);
  useEffect(() => {
    if (!error || shown.current) return;
    shown.current = true;
    toast.error(errorMessage(isErrorCode(error) ? error : "INTERNAL_ERROR").message);
  }, [error]);
  if (me.isPending) return <LoadingSkeleton />;
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  const { available, using: usingIds } = me.data.apps;
  // 出せる（API）・登録している（Web）・一覧にある（共有）アプリだけを、一覧の順で並べる
  const rows: Row[] = available.flatMap((id) => {
    const app = apps.find((a) => a.id === id);
    const entry = appById(id);
    return app && entry ? [{ app, entry }] : [];
  });
  const using = rows.filter((r) => usingIds.includes(r.app.id));
  const addable = rows.filter((r) => !usingIds.includes(r.app.id));
  // 戻る先：使っているアプリがあればそのホーム。0本の人は入口へ戻ってもここへ戻るだけなので、設定（ログアウト・退会がある）を出す
  const home = apps.find((a) => a.id === me.data.apps.landing);
  return (
    <div className="min-h-svh">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:py-10">
        {home ? (
          <Link to={home.basePath} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
            <ArrowLeftIcon className="size-4" /> 戻る
          </Link>
        ) : (
          <Link to="/settings" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
            <SettingsIcon className="size-4" /> 設定
          </Link>
        )}
        <h1 className="text-xl font-semibold">すべてのアプリ</h1>
        {using.length > 0 && (
          <section aria-labelledby="apps-using" className="space-y-3">
            <h2 id="apps-using" className="text-sm text-muted-foreground">
              使っているアプリ
            </h2>
            <ul className="space-y-3">
              {using.map((r) => (
                <AppRow key={r.app.id} row={r} using />
              ))}
            </ul>
          </section>
        )}
        {addable.length > 0 && (
          <section aria-labelledby="apps-addable" className="space-y-3">
            <h2 id="apps-addable" className="text-sm text-muted-foreground">
              足せるアプリ
            </h2>
            <ul className="space-y-3">
              {addable.map((r) => (
                <AppRow key={r.app.id} row={r} using={false} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
