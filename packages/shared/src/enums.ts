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
