import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getActivePet, getActivePetSprite, updateActivePetPreferences } from '../../packages/server/src/services/hermes/pets'

const originalWebUiHome = process.env.HERMES_WEB_UI_HOME

let hermesHome = ''

async function tinyRedPng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer()
}

function profilePetsDir(profile: string): string {
  const segment = Buffer.from(profile || 'default', 'utf-8').toString('base64url')
  return join(hermesHome, 'profile-metadata', segment, 'pets')
}

async function writeInstalledPet(profile: string, slug: string): Promise<string> {
  const petsDir = profilePetsDir(profile)
  const petDir = join(petsDir, slug)
  await mkdir(petDir, { recursive: true })
  await writeFile(join(petDir, 'spritesheet.png'), await tinyRedPng())
  await writeFile(join(petDir, 'pet.json'), `${JSON.stringify({
    slug,
    displayName: 'Desk Cat',
    kind: 'cat',
    submittedBy: 'petdex',
    source: 'petdex',
    spritesheetUrl: 'https://assets.petdex.dev/pets/desk-cat/spritesheet.png',
    petJsonUrl: '',
    zipUrl: '',
    spritesheetFile: 'spritesheet.png',
    mime: 'image/png',
    installedAt: 1,
    updatedAt: 1,
  }, null, 2)}\n`)
  await writeFile(join(petsDir, 'active.json'), `${JSON.stringify({
    enabled: true,
    slug,
    scale: 0.42,
    position: { x: 15, y: 30 },
    updatedAt: 2,
  }, null, 2)}\n`)
  return join(petsDir, 'active.json')
}

describe('pets service', () => {
  beforeEach(async () => {
    hermesHome = await mkdtemp(join(tmpdir(), 'hermes-pets-service-'))
    process.env.HERMES_WEB_UI_HOME = hermesHome
  })

  afterEach(async () => {
    await rm(hermesHome, { recursive: true, force: true })
    if (originalWebUiHome === undefined) delete process.env.HERMES_WEB_UI_HOME
    else process.env.HERMES_WEB_UI_HOME = originalWebUiHome
  })

  it('persists disabled active pet state and stops returning it as active', async () => {
    const profile = 'default'
    const activePath = await writeInstalledPet(profile, 'desk-cat')

    await expect(getActivePet(profile)).resolves.toMatchObject({
      enabled: true,
      slug: 'desk-cat',
      scale: 0.42,
    })

    await expect(updateActivePetPreferences(profile, { enabled: false })).resolves.toBeNull()
    await expect(getActivePet(profile)).resolves.toBeNull()

    const active = JSON.parse(await readFile(activePath, 'utf-8'))
    expect(active).toMatchObject({
      enabled: false,
      slug: 'desk-cat',
      scale: 0.42,
    })
  })

  it('renders an rgb565 sprite buffer for the active pet', async () => {
    const profile = 'default'
    await writeInstalledPet(profile, 'desk-cat')

    const sprite = await getActivePetSprite(profile)

    expect(sprite).not.toBeNull()
    if (!sprite) return
    expect(sprite.width).toBe(192 * 6)
    expect(sprite.height).toBe(136 * 9)
    expect(sprite.frameWidth).toBe(192)
    expect(sprite.frameHeight).toBe(136)
    expect(sprite.frameCount).toBe(6)
    expect(sprite.rowCount).toBe(9)
    expect(sprite.loopMs).toBe(1100)
    expect(sprite.buffer.byteLength).toBe(192 * 6 * 136 * 9 * 2)
    expect(sprite.buffer.readUInt16LE(0)).toBe(0x0000)
    expect(sprite.buffer.readUInt16LE((68 * 192 + 96) * 2)).toBe(0xF800)
    expect(sprite.buffer.readUInt16LE((68 * (192 * 6) + (192 * 5 + 96)) * 2)).toBe(0xF800)
  })
})
