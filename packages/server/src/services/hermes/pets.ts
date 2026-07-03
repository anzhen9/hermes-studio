import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { createRequire } from 'node:module'
import type { OverlayOptions } from 'sharp'
import type sharpDefault from 'sharp'
import { getWebUiHome } from '../../config'
import { logger } from '../logger'
import { getGlobalAgentServer } from '../global-agent/server'
import { fetchPetdexManifest, type PetdexPet } from './petdex'

export type ActivePetState = 'idle' | 'run' | 'review' | 'failed' | 'wave' | 'jump' | 'waiting'

export interface InstalledPet {
  slug: string
  displayName: string
  kind: string
  submittedBy: string
  source: 'petdex'
  spritesheetUrl: string
  petJsonUrl: string
  zipUrl: string
  spritesheetFile: string
  petJsonFile?: string
  mime: string
  installedAt: number
  updatedAt: number
}

export interface ActivePetConfig {
  enabled: boolean
  slug: string
  scale: number
  position?: {
    x: number
    y: number
  }
  updatedAt: number
}

export interface ActivePetResponse {
  enabled: boolean
  slug: string
  displayName: string
  kind: string
  submittedBy: string
  source: 'petdex'
  mime: string
  spritesheetDataUrl?: string
  spritesheetRevision: number
  frameW: number
  frameH: number
  framesPerState: number
  loopMs: number
  scale: number
  position?: {
    x: number
    y: number
  }
  stateRows: string[]
  installedAt: number
  updatedAt: number
}

export interface ActivePetSpriteResponse {
  buffer: Buffer
  width: number
  height: number
  frameWidth: number
  frameHeight: number
  frameCount: number
  loopMs: number
  rowCount: number
  stateRows: string[]
}

export class PetAdoptionError extends Error {
  slug: string
  profile: string
  stage: 'manifest' | 'spritesheet' | 'petjson' | 'install'
  assetUrl: string

  constructor(input: { slug: string; profile: string; stage: 'manifest' | 'spritesheet' | 'petjson' | 'install'; assetUrl: string; message: string }) {
    super(input.message)
    this.name = 'PetAdoptionError'
    this.slug = input.slug
    this.profile = input.profile
    this.stage = input.stage
    this.assetUrl = input.assetUrl
  }
}

const FRAME_W = 192
const FRAME_H = 208
const FRAMES_PER_STATE = 6
const LOOP_MS = 1100
const DEFAULT_SCALE = 0.33
const STATE_ROWS = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
]

const MAX_SPRITESHEET_BYTES = 10 * 1024 * 1024
const MAX_JSON_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 20_000
const FETCH_RETRY_COUNT = 3
const FETCH_RETRY_DELAY_MS = 250
const ACTIVE_PET_SPRITE_WIDTH = 192
const ACTIVE_PET_SPRITE_HEIGHT = 136

type SharpModule = typeof sharpDefault

let sharpLoader: Promise<SharpModule> | null = null

async function loadSharp(): Promise<SharpModule> {
  if (!sharpLoader) {
    sharpLoader = Promise.resolve().then(() => {
      const runtimeRequire = createRequire(join(process.cwd(), 'package.json'))
      return runtimeRequire('sharp') as SharpModule
    })
  }
  return sharpLoader
}

function profileMetadataRoot(): string {
  return join(getWebUiHome(), 'profile-metadata')
}

function profileMetadataDir(name: string): string {
  const segment = Buffer.from(name || 'default', 'utf-8').toString('base64url')
  return join(profileMetadataRoot(), segment)
}

function petsRoot(profile: string): string {
  return join(profileMetadataDir(profile), 'pets')
}

function activePetPath(profile: string): string {
  return join(petsRoot(profile), 'active.json')
}

function petDir(profile: string, slug: string): string {
  return join(petsRoot(profile), safeSlug(slug))
}

function petMetaPath(profile: string, slug: string): string {
  return join(petDir(profile, slug), 'pet.json')
}

function sparkbotSpriteCachePath(profile: string, slug: string): string {
  return join(petDir(profile, slug), 'sparkbot-idle.rgb565')
}

function sparkbotSpriteCacheMetaPath(profile: string, slug: string): string {
  return join(petDir(profile, slug), 'sparkbot-idle.json')
}

function safeSlug(slug: string): string {
  const normalized = String(slug || '').trim().toLowerCase()
  const safe = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!safe) throw new Error('Pet slug is required')
  return safe.slice(0, 120)
}

function assertPetdexAssetUrl(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || (host !== 'petdex.dev' && !host.endsWith('.petdex.dev'))) {
    throw new Error('Unsupported pet asset host')
  }
  return url
}

