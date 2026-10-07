-- ローカル開発・テスト用の使い捨てDBだけで使う（docker-compose.yml）。本番・共有のDBでは実行しない。
-- local-neon-http-proxy は1クエリごとに SCRAM の認証で接続し直すため、既定の4096回ではテストの大半がこの計算になる。
-- 同じパスワードのまま、反復1回で保存し直す（Postgres 16 以降）。DBを新しく作ったときだけ実行される。
SET scram_iterations = 1;
ALTER ROLE postgres PASSWORD 'postgres';
