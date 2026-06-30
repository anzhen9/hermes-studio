import type { Context } from 'koa'
import { createReadStream } from 'fs'
import { stat, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { resolve } from 'path'

type FirmwareTarget = 'c3' | 'sparkbot'

interface FirmwareInfo {
  path: string
  channel: 'development' | 'production'
  size: number
  sha256: string
  md5: string
}

interface TargetConfig {
  /** Route path the firmware is served from. */
  route: string
  /** Manifest `target` identifier shown to devices. */
  target: string
  /** Production firmware path under dist/mcu. */
  distPath: string
  /** Development firmware path under packages/esp32-XXX/.pio/build. */
  devPath: string
}

const TARGETS: Record<FirmwareTarget, TargetConfig> = {
  c3: {
    route: '/api/hermes/mcu/firmware.bin',
    target: 'hstudio-esp32-c3',
    distPath: resolve(process.cwd(), 'dist', 'mcu', 'firmware.bin'),
    devPath: resolve(
      process.cwd(),
      'packages/esp32-c3/.pio/build/esp32-c3-devkitm-1/firmware.bin',
    ),
  },
  sparkbot: {
    route: '/api/hermes/mcu/sparkbot/firmware.bin',
    target: 'hstudio-esp32-sparkbot',
    distPath: resolve(process.cwd(), 'dist', 'mcu', 'sparkbot-firmware.bin'),
    devPath: resolve(
      process.cwd(),
      'packages/esp32-sparkbot/.pio/build/esp32-s3-devkitc-1/firmware.bin',
    ),
  },
}

function firmwareSource(target: FirmwareTarget): Pick<FirmwareInfo, 'path' | 'channel'> {
  const cfg = TARGETS[target]
  if (process.env.NODE_ENV === 'production') {
    return { path: cfg.distPath, channel: 'production' }
  }
  return { path: cfg.devPath, channel: 'development' }
}

async function findFirmware(target: FirmwareTarget): Promise<FirmwareInfo | null> {
  const source = firmwareSource(target)
  try {
    const info = await stat(source.path)
    if (!info.isFile()) {
      return null
    }
    const data = await readFile(source.path)
    return {
      path: source.path,
      channel: source.channel,
      size: info.size,
      sha256: createHash('sha256').update(data).digest('hex'),
      md5: createHash('md5').update(data).digest('hex'),
    }
  } catch {
    return null
  }
}

function parseTarget(value: unknown): FirmwareTarget | null {
  if (value === 'c3' || value === 'sparkbot') return value
  return null
}

/** Resolve the target from the request path. Used by the path-specific route
 *  handlers so each route is self-contained. */
function targetFromPath(ctx: Context): FirmwareTarget | null {
  // /api/hermes/mcu/firmware/manifest          → c3 (legacy)
  // /api/hermes/mcu/sparkbot/firmware/manifest → sparkbot
  if (ctx.path.startsWith('/api/hermes/mcu/sparkbot/')) return 'sparkbot'
  return 'c3'
}

async function sendManifest(ctx: Context, target: FirmwareTarget) {
  const firmware = await findFirmware(target)
  const cfg = TARGETS[target]
  if (!firmware) {
    ctx.status = 404
    ctx.body = { updateAvailable: false, error: 'mcu firmware not found' }
    return
  }

  ctx.set('Cache-Control', 'no-store')
  ctx.body = {
    updateAvailable: true,
    target: cfg.target,
    channel: firmware.channel,
    version: firmware.sha256.slice(0, 12),
    size: firmware.size,
    sha256: firmware.sha256,
    md5: firmware.md5,
    url: cfg.route,
  }
}

async function sendDownload(ctx: Context, target: FirmwareTarget) {
  const firmware = await findFirmware(target)
  if (!firmware) {
    ctx.status = 404
    ctx.body = { error: 'mcu firmware not found' }
    return
  }

  ctx.set('Content-Type', 'application/octet-stream')
  ctx.set('Content-Length', String(firmware.size))
  ctx.set('Cache-Control', 'no-store')
  ctx.set('X-Firmware-Version', firmware.sha256.slice(0, 12))
  ctx.set('X-Firmware-SHA256', firmware.sha256)
  ctx.set('X-Firmware-MD5', firmware.md5)
  ctx.body = createReadStream(firmware.path)
}

/** Legacy C3 manifest route: GET /api/hermes/mcu/firmware/manifest */
export async function manifest(ctx: Context) {
  await sendManifest(ctx, 'c3')
}

/** Legacy C3 download route: GET /api/hermes/mcu/firmware.bin */
export async function download(ctx: Context) {
  await sendDownload(ctx, 'c3')
}

/** Target-aware manifest route. Reads the target from the request path so the
 *  same handler serves both /api/hermes/mcu/firmware/manifest (c3) and
 *  /api/hermes/mcu/sparkbot/firmware/manifest (sparkbot). */
export async function manifestForPath(ctx: Context) {
  const target = parseTarget(targetFromPath(ctx))
  if (!target) {
    ctx.status = 400
    ctx.body = { error: 'Unknown firmware target' }
    return
  }
  await sendManifest(ctx, target)
}

/** Target-aware download route. Same path resolution as manifestForPath. */
export async function downloadForPath(ctx: Context) {
  const target = parseTarget(targetFromPath(ctx))
  if (!target) {
    ctx.status = 400
    ctx.body = { error: 'Unknown firmware target' }
    return
  }
  await sendDownload(ctx, target)
}
