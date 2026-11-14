// サイドバーの枠に、アプリが入れる部品（specs/028-meguru-shell research.md R8）。
import type { ComponentType } from "react";

/** サイドバーの部品が受け取る値。 */
export type SidebarPartProps = {
  /** 項目を選んだときの処理（ドロワーを閉じる） */
  onNavigate?: () => void;
};

/** アプリのサイドバーの中身。枠が上から 頭 → 中身 → 区切り線 → 下の項目 → ユーザーメニュー の順に並べる。 */
export type AppSidebar = {
  /** いちばん上の行（Threadsならアカウントの切り替え） */
  Header: ComponentType<SidebarPartProps>;
  /** 中身（伸びる。Threadsなら担当の案内・機能の一覧・チーム） */
  Body: ComponentType<SidebarPartProps>;
  /** 区切り線の下、ユーザーメニューの上（Threadsなら「このアカウントの設定」） */
  Footer?: ComponentType<SidebarPartProps>;
};
