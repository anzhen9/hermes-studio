import Router from '@koa/router'
import * as ctrl from '../controllers/mcu-firmware'

export const mcuFirmwareRoutes = new Router()

mcuFirmwareRoutes.get('/api/studio/mcu/firmware/:version/manifest', ctrl.manifest)
mcuFirmwareRoutes.get('/api/studio/mcu/firmware/:version/firmware.bin', ctrl.download)

// Keep legacy C3 routes for already-deployed devices.
mcuFirmwareRoutes.get('/api/studio/mcu/firmware/manifest', ctrl.legacyManifest)
mcuFirmwareRoutes.get('/api/studio/mcu/firmware.bin', ctrl.legacyDownload)

// SparkBot versioned firmware routes.
mcuFirmwareRoutes.get('/api/studio/mcu/sparkbot/firmware/:version/manifest', ctrl.sparkbotManifest)
mcuFirmwareRoutes.get('/api/studio/mcu/sparkbot/firmware/:version/firmware.bin', ctrl.sparkbotDownload)

// Keep legacy SparkBot routes for already-deployed devices.
mcuFirmwareRoutes.get('/api/studio/mcu/sparkbot/firmware/manifest', ctrl.sparkbotLegacyManifest)
mcuFirmwareRoutes.get('/api/studio/mcu/sparkbot/firmware.bin', ctrl.sparkbotLegacyDownload)
