const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

// Compile the actual pure TS helper with the project's existing TypeScript dependency.
// This keeps the tests runnable on the supported Node 20+ without a new test framework.
const file = join(__dirname, '../src/lib/monochrome.ts')
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const context = { exports: {} }
vm.runInNewContext(compiled.outputText, context, { filename: file, timeout: 1000 })
const { monochromePalette } = context.exports

const grayLuminance = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const contrast = (a, b) => (Math.max(grayLuminance(a), grayLuminance(b)) + 0.05) / (Math.min(grayLuminance(a), grayLuminance(b)) + 0.05)
const lightness = hsl => Number.parseFloat(hsl.split(' ')[2]) / 100

test('React and React DOM run the same React 19 version', () => {
  assert.match(React.version, /^19\./)
  assert.equal(require('react-dom/package.json').version, React.version)
  assert.equal(require('react-is/package.json').version, React.version)
})

test('Recharts resolves a react-is that recognizes real React 19 elements', () => {
  const chartRequire = createRequire(require.resolve('recharts'))
  assert.equal(chartRequire('react-is').isElement(React.createElement('span')), true)
})

test('brand colors remain neutral and shorthand/case variants agree', () => {
  for (const hex of ['#6366f1', '#ff0000', '#00ff00', '#0000ff', '#000', '#fff']) {
    const palette = monochromePalette(hex)
    assert.match(palette.light, /^0 0% \d+%$/)
    assert.match(palette.dark, /^0 0% \d+%$/)
  }
  assert.equal(monochromePalette('#AbC').light, monochromePalette('#aabbcc').light)
  assert.equal(monochromePalette('#AbC').dark, monochromePalette('#aabbcc').dark)
})

test('invalid or CSS-injection-like brand inputs are rejected', () => {
  for (const value of [null, undefined, 19, {}, [], '', 'red', '#12', '#abcd', '#000000; color:red', 'url(javascript:alert(1))']) {
    assert.equal(monochromePalette(value), undefined)
  }
})

test('all RGB boundary tones retain AA primary-button contrast in both themes', () => {
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        const hex = `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
        const palette = monochromePalette(hex)
        assert.ok(contrast(lightness(palette.light), 0.98) >= 4.5, `light contrast: ${hex}`)
        assert.ok(contrast(lightness(palette.dark), 0.09) >= 4.5, `dark contrast: ${hex}`)
      }
    }
  }
})

test('literal HSL theme tokens have no colored saturation', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf8')
  const tokens = [...css.matchAll(/--[\w-]+:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/g)]
  assert.ok(tokens.length > 20)
  for (const token of tokens) assert.equal(Number(token[2]), 0, token[0])
})
