-- Immutable package terms, frozen aggregate allowances, and latest-order refund guard.
ALTER TABLE `orders` ADD COLUMN `package_snapshot` JSON NULL;
ALTER TABLE `user_packages`
  ADD COLUMN `traffic_quota` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `request_quota` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `order_id` BIGINT UNSIGNED NULL;
CREATE UNIQUE INDEX `user_packages_order_id_key` ON `user_packages`(`order_id`);
UPDATE `user_packages` AS up
JOIN `packages` AS p ON p.`id` = up.`package_id`
SET up.`traffic_quota` = p.`traffic_quota`, up.`request_quota` = p.`request_quota`;
UPDATE `orders` AS o
SET o.`package_snapshot` = JSON_OBJECT(
  'legacy', TRUE,
  'packageName', (SELECT oi.`name` FROM `order_items` AS oi
                   WHERE oi.`order_id` = o.`id` AND oi.`item_type` = 'package' LIMIT 1),
  'quantity', COALESCE((SELECT oi.`quantity` FROM `order_items` AS oi
                         WHERE oi.`order_id` = o.`id` AND oi.`item_type` = 'package' LIMIT 1), 1),
  'recordedItemPrice', (SELECT CAST(oi.`price` AS CHAR) FROM `order_items` AS oi
                         WHERE oi.`order_id` = o.`id` AND oi.`item_type` = 'package' LIMIT 1)
)
WHERE o.`package_id` IS NOT NULL AND o.`package_snapshot` IS NULL;
