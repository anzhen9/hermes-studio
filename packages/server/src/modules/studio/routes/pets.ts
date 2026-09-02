import Router from '@koa/router'
import * as ctrl from '../controllers/pets'

export const petRoutes = new Router()

petRoutes.get('/api/studio/pets/active', ctrl.active)
petRoutes.patch('/api/studio/pets/active', ctrl.updateActive)
petRoutes.post('/api/studio/pets/adopt', ctrl.adopt)
petRoutes.get('/api/studio/pets/local', ctrl.listLocal)
petRoutes.get('/api/studio/pets/local/:slug/asset', ctrl.localAsset)
petRoutes.get('/api/studio/pets/local/:slug/preview', ctrl.localPreview)
petRoutes.delete('/api/studio/pets/local/:slug', ctrl.deleteLocal)
petRoutes.post('/api/studio/pets/import', ctrl.importPet)
