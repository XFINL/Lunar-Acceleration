-- Vendor tables are created by 20261021000000_m4_vendor_readonly; keep this migration after them.
-- The column/job table may already exist on databases that applied the original out-of-order migration.
SET @managed_by_panel_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_resources'
    AND COLUMN_NAME = 'managed_by_panel'
);
SET @managed_by_panel_ddl = IF(
  @managed_by_panel_exists = 0,
  'ALTER TABLE `vendor_resources` ADD COLUMN `managed_by_panel` BOOLEAN NOT NULL DEFAULT false',
  'SELECT 1'
);
PREPARE add_managed_by_panel FROM @managed_by_panel_ddl;
EXECUTE add_managed_by_panel;
DEALLOCATE PREPARE add_managed_by_panel;

CREATE TABLE IF NOT EXISTS `vendor_write_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_account_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
  `idempotency_key` VARCHAR(64) NOT NULL,
  `active_key` VARCHAR(64) NULL,
  `credential_version` INTEGER NOT NULL,
  `origin_snapshot` JSON NULL,
  `external_id` VARCHAR(128) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_token` VARCHAR(36) NULL,
  `lease_expires_at` DATETIME NULL,
  `error_code` VARCHAR(64) NULL,
  `message` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `vendor_write_jobs_idempotency_key_key` (`idempotency_key`),
  UNIQUE INDEX `vendor_write_jobs_active_key_key` (`active_key`),
  INDEX `vendor_write_jobs_status_next_attempt_at_idx` (`status`, `next_attempt_at`),
  INDEX `vendor_write_jobs_vendor_account_id_created_at_idx` (`vendor_account_id`, `created_at`),
  INDEX `vendor_write_jobs_domain_id_idx` (`domain_id`),
  CONSTRAINT `vendor_write_jobs_vendor_account_id_fkey` FOREIGN KEY (`vendor_account_id`) REFERENCES `vendor_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `vendor_write_jobs_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
