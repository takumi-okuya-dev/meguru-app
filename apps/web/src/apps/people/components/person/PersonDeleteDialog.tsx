// 「この人を消す」の確かめ（specs/people/001-people-memo contracts/ui-routes.md 4、research.md R13、US7 AS1）。
// 消えるもの・残るもの・「元に戻せません」を出し、この人の名前（表示名と nameKey で同じ）を入れるまで「消す」を押せない。最後はAPIが確かめる。
import { nameKey, PERSON_NAME_MAX, type PersonSummary } from "@meguru/shared/people";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError, describeError } from "@/lib/api-client";
import { peopleApi } from "../../lib/api";
import { personsPath } from "../../lib/paths";
import { refreshAllPeople } from "../../lib/refresh";
import { fieldClass } from "../EventForm";

/**
 * 「この人を消す」の確かめ。消したら人の一覧へ戻る。
 * @param props - person：人、onClose：やめる
 * @returns ダイアログ
 */
export function PersonDeleteDialog({ person, onClose }: { person: PersonSummary; onClose: () => void }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmName, setConfirmName] = useState("");
  const remove = useMutation({
    mutationFn: () => peopleApi.deletePerson(person.id, confirmName.trim()),
    onSuccess: async () => {
      toast.success("この人の記録をすべて消しました");
      // 先に一覧へ移ってから、この人のページのデータを捨てる（消えた人のページを読み直さない）
      await navigate(personsPath(), { replace: true });
      await refreshAllPeople(queryClient, [person.id]);
    },
  });
  const error = !remove.isError
    ? null
    : remove.error instanceof ApiError && remove.error.code === "CONFIRMATION_MISMATCH"
      ? `名前が違います。「${person.displayName}」と入れてください。`
      : describeError(remove.error);
  return (
    <ConfirmDialog
      title="この人を消しますか？"
      confirmLabel="消す"
      destructive
      pending={confirmName.trim() === "" || nameKey(confirmName) !== nameKey(person.displayName) || remove.isPending}
      error={error}
      onConfirm={() => remove.mutate()}
      onCancel={onClose}
    >
      <p className="font-medium">元に戻せません。</p>
      <div>
        <p>消えるもの：</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>アンケートの回答</li>
          <li>メモ（見た目の特徴・話したこと）</li>
          <li>同意の記録</li>
          <li>別名と、会ったイベントの記録</li>
        </ul>
      </div>
      <div>
        <p>残るもの：</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>会ごとの参加者数（名前のない数としてだけ残ります）</li>
        </ul>
      </div>
      <div className="space-y-1 pt-1">
        <label htmlFor={id} className="block font-medium text-foreground">
          確かめのため、この人の名前「{person.displayName}」を入れてください
        </label>
        <input
          id={id}
          className={fieldClass}
          value={confirmName}
          maxLength={PERSON_NAME_MAX * 2}
          autoComplete="off"
          onChange={(e) => {
            setConfirmName(e.target.value);
            if (remove.isError) remove.reset();
          }}
        />
      </div>
    </ConfirmDialog>
  );
}
