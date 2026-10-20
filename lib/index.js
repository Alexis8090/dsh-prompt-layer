/**
 * dsh-prompt-layer
 *
 * Register one configurable section at the end of the DeepSeek Harness
 * system prompt.
 *
 * Why a system-prompt section: workspace instructions (`AGENTS.md` /
 * `CLAUDE.md`) are delivered as a *user* message whose frame explicitly
 * says they do not override system, developer, or direct user
 * instructions. A section registered here lives in the system prompt
 * itself and is rendered after every built-in section, so a deployment
 * can make its own policy the last text the model reads.
 *
 * The plugin is deliberately generic: it contains no policy text of its
 * own. Operators supply the text through `config.text` or a file.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const name = 'prompt-layer'

/** The host service this plugin registers into. */
export const inject = ['systemPrompt']

/** Highest order used by the host for its own sections (`DEPLOYMENT_PERSONA_SUFFIX`). */
export const HOST_MAX_ORDER = 10200

/** Default order: greater than every built-in section, so this one renders last. */
export const DEFAULT_ORDER = 10500

/** Default section name, shown in host diagnostics. */
export const DEFAULT_SECTION_NAME = 'deploy:custom-layer'

/**
 * Zero-width space used to break a literal `{{` pair.
 *
 * DSH renders strict `{{name}}` variable references and throws on an
 * unknown name. Operator text is plain prose, so a complete brace group
 * is made literal instead of being allowed to break prompt assembly.
 */
const ZERO_WIDTH_SPACE = '\u200B'

function normalizeOrder(value, logger) {
  if (value === undefined) return DEFAULT_ORDER
  if (typeof value === 'number' && Number.isFinite(value)) return value
  logger.warn(`[prompt-layer] order must be a finite number; using ${DEFAULT_ORDER}`)
  return DEFAULT_ORDER
}

function normalizeSectionName(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : DEFAULT_SECTION_NAME
}

function resolveText(config, logger) {
  let text = typeof config.text === 'string' ? config.text : ''

  const textFile =
    typeof config.textFile === 'string' && config.textFile.trim() !== ''
      ? config.textFile.trim()
      : ''

  if (textFile !== '') {
    const absolutePath = resolve(textFile)
    try {
      text = readFileSync(absolutePath, 'utf8')
    } catch (error) {
      logger.warn(
        `[prompt-layer] cannot read textFile "${absolutePath}": ${error.message}; section not registered`,
      )
      return undefined
    }
  }

  const trimmed = text.trim()
  if (trimmed === '') {
    logger.warn('[prompt-layer] empty text; section not registered')
    return undefined
  }
  return trimmed
}

/**
 * Break complete `{{...}}` groups so DSH treats them as literal prose.
 *
 * A lone `{{` without a later `}}` is already literal in DSH and is left
 * untouched.
 */
export function escapeVariableBraces(text) {
  let escaped = false
  const output = text.replace(/\{\{/g, (match, offset) => {
    if (text.indexOf('}}', offset + 2) === -1) return match
    escaped = true
    return `{${ZERO_WIDTH_SPACE}{`
  })
  return { text: output, escaped }
}

/**
 * Register the configured system-prompt section.
 *
 * @param {object} ctx - host plugin context carrying the `systemPrompt` service.
 * @param {object} [config] - plugin configuration from the profile patch.
 * @param {boolean} [config.enabled=true] - set false to disable without unmounting.
 * @param {string} [config.text] - inline section text.
 * @param {string} [config.textFile] - UTF-8 file; takes precedence over `text`.
 * @param {number} [config.order=10500] - render order; larger renders later.
 * @param {string} [config.sectionName="deploy:custom-layer"] - diagnostics name.
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console

  if (config.enabled === false) return

  const sectionName = normalizeSectionName(config.sectionName)
  const order = normalizeOrder(config.order, logger)
  const text = resolveText(config, logger)
  if (text === undefined) return

  const { text: safeText, escaped } = escapeVariableBraces(text)
  if (escaped) {
    logger.warn(
      '[prompt-layer] escaped a complete {{...}} group to literal braces; DSH reserves those for prompt variables',
    )
  }

  const register = () =>
    ctx.systemPrompt.section({
      name: sectionName,
      order,
      text: safeText,
    })

  if (typeof ctx.effect === 'function') {
    ctx.effect(register, 'dsh-prompt-layer: custom section')
  } else {
    register()
  }
}
