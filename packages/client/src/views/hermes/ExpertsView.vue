<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput, NModal, useMessage } from 'naive-ui'
import { useChatStore } from '@/stores/hermes/chat'
import agentsIndex from '@/data/experts-index.json'
import PageSidebarNav from '@/components/layout/PageSidebarNav.vue'
import PageSidebarFooter from '@/components/layout/PageSidebarFooter.vue'

interface ExpertAgent {
  id: string
  path: string
  name: string
  description: string
  emoji?: string
  color?: string
  questions?: string[]
}

interface Department {
  key: string
  name: string
  count: number
  agents: ExpertAgent[]
}

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const chatStore = useChatStore()

const searchQuery = ref('')
const selectedAgent = ref<ExpertAgent | null>(null)
const showModal = ref(false)
const loadingAgentId = ref<string | null>(null)

const totalCount = computed(() => (agentsIndex as { total?: number }).total ?? 0)

const departments = computed<Department[]>(() => {
  return Object.entries(agentsIndex.departments).map(([key, value]) => ({
    key,
    ...value,
  })) as Department[]
})

const filteredDepartments = computed<Department[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return departments.value
  return departments.value
    .map((dept) => ({
      ...dept,
      agents: dept.agents.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q),
      ),
    }))
    .filter((dept) => dept.agents.length > 0)
})

function openAgent(agent: ExpertAgent) {
  if (loadingAgentId.value) return
  selectedAgent.value = agent
  showModal.value = true
}

function openNewChatPage() {
  void router.push({ name: 'hermes.chat' })
}

function closeModal() {
  showModal.value = false
  selectedAgent.value = null
}

