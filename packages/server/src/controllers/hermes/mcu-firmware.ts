import type { Context } from 'koa'
import { createReadStream } from 'fs'
import { stat, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { resolve } from 'path'

type FirmwareTarget = 'c3' | 'sparkbot'
type FirmwareVersion = 'v1'
type FirmwareContext = Context & { params?: Record<string, unknown> }

interface FirmwareInfo {
  path: string
  channel: 'development' | 'production'
  firmwareVersion: string
  size: number
  sha256: string
  md5: string
}

interface TargetConfig {
  target: string
  legacyRoute: string
  versionedRoute: (version: FirmwareVersion) => string
  distPathByVersion?: Record<FirmwareVersion, string>
  devPathByVersion?: Record<FirmwareVersion, string>
  distPath?: string
  devPath?: string
}

const DEFAULT_FIRMWARE_VERSION: FirmwareVersion = 'v1'
const SUPPORTED_C3_VERSIONS = new Set<string>([DEFAULT_FIRMWARE_VERSION])

const TARGETS: Record<FirmwareTarget, TargetConfig> = {
  c3: {
    target: 'hstudio-esp32-c3',
    legacyRoute: '/api/hermes/mcu/firmware.bin',
    versionedRoute: (version) => `/api/hermes/mcu/firmware/${version}/firmware.bin`,
    distPathByVersion: {
      v1: resolve(process.cwd(), 'dist', 'mcu', 'v1', 'firmware.bin'),
    },
    devPathByVersion: {
      v1: resolve(process.cwd(), 'packages/esp32-c3/v1/.pio/build/esp32-c3-devkitm-1/firmware.bin'),
    },
  },
  sparkbot: {
    target: 'hstudio-esp32-sparkbot',
    legacyRoute: '/api/hermes/mcu/sparkbot/firmware.bin',
    versionedRoute: () => '/api/hermes/mcu/sparkbot/firmware.bin',
    distPath: resolve(process.cwd(), 'dist', 'mcu', 'sparkbot-firmware.bin'),
    devPath: resolve(process.cwd(), 'packages/esp32-sparkbot/.pio/build/esp32-s3-devkitc-1/firmware.bin'),
  },
}

const LEGACY_C3_DIST_FALLBACK = resolve(process.cwd(), 'dist', 'mcu', 'firmware.bin')

function c3VersionFromContext(ctx: Context): FirmwareVersion | null {
  const version = String((ctx as FirmwareContext).params?.version || DEFAULT_FIRMWARE_VERSION)
  return SUPPORTED_C3_VERSIONS.has(version) ? (version as FirmwareVersion) : null
}

function targetFromPath(ctx: Context): FirmwareTarget {
  if (ctx.path.startsWith('/api/hermes/mcu/sparkbot/')) return 'sparkbot'
  return 'c3'
}

function sourceCandidates(target: FirmwareTarget, version?: FirmwareVersion): string[] {
  const cfg = TARGETS[target]
  const isProd = process.env.NODE_ENV === 'production'

  if (target === 'c3') {
    const resolvedVersion = version || DEFAULT_FIRMWARE_VERSION
    const versionPath = isProd
      ? cfg.distPathByVersion?.[resolvedVersion]
      : cfg.devPathByVersion?.[resolvedVersion]
    const paths = [versionPath].filter((value): value is string => !!value)

    if (isProd && resolvedVersion === DEFAULT_FIRMWARE_VERSION) {
      paths.push(LEGACY_C3_DIST_FALLBACK)
    }

    return paths
  }

  const targetPath = isProd ? cfg.distPath : cfg.devPath
  return targetPath ? [targetPath] : []
}

async function readFirmwareInfo(
  filePath: string,
  channel: FirmwareInfo['channel'],
  firmwareVersion: string,
): Promise<FirmwareInfo | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null

    const data = await readFile(filePath)
    return {
      path: filePath,
      channel,
      firmwareVersion,
      size: info.size,
      sha256: createHash('sha256').update(data).digest('hex'),
      md5: createHash('md5').update(data).digest('hex'),
    }
  } catch {
    return null
  }
}

