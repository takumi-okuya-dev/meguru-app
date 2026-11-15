// ルートの調べ方（ログインなしで開けるか）。specs/015 で読みもののページを入れ物で包んだので、入れ子をたどる
import { isValidElement, type ReactNode } from "react";
import { RequireAuth } from "@/shell/guards/RequireAuth";

type Route = { path?: string; element?: ReactNode; children?: Route[] };

/**
 * そのパスが、ログイン（RequireAuth）の外にあるかを調べる。
 * @param routes - ルートの一覧
 * @param path - 調べるパス
 * @returns ログインなしで開けるなら true
 */
export function isPublicPath(routes: readonly Route[], path: string): boolean {
  return routes.some((r) => {
    if (isValidElement(r.element) && r.element.type === RequireAuth) return false;
    if (r.path === path) return true;
    return r.children ? isPublicPath(r.children, path) : false;
  });
}
