import { create } from 'zustand'
import { memoryStore } from '../agent/hermes/memory'
import { skillsStore } from '../agent/hermes/skills'
import { learningLoop } from '../agent/hermes/learning'
import { searchSessions } from '../agent/hermes/sessionSearch'
import { getAgentsDoc, getSoulDoc, setAgentsDoc, setSoulDoc } from '../agent/hermes/promptBuilder'
import { pluginRegistry, type PluginManifest } from '../agent/hermes/plugins'
import type { LearningEvent, MemoryBundle, SessionSearchHit, Skill } from '../agent/hermes/types'
import type { ArchiveRecord } from '../agent/types'

interface LearningStore {
  loaded: boolean
  memory: MemoryBundle
  skills: Skill[]
  events: LearningEvent[]
  pendingDrafts: Array<{ name: string; description: string; body: string }>
  soul: string
  agents: string
  searchHits: SessionSearchHit[]
  plugins: PluginManifest[]

  load: () => Promise<void>
  persist: () => Promise<void>
  refresh: () => void
  setUserProfile: (text: string) => Promise<void>
  setMemoryDoc: (text: string) => Promise<void>
  appendMemory: (text: string) => Promise<void>
  deleteMemoryEntry: (id: string) => Promise<void>
  clearMemories: () => Promise<void>
  setSoul: (text: string) => Promise<void>
  setAgents: (text: string) => Promise<void>
  approveDraft: (name: string) => Promise<void>
  rejectDraft: (name: string) => void
  search: (query: string, archive: ArchiveRecord[]) => void
  saveSkill: (name: string, description: string, body: string) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
  importPlugin: (manifest: PluginManifest) => Promise<void>
  removePlugin: (id: string) => Promise<void>
  applyPlugins: () => void
}

async function loadFromDisk() {
  if (window.subagents?.hermes?.get) {
    const data = (await window.subagents.hermes.get()) as {
      memory?: MemoryBundle
      skills?: Array<{ path: string; raw: string }>
      soul?: string
      agents?: string
      plugins?: PluginManifest[]
    } | null
    if (data?.memory) memoryStore.loadBundle(data.memory)
    if (data?.skills) skillsStore.loadAll(data.skills)
    if (data?.soul) setSoulDoc(data.soul)
    if (data?.agents) setAgentsDoc(data.agents)
    if (data?.plugins) pluginRegistry.loadFromArray(data.plugins)
  } else {
    try {
      const raw = localStorage.getItem('subagents.hermes.v1')
      if (raw) {
        const data = JSON.parse(raw) as {
          memory?: MemoryBundle
          skills?: Array<{ path: string; raw: string }>
          soul?: string
          agents?: string
          plugins?: PluginManifest[]
        }
        if (data.memory) memoryStore.loadBundle(data.memory)
        if (data.skills) skillsStore.loadAll(data.skills)
        if (data.soul) setSoulDoc(data.soul)
        if (data.agents) setAgentsDoc(data.agents)
        if (data.plugins) pluginRegistry.loadFromArray(data.plugins)
      }
    } catch {
      /* ignore */
    }
  }
  // Also try Electron plugins dir
  if (window.subagents?.plugins?.list) {
    try {
      const files = (await window.subagents.plugins.list()) as PluginManifest[]
      if (files?.length) {
        pluginRegistry.loadFromArray([...pluginRegistry.list(), ...files])
      }
    } catch {
      /* ignore */
    }
  }
  pluginRegistry.apply()
}

async function saveToDisk() {
  const payload = {
    memory: memoryStore.getBundle(),
    skills: skillsStore.exportAll(),
    soul: getSoulDoc(),
    agents: getAgentsDoc(),
    plugins: pluginRegistry.exportAll(),
  }
  if (window.subagents?.hermes?.set) {
    await window.subagents.hermes.set(payload)
  } else {
    localStorage.setItem('subagents.hermes.v1', JSON.stringify(payload))
  }
}

export const useLearningStore = create<LearningStore>((set, get) => {
  learningLoop.subscribe((events) => {
    set({
      events,
      pendingDrafts: learningLoop.getPendingSkillDrafts(),
      memory: memoryStore.getBundle(),
      skills: skillsStore.list(),
    })
    void get().persist()
  })

  return {
    loaded: false,
    memory: memoryStore.getBundle(),
    skills: skillsStore.list(),
    events: learningLoop.getEvents(),
    pendingDrafts: learningLoop.getPendingSkillDrafts(),
    soul: getSoulDoc(),
    agents: getAgentsDoc(),
    searchHits: [],
    plugins: pluginRegistry.list(),

    load: async () => {
      await loadFromDisk()
      set({
        loaded: true,
        memory: memoryStore.getBundle(),
        skills: skillsStore.list(),
        events: learningLoop.getEvents(),
        pendingDrafts: learningLoop.getPendingSkillDrafts(),
        soul: getSoulDoc(),
        agents: getAgentsDoc(),
        plugins: pluginRegistry.list(),
      })
    },

    persist: async () => {
      await saveToDisk()
    },

    refresh: () => {
      set({
        memory: memoryStore.getBundle(),
        skills: skillsStore.list(),
        events: learningLoop.getEvents(),
        pendingDrafts: learningLoop.getPendingSkillDrafts(),
        soul: getSoulDoc(),
        agents: getAgentsDoc(),
        plugins: pluginRegistry.list(),
      })
    },

    setUserProfile: async (text) => {
      memoryStore.setUserProfile(text)
      get().refresh()
      await get().persist()
    },

    setMemoryDoc: async (text) => {
      memoryStore.setMemoryDoc(text)
      get().refresh()
      await get().persist()
    },

    appendMemory: async (text) => {
      memoryStore.appendMemory(text)
      get().refresh()
      await get().persist()
    },

    deleteMemoryEntry: async (id) => {
      memoryStore.deleteEntry(id)
      get().refresh()
      await get().persist()
    },

    clearMemories: async () => {
      memoryStore.clearAll()
      get().refresh()
      await get().persist()
    },

    setSoul: async (text) => {
      setSoulDoc(text)
      set({ soul: getSoulDoc() })
      await get().persist()
    },

    setAgents: async (text) => {
      setAgentsDoc(text)
      set({ agents: getAgentsDoc() })
      await get().persist()
    },

    approveDraft: async (name) => {
      learningLoop.approveSkillDraft(name)
      get().refresh()
      await get().persist()
    },

    rejectDraft: (name) => {
      learningLoop.rejectSkillDraft(name)
      get().refresh()
    },

    search: (query, archive) => {
      set({ searchHits: searchSessions(query, archive) })
    },

    saveSkill: async (name, description, body) => {
      skillsStore.save(
        {
          name,
          description,
          version: '1.0.0',
          author: 'user',
          createdBy: 'user',
        },
        body,
      )
      get().refresh()
      await get().persist()
    },

    removeSkill: async (name) => {
      skillsStore.remove(name)
      get().refresh()
      await get().persist()
    },

    setPluginEnabled: async (id, enabled) => {
      pluginRegistry.setEnabled(id, enabled)
      pluginRegistry.apply()
      get().refresh()
      await get().persist()
    },

    importPlugin: async (manifest) => {
      pluginRegistry.add({ ...manifest, enabled: manifest.enabled !== false })
      pluginRegistry.apply()
      get().refresh()
      await get().persist()
    },

    removePlugin: async (id) => {
      pluginRegistry.remove(id)
      pluginRegistry.apply()
      get().refresh()
      await get().persist()
    },

    applyPlugins: () => {
      pluginRegistry.apply()
      get().refresh()
    },
  }
})