async function findFirmware(target: FirmwareTarget, version?: FirmwareVersion): Promise<FirmwareInfo | null> {
  const firmwareVersion = target === 'c3' ? (version || DEFAULT_FIRMWARE_VERSION) : 'sparkbot'
  const channel: FirmwareInfo['channel'] = process.env.NODE_ENV === 'production' ? 'production' : 'development'

  for (const filePath of sourceCandidates(target, version)) {
    const firmware = await readFirmwareInfo(filePath, channel, firmwareVersion)
    if (firmware) return firmware
  }

  return null
}

function firmwareDownloadRoute(target: FirmwareTarget, firmwareVersion: string): string {
  const cfg = TARGETS[target]
  if (target === 'c3' && SUPPORTED_C3_VERSIONS.has(firmwareVersion)) {
    return cfg.versionedRoute(firmwareVersion as FirmwareVersion)
  }
  return cfg.legacyRoute
}

async function sendManifest(ctx: Context, target: FirmwareTarget, version?: FirmwareVersion) {
  const firmware = await findFirmware(target, version)
  if (!firmware) {
    ctx.status = 404
    ctx.body = { updateAvailable: false, error: 'mcu firmware not found' }
    return
  }

  ctx.set('Cache-Control', 'no-store')
  ctx.body = {
    updateAvailable: true,
    target: TARGETS[target].target,
    channel: firmware.channel,
    firmwareVersion: firmware.firmwareVersion,
    version: firmware.sha256.slice(0, 12),
    size: firmware.size,
    sha256: firmware.sha256,
    md5: firmware.md5,
    url: firmwareDownloadRoute(target, firmware.firmwareVersion),
  }
}

async function sendDownload(ctx: Context, target: FirmwareTarget, version?: FirmwareVersion) {
  const firmware = await findFirmware(target, version)
  if (!firmware) {
    ctx.status = 404
    ctx.body = { error: 'mcu firmware not found' }
    return
  }

  ctx.set('Content-Type', 'application/octet-stream')
  ctx.set('Content-Length', String(firmware.size))
  ctx.set('Cache-Control', 'no-store')
  ctx.set('X-Firmware-Version', firmware.sha256.slice(0, 12))
  ctx.set('X-MCU-Firmware-Version', firmware.firmwareVersion)
  ctx.set('X-Firmware-SHA256', firmware.sha256)
  ctx.set('X-Firmware-MD5', firmware.md5)
  ctx.body = createReadStream(firmware.path)
}

export async function manifest(ctx: Context) {
  const version = c3VersionFromContext(ctx)
  if (!version) {
    ctx.status = 404
    ctx.body = { updateAvailable: false, error: 'unsupported mcu firmware version' }
    return
  }
  await sendManifest(ctx, 'c3', version)
}

export async function download(ctx: Context) {
  const version = c3VersionFromContext(ctx)
  if (!version) {
    ctx.status = 404
    ctx.body = { error: 'unsupported mcu firmware version' }
    return
  }
  await sendDownload(ctx, 'c3', version)
}

export async function legacyManifest(ctx: Context) {
  const firmwareCtx = ctx as FirmwareContext
  firmwareCtx.params = { ...firmwareCtx.params, version: DEFAULT_FIRMWARE_VERSION }
  return manifest(ctx)
}

export async function legacyDownload(ctx: Context) {
  const firmwareCtx = ctx as FirmwareContext
  firmwareCtx.params = { ...firmwareCtx.params, version: DEFAULT_FIRMWARE_VERSION }
  ctx.set('X-Legacy-Firmware-Route', TARGETS.c3.legacyRoute)
  return download(ctx)
}

export async function manifestForPath(ctx: Context) {
  const target = targetFromPath(ctx)
  if (target === 'c3') return legacyManifest(ctx)
  return sendManifest(ctx, target)
}

export async function downloadForPath(ctx: Context) {
  const target = targetFromPath(ctx)
  if (target === 'c3') {
    ctx.set('X-Legacy-Firmware-Route', TARGETS.c3.legacyRoute)
    return legacyDownload(ctx)
  }
  return sendDownload(ctx, target)
}
