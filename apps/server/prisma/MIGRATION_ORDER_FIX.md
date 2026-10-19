# Vendor write-job migration ordering

`20261019105000_m3_m4_write_jobs` ran before `20261021000000_m4_vendor_readonly`, even though it alters `vendor_resources` and creates foreign keys to `vendor_accounts`; both tables are only created by the later migration. A clean `prisma migrate deploy` therefore cannot apply the old ordering. The fix keeps the `origins.is_backup` change at its valid point, moves vendor-resource/job DDL to `20261022000000_m4_vendor_write_jobs`, and makes the moved DDL tolerant of a pre-existing column or job table from a database that had already applied the former SQL.

## Applied-database compatibility and checksum

The historical migration had to change because no later migration can make a clean deploy pass a failing earlier migration. Its original SHA-256 in this checkout was `80dd9a1c08f24414218eda59b38efc7ba4cba06318f3bd5ec43f695d1e846775`; after the edit it is `3a65f2d570cfd9dd077dbd339018df486ad02c84a18d835ee742697a5b2044f3`. This is a deliberate historical SQL change, not a blanket re-baseline: do **not** rewrite `_prisma_migrations.checksum` on deployed databases. Databases that already recorded the old migration as applied retain that checksum and the already-created objects; Prisma deploy does not re-execute an applied migration, while the new migration safely recognizes those objects. A database that has not applied the old migration now records its new checksum. As usual, inspect any `migrate dev` history-drift warning on an old deployment rather than editing its migration ledger automatically.

The later `20261021000000_m4_vendor_readonly` migration is unchanged. The new `managed_by_panel` DDL is conditional because the original migration may already have created the column on an existing database. The queue table is `CREATE TABLE IF NOT EXISTS` for the same compatibility reason.

## `created_at` defaults

`DateTime @db.DateTime` emits a MySQL `DATETIME` (precision 0), but Prisma's `@default(now())` emitted `DEFAULT CURRENT_TIMESTAMP(3)`, which MySQL 8 rejects as `Invalid default value`. The schema now uses `@default(dbgenerated("CURRENT_TIMESTAMP"))` for DateTime defaults (including `updated_at` and scheduling timestamps), preserving `@updatedAt` behavior while generating a valid precision-0 default. The fresh-deploy acceptance script validates the schema, inspects generated DDL, creates a probe using Prisma's exact default expression, and checks actual MySQL population of `created_at`/`updated_at`.

## Reproducible acceptance

On a local MySQL instance, create a **blank, disposable** database whose name ends with `_migration_test`, grant a local user access, then run:

```sh
DATABASE_URL='mysql://USER:PASSWORD@127.0.0.1:PORT/NAME_migration_test' \
  apps/server/prisma/tests/migrate-deploy-acceptance.sh
```

The script refuses non-local hosts and non-empty schemas. It invokes the same `prisma migrate deploy` path as production and verifies the vendor tables, `managed_by_panel`, timestamp defaults, and queue foreign keys.

## 旧バージョンで途中失敗した DB の復旧

`migrate deploy` が旧 SQL の `vendor_resources` 不在で停止した DB は、適用済みの DB と区別してください。MySQL の DDL は途中までコミットされるため、`origins.is_backup` だけが存在し、Prisma の履歴に失敗が残る可能性があります。この状態で無条件に再実行・リセット・チェックサム変更をしてはいけません。

バックアップ後、`prisma migrate status`、`_prisma_migrations` の失敗ログ、`information_schema.columns`、関連テーブルの存在を管理者が確認します。修正後の `20261019105000_m3_m4_write_jobs` の唯一の効果である `origins.is_backup` が正しく存在し、その変更以外の不明な差分がないことを確認できた場合に限り、当該マイグレーションを `prisma migrate resolve --applied 20261019105000_m3_m4_write_jobs` で適用済みにしてから、通常の `prisma migrate deploy` を続けます。`is_backup` が存在せず、変更が一切適用されていないことを確認できた場合は `--rolled-back` を選んでから修正版を再実行します。これは管理者が実スキーマに基づいて選択する復旧手順であり、自動化しません。

手動で vendor 関連テーブルを先に作成した DB や、その他の途中適用がある DB は個別にスキーマを比較してください。`CREATE TABLE IF NOT EXISTS` は既存テーブルの構造を自動修正しません。
