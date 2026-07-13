import * as esbuild from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'))
const version = pkg.version
const serverOutDir = resolve(rootDir, 'dist/server')

rmSync(serverOutDir, { recursive: true, force: true })
mkdirSync(serverOutDir, { recursive: true })

await esbuild.build({
  entryPoints: [resolve(rootDir, 'packages/server/src/index.ts')],
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node23',
  format: 'cjs',
  outfile: resolve(serverOutDir, 'index.js'),
  external: ['node-pty', 'node:sqlite', 'sharp', 'socket.io'],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  sourcemap: true,
  minify: true,
  treeShaking: true,
  logLevel: 'info',
})

const bridgeOutDir = resolve(serverOutDir, 'agent-bridge', 'python')
const bridgeSrcDir = resolve(rootDir, 'packages/server/src/services/hermes/agent-bridge/python')
mkdirSync(bridgeOutDir, { recursive: true })
for (const fileName of readdirSync(bridgeSrcDir)) {
  if (fileName.endsWith('.py')) {
    cpSync(resolve(bridgeSrcDir, fileName), resolve(bridgeOutDir, fileName))
  }
}
chmodSync(resolve(bridgeOutDir, 'hermes_bridge.py'), 0o755)

cpSync(
  resolve(rootDir, 'docs/openapi.json'),
  resolve(serverOutDir, 'openapi.json'),
)

const skillsOutDir = resolve(rootDir, 'dist/skills')
rmSync(skillsOutDir, { recursive: true, force: true })
cpSync(
  resolve(rootDir, 'packages/skills'),
  skillsOutDir,
  { recursive: true },
)

const firmwareOutDir = resolve(rootDir, 'dist/mcu')
const legacyFirmwareOutPath = resolve(firmwareOutDir, 'firmware.bin')
for (const firmwareVersion of ['v1', 'v2']) {
  const firmwareBuildSrc = resolve(rootDir, `packages/esp32-c3/${firmwareVersion}/.pio/build/esp32-c3-devkitm-1/firmware.bin`)
  const firmwareReleaseSrc = resolve(rootDir, `packages/esp32-c3/release/${firmwareVersion}/firmware.bin`)
  const firmwareVersionedOutDir = resolve(firmwareOutDir, firmwareVersion)
  const firmwareOutPath = resolve(firmwareVersionedOutDir, 'firmware.bin')
  let firmwareSrc = ''
  let sourceLabel = ''

  if (existsSync(firmwareBuildSrc)) {
    mkdirSync(dirname(firmwareReleaseSrc), { recursive: true })
    cpSync(firmwareBuildSrc, firmwareReleaseSrc)
    firmwareSrc = firmwareBuildSrc
    sourceLabel = 'PlatformIO build output'
  } else if (existsSync(firmwareReleaseSrc)) {
    firmwareSrc = firmwareReleaseSrc
    sourceLabel = 'release artifact'
  }

  if (!firmwareSrc) {
    console.warn(`[build-server] ESP32-C3 ${firmwareVersion} firmware not found, skipped dist/mcu/${firmwareVersion}/firmware.bin`)
    continue
  }

  mkdirSync(firmwareVersionedOutDir, { recursive: true })
  cpSync(firmwareSrc, firmwareOutPath)
  if (firmwareVersion === 'v1') cpSync(firmwareSrc, legacyFirmwareOutPath)
  console.log(`[build-server] ESP32-C3 ${firmwareVersion} firmware copied from ${sourceLabel}`)
}

// ESP-SparkBot firmware — dedicated OTA channel, versioned like ESP32-C3.
const sparkbotFirmwareVersion = 'v1'
const sparkbotFirmwareBuildSrc = resolve(rootDir, `packages/esp32-sparkbot/${sparkbotFirmwareVersion}/.pio/build/esp32-s3-devkitc-1/firmware.bin`)
const sparkbotFirmwareReleaseSrc = resolve(rootDir, `packages/esp32-sparkbot/release/${sparkbotFirmwareVersion}/firmware.bin`)
const sparkbotFirmwareOutDir = resolve(rootDir, 'dist/mcu/sparkbot')
const sparkbotFirmwareVersionedOutDir = resolve(sparkbotFirmwareOutDir, sparkbotFirmwareVersion)
const sparkbotFirmwareOutPath = resolve(sparkbotFirmwareVersionedOutDir, 'firmware.bin')
const legacySparkbotFirmwareOutPath = resolve(firmwareOutDir, 'sparkbot-firmware.bin')
if (existsSync(sparkbotFirmwareBuildSrc)) {
  mkdirSync(sparkbotFirmwareVersionedOutDir, { recursive: true })
  mkdirSync(dirname(sparkbotFirmwareReleaseSrc), { recursive: true })
  cpSync(sparkbotFirmwareBuildSrc, sparkbotFirmwareReleaseSrc)
  cpSync(sparkbotFirmwareBuildSrc, sparkbotFirmwareOutPath)
  cpSync(sparkbotFirmwareBuildSrc, legacySparkbotFirmwareOutPath)
  console.log(`[build-server] ESP-SparkBot ${sparkbotFirmwareVersion} firmware copied from PlatformIO build output`)
} else if (existsSync(sparkbotFirmwareReleaseSrc)) {
  mkdirSync(sparkbotFirmwareVersionedOutDir, { recursive: true })
  cpSync(sparkbotFirmwareReleaseSrc, sparkbotFirmwareOutPath)
  cpSync(sparkbotFirmwareReleaseSrc, legacySparkbotFirmwareOutPath)
  console.log(`[build-server] ESP-SparkBot ${sparkbotFirmwareVersion} firmware copied from release artifact`)
} else {
  console.warn(`[build-server] ESP-SparkBot ${sparkbotFirmwareVersion} firmware not found, skipped dist/mcu/sparkbot/${sparkbotFirmwareVersion}/firmware.bin`)
}
