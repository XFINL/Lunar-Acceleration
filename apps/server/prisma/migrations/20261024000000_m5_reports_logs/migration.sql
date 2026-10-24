ALTER TABLE `traffic_stats_hourly`
  ADD COLUMN `requests` DECIMAL(40,0) NOT NULL DEFAULT 0,
  ADD COLUMN `bandwidth_peak` DECIMAL(40,0) NOT NULL DEFAULT 0,
  ADD COLUMN `cache_hit` DECIMAL(40,0) NOT NULL DEFAULT 0,
  ADD COLUMN `cache_miss` DECIMAL(40,0) NOT NULL DEFAULT 0;

CREATE TABLE `traffic_status_hourly` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `stat_time` DATETIME(0) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `status_code` SMALLINT UNSIGNED NOT NULL,
  `requests` DECIMAL(40,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (`domain_id`,`source`,`stat_time`,`status_code`),
  INDEX `traffic_status_hourly_user_id_stat_time_status_code_idx` (`user_id`,`stat_time`,`status_code`),
  CONSTRAINT `traffic_status_hourly_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `traffic_status_hourly_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `traffic_status_hourly_hourly_fkey` FOREIGN KEY (`domain_id`,`source`,`stat_time`) REFERENCES `traffic_stats_hourly` (`domain_id`,`source`,`stat_time`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `access_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `event_time` DATETIME(0) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `status_code` SMALLINT UNSIGNED NOT NULL,
  `bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `user_agent` VARCHAR(512) NULL,
  `region` VARCHAR(96) NULL,
  `isp` VARCHAR(96) NULL,
  `source` VARCHAR(16) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `access_logs_domain_id_event_time_id_idx` (`domain_id`,`event_time`,`id`),
  INDEX `access_logs_user_id_event_time_id_idx` (`user_id`,`event_time`,`id`),
  INDEX `access_logs_expires_at_idx` (`expires_at`),
  INDEX `access_logs_domain_id_status_code_event_time_idx` (`domain_id`,`status_code`,`event_time`),
  CONSTRAINT `access_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `access_logs_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `log_delivery_configs` (
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `retention_days` TINYINT UNSIGNED NOT NULL DEFAULT 30,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`domain_id`),
  INDEX `log_delivery_configs_user_id_idx` (`user_id`),
  CONSTRAINT `log_delivery_configs_domain_id_fkey` FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `log_delivery_configs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
