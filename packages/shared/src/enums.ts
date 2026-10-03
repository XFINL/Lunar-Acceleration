/**
 * 角色类型（与 users.role_type 对应）
 */
export enum RoleType {
  /** 普通用户 */
  USER = 1,
  /** 管理员 */
  ADMIN = 2,
  /** 超级管理员 */
  SUPER_ADMIN = 3,
}

/**
 * 用户状态（与 users.status 对应）
 */
export enum UserStatus {
  /** 禁用 */
  DISABLED = 0,
  /** 正常 */
  ACTIVE = 1,
  /** 待审核 */
  PENDING = 2,
}

/**
 * 数据范围
 */
export enum DataScope {
  /** 全部数据 */
  ALL = 'all',
  /** 本组数据 */
  GROUP = 'group',
  /** 自己的数据 */
  SELF = 'self',
}

/**
 * 系统内置角色标识（与 roles.code 对应）
 */
export enum RoleCode {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  OPS = 'ops',
  USER = 'user',
  SUB_USER = 'sub_user',
}

/** 角色中文名 */
export const ROLE_NAME_MAP: Record<RoleCode, string> = {
  [RoleCode.SUPER_ADMIN]: '超级管理员',
  [RoleCode.ADMIN]: '管理员',
  [RoleCode.OPS]: '运维',
  [RoleCode.USER]: '用户',
  [RoleCode.SUB_USER]: '子用户',
}

// ============================================================
// M2 套餐与订单
// ============================================================

/** 套餐接入类型（packages.access_type） */
export enum PackageAccessType {
  /** 自建节点 */
  SELF_NODE = 1,
  /** 第三方厂商 */
  VENDOR = 2,
  /** 混合 */
  HYBRID = 3,
}

export const PACKAGE_ACCESS_TYPE_MAP: Record<PackageAccessType, string> = {
  [PackageAccessType.SELF_NODE]: '自建节点',
  [PackageAccessType.VENDOR]: '第三方厂商',
  [PackageAccessType.HYBRID]: '混合',
}

/** 套餐周期（packages.period） */
export enum PackagePeriod {
  MONTH = 1,
  QUARTER = 2,
  YEAR = 3,
}

export const PACKAGE_PERIOD_MAP: Record<PackagePeriod, string> = {
  [PackagePeriod.MONTH]: '月',
  [PackagePeriod.QUARTER]: '季',
  [PackagePeriod.YEAR]: '年',
}

/** 套餐上下架状态（packages.status） */
export enum PackageStatus {
  OFFLINE = 0,
  ONLINE = 1,
}

/** 超额度策略（packages.over_quota_policy） */
export enum OverQuotaPolicy {
  /** 限速 */
  LIMIT_SPEED = 1,
  /** 按量扣费 */
  PAY_AS_YOU_GO = 2,
  /** 停服 */
  SUSPEND = 3,
}

export const OVER_QUOTA_POLICY_MAP: Record<OverQuotaPolicy, string> = {
  [OverQuotaPolicy.LIMIT_SPEED]: '限速',
  [OverQuotaPolicy.PAY_AS_YOU_GO]: '按量扣费',
  [OverQuotaPolicy.SUSPEND]: '停服',
}

/** 用户套餐状态（user_packages.status） */
export enum UserPackageStatus {
  ACTIVE = 1,
  EXPIRED = 2,
  CANCELLED = 3,
}

/** 订单状态（orders.status） */
export enum OrderStatus {
  /** 待支付 */
  PENDING = 1,
  /** 已支付 */
  PAID = 2,
  /** 已取消 */
  CANCELLED = 3,
  /** 已退款 */
  REFUNDED = 4,
}

export const ORDER_STATUS_MAP: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: '待支付',
  [OrderStatus.PAID]: '已支付',
  [OrderStatus.CANCELLED]: '已取消',
  [OrderStatus.REFUNDED]: '已退款',
}

/** 支付状态（payments.status） */
export enum PaymentStatus {
  PENDING = 1,
  SUCCESS = 2,
  FAILED = 3,
  REFUNDED = 4,
}

/** 资金流水类型（transactions.type） */
export enum TransactionType {
  INCOME = 1,
  EXPENSE = 2,
}

export const TRANSACTION_TYPE_MAP: Record<TransactionType, string> = {
  [TransactionType.INCOME]: '收入',
  [TransactionType.EXPENSE]: '支出',
}

/** 支付渠道标识 */
export const PAY_CHANNELS = ['wechat', 'alipay', 'stripe'] as const
export type PayChannel = (typeof PAY_CHANNELS)[number]

export const PAY_CHANNEL_MAP: Record<PayChannel, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  stripe: 'Stripe',
}

/** 订单明细类型 */
export const ORDER_ITEM_TYPES = ['package', 'traffic_pack', 'bandwidth_pack'] as const
export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number]