async function fetchAgentInstructions(path: string): Promise<string> {
  const token = localStorage.getItem('hermes_api_key') || ''
  const res = await fetch(`/api/hermes/agents/content?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: token ? `Bearer ${token}` : '' },
  })
  if (!res.ok) {
    throw new Error(`Failed to load agent content: ${res.status}`)
  }
  const data = await res.json()
  return data.instructions as string
}

const DRAFT_KEY = 'hermes_chat_input_drafts_v1'

function saveDraft(sessionId: string, text: string) {
  const raw = localStorage.getItem(DRAFT_KEY)
  const drafts = raw ? (JSON.parse(raw) as Record<string, string>) : {}
  drafts[sessionId] = text
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts))
}

async function startChat(agent: ExpertAgent, initialQuestion?: string) {
  if (loadingAgentId.value) return
  loadingAgentId.value = agent.id
  try {
    const instructions = await fetchAgentInstructions(agent.path)
    const session = await chatStore.startExpertChat({
      id: agent.id,
      path: agent.path,
      name: agent.name,
      emoji: agent.emoji,
    }, instructions)
    if (initialQuestion) {
      saveDraft(session.id, initialQuestion)
    }
    closeModal()
    await router.push({
      name: 'hermes.session',
      params: { sessionId: session.id },
    })
  } catch (err: any) {
    message.error(err?.message || t('experts.loadFailed'))
  } finally {
    loadingAgentId.value = null
  }
}
</script>

<template>
  <div class="experts-panel">
    <aside class="session-list">
      <div class="page-sidebar-top">
        <PageSidebarNav
          active="experts"
          :primary-label="t('chat.newChat')"
          hide-mode-switch
          @primary="openNewChatPage"
        />
      </div>
      <PageSidebarFooter />
    </aside>

    <div class="experts-view">
      <header class="page-header">
        <div class="header-main">
          <h2 class="header-title">{{ t('experts.title') }}</h2>
          <span class="header-subtitle">{{ t('experts.total', { count: totalCount }) }}</span>
        </div>
      </header>

      <div class="experts-content">
        <NInput
          v-model:value="searchQuery"
          :placeholder="t('experts.searchPlaceholder')"
          clearable
          class="search-input"
        />

        <div v-if="filteredDepartments.length" class="departments">
          <section
            v-for="dept in filteredDepartments"
            :key="dept.key"
            class="department-section"
          >
            <div class="department-header">
              <h3 class="department-name">{{ dept.name }}</h3>
              <span class="department-count">
                {{ t('experts.agentCount', { count: dept.agents.length }) }}
              </span>
            </div>

            <div class="agent-grid">
              <article
                v-for="agent in dept.agents"
                :key="agent.id"
                class="agent-card"
                :class="{ loading: loadingAgentId === agent.id }"
                role="button"
                tabindex="0"
                @click="openAgent(agent)"
                @keydown.enter.prevent="openAgent(agent)"
                @keydown.space.prevent="openAgent(agent)"
              >
                <div class="agent-name">
                  <span v-if="agent.emoji" class="agent-emoji" aria-hidden="true">{{ agent.emoji }}</span>
                  <span>{{ agent.name }}</span>
                </div>
                <p class="agent-description">{{ agent.description }}</p>
              </article>
            </div>
          </section>
        </div>

        <NEmpty v-else :description="t('experts.noMatch')" />
      </div>
    </div>

    <NModal
      v-model:show="showModal"
      preset="card"
      :title="selectedAgent?.name || ''"
      style="width: 520px; max-width: calc(100vw - 32px)"
      @after-leave="selectedAgent = null"
    >
      <div v-if="selectedAgent" class="agent-detail">
        <div class="agent-detail-header">
          <span v-if="selectedAgent.emoji" class="agent-detail-emoji" aria-hidden="true">{{ selectedAgent.emoji }}</span>
          <p class="agent-detail-description">{{ selectedAgent.description }}</p>
        </div>

        <section v-if="selectedAgent.questions?.length" class="sample-questions">
          <h4 class="sample-questions-title">{{ t('experts.sampleQuestions') }}</h4>
          <div class="sample-questions-list">
            <button
              v-for="(question, idx) in selectedAgent.questions"
              :key="idx"
              type="button"
              class="question-card"
              :disabled="!!loadingAgentId"
              @click="startChat(selectedAgent, question)"
            >
              <span class="question-index">{{ idx + 1 }}</span>
              <span class="question-text">{{ question }}</span>
            </button>
          </div>
        </section>

        <div class="agent-detail-actions">
          <NButton
            type="primary"
            block
            :loading="!!loadingAgentId"
            @click="startChat(selectedAgent)"
          >
            {{ t('experts.directChat') }}
          </NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.experts-panel {
  display: flex;
  height: 100%;
  position: relative;
}

.session-list {
  width: $sidebar-width;
  border-right: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;

  @media (max-width: $breakpoint-mobile) {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    z-index: 120;
    background: $bg-card;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  }
}

.page-sidebar-top {
  flex-shrink: 0;
  padding: 12px;
  border-bottom: 1px solid $border-color;
}

.experts-view {
  flex: 1;
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.page-header {
  padding: 16px 20px;
  border-bottom: 1px solid $border-color;
}

.header-main {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: $text-primary;
}

.header-subtitle {
  font-size: 13px;
  color: $text-muted;
}

.experts-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.search-input {
  max-width: 420px;
  margin-bottom: 20px;
}

.departments {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.department-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.department-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: $text-primary;
}

.department-count {
  font-size: 12px;
  color: $text-muted;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.agent-card {
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color $transition-fast, box-shadow $transition-fast, transform $transition-fast;

  &:hover {
    border-color: rgba(var(--accent-primary-rgb), 0.45);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--accent-primary-rgb), 0.55);
    outline-offset: 2px;
  }

  &.loading {
    opacity: 0.7;
    pointer-events: none;
  }
}

.agent-name {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: $text-primary;
}

.agent-emoji {
  font-size: 18px;
  line-height: 1;
}

.agent-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: $text-muted;
}

.agent-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.agent-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.agent-detail-emoji {
  flex-shrink: 0;
  font-size: 28px;
  line-height: 1.2;
}

.agent-detail-description {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: $text-muted;
}

.sample-questions-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: $text-primary;
}

.sample-questions-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.question-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color $transition-fast, box-shadow $transition-fast, background $transition-fast;

  &:hover:not(:disabled) {
    border-color: rgba(var(--accent-primary-rgb), 0.45);
    background: rgba(var(--accent-primary-rgb), 0.04);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--accent-primary-rgb), 0.55);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.question-index {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(var(--accent-primary-rgb), 0.12);
  color: $accent-primary;
  font-size: 12px;
  font-weight: 600;
}

.question-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.55;
  color: $text-primary;
}

.agent-detail-actions {
  padding-top: 4px;
}

@media (max-width: $breakpoint-mobile) {
  .page-header {
    padding: 14px 16px;
  }

  .experts-content {
    padding: 16px;
  }

  .search-input {
    max-width: none;
  }

  .agent-grid {
    grid-template-columns: 1fr;
  }
}
</style>
