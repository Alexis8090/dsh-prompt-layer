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
 * can place its own policy at the end of the system prompt.
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

/**
 * Order used by the 1.0.x default and kept as a public compatibility export.
 *
 * The runtime default is derived in `apply`: the host's
 * `DEPLOYMENT_PERSONA_SUFFIX` + 300 (currently 10500).
 */
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

/**
 * Ask the host for its last built-in section order.
 *
 * Queried at runtime so a host upgrade cannot silently make this plugin
 * render before another built-in section.
 */
function resolveBaseOrder(ctx) {
  const suffix = ctx?.systemPrompt?.getSectionOrder?.('DEPLOYMENT_PERSONA_SUFFIX')
  return typeof suffix === 'number' && Number.isFinite(suffix) ? suffix : HOST_MAX_ORDER
}

function normalizeOrder(value, logger, baseOrder = HOST_MAX_ORDER) {
  const fallback = baseOrder + 300
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    logger.warn(`[prompt-layer] order must be a finite number; using ${fallback}`)
    return fallback
  }
  if (value <= baseOrder) {
    logger.warn(
      `[prompt-layer] order ${value} is not above the host's last section (${baseOrder}); this section will not render last`,
    )
  }
  return value
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
 * A run of two or more opening braces is escaped as a whole: replacing
 * only the first pair would let the replacement's trailing `{` rejoin the
 * next original `{` and form a new `{{` that DSH still parses.
 *
 * A lone `{{` without a later `}}` is already literal in DSH and is left
 * untouched.
 */
export function escapeVariableBraces(text) {
  let escaped = false
  const output = text.replace(/\{{2,}/g, (run, offset) => {
    if (text.indexOf('}}', offset + run.length) === -1) return run
    escaped = true
    return run.split('').join(ZERO_WIDTH_SPACE)
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
 * @param {number} [config.order] - render order; defaults to the host's last
 *   section order + 300 (currently 10500). A value at or below the host base
 *   registers but warns, because the section will not render last.
 * @param {string} [config.sectionName="deploy:custom-layer"] - diagnostics name.
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console

  if (config.enabled === false) return

  const sectionName = normalizeSectionName(config.sectionName)
  const baseOrder = resolveBaseOrder(ctx)
  const order = normalizeOrder(config.order, logger, baseOrder)
  const text = resolveText(config, logger)
  if (text === undefined) return

  const { text: safeText, escaped } = escapeVariableBraces(text)
  if (escaped) {
    logger.warn(
      '[prompt-layer] escaped a brace run to literal braces; DSH reserves those for prompt variables',
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
