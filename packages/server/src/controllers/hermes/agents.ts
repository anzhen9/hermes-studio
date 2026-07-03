import { readFile, stat } from 'fs/promises'
import { resolve, join } from 'path'
import type { Context } from 'koa'
import { isPathWithin } from '../../services/hermes/hermes-path'

/**
 * Resolve the root directory that contains agent markdown files.
 *
 * Candidates are tried in order; the first that exists and is a
 * directory wins. This keeps the resolver working across:
 *   - ts-node dev (source at packages/server/src/controllers/hermes)
 *   - built server (dist/server/...)
 *   - packaged desktop runtime
 */
async function resolveAgentsRoot(): Promise<string | null> {
  const candidates = [
    // ts-node dev: __dirname = packages/server/src/controllers/hermes
    resolve(__dirname, '..', '..', '..', '..', 'agents'),
    // esbuild bundle: __dirname = dist/server (single index.js)
    resolve(__dirname, '..', 'agents'),
    // built server tree: __dirname = dist/server/src/controllers/hermes
    resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'agents'),
    // workspace root fallback
    resolve(process.cwd(), 'packages', 'agents'),
    resolve(process.cwd(), 'dist', 'agents'),
  ]
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) return candidate
    } catch {
      // try next
    }
  }
  return null
}

/**
 * GET /api/hermes/agents/content?path=<relative-path>
 *
 * Returns the raw markdown content of an agent file. The path is
 * relative to the agents root and is restricted to that directory
 * to prevent traversal outside the agents collection.
 *
 * Response shape: { path: string, instructions: string }
 */
export async function getAgentContent(ctx: Context): Promise<void> {
  const rawPath = ctx.query.path
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    ctx.status = 400
    ctx.body = { error: 'Missing or invalid path parameter' }
    return
  }

  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) {
    ctx.status = 400
    ctx.body = { error: 'Invalid path parameter' }
    return
  }

  const root = await resolveAgentsRoot()
  if (!root) {
    ctx.status = 500
    ctx.body = { error: 'Agents directory not found on server' }
    return
  }

  const fullPath = resolve(join(root, normalized))
  if (!isPathWithin(fullPath, root)) {
    ctx.status = 403
    ctx.body = { error: 'Access denied' }
    return
  }

  try {
    const instructions = await readFile(fullPath, 'utf-8')
    ctx.body = { path: normalized, instructions }
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
      ctx.status = 404
      ctx.body = { error: 'Agent file not found' }
      return
    }
    ctx.status = 500
    ctx.body = { error: `Failed to read agent file: ${err?.message || err}` }
  }
}
