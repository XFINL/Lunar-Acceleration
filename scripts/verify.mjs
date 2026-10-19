import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readdirSync } from 'node:fs'

// Integration verification must never silently pass without its disposable database.
const root = fileURLToPath(new URL('../', import.meta.url))
let database
try {
  database = new URL(process.env.DATABASE_URL ?? '')
} catch {
  console.error('専用テスト DB の DATABASE_URL を指定してください。')
  process.exit(1)
}
if (database.protocol !== 'mysql:' || !/^\/[A-Za-z0-9_]+_test$/.test(database.pathname)) {
  console.error('検証には名前が _test で終わる専用 MySQL データベースが必要です。')
  process.exit(1)
}
const env = {
  ...process.env,
  ACME_WORKER_ENABLED: 'false',
  VENDOR_WRITES_ENABLED: 'false',
  VENDOR_WRITE_WORKER_ENABLED: 'false',
}
function run(args, cwd = root) {
  console.log(`\n[検証] pnpm ${args.join(' ')}`)
  const result = spawnSync('pnpm', args, { cwd, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    console.error('検証に失敗しました。コミット・マージは実行されません。')
    process.exit(result.status || 1)
  }
}
run(['install', '--frozen-lockfile'])
run(['build:shared'])
run(['db:generate'])
run(['db:deploy'])
run(['db:seed'])
// Seed and deploy must be safe to execute again on an already initialized DB.
run(['db:deploy'])
run(['db:seed'])
run(['test:verify'])
run(['lint'])
run(['typecheck'])
run(['build'])
run(['test'])
// Serial files avoid cross-suite fixture mutation and connection-pool exhaustion.
const integrationDir = resolve(root, 'apps/server/test/integration')
const integrationFiles = readdirSync(integrationDir).filter(name => name.endsWith('.test.cjs')).sort()
if (integrationFiles.length === 0) {
  console.error('統合テストが見つかりません。')
  process.exit(1)
}
run(['exec', 'node', '--test', '--test-concurrency=1', ...integrationFiles.map(name => resolve(integrationDir, name))], resolve(root, 'apps/server'))
console.log('\n[検証] ローカル検証完了。実クラウド・実 DNS・TLS の受け入れ試験とは異なります。')
