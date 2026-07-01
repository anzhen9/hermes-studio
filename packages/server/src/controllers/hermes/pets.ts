import type { Context } from 'koa'
import { getActiveProfileName } from '../../services/hermes/hermes-profile'
import { logger } from '../../services/logger'
import { PetAdoptionError, adoptPetFromPetdex, getActivePet, getActivePetSprite, updateActivePetPreferences } from '../../services/hermes/pets'

function requestedProfile(ctx: Context): string {
  return ctx.state.profile?.name || getActiveProfileName() || 'default'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Pet request failed'
}

export async function active(ctx: Context) {
  ctx.body = { pet: await getActivePet(requestedProfile(ctx)) }
}

export async function activeSprite(ctx: Context) {
  const sprite = await getActivePetSprite(requestedProfile(ctx))
  if (!sprite) {
    ctx.status = 404
    ctx.body = { error: 'Pet sprite is not available' }
    return
  }

  ctx.set('Content-Type', 'application/octet-stream')
  ctx.set('Cache-Control', 'public, max-age=60')
  ctx.set('X-Hermes-Image-Width', String(sprite.width))
  ctx.set('X-Hermes-Image-Height', String(sprite.height))
  ctx.body = sprite.buffer
}

export async function adopt(ctx: Context) {
  const body = ctx.request.body as { slug?: unknown } | undefined
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  const profile = requestedProfile(ctx)
  if (!slug) {
    ctx.status = 400
    ctx.body = { error: 'Pet slug is required' }
    return
  }

  try {
    ctx.body = { pet: await adoptPetFromPetdex(profile, slug) }
  } catch (err) {
    logger.warn({ err, slug, profile }, '[pets] adopt failed')
    const message = errorMessage(err)
    ctx.status = message.includes('was not found') ? 404 : 400
    ctx.body = err instanceof PetAdoptionError
      ? {
          error: message,
          details: {
            slug: err.slug,
            profile: err.profile,
            stage: err.stage,
            assetUrl: err.assetUrl,
          },
        }
      : { error: message }
  }
}

export async function updateActive(ctx: Context) {
  const body = ctx.request.body as {
    scale?: unknown
    position?: { x?: unknown; y?: unknown }
    enabled?: unknown
  } | undefined

  const pet = await updateActivePetPreferences(requestedProfile(ctx), {
    scale: typeof body?.scale === 'number' ? body.scale : undefined,
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
    position: body?.position && typeof body.position.x === 'number' && typeof body.position.y === 'number'
      ? { x: body.position.x, y: body.position.y }
      : undefined,
  })
  ctx.body = { pet }
}
