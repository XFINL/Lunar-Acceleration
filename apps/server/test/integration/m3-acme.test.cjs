const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')

const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, base, token, db, user
const jwt = new JwtService()
const oldAcmeEnv = {}
for (const key of ['ACME_ACCOUNT_KEY', 'ACME_EMAIL', 'ACME_DIRECTORY', 'ACME_PROFILE', 'ACME_ACCEPT_TOS']) oldAcmeEnv[key] = process.env[key]

async function call(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, payload: await response.json() }
}

before(async () => {
  for (const key of Object.keys(oldAcmeEnv)) delete process.env[key]
  if (!enabled) return
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  db = app.get(PrismaService)
  user = await db.user.create({ data: { username: `acme_it_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  const role = await db.role.findUniqueOrThrow({ where: { code: 'user' } })
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } })
  token = jwt.sign({ sub: user.id.toString(), username: user.username, roleType: user.roleType }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '10m' })
})

after(async () => {
  if (app) await app.close()
  for (const [key, value] of Object.entries(oldAcmeEnv)) if (value !== undefined) process.env[key] = value
})

integration('M3 ACME: apply and apply-acme aliases fail actionably without contacting a CA when unconfigured', async () => {
  for (const route of ['/user/certificates/apply', '/user/certificates/apply-acme']) {
    const result = await call(route, 'POST', {})
    assert.notEqual(result.payload.code, 0)
    assert.match(JSON.stringify(result.payload), /ACME is not configured/)
    assert.equal(result.status, 400)
  }
})
