const { test } = require('node:test')
const assert = require('node:assert/strict')
const { LocalStorageService } = require('../dist/modules/setting/storage/local.storage')

test('uploaded images cannot retain attacker-supplied HTML extensions', async () => {
  const storage = new LocalStorageService()
  const stored = await storage.save({originalname:'dangerous.html',mimetype:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10]),size:8})
  try {
    assert.ok(stored.path.endsWith('.png'))
    assert.ok(!stored.path.endsWith('.html'))
  } finally { await storage.remove(stored.path) }
})
test('active upload types cannot be stored as site assets', async () => {
  const storage = new LocalStorageService()
  await assert.rejects(()=>storage.save({originalname:'x.svg',mimetype:'image/svg+xml',buffer:Buffer.from('<svg/>'),size:6}))
})
