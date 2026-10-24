CREATE TABLE `node_groups` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL,
  `region` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nodes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `ip` VARCHAR(64) NOT NULL,
  `port` INT UNSIGNED NOT NULL DEFAULT 443,
  `region` VARCHAR(64) NULL,
  `isp` VARCHAR(64) NULL,
  `node_group_id` BIGINT UNSIGNED NULL,
  `status` TINYINT NOT NULL DEFAULT 2 COMMENT '1 online, 2 offline, 3 maintenance, 4 deploying',
  `weight` INT UNSIGNED NOT NULL DEFAULT 1,
  `version` VARCHAR(32) NULL,
  `cpu_cores` INT UNSIGNED NULL,
  `memory_mb` INT UNSIGNED NULL,
  `disk_gb` INT UNSIGNED NULL,
  `bandwidth_mbps` INT UNSIGNED NULL,
  `last_heartbeat` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `nodes_status_idx` (`status`),
  INDEX `nodes_region_idx` (`region`),
  INDEX `nodes_node_group_id_idx` (`node_group_id`),
  CONSTRAINT `nodes_node_group_id_fkey` FOREIGN KEY (`node_group_id`) REFERENCES `node_groups` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `node_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `node_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL COMMENT 'hex SHA-256 of raw one-time token; never store raw token',
  `status` TINYINT NOT NULL DEFAULT 1,
  `expire_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `node_tokens_node_id_key` (`node_id`),
  CONSTRAINT `node_tokens_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `node_metrics` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `node_id` BIGINT UNSIGNED NOT NULL,
  `stat_time` DATETIME NOT NULL,
  `cpu_usage` DECIMAL(5,2) NULL,
  `mem_usage` DECIMAL(5,2) NULL,
  `disk_usage` DECIMAL(5,2) NULL,
  `bandwidth_in` BIGINT UNSIGNED NULL,
  `bandwidth_out` BIGINT UNSIGNED NULL,
  `connections` INT UNSIGNED NULL,
  `qps` INT UNSIGNED NULL,
  `cache_hit_rate` DECIMAL(5,2) NULL,
  PRIMARY KEY (`id`),
  INDEX `node_metrics_node_id_stat_time_idx` (`node_id`, `stat_time`),
  CONSTRAINT `node_metrics_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `node_request_nonces` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `node_id` BIGINT UNSIGNED NOT NULL,
  `nonce` VARCHAR(128) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `node_request_nonces_node_id_nonce_key` (`node_id`, `nonce`),
  INDEX `node_request_nonces_expires_at_idx` (`expires_at`),
  CONSTRAINT `node_request_nonces_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
