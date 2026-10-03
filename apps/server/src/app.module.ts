import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import configuration, { type ThrottleConfig } from './config/configuration'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { OrderModule } from './modules/order/order.module'
import { PackageModule } from './modules/package/package.module'
import { RbacModule } from './modules/rbac/rbac.module'
import { SettingModule } from './modules/setting/setting.module'
import { UserModule } from './modules/user/user.module'
import { PrismaModule } from './database/prisma.module'
import { I18nModule } from './shared/i18n/i18n.module'
import { RedisModule } from './shared/redis/redis.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { AuditInterceptor } from './common/interceptors/audit.interceptor'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const throttle = configService.get<ThrottleConfig>('throttle')!
        return {
          throttlers: [{ ttl: throttle.ttl * 1000, limit: throttle.limit }],
        }
      },
    }),
    // 基础设施（均为 @Global）
    PrismaModule,
    RedisModule,
    I18nModule,
    // 业务模块
    AuthModule,
    RbacModule,
    UserModule,
    PackageModule,
    OrderModule,
    SettingModule,
    AuditModule,
  ],
  providers: [
    // 限流 -> 认证
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 注册顺序即执行顺序：Logging 最外，Transform 包裹响应，Audit 最内（拿到原始返回值）
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL })
  }
}
