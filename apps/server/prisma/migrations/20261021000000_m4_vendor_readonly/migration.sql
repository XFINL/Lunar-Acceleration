-- M4 read-only vendor inventory. Existing package vendor_id values are preserved.
CREATE TABLE `vendors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `driver` VARCHAR(64) NOT NULL,
  `logo` VARCHAR(255) NULL,
  `description` VARCHAR(512) NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `sort` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `vendors_code_key` (`code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vendor_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `access_key` TEXT NOT NULL,
  `secret_key` TEXT NOT NULL,
  `config` JSON NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `last_sync_at` DATETIME NULL,
  `credential_version` INTEGER NOT NULL DEFAULT 1,
  `operation_token` VARCHAR(36) NULL,
  `operation_expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `vendor_accounts_vendor_id_name_key` (`vendor_id`, `name`),
  INDEX `vendor_accounts_vendor_id_idx` (`vendor_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `vendor_accounts_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vendor_resources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_account_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `vendor_domain_id` VARCHAR(128) NULL,
  `vendor_cert_id` VARCHAR(128) NULL,
  `resource_data` JSON NULL,
  `synced_at` DATETIME NULL,
  UNIQUE INDEX `vendor_resources_vendor_account_id_domain_id_key` (`vendor_account_id`, `domain_id`),
  INDEX `vendor_resources_domain_id_idx` (`domain_id`),
  INDEX `vendor_resources_vendor_account_id_idx` (`vendor_account_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `vendor_resources_vendor_account_id_fkey` FOREIGN KEY (`vendor_account_id`) REFERENCES `vendor_accounts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `vendor_resources_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vendor_sync_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_account_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `status` TINYINT NOT NULL,
  `message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `vendor_sync_logs_vendor_account_id_idx` (`vendor_account_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `vendor_sync_logs_vendor_account_id_fkey` FOREIGN KEY (`vendor_account_id`) REFERENCES `vendor_accounts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
