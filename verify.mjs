#!/usr/bin/env node
/**
 * Optional integration check against a real DSH SystemPrompt service.
 *
 * The unit tests in `test/` use a stub context and need no dependencies.
 * This script goes one step further: it mounts the plugin into the real
 * `SystemPrompt` implementation, assembles the prompt, and asserts that
 * this plugin's section really is the last one.
 *
 * Usage:
 *   node verify.mjs
 *   node verify.mjs --modules "C:\Users\<you>\.dsh\profiles\node_modules"
 *   DSH_PROFILE_NODE_MODULES=... node verify.mjs
 *
 * If the DSH packages are not resolvable, the script prints SKIP and
 * exits 0: it is a diagnostic, not a gate.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply, DEFAULT_ORDER } from './lib/index.js'

const args = process.argv.slice(2)
const modulesIndex = args.indexOf('--modules')
const modulesDir =
  modulesIndex !== -1 ? args[modulesIndex + 1] : process.env.DSH_PROFILE_NODE_MODULES

async function loadHost() {
  if (modulesDir) {
    const systemPromptPath = join(
      modulesDir,
      '@deepseek-ai',
      'dsh-system-prompt',
      'lib',
      'index.js',
    )
    const cordisPath = join(modulesDir, '@deepseek-ai', 'cordis', 'lib', 'index.js')
    if (!existsSync(systemPromptPath) || !existsSync(cordisPath)) {
      console.log(`SKIP: DSH packages not found under ${modulesDir}`)
      process.exit(0)
    }
    const systemPrompt = await import(pathToFileURL(systemPromptPath).href)
    const cordis = await import(pathToFileURL(cordisPath).href)
    return { ...systemPrompt, ...cordis }
  }

  try {
    const systemPrompt = await import('@deepseek-ai/dsh-system-prompt')
    const cordis = await import('@deepseek-ai/cordis')
    return { ...systemPrompt, ...cordis }
  } catch {
    console.log(
      'SKIP: @deepseek-ai/dsh-system-prompt is not installed. Pass --modules <profile node_modules>.',
    )
    process.exit(0)
  }
}

const { SystemPrompt, renderPrompt, Context } = await loadHost()

const text = 'VERIFY: the deployment layer is the last text in the system prompt.'
const sectionName = 'deploy:verify'

const ctx = new Context()
new SystemPrompt(ctx, {})
apply(ctx, { text, sectionName, order: DEFAULT_ORDER })

const assembly = await ctx.systemPrompt.assemble()
const rendered = renderPrompt(assembly)
const last = assembly.sections.at(-1)

let failures = 0
function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
  if (!condition) failures += 1
}

check('section registered', assembly.sections.some((section) => section.name === sectionName))
check('section renders last', last?.name === sectionName, `last=${last?.name}`)
check('rendered prompt contains the text', rendered.includes(text))
check('rendered prompt ends with the text', rendered.trimEnd().endsWith(text))
check('order is above the host maximum', DEFAULT_ORDER > 10200, `order=${DEFAULT_ORDER}`)

console.log('\nsections seen by the registry:')
for (const section of assembly.sections) console.log(`  ${section.order}\t${section.name}`)

assert.equal(failures, 0, `${failures} verification(s) failed`)
console.log('\nOK: dsh-prompt-layer renders after every built-in section.')
