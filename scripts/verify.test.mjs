import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./verify.mjs', import.meta.url))
for (const [name, url] of [
  ['missing URL', ''],
  ['invalid URL', 'not-a-url'],
  ['production database', 'mysql://test:test@127.0.0.1/lunar'],
  ['wrong protocol', 'postgres://test:test@127.0.0.1/lunar_test'],
  ['unsafe database name', 'mysql://test:test@127.0.0.1/lunar%20_test'],
]) {
  test(`verification refuses ${name} before running pnpm`, () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: url, PATH: '' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /DATABASE_URL|専用 MySQL/)
  })
}
