import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/agents'

export const agentRoutes = new Router()

agentRoutes.get('/api/hermes/agents/content', ctrl.getAgentContent)
