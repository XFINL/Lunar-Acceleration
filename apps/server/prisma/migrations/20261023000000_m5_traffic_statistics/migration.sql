CREATE TABLE `traffic_stats_hourly` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `domain_id` BIGINT UNSIGNED NOT NULL,
  `stat_time` DATETIME(0) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `traffic` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `traffic_stats_hourly_domain_id_source_stat_time_key` (`domain_id`, `source`, `stat_time`),
  INDEX `traffic_stats_hourly_user_id_stat_time_idx` (`user_id`, `stat_time`),
  INDEX `traffic_stats_hourly_domain_id_stat_time_idx` (`domain_id`, `stat_time`),
  CONSTRAINT `traffic_stats_hourly_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `traffic_stats_hourly_domain_id_fkey`
    FOREIGN KEY (`domain_id`) REFERENCES `domains` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
