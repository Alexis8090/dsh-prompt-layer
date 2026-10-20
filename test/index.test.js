import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  apply,
  escapeVariableBraces,
  name,
  inject,
  DEFAULT_ORDER,
  DEFAULT_SECTION_NAME,
} from '../lib/index.js'

function createCtx() {
  const sections = []
  const warnings = []
  return {
    sections,
    warnings,
    systemPrompt: {
      section(options) {
        sections.push(options)
        return () => {}
      },
    },
    effect(fn) {
      return fn()
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
      info() {},
    },
  }
}

test('exports the host contract', () => {
  assert.equal(name, 'prompt-layer')
  assert.deepEqual(inject, ['systemPrompt'])
})

test('registers the configured text with default name and order', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'hello from the deployment layer' })

  assert.equal(ctx.sections.length, 1)
  assert.deepEqual(ctx.sections[0], {
    name: DEFAULT_SECTION_NAME,
    order: DEFAULT_ORDER,
    text: 'hello from the deployment layer',
  })
})

test('honours a custom section name and order', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'custom', sectionName: 'deploy:team-policy', order: 20000 })

  assert.deepEqual(ctx.sections[0], {
    name: 'deploy:team-policy',
    order: 20000,
    text: 'custom',
  })
})

test('falls back to the default order when order is not finite', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'x', order: Number.NaN })

  assert.equal(ctx.sections[0].order, DEFAULT_ORDER)
  assert.ok(ctx.warnings.some((message) => message.includes('order must be a finite number')))
})

test('set enabled=false registers nothing', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'x', enabled: false })

  assert.equal(ctx.sections.length, 0)
})

test('empty text registers nothing and warns', () => {
  const ctx = createCtx()
  apply(ctx, { text: '   \n  ' })

  assert.equal(ctx.sections.length, 0)
  assert.ok(ctx.warnings.some((message) => message.includes('empty text')))
})

test('textFile takes precedence over text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prompt-layer-'))
  try {
    const file = join(dir, 'policy.txt')
    writeFileSync(file, 'from file\n', 'utf8')

    const ctx = createCtx()
    apply(ctx, { text: 'inline', textFile: file })

    assert.equal(ctx.sections[0].text, 'from file')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing textFile registers nothing and warns', () => {
  const ctx = createCtx()
  apply(ctx, { textFile: join(tmpdir(), 'dsh-prompt-layer-does-not-exist.txt') })

  assert.equal(ctx.sections.length, 0)
  assert.ok(ctx.warnings.some((message) => message.includes('cannot read textFile')))
})

test('trims surrounding whitespace before registering', () => {
  const ctx = createCtx()
  apply(ctx, { text: '\n\n  padded  \n\n' })

  assert.equal(ctx.sections[0].text, 'padded')
})

test('escapes complete {{...}} groups so prompt assembly cannot throw', () => {
  const { text, escaped } = escapeVariableBraces('literal {{unknown}} braces')

  assert.equal(escaped, true)
  assert.equal(text.includes('{{'), false)
  assert.ok(text.includes('unknown'))
})

test('leaves a lone {{ as literal prose', () => {
  const { text, escaped } = escapeVariableBraces('a lone {{ stays')

  assert.equal(escaped, false)
  assert.equal(text, 'a lone {{ stays')
})

test('apply escapes braces in the registered text', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'value: {{unknown}}' })

  assert.equal(ctx.sections[0].text.includes('{{'), false)
  assert.ok(ctx.warnings.some((message) => message.includes('escaped')))
})

test('escapes a run of three or more opening braces', () => {
  for (const input of ['{{a}}', '{{{a}}}', '{{{{a}}}}', '{{ a }}', '{{a}{b}}']) {
    const { text } = escapeVariableBraces(input)
    assert.equal(text.includes('{{'), false, input)
  }
})

test('apply escapes brace runs before registering', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'example: {{{{name}}}}' })

  assert.equal(ctx.sections[0].text.includes('{{'), false)
})

test('warns when order is not above the host last section', () => {
  const ctx = createCtx()
  apply(ctx, { text: 'x', order: 500 })

  assert.ok(ctx.warnings.some((message) => message.includes('not above')))
})

test('derives the default order from the host base when available', () => {
  const ctx = createCtx()
  ctx.systemPrompt.getSectionOrder = () => 10250
  apply(ctx, { text: 'x' })

  assert.equal(ctx.sections[0].order, 10550)
})
