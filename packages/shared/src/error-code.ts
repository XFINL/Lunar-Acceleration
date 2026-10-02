/**
 * 统一错误码（见 03-api.md §1.4）
 */
export enum ErrorCode {
  SUCCESS = 0,

  // 参数错误 40000-40099
  PARAM_INVALID = 40001,
  DOMAIN_FORMAT_INVALID = 40002,

  // 认证错误 40100-40199
  UNAUTHORIZED = 40101,
  TOKEN_EXPIRED = 40102,
  TOKEN_INVALID = 40103,
  CAPTCHA_INVALID = 40104,
  ACCOUNT_DISABLED = 40105,
  CREDENTIALS_INVALID = 40106,

  // 权限错误 40300-40399
  FORBIDDEN = 40301,
  PACKAGE_FEATURE_UNSUPPORTED = 40302,
  QUOTA_EXCEEDED = 40303,

  // 资源不存在 40400-40499
  DOMAIN_NOT_FOUND = 40401,
  NODE_NOT_FOUND = 40402,
  USER_NOT_FOUND = 40403,
  ROLE_NOT_FOUND = 40404,
  RECORD_NOT_FOUND = 40405,

  // 资源冲突 40900-40999
  DOMAIN_EXISTS = 40901,
  USERNAME_EXISTS = 40902,
  EMAIL_EXISTS = 40903,
  ROLE_EXISTS = 40904,

  // 限流 42900-42999
  TOO_MANY_REQUESTS = 42901,

  // 服务器错误 50000-50099
  INTERNAL_ERROR = 50001,

  // 业务错误 60000-60099
  DOMAIN_AUDITING = 60001,
  PACKAGE_EXPIRED = 60002,

  // 第三方错误 70000-70099
  VENDOR_API_ERROR = 70001,
  NODE_COMMUNICATION_ERROR = 70002,
}

/** 错误码 -> 默认中文文案（i18n key 为 error.{code}） */
export const ERROR_MESSAGE_MAP: Record<number, string> = {
  [ErrorCode.SUCCESS]: '成功',
  [ErrorCode.PARAM_INVALID]: '参数校验失败',
  [ErrorCode.DOMAIN_FORMAT_INVALID]: '域名格式错误',
  [ErrorCode.UNAUTHORIZED]: '未登录',
  [ErrorCode.TOKEN_EXPIRED]: 'Token 已过期',
  [ErrorCode.TOKEN_INVALID]: 'Token 无效',
  [ErrorCode.CAPTCHA_INVALID]: '验证码错误或已失效',
  [ErrorCode.ACCOUNT_DISABLED]: '账号已被禁用',
  [ErrorCode.CREDENTIALS_INVALID]: '用户名或密码错误',
  [ErrorCode.FORBIDDEN]: '无权限',
  [ErrorCode.PACKAGE_FEATURE_UNSUPPORTED]: '套餐不支持该功能',
  [ErrorCode.QUOTA_EXCEEDED]: '配额已用完',
  [ErrorCode.DOMAIN_NOT_FOUND]: '域名不存在',
  [ErrorCode.NODE_NOT_FOUND]: '节点不存在',
  [ErrorCode.USER_NOT_FOUND]: '用户不存在',
  [ErrorCode.ROLE_NOT_FOUND]: '角色不存在',
  [ErrorCode.RECORD_NOT_FOUND]: '记录不存在',
  [ErrorCode.DOMAIN_EXISTS]: '域名已存在',
  [ErrorCode.USERNAME_EXISTS]: '用户名已存在',
  [ErrorCode.EMAIL_EXISTS]: '邮箱已被注册',
  [ErrorCode.ROLE_EXISTS]: '角色标识已存在',
  [ErrorCode.TOO_MANY_REQUESTS]: '请求过于频繁',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',
  [ErrorCode.DOMAIN_AUDITING]: '域名审核中',
  [ErrorCode.PACKAGE_EXPIRED]: '套餐已过期',
  [ErrorCode.VENDOR_API_ERROR]: '厂商 API 调用失败',
  [ErrorCode.NODE_COMMUNICATION_ERROR]: '节点通信失败',
}
