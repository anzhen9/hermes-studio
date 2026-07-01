import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../packages/server/src/services/hermes/petdex', () => ({
  fetchPetdexManifest: vi.fn(async () => ({
    generatedAt: '2026-07-01T00:00:00.000Z',
    total: 1,
    pets: [{
      slug: 'sandronya',
      displayName: 'Sandronya',
      kind: 'creature',
      submittedBy: 'petdex',
      spritesheetUrl: 'https://assets.petdex.dev/pets/sandronya/sprite.png',
      petJsonUrl: 'https://assets.petdex.dev/pets/sandronya/pet.json',
      zipUrl: 'https://assets.petdex.dev/pets/sandronya/pet.zip',
    }],
  })),
}))

const originalWebUiHome = process.env.HERMES_WEB_UI_HOME

let hermesHome = ''

function profilePetsDir(profile: string): string {
  const segment = Buffer.from(profile || 'default', 'utf-8').toString('base64url')
  return join(hermesHome, 'profile-metadata', segment, 'pets')
}

describe('pet adoption service', () => {
  beforeEach(async () => {
    hermesHome = await mkdtemp(join(tmpdir(), 'hermes-pets-adopt-'))
    process.env.HERMES_WEB_UI_HOME = hermesHome
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(hermesHome, { recursive: true, force: true })
    if (originalWebUiHome === undefined) delete process.env.HERMES_WEB_UI_HOME
    else process.env.HERMES_WEB_UI_HOME = originalWebUiHome
  })

  it('retries transient sprite download failures and ignores optional pet.json download failures', async () => {
    const { adoptPetFromPetdex } = await import('../../packages/server/src/services/hermes/pets')

    const spriteBody = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const transient = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(new Response(spriteBody, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(spriteBody.byteLength),
        },
      }))
      .mockRejectedValueOnce(new Error('optional pet json failed'))

    vi.stubGlobal('fetch', fetchMock)

    const pet = await adoptPetFromPetdex('default', 'sandronya')

    expect(pet.slug).toBe('sandronya')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const activeFile = join(profilePetsDir('default'), 'active.json')
    const installedFile = join(profilePetsDir('default'), 'sandronya', 'pet.json')
    expect(JSON.parse(await readFile(activeFile, 'utf-8'))).toMatchObject({ slug: 'sandronya', enabled: true })
    expect(JSON.parse(await readFile(installedFile, 'utf-8'))).toMatchObject({ slug: 'sandronya', mime: 'image/png' })
  })

  it('surfaces structured context when spritesheet download fails permanently', async () => {
    const { PetAdoptionError, adoptPetFromPetdex } = await import('../../packages/server/src/services/hermes/pets')

    const fetchMock = vi.fn().mockRejectedValue(new Error('read ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(adoptPetFromPetdex('default', 'sandronya')).rejects.toMatchObject<InstanceType<typeof PetAdoptionError>>({
      name: 'PetAdoptionError',
      slug: 'sandronya',
      profile: 'default',
      stage: 'spritesheet',
      assetUrl: 'https://assets.petdex.dev/pets/sandronya/sprite.png',
    })
  })
})