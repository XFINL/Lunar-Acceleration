const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join, relative } = require('node:path')
const ts = require('typescript')
const root = join(__dirname, '../src')

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.tsx') ? [path] : []
  })
}

test('liquid glass component instances are confined to navigation', () => {
  const allowed = new Set(['layouts/components/Header.tsx', 'layouts/components/Sidebar.tsx'])
  for (const path of sourceFiles(root)) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'GlassSurface') {
        assert.ok(allowed.has(relative(root, path)), `${relative(root, path)} must use direct CSS frost, not a liquid backdrop`)
        const variant = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'variant')
        assert.equal(variant?.initializer?.text, 'liquid', 'Navigation explicitly opts into the liquid engine')
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
})

test('shadcn registry configuration is ready for this existing Vite workspace', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../components.json'), 'utf8'))
  assert.equal(config.$schema, 'https://ui.shadcn.com/schema.json')
  assert.equal(config.rsc, false)
  assert.equal(config.tsx, true)
  assert.equal(config.tailwind.css, 'src/index.css')
  assert.equal(config.aliases.ui, '@/components/ui')
  assert.equal(config.aliases.utils, '@/lib/utils')
})

test('plain page background and direct CSS frost never add textures or faux highlights', () => {
  const css = readFileSync(join(root, 'index.css'), 'utf8')
  assert.doesNotMatch(css, /(?:radial|linear|repeating-linear)-gradient\(/)
  for (const name of ['frosted-panel', 'frosted-control', 'frosted-popover']) assert.ok(css.includes(`.${name}`))
  assert.match(css, /backdrop-filter:\s*blur\(20px\)/)
  assert.match(css, /prefers-reduced-transparency/)
  assert.match(css, /forced-colors/)
})

test('ordinary UI components never import liquid glass decoration', () => {
  for (const path of sourceFiles(join(root, 'components/ui'))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /GlassSurface|liquid-glass-react/, relative(root, path))
  }
})
