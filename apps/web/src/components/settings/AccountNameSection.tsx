// 「このアカウントの設定」の「アカウントの名前」の区分（specs/012 FR-040、contracts/ui-routes.md「アカウントの名前」）。
// 主に出す名前をオーナーが直す。保存すると、切り替えメニュー・ホームなどの表示がすぐ変わる。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_NAME_MAX, countChars, type AccountSummary } from "@threads-grower/shared";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { Button } from "@/components/ui/button";
import { api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

/**
 * アカウントの名前の区分。オーナーだけに出す（呼び出し側で出し分ける）。
 * @param props - account：アカウント
 * @returns 区分
 */
export function AccountNameSection({ account }: { account: AccountSummary }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(account.name);
  // ほかの画面で直されたら、入力欄も合わせる
  useEffect(() => setName(account.name), [account.name]);
  const save = useMutation({
    mutationFn: () => api.renameAccount(account.id, { name: name.trim() }),
    onSuccess: async () => {
      toast.success("名前を保存しました");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.account(account.id) }),
      ]);
    },
  });
  const trimmed = name.trim();
  const canSave = trimmed !== "" && countChars(trimmed) <= ACCOUNT_NAME_MAX && trimmed !== account.name && !save.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSave) save.mutate();
  }

  return (
    <section aria-labelledby="account-name-heading" className="space-y-3">
      <h2 id="account-name-heading" className="font-medium">
        アカウントの名前
      </h2>
      <form className="space-y-3" onSubmit={submit}>
        <FieldWithCounter
          id="account-name"
          label="名前"
          description="切り替えメニューやホームに出す名前です。Threadsには送りません。"
          value={name}
          onChange={setName}
          max={ACCOUNT_NAME_MAX}
          multiline={false}
          error={save.isError ? describeError(save.error) : undefined}
        />
        <Button type="submit" variant="outline" className="rounded-full" disabled={!canSave}>
          名前を保存
        </Button>
      </form>
    </section>
  );
}
