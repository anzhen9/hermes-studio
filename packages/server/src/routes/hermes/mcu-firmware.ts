import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/mcu-firmware'

export const mcuFirmwareRoutes = new Router()

// Legacy C3 routes (kept for backward compatibility with existing C3 firmware)
mcuFirmwareRoutes.get('/api/hermes/mcu/firmware/manifest', ctrl.manifest)
mcuFirmwareRoutes.get('/api/hermes/mcu/firmware.bin', ctrl.download)

// ESP-SparkBot dedicated OTA routes
mcuFirmwareRoutes.get('/api/hermes/mcu/sparkbot/firmware/manifest', ctrl.manifestForPath)
mcuFirmwareRoutes.get('/api/hermes/mcu/sparkbot/firmware.bin', ctrl.downloadForPath)
