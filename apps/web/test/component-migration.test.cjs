const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readdirSync, readFileSync } = require('node:fs')
const { join, relative } = require('node:path')
const ts = require('typescript')

const root = join(__dirname, '../src')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}
const sources = files(root).map(path => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true))
function visit(source, check) {
  function walk(node) {
    check(node, relative(root, source.fileName))
    ts.forEachChild(node, walk)
  }
  walk(source)
}

test('source modules stay syntactically valid during UI migration', () => {
  for (const source of sources) {
    assert.equal(source.parseDiagnostics.length, 0, relative(root, source.fileName))
  }
})

test('resource pages never fall back to blocking browser confirmation', () => {
  for (const source of sources) visit(source, (node, path) => {
    if (!ts.isCallExpression(node)) return
    const target = node.expression
    const nativeConfirm = ts.isIdentifier(target) ? target.text === 'confirm'
      : ts.isPropertyAccessExpression(target) && ['window', 'globalThis'].includes(target.expression.getText(source)) && target.name.text === 'confirm'
    assert.equal(Boolean(nativeConfirm), false, `${path}: use ConfirmAction instead`)
  })
})

test('Select and checkbox consumers use the shared accessible components', () => {
  for (const source of sources) visit(source, (node, path) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/components/ui/select') {
      for (const item of node.importClause?.namedBindings?.elements ?? []) {
        assert.notEqual((item.propertyName ?? item.name).text, 'Select', `${path}: use the public SelectRoot API`)
      }
    }
    if (!(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) return
    const tag = node.tagName.getText(source)
    assert.ok(!['select', 'option'].includes(tag), `${path}: legacy Select markup`)
    if (tag !== 'input') return
    const type = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'type')
    if (type?.initializer && ts.isStringLiteral(type.initializer)) {
      assert.notEqual(type.initializer.text, 'checkbox', `${path}: use Checkbox instead`)
    }
  })
})

test('all M3 and vendor management pages retain a nonempty exported component', () => {
  for (const path of ['pages/user/CachePage.tsx', 'pages/user/DomainsPage.tsx', 'pages/user/OriginsPage.tsx', 'pages/user/CertificatesPage.tsx', 'pages/admin/VendorsPage.tsx']) {
    const source = sources.find(item => relative(root, item.fileName) === path)
    assert.ok(source && source.text.trim().length > 500, `${path}: page content missing`)
    const name = path.split('/').at(-1).replace('.tsx', '')
    assert.ok(source.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === name && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)), `${path}: exported page component missing`)
  }
})

test('page utilities preserve the monochrome palette', () => {
  for (const source of sources) {
    assert.doesNotMatch(source.text, /(?:text|bg|border|ring)-(?:amber|green|red|blue|indigo|purple|yellow|emerald|rose|cyan|orange|violet|pink|teal|lime|fuchsia|sky)-\d+/, relative(root, source.fileName))
  }
})