function mimeFromResponse(response: Response, fallbackUrl: string): string {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType?.startsWith('image/')) return contentType
  if (fallbackUrl.endsWith('.webp')) return 'image/webp'
  if (fallbackUrl.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

function isTransientPetAssetError(error: unknown): boolean {
  const cause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined
  const code = [error, cause]
    .map(value => value && typeof value === 'object' ? String((value as { code?: unknown }).code || '').trim().toUpperCase() : '')
    .find(Boolean) || ''
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) {
    return true
  }

  const message = [error, cause]
    .map(value => value instanceof Error ? value.message : String(value || ''))
    .join(' ')
    .toLowerCase()
  return /econnreset|timed out|timeout|fetch failed|socket|network|eai_again|connection reset/.test(message)
}

async function waitForRetry(attempt: number): Promise<void> {
  const delayMs = FETCH_RETRY_DELAY_MS * attempt
  await new Promise(resolve => setTimeout(resolve, delayMs))
}

async function fetchBytes(urlValue: string, maxBytes: number): Promise<{ buffer: Buffer; mime: string }> {
  const url = assertPetdexAssetUrl(urlValue)
  let lastError: unknown = null
  for (let attempt = 1; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'hermes-web-ui-pets',
          Connection: 'close',
        },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Pet asset request failed: ${response.status}`)

      const length = Number(response.headers.get('content-length') || '0')
      if (Number.isFinite(length) && length > maxBytes) {
        throw new Error('Pet asset is too large')
      }

      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > maxBytes) {
        throw new Error('Pet asset is too large')
      }

      return {
        buffer: Buffer.from(arrayBuffer),
        mime: mimeFromResponse(response, url.pathname.toLowerCase()),
      }
    } catch (error) {
      lastError = error
      if (attempt >= FETCH_RETRY_COUNT || !isTransientPetAssetError(error)) {
        throw error
      }
      logger.warn({ err: error, url: url.toString(), attempt, maxAttempts: FETCH_RETRY_COUNT }, '[pets] transient asset fetch failed, retrying')
      await waitForRetry(attempt)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Pet asset request failed')
}

async function fetchTextAsset(urlValue: string, maxBytes: number): Promise<string | null> {
  if (!urlValue) return null
  const { buffer } = await fetchBytes(urlValue, maxBytes)
  return buffer.toString('utf-8')
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
}

function normalizeInstalledPet(pet: PetdexPet, asset: { mime: string }, now: number): InstalledPet {
  return {
    slug: pet.slug,
    displayName: pet.displayName || pet.slug,
    kind: pet.kind || 'pet',
    submittedBy: pet.submittedBy || '',
    source: 'petdex',
    spritesheetUrl: pet.spritesheetUrl,
    petJsonUrl: pet.petJsonUrl,
    zipUrl: pet.zipUrl,
    spritesheetFile: 'spritesheet.webp',
    petJsonFile: pet.petJsonUrl ? 'petdex-pet.json' : undefined,
    mime: asset.mime,
    installedAt: now,
    updatedAt: now,
  }
}

function notifyMcuPetChanged(profile: string): void {
  const server = getGlobalAgentServer()
  if (!server) return
  const notified = server.broadcastToMcuClients(profile, { type: 'pet.changed', profile })
  if (notified > 0) {
    logger.info({ profile, notified }, '[pets] notified MCU clients of pet change')
  }
}

export async function adoptPetFromPetdex(profile: string, slugInput: string): Promise<ActivePetResponse> {
  const slug = safeSlug(slugInput)
  const manifest = await fetchPetdexManifest()
  const pet = manifest.pets.find(item => safeSlug(item.slug) === slug)
  if (!pet) throw new Error(`Pet "${slugInput}" was not found in petdex`)

  const targetDir = petDir(profile, pet.slug)
  await mkdir(targetDir, { recursive: true })

  const spritesheet = await fetchBytes(pet.spritesheetUrl, MAX_SPRITESHEET_BYTES).catch((error) => {
    throw new PetAdoptionError({
      slug: pet.slug,
      profile,
      stage: 'spritesheet',
      assetUrl: pet.spritesheetUrl,
      message: error instanceof Error ? error.message : 'Pet spritesheet download failed',
    })
  })
  await writeFile(join(targetDir, 'spritesheet.webp'), spritesheet.buffer, { mode: 0o600 })

  if (pet.petJsonUrl) {
    try {
      const petJson = await fetchTextAsset(pet.petJsonUrl, MAX_JSON_BYTES)
      if (petJson) await writeFile(join(targetDir, 'petdex-pet.json'), petJson, { encoding: 'utf-8', mode: 0o600 })
    } catch (error) {
      logger.warn({ err: error, slug: pet.slug, url: pet.petJsonUrl }, '[pets] optional pet metadata download failed')
    }
  }

  const now = Date.now()
  const installed = normalizeInstalledPet(pet, spritesheet, now)
  const active: ActivePetConfig = {
    enabled: true,
    slug: installed.slug,
    scale: DEFAULT_SCALE,
    updatedAt: now,
  }

  await writeJsonFile(petMetaPath(profile, pet.slug), installed)
  await writeJsonFile(activePetPath(profile), active)

  try {
    await getActivePetSprite(profile)
  } catch (err) {
    logger.warn({ err, profile, slug: pet.slug }, '[pets] pre-generating sparkbot sprite cache failed')
  }

  const response = await buildActivePetResponse(profile, installed, active)
  if (!response) {
    throw new PetAdoptionError({
      slug: pet.slug,
      profile,
      stage: 'install',
      assetUrl: pet.spritesheetUrl,
      message: 'Installed pet asset is missing',
    })
  }
  notifyMcuPetChanged(profile)
  return response
}

export async function getActivePet(profile: string, options: { lightweight?: boolean } = {}): Promise<ActivePetResponse | null> {
  const active = await readJsonFile<ActivePetConfig>(activePetPath(profile))
  if (!active?.enabled || !active.slug) return null

  const installed = await readJsonFile<InstalledPet>(petMetaPath(profile, active.slug))
  if (!installed) return null

  return buildActivePetResponse(profile, installed, active, options)
}

export async function updateActivePetPreferences(
  profile: string,
  input: { scale?: number; position?: { x?: number; y?: number }; enabled?: boolean },
): Promise<ActivePetResponse | null> {
  const active = await readJsonFile<ActivePetConfig>(activePetPath(profile))
  if (!active?.slug) return null

  const next: ActivePetConfig = {
    ...active,
    updatedAt: Date.now(),
  }

  if (typeof input.enabled === 'boolean') {
    next.enabled = input.enabled
  }

  if (typeof input.scale === 'number' && Number.isFinite(input.scale)) {
    next.scale = Math.min(1.2, Math.max(0.18, input.scale))
  }

  if (input.position && typeof input.position.x === 'number' && typeof input.position.y === 'number') {
    next.position = {
      x: Math.round(Math.max(0, input.position.x)),
      y: Math.round(Math.max(0, input.position.y)),
    }
  }

  await writeJsonFile(activePetPath(profile), next)
  if (!next.enabled) return null
  return getActivePet(profile)
}

async function buildActivePetResponse(
  profile: string,
  installed: InstalledPet,
  active: ActivePetConfig,
  options: { lightweight?: boolean } = {},
): Promise<ActivePetResponse | null> {
  const filePath = join(petDir(profile, installed.slug), installed.spritesheetFile || 'spritesheet.webp')
  if (!existsSync(filePath)) return null

  const spritesheetRevision = installed.updatedAt || installed.installedAt || 0
  const updatedAt = Math.max(active.updatedAt || 0, spritesheetRevision)

  let spritesheetDataUrl: string | undefined
  if (!options.lightweight) {
    const data = await readFile(filePath)
    spritesheetDataUrl = `data:${installed.mime || 'image/webp'};base64,${data.toString('base64')}`
  }

  return {
    enabled: active.enabled,
    slug: installed.slug,
    displayName: installed.displayName,
    kind: installed.kind,
    submittedBy: installed.submittedBy,
    source: installed.source,
    mime: installed.mime || 'image/webp',
    spritesheetDataUrl,
    frameW: FRAME_W,
    frameH: FRAME_H,
    framesPerState: FRAMES_PER_STATE,
    loopMs: LOOP_MS,
    scale: typeof active.scale === 'number' && active.scale > 0 ? active.scale : DEFAULT_SCALE,
    position: active.position && Number.isFinite(active.position.x) && Number.isFinite(active.position.y)
      ? { x: active.position.x, y: active.position.y }
      : undefined,
    stateRows: STATE_ROWS,
    installedAt: installed.installedAt,
    spritesheetRevision,
    updatedAt,
  }
}

function rgb888ToRgb565(r: number, g: number, b: number): number {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
}

function rgbaToRgb565(buffer: Buffer, channels: number): Buffer {
  const pixelCount = Math.floor(buffer.length / channels)
  const output = Buffer.alloc(pixelCount * 2)
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += channels) {
    const value = rgb888ToRgb565(buffer[offset], buffer[offset + 1], buffer[offset + 2])
    output.writeUInt16LE(value, pixel * 2)
  }
  return output
}

async function readCachedSparkbotSprite(profile: string, installed: InstalledPet): Promise<ActivePetSpriteResponse | null> {
  const cachePath = sparkbotSpriteCachePath(profile, installed.slug)
  const metaPath = sparkbotSpriteCacheMetaPath(profile, installed.slug)
  if (!existsSync(cachePath) || !existsSync(metaPath)) return null

  const meta = await readJsonFile<{
    spritesheetRevision?: number
    width?: number
    height?: number
    frameWidth?: number
    frameHeight?: number
    frameCount?: number
    loopMs?: number
    rowCount?: number
    stateRows?: string[]
  }>(metaPath)
  const spritesheetRevision = installed.updatedAt || installed.installedAt || 0
  if (!meta || meta.spritesheetRevision !== spritesheetRevision) return null
  if (!meta.rowCount || meta.rowCount < 1) return null

  const buffer = await readFile(cachePath)
  return {
    buffer,
    width: meta.width || ACTIVE_PET_SPRITE_WIDTH * FRAMES_PER_STATE,
    height: meta.height || ACTIVE_PET_SPRITE_HEIGHT,
    frameWidth: meta.frameWidth || ACTIVE_PET_SPRITE_WIDTH,
    frameHeight: meta.frameHeight || ACTIVE_PET_SPRITE_HEIGHT,
    frameCount: meta.frameCount || FRAMES_PER_STATE,
    loopMs: meta.loopMs || LOOP_MS,
    rowCount: meta.rowCount,
    stateRows: meta.stateRows || STATE_ROWS,
  }
}

async function writeCachedSparkbotSprite(
  profile: string,
  installed: InstalledPet,
  sprite: ActivePetSpriteResponse,
): Promise<void> {
  const spritesheetRevision = installed.updatedAt || installed.installedAt || 0
  await writeFile(sparkbotSpriteCachePath(profile, installed.slug), sprite.buffer, { mode: 0o600 })
  await writeJsonFile(sparkbotSpriteCacheMetaPath(profile, installed.slug), {
    spritesheetRevision,
    width: sprite.width,
    height: sprite.height,
    frameWidth: sprite.frameWidth,
    frameHeight: sprite.frameHeight,
    frameCount: sprite.frameCount,
    loopMs: sprite.loopMs,
    rowCount: sprite.rowCount,
    stateRows: sprite.stateRows,
  })
}

export async function getActivePetSprite(profile: string): Promise<ActivePetSpriteResponse | null> {
  const active = await readJsonFile<ActivePetConfig>(activePetPath(profile))
  if (!active?.enabled || !active.slug) return null

  const installed = await readJsonFile<InstalledPet>(petMetaPath(profile, active.slug))
  if (!installed) return null

  const cached = await readCachedSparkbotSprite(profile, installed)
  if (cached) return cached

  const filePath = join(petDir(profile, installed.slug), installed.spritesheetFile || 'spritesheet.webp')
  if (!existsSync(filePath)) return null

  try {
    const source = await readFile(filePath)
    const sharp = await loadSharp()
    const metadata = await sharp(source).metadata()
    const frameCount = FRAMES_PER_STATE
    const rowCount = STATE_ROWS.length
    const composite: OverlayOptions[] = []

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const sourceRowTop = rowIndex * FRAME_H
      const hasFullGrid = metadata.width && metadata.height && metadata.width >= FRAME_W * frameCount && metadata.height >= FRAME_H * rowCount

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const baseFrame = sharp(source)
        const framePipeline = hasFullGrid
          ? baseFrame.extract({ left: frameIndex * FRAME_W, top: sourceRowTop, width: FRAME_W, height: FRAME_H })
          : metadata.width && metadata.height && metadata.width >= FRAME_W && metadata.height >= FRAME_H
            ? baseFrame.extract({ left: 0, top: 0, width: FRAME_W, height: FRAME_H })
            : baseFrame

        const frame = await framePipeline
          .resize(ACTIVE_PET_SPRITE_WIDTH, ACTIVE_PET_SPRITE_HEIGHT, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          })
          .flatten({ background: { r: 0, g: 0, b: 0 } })
          .removeAlpha()
          .png()
          .toBuffer()

        composite.push({
          input: frame,
          left: frameIndex * ACTIVE_PET_SPRITE_WIDTH,
          top: rowIndex * ACTIVE_PET_SPRITE_HEIGHT,
        })
      }
    }

    const { data, info } = await sharp({
      create: {
        width: ACTIVE_PET_SPRITE_WIDTH * frameCount,
        height: ACTIVE_PET_SPRITE_HEIGHT * rowCount,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composite)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const sprite: ActivePetSpriteResponse = {
      buffer: rgbaToRgb565(data, info.channels),
      width: info.width,
      height: info.height,
      frameWidth: ACTIVE_PET_SPRITE_WIDTH,
      frameHeight: ACTIVE_PET_SPRITE_HEIGHT,
      frameCount,
      loopMs: LOOP_MS,
      rowCount,
      stateRows: STATE_ROWS,
    }
    await writeCachedSparkbotSprite(profile, installed, sprite)
    return sprite
  } catch (err) {
    logger.warn({ err, profile, slug: installed.slug, path: filePath }, '[pets] sparkbot sprite generation failed')
    return null
  }
}
