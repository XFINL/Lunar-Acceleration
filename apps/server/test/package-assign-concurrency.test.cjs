const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PackageService } = require('../dist/modules/package/package.service.js')

function makeDb(transaction) {
  const user = { id: 5n, deletedAt: null }
  const pkg = { id: 9n, period: 1, trafficQuota: 1200n, requestQuota: 3400n }
  const txCalls = { locks: 0, eligibilityChecks: 0, cancelled: 0, created: [], updated: [] }
  const tx = {
    $queryRaw: async () => { txCalls.locks += 1; return [] },
    user: {
      findFirst: async () => { txCalls.eligibilityChecks += 1; return { id: user.id } },
      update: async (args) => { txCalls.updated.push(args); return args.data },
    },
    userPackage: {
      updateMany: async (args) => { txCalls.cancelled += 1; return { count: 1, args } },
      create: async (args) => { txCalls.created.push(args); return args.data },
    },
  }
  return {
    db: {
      user: { findFirst: async () => user },
      package: { findUnique: async () => pkg },
      $transaction: (callback) => transaction(callback, tx),
    },
    txCalls,
  }
}

function p2034(message = 'deadlock') {
  return Object.assign(new Error(message), { code: 'P2034' })
}

test('assignPackage retries a P2034 transaction and commits the package assignment', async () => {
  let attempts = 0
  const { db, txCalls } = makeDb(async (callback, tx) => {
    attempts += 1
    const result = await callback(tx)
    if (attempts === 1) throw p2034()
    return result
  })

  const result = await new PackageService(db).assignPackage('5', '9')

  assert.equal(attempts, 2)
  assert.equal(txCalls.locks, 2)
  assert.equal(txCalls.eligibilityChecks, 2)
  assert.equal(txCalls.cancelled, 2)
  assert.equal(txCalls.created.length, 2)
  assert.equal(txCalls.created[1].data.userId, 5n)
  assert.equal(txCalls.created[1].data.packageId, 9n)
  assert.equal(txCalls.created[1].data.status, 1)
  assert.equal(txCalls.created[1].data.trafficQuota, 1200n)
  assert.equal(txCalls.created[1].data.requestQuota, 3400n)
  assert.equal(result.userId, '5')
  assert.equal(result.packageId, '9')
  assert.ok(result.expireAt instanceof Date)
  assert.equal(txCalls.updated[1].data.packageId, 9n)
  assert.deepEqual(txCalls.updated[1].data.packageExpireAt, result.expireAt)
})

test('assignPackage stops after three P2034 transaction attempts and propagates the last failure', async () => {
  let attempts = 0
  const finalError = p2034('still contended')
  const { db } = makeDb(async () => {
    attempts += 1
    throw attempts === 3 ? finalError : p2034()
  })

  await assert.rejects(new PackageService(db).assignPackage('5', '9'), (error) => error === finalError)
  assert.equal(attempts, 3)
})

test('assignPackage does not retry non-P2034 transaction errors', async () => {
  let attempts = 0
  const failure = Object.assign(new Error('constraint failure'), { code: 'P2002' })
  const { db } = makeDb(async () => {
    attempts += 1
    throw failure
  })

  await assert.rejects(new PackageService(db).assignPackage('5', '9'), (error) => error === failure)
  assert.equal(attempts, 1)
})
