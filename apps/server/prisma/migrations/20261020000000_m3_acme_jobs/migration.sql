-- M3 ACME durable lifecycle. Existing certificate IDs and HTTPS bindings are preserved.
ALTER TABLE `certificates`
  ADD COLUMN `acme_directory` VARCHAR(255) NULL,
  ADD COLUMN `acme_domains` JSON NULL,
  ADD COLUMN `chain_pem` TEXT NULL,
  ADD COLUMN `last_renewed_at` DATETIME NULL,
  ADD COLUMN `renewal_error` VARCHAR(512) NULL;

CREATE TABLE `certificate_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NULL,
  `certificate_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `domains` JSON NOT NULL,
  `challenge` JSON NULL,
  `order_data` JSON NULL,
  `private_key` TEXT NULL,
  `csr` TEXT NULL,
  `error` VARCHAR(512) NULL,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `certificate_jobs_user_id_status_idx` (`user_id`, `status`),
  INDEX `certificate_jobs_certificate_id_idx` (`certificate_id`),
  INDEX `certificate_jobs_expires_at_idx` (`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
