const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')

const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
let app, base, token
before(async () => {
  if (!enabled) return
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  const db = app.get(PrismaService)
  const user = await db.user.create({ data: { username: `http_${Date.now()}_${process.pid}`, passwordHash: 'fixture', roleType: 1 } })
  token = new JwtService().sign({ sub: user.id.toString(), username: user.username, roleType: 1 }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '5m' })
})
after(async () => { if (app) await app.close() })

integration('HTTP: anonymous callers cannot fetch SMTP credentials', async () => {
  const response = await fetch(`${base}/user/site-config/email`)
  const payload = await response.json()
  assert.notEqual(payload.code, 0)
  assert.ok(!JSON.stringify(payload).includes('configValue'))
})
integration('HTTP: public basic branding works without authentication', async () => {
  const response = await fetch(`${base}/user/site-config/basic`)
  const payload = await response.json()
  assert.equal(payload.code, 0)
  assert.equal(typeof payload.data.siteName, 'string')
})
integration('HTTP: order endpoints require authentication', async () => {
  const response = await fetch(`${base}/user/orders`)
  const payload = await response.json()
  assert.notEqual(payload.code, 0)
})
integration('HTTP: ordinary user cannot read administrator settings', async () => {
  const response = await fetch(`${base}/admin/site-config`, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json()
  assert.notEqual(payload.code, 0)
})
