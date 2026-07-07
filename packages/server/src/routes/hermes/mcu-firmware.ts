import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/mcu-firmware'

export const mcuFirmwareRoutes = new Router()

mcuFirmwareRoutes.get('/api/hermes/mcu/firmware/:version/manifest', ctrl.manifest)
mcuFirmwareRoutes.get('/api/hermes/mcu/firmware/:version/firmware.bin', ctrl.download)

// Keep legacy C3 routes for already-deployed devices.
mcuFirmwareRoutes.get('/api/hermes/mcu/firmware/manifest', ctrl.legacyManifest)
mcuFirmwareRoutes.get('/api/hermes/mcu/firmware.bin', ctrl.legacyDownload)

// SparkBot uses dedicated target-prefixed firmware routes.
mcuFirmwareRoutes.get('/api/hermes/mcu/sparkbot/firmware/manifest', ctrl.manifestForPath)
mcuFirmwareRoutes.get('/api/hermes/mcu/sparkbot/firmware.bin', ctrl.downloadForPath)
