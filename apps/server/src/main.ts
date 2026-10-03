import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import type { AppConfig } from './config/configuration'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const configService = app.get(ConfigService)
  const appConfig = configService.get<AppConfig>('app')!

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
  app.use(cookieParser())
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  })

  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lunar-Acceleration API')
    .setDescription('CDN 加速控制面板接口文档')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  await app.listen(appConfig.port, '0.0.0.0')

  const logger = new Logger('Bootstrap')
  logger.log(`服务已启动: ${appConfig.appUrl} (env=${appConfig.env})`)
  logger.log(`接口前缀: /api/v1  文档: ${appConfig.appUrl}/api/docs`)
}

void bootstrap()
