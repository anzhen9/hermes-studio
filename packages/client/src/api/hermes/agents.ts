import { request } from '../client'

export interface AgentContent {
  path: string
  instructions: string
}

export async function getAgentContent(path: string): Promise<AgentContent> {
  return request(`/api/hermes/agents/content?path=${encodeURIComponent(path)}`, {
    method: 'GET',
  })
}
