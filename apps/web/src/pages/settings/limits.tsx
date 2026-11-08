// 設定 > 運営 > 上限（specs/024-tester-invite-connect contracts/ui-routes.md 6、US3、FR-016・FR-017）。
// 運営者だけ。全員の既定値と、人ごとの上限（アカウントの数・1日の投稿数）。運営者には上限をかけない。
// 画面はモック（https://claude.ai/artifact/R6Pc9o8YomNZNDEB161eSf 6枚目）。
import {
  ACCOUNT_LIMIT_MAX,
  DAILY_POST_LIMIT_MAX,
  type DefaultLimits,
  type OperatorLimitUser,
} from "@threads-grower/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Toggle } from "@/components/settings/FeatureSwitches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * 日時の表示（例：11/8 14:02）。
 * @param iso - ISO 8601 の日時
 * @returns 表示の文字列
 */
const mdhm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * 数の欄の値を読む（空なら null）。
 * @param raw - 入力
 * @param max - 最大
 * @returns 1〜max の整数。違えば undefined、空なら null
 */
const parseLimit = (raw: string, max: number): number | null | undefined => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
};

/**
 * 上限（/settings/limits）。
 * @returns 画面
 */
export function LimitsPage() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.operatorLimits, queryFn: api.operatorLimits, retry: false });
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<OperatorLimitUser | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.operatorLimits });

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    setFound(null);
    try {
      setFound(await api.findLimitUser(email.trim()));
    } catch (err) {
      setSearchError(err instanceof ApiError && err.code === "USER_NOT_FOUND" ? "見つかりません" : describeError(err));
    }
  };

  if (q.isError && q.error instanceof ApiError && q.error.code === "OPERATOR_ONLY") {
    return <p className="text-sm text-muted-foreground">この画面は運営者だけが使えます。</p>;
  }

  return (
    <div className="space-y-7">
      <h1 className="text-2xl font-semibold max-md:hidden">上限</h1>

      <section aria-labelledby="limits-default-title" className="space-y-2.5">
        <h2 id="limits-default-title" className="font-medium">
          全員の既定値
        </h2>
        {q.isPending ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {describeError(q.error)}
          </p>
        ) : (
          <DefaultsForm key={JSON.stringify(q.data.defaults)} defaults={q.data.defaults} onSaved={refresh} />
        )}
      </section>

      <section aria-labelledby="limits-user-title" className="space-y-2.5">
        <h2 id="limits-user-title" className="font-medium">
          人ごとの上限
        </h2>
        <form className="flex gap-2" onSubmit={(e) => void search(e)}>
          <Input
            type="email"
            aria-label="メールアドレス"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-full px-4 md:h-9"
          />
          <Button type="submit" variant="outline" className="h-10 rounded-full md:h-9" disabled={email.trim() === ""}>
            探す
          </Button>
        </form>
        {searchError && (
          <p role="alert" className="text-sm text-muted-foreground">
            {searchError}
          </p>
        )}
        {found && q.data && (
          <UserLimitsCard
            key={`${found.userId}-${found.accountLimit}-${found.dailyPostLimit}`}
            user={found}
            defaults={q.data.defaults}
            onSaved={async (after) => {
              setFound(after);
              await refresh();
            }}
          />
        )}
      </section>

      <section aria-labelledby="limits-overrides-title" className="space-y-2.5">
        <h2 id="limits-overrides-title" className="font-medium">
          既定値と違う人
        </h2>
        {q.data && q.data.overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">いません</p>
        ) : q.data ? (
          <ul className="divide-y rounded-2xl border bg-card px-4">
            {q.data.overrides.map((o) => (
              <li key={o.userId} className="flex items-center gap-2.5 py-3">
                <span className="flex min-w-0 flex-1 flex-col leading-snug">
                  <span className="truncate font-medium">{o.name ?? o.email}</span>
                  <span className="truncate text-[13px] text-muted-foreground">
                    {o.accountLimit === null ? "アカウントは既定値" : `アカウント${o.accountLimit}件`}・
                    {o.dailyPostLimit === null ? "投稿は既定値" : `投稿${o.dailyPostLimit}件`}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  className="h-10 shrink-0 rounded-full md:h-9"
                  onClick={async () => {
                    const after = await api.putUserLimits(o.userId, { accountLimit: null, dailyPostLimit: null });
                    if (found?.userId === after.userId) setFound(after);
                    await refresh();
                  }}
                >
                  既定値に戻す
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[13px] text-muted-foreground">運営者には上限をかけません。</p>
      </section>

      {q.data && (
        <Toggle title="変更の記録" region="変更の記録">
          {q.data.events.length === 0 ? (
            <p className="text-muted-foreground">まだ変更はありません</p>
          ) : (
            <ul className="space-y-1">
              {q.data.events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-2.5">
                  <span className="w-[76px] shrink-0 text-muted-foreground tabular-nums">{mdhm(e.at)}</span>
                  <span className="min-w-0">
                    {e.action === "default_limits" ? "既定値を変えた" : "人ごとの上限を変えた"}
                    {e.actor ? `（${e.actor}）` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Toggle>
      )}
    </div>
  );
}

/**
 * 数の欄（ラベルと「件」）。
 * @param props - label：項目名、note：下の小さな文、value・onChange：値、max：最大
 * @returns 行
 */
function LimitField({
  label,
  note,
  value,
  onChange,
  max,
  placeholder,
}: {
  label: string;
  note?: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <label htmlFor={id} className="text-sm">
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </label>
      <span className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-20 rounded-full px-3 text-center"
        />
        <span className="text-sm">件</span>
      </span>
    </div>
  );
}

/**
 * 全員の既定値のフォーム。
 * @param props - defaults：今の既定値、onSaved：保存できたとき
 * @returns フォーム
 */
function DefaultsForm({ defaults, onSaved }: { defaults: DefaultLimits; onSaved: () => Promise<unknown> }) {
  const [account, setAccount] = useState(String(defaults.accountLimit));
  const [daily, setDaily] = useState(String(defaults.dailyPostLimit));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const a = parseLimit(account, ACCOUNT_LIMIT_MAX);
  const d = parseLimit(daily, DAILY_POST_LIMIT_MAX);
  const valid = typeof a === "number" && typeof d === "number";
  return (
    <div className="space-y-2.5">
      <div className="divide-y rounded-2xl border bg-card px-4">
        <LimitField label="アカウントの数" value={account} onChange={setAccount} max={ACCOUNT_LIMIT_MAX} />
        <LimitField label="1日の投稿数（1アカウント）" value={daily} onChange={setDaily} max={DAILY_POST_LIMIT_MAX} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        className="h-10 rounded-full md:h-9"
        disabled={!valid || pending}
        onClick={async () => {
          if (!valid) return;
          setPending(true);
          setError(null);
          try {
            await api.putDefaultLimits({ accountLimit: a, dailyPostLimit: d });
            await onSaved();
          } catch (err) {
            setError(describeError(err));
          } finally {
            setPending(false);
          }
        }}
      >
        保存
      </Button>
    </div>
  );
}

/**
 * 見つかった人の上限のカード。空の欄は既定値。
 * @param props - user：見つかった人、defaults：既定値、onSaved：保存できたとき
 * @returns カード
 */
function UserLimitsCard({
  user,
  defaults,
  onSaved,
}: {
  user: OperatorLimitUser;
  defaults: DefaultLimits;
  onSaved: (after: OperatorLimitUser) => Promise<void>;
}) {
  const [account, setAccount] = useState(user.accountLimit === null ? "" : String(user.accountLimit));
  const [daily, setDaily] = useState(user.dailyPostLimit === null ? "" : String(user.dailyPostLimit));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const a = parseLimit(account, ACCOUNT_LIMIT_MAX);
  const d = parseLimit(daily, DAILY_POST_LIMIT_MAX);
  const valid = a !== undefined && d !== undefined;
  const save = async (v: { accountLimit: number | null; dailyPostLimit: number | null }) => {
    setPending(true);
    setError(null);
    try {
      await onSaved(await api.putUserLimits(user.userId, v));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-1 rounded-2xl border bg-card px-4 py-3.5">
      <span className="block font-medium">{user.name ?? user.email}</span>
      <span className="block text-[13px] text-muted-foreground">
        {user.email}・アカウント{user.ownedAccountCount}件
      </span>
      {user.operator && <p className="pt-1 text-[13px]">運営者には上限をかけません</p>}
      <div className="divide-y">
        <LimitField
          label="アカウントの数"
          note={a === null ? `既定値（${defaults.accountLimit}件）` : "この人だけ"}
          value={account}
          onChange={setAccount}
          max={ACCOUNT_LIMIT_MAX}
          placeholder={String(defaults.accountLimit)}
        />
        <LimitField
          label="1日の投稿数"
          note={d === null ? `既定値（${defaults.dailyPostLimit}件）` : "この人だけ"}
          value={daily}
          onChange={setDaily}
          max={DAILY_POST_LIMIT_MAX}
          placeholder={String(defaults.dailyPostLimit)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          className="h-10 rounded-full md:h-9"
          disabled={!valid || pending}
          onClick={() => valid && void save({ accountLimit: a, dailyPostLimit: d })}
        >
          保存
        </Button>
        <Button
          variant="ghost"
          className="h-10 rounded-full md:h-9"
          disabled={pending}
          onClick={() => void save({ accountLimit: null, dailyPostLimit: null })}
        >
          既定値に戻す
        </Button>
      </div>
    </div>
  );
}
