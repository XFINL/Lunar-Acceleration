const test = require('node:test')
const assert = require('node:assert/strict')
const { PackageService } = require('../dist/modules/package/package.service')

function packageRow(vendorId = 12n) {
  return {
    id: 7n,
    name: 'Vendor package',
    code: 'vendor-package',
    description: null,
    accessType: 2,
    vendorId,
    trafficQuota: 0n,
    bandwidthLimit: 0,
    domainLimit: 0,
    requestQuota: 0n,
    featureFlags: null,
    overQuotaPolicy: 1,
    price: { toFixed: () => '0.00' },
    period: 1,
    status: 1,
    sort: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }
}

function makeService(overrides = {}) {
  const calls = { create: [], update: [], vendorLookup: [], resourceLookup: [] }
  const db = {
    package: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => {
        calls.create.push(data)
        return { id: 7n }
      },
      update: async ({ data }) => {
        calls.update.push(data)
        const definedData = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        )
        return { ...packageRow(), ...definedData }
      },
    },
    vendor: {
      findFirst: async (query) => {
        calls.vendorLookup.push(query)
        return { id: 12n }
      },
    },
    vendorResource: {
      findFirst: async (query) => {
        calls.resourceLookup.push(query)
        return null
      },
    },
    ...overrides,
  }
  return { service: new PackageService(db), db, calls }
}

const createInput = (accessType = 2, vendorId) => ({
  name: 'Vendor package',
  code: 'vendor-package',
  accessType,
  ...(vendorId !== undefined ? { vendorId } : {}),
})

test('create permits an unmapped third-party package and persists null', async () => {
  const { service, calls } = makeService()
  await service.adminCreatePackage(createInput())
  assert.equal(calls.create[0].vendorId, null)
  assert.equal(calls.vendorLookup.length, 0)
})

test('create accepts only an existing enabled vendor mapping', async () => {
  const { service, calls } = makeService()
  await service.adminCreatePackage(createInput(3, '12'))
  assert.equal(calls.create[0].vendorId, 12n)
  assert.deepEqual(calls.vendorLookup[0].where, { id: 12n, status: 1 })
})

test('invalid or unavailable vendor IDs are rejected; self-node mappings cannot be set', async (t) => {
  const invalid = makeService()
  await assert.rejects(invalid.service.adminCreatePackage(createInput(2, '12x')))
  assert.equal(invalid.calls.vendorLookup.length, 0)

  const unavailable = makeService({ vendor: { findFirst: async () => null } })
  await assert.rejects(unavailable.service.adminCreatePackage(createInput(2, '999')))

  const self = makeService()
  await assert.rejects(self.service.adminCreatePackage(createInput(1, '12')))
  assert.equal(self.calls.create.length, 0)
})

test('update omission preserves the existing mapping; explicit null clears it', async () => {
  const { service, db, calls } = makeService()
  db.package.findUnique = async () => packageRow()

  await service.adminUpdatePackage('7', { name: 'Renamed' })
  assert.equal(calls.update[0].vendorId, undefined)
  assert.equal(calls.resourceLookup.length, 0)

  await service.adminUpdatePackage('7', { vendorId: null })
  assert.equal(calls.update[1].vendorId, null)
  const where = calls.resourceLookup[0].where
  assert.equal(where.managedByPanel, true)
  assert.equal(Object.hasOwn(where.domain, 'status'), false)
  assert.equal(Object.hasOwn(where.domain, 'deletedAt'), false)
  assert.equal(where.domain.user.packageId, 7n)
})

test('mapping changes are blocked while any current package user still has a panel-managed resource', async () => {
  const { service, db, calls } = makeService()
  db.package.findUnique = async () => packageRow()
  db.vendorResource.findFirst = async () => ({ id: 44n })

  await assert.rejects(service.adminUpdatePackage('7', { vendorId: null }), /不能更换或清除厂商映射/)
  assert.equal(calls.update.length, 0)
})

test('switching to self-node requires an explicit mapping clear', async () => {
  const { service, db, calls } = makeService()
  db.package.findUnique = async () => packageRow()

  await assert.rejects(service.adminUpdatePackage('7', { accessType: 1 }), /必须清除厂商映射/)
  assert.equal(calls.update.length, 0)
})
