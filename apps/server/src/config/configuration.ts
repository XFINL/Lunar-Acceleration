export interface AppConfig {
  env: string
  port: number
  appUrl: string
  corsOrigins: string[]
}

export interface DatabaseConfig {
  url: string
}

export interface RedisConfig {
  host: string
  port: number
  password?: string
  db: number
}

export interface JwtConfig {
  secret: string
  expiresIn: string
  refreshSecret: string
  refreshExpiresIn: string
}

export interface ThrottleConfig {
  ttl: number
  limit: number
  loginLimit: number
}

export interface SecurityConfig {
  encryptionKey: string
}

export interface LogConfig {
  level: string
}

export interface AllConfig {
  app: AppConfig
  database: DatabaseConfig
  redis: RedisConfig
  jwt: JwtConfig
  throttle: ThrottleConfig
  security: SecurityConfig
  log: LogConfig
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export default (): AllConfig => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: toInt(process.env.PORT, 3000),
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toInt(process.env.REDIS_DB, 0),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev_access_secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  throttle: {
    ttl: toInt(process.env.THROTTLE_TTL, 60),
    limit: toInt(process.env.THROTTLE_LIMIT, 100),
    loginLimit: toInt(process.env.LOGIN_THROTTLE_LIMIT, 5),
  },
  security: {
    encryptionKey:
      process.env.ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
})
