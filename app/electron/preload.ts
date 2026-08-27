import { contextBridge, ipcRenderer } from 'electron'
import type { PublishAdapterResult } from '../src/agent/contentPublishAdapters'
import type { PiTurnSettlement } from '../src/agent/piHostRun'
import type { TurnRecordPage } from '../src/agent/turnRecord'
import { sanitizeCliDoctorProviders } from '../src/agent/cliDoctor'
import type { SubDesignPluginExecutionProjection, SubDesignPluginExecutionRequest } from '../src/agent/subdesign/pluginExecution'
import type { SubDesignMetadataKind } from '../src/agent/subdesign/metadataKinds'
import type { PiCatalogEntry } from './piToolHost'
import type { PiHostAttachment, PiHostAttachmentPage, PiHostFinalizationClaimResult, PiHostFinalizationCompleteResult } from './piHostAttachment'
import type {
  ExternalCliConnectorRequirement,
  ExternalCliRunPhase,
  ExternalCliTerminalClassification,
} from '../src/agent/externalCliRunSession'
import type {
  MemoryProjectionResult,
  MemoryProjectionScope,
} from '../src/agent/memoryProjection'

type PiHostThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type PiHostSettings = {
  provider: string
  model: string
  thinkingLevel: PiHostThinkingLevel
  activeTools: string[]
  compaction: 'auto' | 'manual'
  approvalMode: 'always' | 'auto' | 'full'
  bashRequireAsk: boolean
  unattended: boolean
  workspaceTextSearch?: boolean
}
type PiHostConfigStatus = {
  settingsSource: 'native' | 'managed' | 'default'
  settingsLoaded: boolean
  oauthSources: Array<'codex-cli' | 'claude-cli'>
  oauthImportedProviders: string[]
  oauthSkippedProviders: string[]
  oauthConflicts: string[]
  /** ADR-0052: availability metadata only; never credential-shaped. */
  subscriptionCatalog?: import('../src/agent/subscriptionCatalog').SubscriptionProviderCatalog[]
  /** True when the rows above are the last-good cache, not this boot's build. */
  subscriptionCatalogStale?: boolean
  /** When the published catalog was built (cache keeps its ORIGINAL build time). */
  subscriptionCatalogCachedAt?: number
}

const api = {
  platform: () => ipcRenderer.invoke('app:platform') as Promise<string>,
  version: () => ipcRenderer.invoke('app:version') as Promise<string>,
  piHost: {
    onEvent: (cb: (event: { event: string; payload: unknown }) => void) => {
      const handler = (_evt: unknown, event: { event: string; payload: unknown }) => cb(event)
      ipcRenderer.on('pi-host:event', handler)
      return () => ipcRenderer.removeListener('pi-host:event', handler)
    },
    status: () => ipcRenderer.invoke('pi-host:status') as Promise<{
      state: 'stopped' | 'starting' | 'ready' | 'crashed' | 'error'
      protocolVersion?: number
      capabilities?: string[]
      exitCode?: number | null
      signal?: number
      message?: string
    }>,
    health: () => ipcRenderer.invoke('pi-host:health') as Promise<{
      protocolVersion: number
      capabilities: string[]
      status: 'ready'
    }>,
    settings: {
      get: () => ipcRenderer.invoke('pi-host:settings:get') as Promise<{
        settings: PiHostSettings
        config?: PiHostConfigStatus
      }>,
      update: (patch: { provider?: string; baseUrl?: string; apiKey?: string; model?: string; thinkingLevel?: PiHostThinkingLevel; activeTools?: string[]; compaction?: 'auto' | 'manual'; approvalMode?: 'always' | 'auto' | 'full'; bashRequireAsk?: boolean; unattended?: boolean; workspaceTextSearch?: boolean }) =>
        ipcRenderer.invoke('pi-host:settings:update', patch) as Promise<{
          settings: PiHostSettings
          config?: PiHostConfigStatus
        }>,
      profile: (role?: Record<string, unknown>, taskOverride?: Record<string, unknown>) =>
        ipcRenderer.invoke('pi-host:settings:profile', role, taskOverride) as Promise<{ profile: unknown }>,
    },
      sessions: {
        create: (title?: string, threadId?: string) => ipcRenderer.invoke('pi-host:sessions:create', title, threadId) as Promise<{ sessionId: string; sessions: unknown[] }>,
        createChild: (input: Record<string, unknown>) => ipcRenderer.invoke('pi-host:sessions:create-child', input) as Promise<{ sessionId: string; sessions: unknown[] }>,
        list: () => ipcRenderer.invoke('pi-host:sessions:list') as Promise<{ sessions: unknown[] }>,
        record: (sessionId: string, before?: number, limit?: number) =>
          ipcRenderer.invoke('pi-host:sessions:record', sessionId, before, limit) as Promise<{ page: TurnRecordPage }>,
        fork: (sessionId: string) => ipcRenderer.invoke('pi-host:sessions:fork', sessionId) as Promise<{ sessionId: string; sessions: unknown[] }>,
        reset: (sessionId: string) => ipcRenderer.invoke('pi-host:sessions:reset', sessionId) as Promise<{ sessionId: string; sessions: unknown[] }>,
        archive: (sessionId: string) => ipcRenderer.invoke('pi-host:sessions:archive', sessionId) as Promise<{ sessionId: string; sessions: unknown[] }>,
        compact: (sessionId: string) => ipcRenderer.invoke('pi-host:sessions:compact', sessionId) as Promise<{ sessionId: string; sessions: unknown[] }>,
      },
      runs: {
        list: () => ipcRenderer.invoke('pi-host:runs:list') as Promise<{ queue: unknown[] }>,
        active: () => ipcRenderer.invoke('pi-host:runs:active') as Promise<{ activeRuns: PiHostAttachment[]; terminalRuns: PiHostAttachment[] }>,
        attach: (runId: string, before?: number, limit?: number) => ipcRenderer.invoke('pi-host:runs:attach', runId, before, limit) as Promise<{ page?: PiHostAttachmentPage; attachment?: PiHostAttachment }>,
        finalizeClaim: (runId: string, claimantId: string, leaseMs?: number) => ipcRenderer.invoke('pi-host:runs:finalize-claim', runId, claimantId, leaseMs) as Promise<PiHostFinalizationClaimResult>,
        finalizeComplete: (runId: string, claimantId: string, claimEpoch: number, finalOutcome: import('../src/agent/runLearningSettlement').RunLearningFinalOutcome) => ipcRenderer.invoke('pi-host:runs:finalize-complete', runId, claimantId, claimEpoch, finalOutcome) as Promise<PiHostFinalizationCompleteResult>,
        ack: (runId: string) => ipcRenderer.invoke('pi-host:runs:ack', runId) as Promise<{ runId: string; resolved: boolean }>,
        enqueue: (input: Record<string, unknown>) => ipcRenderer.invoke('pi-host:runs:enqueue', input) as Promise<{ queue: unknown[] }>,
        cancel: (runId: string) => ipcRenderer.invoke('pi-host:runs:cancel', runId) as Promise<{ queue: unknown[] }>,
        claim: (runId?: string) => ipcRenderer.invoke('pi-host:runs:claim', runId) as Promise<{ run?: unknown; queue: unknown[] }>,
        settle: (runId: string, settlement: PiTurnSettlement) => ipcRenderer.invoke('pi-host:runs:settle', runId, settlement) as Promise<{ run?: unknown; queue: unknown[]; settlement: string }>,
      },
      resources: {
        list: () => ipcRenderer.invoke('pi-host:resources:list') as Promise<{ resources?: Array<{ id: string; kind: string; source: string; enabled: boolean; reason?: string }>; diagnostics?: Array<{ path: string; message?: unknown }> }>,
        reload: (resources: unknown[]) => ipcRenderer.invoke('pi-host:resources:reload', resources) as Promise<{ resources: unknown[] }>,
        syncSkills: (skills: Array<{ name?: string; description?: string; body?: string; status?: string }>) =>
          ipcRenderer.invoke('pi-host:resources:sync-skills', skills) as Promise<{ skillsDir: string; results: Array<{ name: string; ok: boolean; status?: string; filePath?: string; slug?: string; error?: string }> }>,
        listSkillFiles: () =>
          ipcRenderer.invoke('pi-host:resources:list-skill-files') as Promise<{ files: Array<{ path: string; raw: string }> }>,
      },
      approvals: {
        resolve: (input: { runId: string; callId: string; decision: 'allow' | 'deny'; answer?: string }) =>
          ipcRenderer.invoke('pi-host:approvals:resolve', input) as Promise<unknown>,
      },
      memory: {
        list: () => ipcRenderer.invoke('pi-host:memory:list') as Promise<{ memories: unknown[] }>,
        add: (memory: Record<string, unknown>) => ipcRenderer.invoke('pi-host:memory:add', memory) as Promise<{ memories: unknown[] }>,
        delete: (id: string) => ipcRenderer.invoke('pi-host:memory:delete', id) as Promise<{ memories: unknown[] }>,
        clear: () => ipcRenderer.invoke('pi-host:memory:clear') as Promise<{ memories: unknown[] }>,
        recall: (query: string, project?: string, limit?: number) => ipcRenderer.invoke('pi-host:memory:recall', query, project, limit) as Promise<{ memories: unknown[] }>,
      },
      memoryProjection: {
        list: (input: { scope: MemoryProjectionScope; cursor?: string; limit?: number }) =>
          ipcRenderer.invoke('pi-host:memory-projection:list', input) as Promise<MemoryProjectionResult>,
        get: (logicalKey: 'profile:user' | 'memory:document') =>
          ipcRenderer.invoke('pi-host:memory-projection:get', logicalKey) as Promise<MemoryProjectionResult>,
        upsert: (input: {
          scope: MemoryProjectionScope
          logicalKey: string
          kind: 'memory' | 'profile' | 'document'
          text: string
          tags: string[]
          createdAt: string
        }) => ipcRenderer.invoke('pi-host:memory-projection:upsert', input) as Promise<MemoryProjectionResult>,
        delete: (input: { scope: MemoryProjectionScope; logicalKey: string }) =>
          ipcRenderer.invoke('pi-host:memory-projection:delete', input) as Promise<MemoryProjectionResult>,
        clear: (scope: MemoryProjectionScope) =>
          ipcRenderer.invoke('pi-host:memory-projection:clear', scope) as Promise<MemoryProjectionResult>,
      },
      capabilities: {
        list: () => ipcRenderer.invoke('pi-host:capabilities:list') as Promise<{ items: unknown[] }>,
        load: (id: string) => ipcRenderer.invoke('pi-host:capabilities:load', id) as Promise<{ items: unknown[]; loaded: boolean }>,
        search: (query: string) => ipcRenderer.invoke('pi-host:capabilities:search', query) as Promise<{ items: unknown[] }>,
      },
      extensions: {
        list: () => ipcRenderer.invoke('pi-host:extensions:list') as Promise<{ extensions: unknown[] }>,
        install: (input: { id: string; name: string; version: string; kind: 'package' | 'mcp'; source: string; enabled?: boolean; trusted?: boolean; tools?: string[]; credentialRefs?: string[]; mcp?: { command: string; args: string[]; env?: Record<string, string> } }) => ipcRenderer.invoke('pi-host:extensions:install', input) as Promise<{ extension?: unknown }>,
        update: (input: { id: string; name?: string; version?: string; source?: string; enabled?: boolean; trusted?: boolean; tools?: string[]; credentialRefs?: string[]; mcp?: { command: string; args: string[]; env?: Record<string, string> } }) => ipcRenderer.invoke('pi-host:extensions:update', input) as Promise<{ extension?: unknown }>,
        reload: (id: string) => ipcRenderer.invoke('pi-host:extensions:reload', id) as Promise<{ extension?: unknown }>,
        setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('pi-host:extensions:set-enabled', { id, enabled }) as Promise<{ extension?: unknown }>,
        uninstall: (id: string) => ipcRenderer.invoke('pi-host:extensions:uninstall', id) as Promise<{ removed?: boolean }>,
      },
      turn: {
        submit: (input: { sessionId: string; prompt: string; runId?: string; cwd?: string; profile?: Record<string, unknown>; contextPolicy?: { memoryEnabled: boolean; memoryWriteEnabled: boolean; referenceChatHistory: boolean; temporary: boolean; project?: string; contextWindowTokens?: number; deniedTools?: string[]; approvalTools?: string[]; outboundShellMode?: 'required' | 'optional' | 'demo' | 'off'; viewRoot?: string; gitPolicy?: { branchPrefix?: string; allowForcePush: boolean; draftPr: boolean }; approvalTimeoutMs?: number }; pattern?: 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'; maxIterations?: number; definitionOfDone?: string; timeoutMs?: number; mode?: 'steer' | 'queue'; queue?: boolean; pluginExecution?: SubDesignPluginExecutionRequest }) => ipcRenderer.invoke('pi-host:turn:submit', input) as Promise<{ sessionId: string; runId: string; settlement: string; queued?: 'steer' | 'queue'; items?: unknown[]; orchestration?: { pattern: string; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }; pluginExecution?: SubDesignPluginExecutionProjection }>,
        cancel: (runId: string) => ipcRenderer.invoke('pi-host:turn:cancel', runId) as Promise<{ runId: string; settlement: string }>,
        interrupt: (input: { runId: string; reason?: 'user' | 'timeout' }) =>
          ipcRenderer.invoke('pi-host:turn:interrupt', input) as Promise<{ runId: string; settlement: string; interruptReason?: 'user' | 'timeout' }>,
      },
      tools: {
      list: () => ipcRenderer.invoke('pi-host:tools:list') as Promise<{ builtinTools: string[] }>,
        catalog: () => ipcRenderer.invoke('pi-host:tools:catalog') as Promise<{ catalog: PiCatalogEntry[] }>,
        execute: (tool: 'read' | 'grep' | 'find' | 'ls' | 'write' | 'edit' | 'bash' | 'code' | 'mcp', params: Record<string, unknown>) =>
        ipcRenderer.invoke('pi-host:tools:execute', { tool, params }) as Promise<{ tool: string; content: unknown }>,
    },
  },
  journal: {
    /** Durable main-process mirror of the renderer run journal. */
    read: () => ipcRenderer.invoke('journal:mirror:read') as Promise<{ state: string; savedAt?: string; fromBackup?: boolean } | null>,
    write: (state: string) => ipcRenderer.invoke('journal:mirror:write', state) as Promise<{ ok: boolean; error?: string }>,
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state') as Promise<{
      schemaVersion: 1
      status: 'idle' | 'available' | 'deferred' | 'downloaded' | 'install-pending' | 'rolled-back' | 'failed'
      currentVersion: string
      manifest?: { version: string; mandatory: boolean; releaseNotes: string; platform: string; arch: string }
      downloadedPath?: string
      progress: number
      deferredUntil?: string
      transactionId?: string
      lastError?: string
      updatedAt: string
    }>,
    check: (input?: { url?: string }) => ipcRenderer.invoke('updates:check', input || {}) as Promise<{ ok: boolean; state: unknown; error?: string }>,
    defer: (version: string) => ipcRenderer.invoke('updates:defer', version) as Promise<{ ok: boolean; state: unknown; error?: string }>,
    download: () => ipcRenderer.invoke('updates:download') as Promise<{ ok: boolean; state: unknown; error?: string }>,
    captureMigration: (input: { appVersion?: string; rendererStorage?: Record<string, string>; projects?: Array<{ root: string; name?: string; branch?: string | null }>; queue?: unknown; schedules?: unknown[]; artifactIndex?: unknown }) => ipcRenderer.invoke('updates:captureMigration', input) as Promise<unknown>,
    install: (snapshot: unknown) => ipcRenderer.invoke('updates:install', snapshot) as Promise<{ ok: boolean; restartRequired: boolean; state: unknown; error?: string }>,
    rollback: () => ipcRenderer.invoke('updates:rollback') as Promise<{ ok: boolean; launchable: boolean; state: unknown; rollbackPath?: string; snapshot?: { rendererStorage?: Record<string, string> } }>,
    pendingMigration: () => ipcRenderer.invoke('updates:pendingMigration') as Promise<{ ok: boolean; state: unknown; snapshot?: { rendererStorage?: Record<string, string> }; error?: string }>,
    completeMigration: (snapshot?: unknown) => ipcRenderer.invoke('updates:completeMigration', snapshot) as Promise<unknown>,
    onProgress: (cb: (payload: { progress: number }) => void) => {
      const handler = (_evt: unknown, payload: { progress: number }) => cb(payload)
      ipcRenderer.on('updates:progress', handler)
      return () => ipcRenderer.removeListener('updates:progress', handler)
    },
  },
  /** 檔案回捲(G5):寫入前快照 + 依時點還原(外部改動保護) */
  rewind: {
    record: (payload: {
      threadId: string
      runId?: string
      kind: 'write' | 'delete' | 'move'
      relPath: string
      toPath?: string
      before: string | null
      after?: string | null
    }) =>
      ipcRenderer.invoke('rewind:record', payload) as Promise<{
        ok: boolean
        id?: string
        skipped?: string
      }>,
    list: (threadId: string) =>
      ipcRenderer.invoke('rewind:list', threadId) as Promise<
        Array<{
          id: string
          threadId: string
          runId?: string
          kind: 'write' | 'delete' | 'move'
          at: string
          relPath: string
          toPath?: string
          beforeBytes: number
          existedBefore: boolean
        }>
      >,
    restore: (threadId: string, toEntryId: string, projectRoot?: string, force?: boolean) =>
      ipcRenderer.invoke('rewind:restore', threadId, toEntryId, projectRoot, force) as Promise<{
        ok: boolean
        restored: string[]
        conflicts: string[]
        errors: string[]
      }>,
    clear: (threadId: string) =>
      ipcRenderer.invoke('rewind:clear', threadId) as Promise<boolean>,
  },
  checkpoints: {
    save: (input: { runId: string; threadId?: string; summary: string; messages: unknown[] }) =>
      ipcRenderer.invoke('checkpoints:save', input) as Promise<{ ok: boolean; checkpoint?: unknown; error?: string }>,
    load: (runId: string) => ipcRenderer.invoke('checkpoints:load', runId) as Promise<unknown>,
    list: (runId?: string) => ipcRenderer.invoke('checkpoints:list', runId) as Promise<unknown[]>,
    remove: (runId: string) => ipcRenderer.invoke('checkpoints:remove', runId) as Promise<{ ok: boolean }>,
    claimResume: (runId: string) =>
      ipcRenderer.invoke('checkpoints:claim-resume', runId) as Promise<{ ok: boolean; checkpoint?: unknown; reason?: string }>,
  },
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('app:notify', title, body) as Promise<{ ok: boolean }>,
  showWindow: () => ipcRenderer.invoke('app:showWindow') as Promise<{ ok: boolean }>,
  userDataPath: () => ipcRenderer.invoke('app:userDataPath') as Promise<string>,
  /** Prevent system sleep while long agent runs (ChatGPT-style) */
  power: {
    preventSleep: () =>
      ipcRenderer.invoke('power:preventSleep') as Promise<{ ok: boolean; id?: number }>,
    allowSleep: () =>
      ipcRenderer.invoke('power:allowSleep') as Promise<{ ok: boolean }>,
  },
  webhook: {
    start: (opts?: { port?: number; token?: string }) =>
      ipcRenderer.invoke('webhook:start', opts || {}) as Promise<{
        running: boolean
        port: number
        token: string
        url: string | null
        lastError: string | null
        hitCount: number
      }>,
    stop: () =>
      ipcRenderer.invoke('webhook:stop') as Promise<{
        running: boolean
        port: number
        token: string
        url: string | null
        lastError: string | null
        hitCount: number
      }>,
    status: () =>
      ipcRenderer.invoke('webhook:status') as Promise<{
        running: boolean
        port: number
        token: string
        url: string | null
        lastError: string | null
        hitCount: number
      }>,
    dispatch: (request: { target: string; payload: Record<string, unknown> }) =>
      ipcRenderer.invoke('webhook:dispatch', request) as Promise<{
        ok: boolean
        status?: number
        error?: string
      }>,
    onEvent: (cb: (payload: {
      receivedAt: string
      path: string
      source?: string
      subject?: string
      hasAttachment?: boolean
      body?: string
      keyword?: string
      headers: Record<string, string>
      raw: unknown
    }) => void) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('webhook:event', handler)
      return () => {
        ipcRenderer.removeListener('webhook:event', handler)
      }
    },
  },
  /** G10 monitor 事件流:長命令輸出逐行 → Proactive 事件 */
  monitor: {
    start: (input: { command: string; description: string; cwd?: string }) =>
      ipcRenderer.invoke('monitor:start', input) as Promise<{
        ok: boolean
        id?: string
        error?: string
      }>,
    stop: (id: string) => ipcRenderer.invoke('monitor:stop', id) as Promise<boolean>,
    list: () =>
      ipcRenderer.invoke('monitor:list') as Promise<
        Array<{
          id: string
          description: string
          command: string
          startedAt: string
          lineCount: number
        }>
      >,
    onEvent: (
      cb: (payload: { id: string; description: string; line: string; at: string }) => void,
    ) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('monitor:event', handler)
      return () => {
        ipcRenderer.removeListener('monitor:event', handler)
      }
    },
    onStopped: (
      cb: (payload: {
        id: string
        description: string
        reason: 'exit' | 'volume' | 'stopped' | 'error'
        detail?: string
        code?: number | null
        at: string
      }) => void,
    ) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('monitor:stopped', handler)
      return () => {
        ipcRenderer.removeListener('monitor:stopped', handler)
      }
    },
  },
  archive: {
    list: () => ipcRenderer.invoke('archive:list') as Promise<unknown[]>,
    save: (record: unknown) =>
      ipcRenderer.invoke('archive:save', record) as Promise<{ ok: boolean; path: string }>,
    get: (id: string) => ipcRenderer.invoke('archive:get', id) as Promise<unknown | null>,
    delete: (id: string) =>
      ipcRenderer.invoke('archive:delete', id) as Promise<{ ok: boolean }>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<unknown | null>,
    set: (settings: unknown) =>
      ipcRenderer.invoke('settings:set', settings) as Promise<{ ok: boolean }>,
  },
  llm: {
    models: (req: { baseUrl: string; apiKey: string }) =>
      ipcRenderer.invoke('llm:models', req) as Promise<{ models: string[] }>,
    chat: (req: {
      baseUrl: string
      apiKey: string
      model: string
      fallbackModels?: string[]
      messages: unknown[]
      temperature?: number
      max_tokens?: number
      tools?: unknown[]
      tool_choice?: unknown
      runId?: string
      effectiveMode?: 'off' | 'demo' | 'optional' | 'required'
      providerConnectionId?: string
      outboundProfileSource?: 'company' | 'baseline' | 'none'
      outboundRedactionSummary?: import('../src/agent/outbound/redactionTaxonomy.ts').RedactionSummaryEntry[]
    }) =>
      ipcRenderer.invoke('llm:chat', req) as Promise<{
        content: string
        tokensUsed: number
        model: string
        toolCalls?: Array<{ id: string; name: string; arguments: string }>
        finishReason?: string
      }>,
  },
  tools: {
    webSearch: (query: string, limit?: number) =>
      ipcRenderer.invoke('tools:webSearch', query, limit) as Promise<{
        query: string
        results: Array<{ title: string; snippet: string; url?: string }>
      }>,
    httpFetch: (url: string, maxChars?: number) =>
      ipcRenderer.invoke('tools:httpFetch', url, maxChars) as Promise<{
        ok: boolean
        text: string
        status?: number
      }>,
    httpRequest: (input: { url: string; method?: string; headers?: Record<string, string>; body?: string; maxChars?: number }) =>
      ipcRenderer.invoke('tools:httpRequest', input) as Promise<{ ok: boolean; text: string; status?: number }>,
    workspaceList: (path?: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceList', path, projectRoot) as Promise<{
        ok: boolean
        path: string
        entries: Array<{ name: string; dir: boolean }>
        projectRoot?: string | null
        error?: 'not-found' | string
        message?: string
      }>,
    workspaceRead: (path: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceRead', path, projectRoot) as Promise<{
        ok: boolean
        content: string
      }>,
    workspaceGrep: (input: { query: string; path?: string; glob?: string; maxResults?: number }, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceGrep', input, projectRoot) as Promise<{
        ok: boolean
        root: string
        matches: Array<{ path: string; line: number; text: string }>
        files: string[]
        truncated: boolean
        error?: string
      }>,
    workspaceGlob: (input: { pattern: string; path?: string; maxResults?: number }, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceGlob', input, projectRoot) as Promise<{
        ok: boolean
        root: string
        matches: Array<{ path: string; line: number; text: string }>
        files: string[]
        truncated: boolean
        error?: string
      }>,
    workspaceWrite: (path: string, content: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceWrite', path, content, projectRoot) as Promise<{
        ok: boolean
        path: string
        bytes: number
        error?: string
      }>,
    workspaceDiff: (paths?: string[], projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceDiff', paths || [], projectRoot) as Promise<{
        ok: boolean
        diff: string
        files: string[]
        error?: string
      }>,
    workspaceDownload: (url: string, path: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceDownload', url, path, projectRoot) as Promise<{ ok: boolean; path: string; bytes: number; error?: string }>,
    workspaceMkdir: (path: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceMkdir', path, projectRoot) as Promise<{ ok: boolean; path: string; error?: string }>,
    workspaceMove: (from: string, to: string, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceMove', from, to, projectRoot) as Promise<{ ok: boolean; from: string; to: string; error?: string }>,
    workspaceDelete: (path: string, recursive?: boolean, projectRoot?: string) =>
      ipcRenderer.invoke('tools:workspaceDelete', path, recursive, projectRoot) as Promise<{ ok: boolean; path: string; error?: string }>,
    workspaceRoot: () => ipcRenderer.invoke('tools:workspaceRoot') as Promise<string>,
    toolOutputSpillWrite: (input: { runId: string; threadId?: string; tool: string; output: string; projectRoot?: string }) =>
      ipcRenderer.invoke('tools:toolOutputSpillWrite', input) as Promise<{ ok: boolean; locator?: string; bytes?: number; error?: string }>,
    toolOutputSpillRead: (input: { locator: string; runId: string; projectRoot?: string; offset?: number; maxBytes?: number }) =>
      ipcRenderer.invoke('tools:toolOutputSpillRead', input) as Promise<{ ok: boolean; output?: string; bytes?: number; offset?: number; nextOffset?: number; error?: string }>,
    toolOutputSpillDispose: (input: { runId: string; projectRoot?: string }) =>
      ipcRenderer.invoke('tools:toolOutputSpillDispose', input) as Promise<{ ok: boolean }>,
    memorySet: (key: string, value: string) =>
      ipcRenderer.invoke('tools:memorySet', key, value) as Promise<{ ok: boolean }>,
    memoryGet: (key: string) =>
      ipcRenderer.invoke('tools:memoryGet', key) as Promise<string | null>,
  },
  learning: {
    export: (input: { relativePath: string; content: string; projectRoot?: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('learning:export', input) as Promise<{
        ok: boolean
        path?: string
        bytes?: number
        exists?: boolean
        error?: string
      }>,
  },
  subdesign: {
    harnessStatus: (binaryPath?: string) => ipcRenderer.invoke('subdesign:harnessStatus', binaryPath) as Promise<{
      available: boolean
      platform: string
      version: string | null
      reason: string | null
      screenRecording: string
      accessibility: string
    }>,
    readMetadata: (projectRoot?: string) =>
      ipcRenderer.invoke('subdesign:readMetadata', projectRoot) as Promise<{
        ok: boolean
        briefs: unknown[]
        artifacts: unknown[]
        critiques: unknown[]
        exports: unknown[]
        openDesignPacks: unknown[]
        openDesignSnapshots: unknown[]
        openDesignProviderSettings: unknown[]
        openDesignProviderRuns: unknown[]
        openDesignSurfaceSessions: unknown[]
        error?: string
      }>,
    writeMetadata: (input: { kind: SubDesignMetadataKind; payload: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:writeMetadata', input) as Promise<{
        ok: boolean
        path?: string
        bytes?: number
        error?: string
      }>,
    listArtifacts: (projectRoot?: string) =>
      ipcRenderer.invoke('subdesign:listArtifacts', projectRoot) as Promise<{
        ok: boolean
        artifacts: unknown[]
        error?: string
      }>,
    readArtifact: (input: { entry: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:readArtifact', input) as Promise<{
        ok: boolean
        content: string
        error?: string
      }>,
    revealProviderAttachment: (input: { locator: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:revealProviderAttachment', input) as Promise<{
        ok: boolean
        error?: string
      }>,
    patchArtifact: (input: { artifact: unknown; operations: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:patchArtifact', input) as Promise<{
        ok: boolean
        artifact?: unknown
        paths?: string[]
        operationCount?: number
        error?: string
      }>,
    preparePinnedPatchScope: (input: { artifact: unknown; pins: unknown; runId: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:preparePinnedPatchScope', input) as Promise<{
        ok: boolean
        scopeId?: string
        error?: string
      }>,
    clearPinnedPatchScope: (input: { artifactId: string; runId: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:clearPinnedPatchScope', input) as Promise<{ ok: boolean }>,
    registerMcpAppSurface: (input: {
      surfaceId: string
      declaration: unknown
      runId?: string
      threadId?: string
      projectRoot?: string
      expiresAt?: string
    }) => ipcRenderer.invoke('subdesign:registerMcpAppSurface', input) as Promise<{
      ok: boolean
      token?: string
      error?: string
    }>,
    unregisterMcpAppSurface: (token: string) =>
      ipcRenderer.invoke('subdesign:unregisterMcpAppSurface', token) as Promise<{ ok: boolean }>,
    callMcpAppTool: (input: {
      surfaceToken: string
      coordinate: string
      arguments?: Record<string, unknown>
      approvalToken?: string
      approvalDecision?: 'allow' | 'deny'
    }) => ipcRenderer.invoke('subdesign:mcpAppToolCall', input) as Promise<{
      ok: boolean
      content?: unknown
      error?: string
      approvalRequired?: boolean
      approvalToken?: string
    }>,
    applyTweak: (input: { artifact: unknown; tweakId: string; value: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:applyTweak', input) as Promise<{
        ok: boolean
        artifact?: unknown
        paths?: string[]
        operationCount?: number
        error?: string
      }>,
    verifyEvidence: (input: { artifact: unknown; evidence: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:verifyEvidence', input) as Promise<{
        ok: boolean
        validKinds?: string[]
        errors?: string[]
      }>,
    captureEvidence: (input: {
      artifact: unknown
      kind: 'screenshot' | 'dom'
      viewport?: { width: number; height: number }
      projectRoot?: string
    }) => ipcRenderer.invoke('subdesign:captureEvidence', input) as Promise<{
      ok: boolean
      path?: string
      capturedAt?: string
      evidenceId?: string
      sha256?: string
      source?: string
      artifactId?: string
      revision?: number
      createdAt?: string
      error?: string
    }>,
    lintEvidence: (input: { artifact: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:lintEvidence', input) as Promise<{
        ok: boolean
        evidence?: unknown
        findings?: unknown[]
        error?: string
      }>,
    contrastGate: (input: { artifact: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:contrastGate', input) as Promise<{
        ok: boolean
        evidence?: unknown
        violations?: unknown[]
        error?: string
      }>,
    consoleErrorGate: (input: { artifact: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:consoleErrorGate', input) as Promise<{
        ok: boolean
        evidence?: unknown
        errors?: unknown[]
        error?: string
      }>,
    buildSuccessGate: (input: { artifact: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:buildSuccessGate', input) as Promise<{
        ok: boolean
        evidence?: unknown
        problems?: unknown[]
        error?: string
      }>,
    responsiveOverflowGate: (input: { artifact: unknown; widths?: number[]; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:responsiveOverflowGate', input) as Promise<{
        ok: boolean
        evidence?: unknown
        violations?: unknown[]
        error?: string
      }>,
    tokenConsistencyGate: (input: { artifact: unknown; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:tokenConsistencyGate', input) as Promise<{
        ok: boolean
        evidence?: unknown
        violations?: unknown[]
        error?: string
      }>,
    importReference: (input: { briefId: string; kind: 'screenshot' | 'url'; source: string; suggestedTitle?: string; projectRoot?: string }) =>
      ipcRenderer.invoke('subdesign:importReference', input) as Promise<{
        ok: boolean
        reference?: unknown
        error?: string
      }>,
    exportCapabilities: () => ipcRenderer.invoke('subdesign:exportCapabilities') as Promise<{
      ok: boolean
      pptx: boolean
      mp4: boolean
      mp4Error?: string
    }>,
    copyVendorPack: (input: {
      sourcePath: string
      assetPaths: string[]
      targetId: string
      digest: string
      kind?: 'template' | 'skill' | 'prompt' | 'craft' | 'media'
      projectRoot?: string
    }) => ipcRenderer.invoke('subdesign:copyVendorPack', input) as Promise<{
      ok: boolean
      path?: string
      files?: number
      bytes?: number
      error?: string
    }>,
    exportArtifact: (input: {
      artifact: unknown
      critique?: unknown
      format: 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
      projectRoot?: string
      suggestedName?: string
    }) =>
      ipcRenderer.invoke('subdesign:exportArtifact', input) as Promise<{
        ok: boolean
        cancelled?: boolean
        path?: string
        bytes?: number
        sha256?: string
        artifactId?: string
        revision?: number
        format?: 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
        error?: string
      }>,
  },
  scheduler: {
    list: () => ipcRenderer.invoke('scheduler:list') as Promise<unknown[]>,
    saveAll: (jobs: unknown) =>
      ipcRenderer.invoke('scheduler:saveAll', jobs) as Promise<{ ok: boolean }>,
    onTick: (cb: (payload: { at: string }) => void) => {
      const handler = (_: unknown, payload: { at: string }) => cb(payload)
      ipcRenderer.on('scheduler:tick', handler)
      return () => ipcRenderer.removeListener('scheduler:tick', handler)
    },
  },
  events: {
    list: () => ipcRenderer.invoke('events:list') as Promise<unknown[]>,
    saveAll: (events: unknown) =>
      ipcRenderer.invoke('events:saveAll', events) as Promise<{ ok: boolean }>,
  },
  hermes: {
    get: () => ipcRenderer.invoke('hermes:get') as Promise<unknown | null>,
    set: (data: unknown) =>
      ipcRenderer.invoke('hermes:set', data) as Promise<{ ok: boolean }>,
  },
  mcp: {
    discover: (projectRoot?: string) => ipcRenderer.invoke('mcp:discover', projectRoot) as Promise<{
      servers: Array<{ id: string; name: string; enabled: boolean; transport: 'http' | 'stdio'; url?: string; command?: string; args?: string[] }>
      sources: string[]
    }>,
    httpRpc: (input: {
      url: string
      headers?: Record<string, string>
      body: unknown
    }) => ipcRenderer.invoke('mcp:httpRpc', input) as Promise<unknown>,
    stdioListTools: (input: { id: string; command: string; args: string[]; env?: Record<string, string> }) =>
      ipcRenderer.invoke('mcp:stdioListTools', input) as Promise<
        Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
      >,
    stdioCallTool: (input: {
      id: string
      command: string
      args: string[]
      env?: Record<string, string>
      toolName: string
      arguments: Record<string, unknown>
    }) =>
      ipcRenderer.invoke('mcp:stdioCallTool', input) as Promise<{
        ok: boolean
        content: string
        error?: string
      }>,
    stdioEnsure: (input: { id: string; command: string; args: string[]; env?: Record<string, string> }) =>
      ipcRenderer.invoke('mcp:stdioEnsure', input) as Promise<{
        id: string
        command: string
        args: string[]
        alive: boolean
        pid: number | null
        startedAt: string | null
        lastError: string | null
        requestCount: number
      }>,
    stdioStop: (id: string) =>
      ipcRenderer.invoke('mcp:stdioStop', id) as Promise<{ ok: boolean }>,
    stdioStopAll: () =>
      ipcRenderer.invoke('mcp:stdioStopAll') as Promise<{ ok: boolean; stopped: number }>,
    stdioSessions: () =>
      ipcRenderer.invoke('mcp:stdioSessions') as Promise<
        Array<{
          id: string
          command: string
          args: string[]
          alive: boolean
          pid: number | null
          startedAt: string | null
          lastError: string | null
          requestCount: number
        }>
      >,
  },
  shell: {
    bash: (input: { command: string; cwd?: string; timeoutMs?: number; runId?: string }) =>
      ipcRenderer.invoke('shell:bash', input) as Promise<{
        ok: boolean
        code: number | null
        stdout: string
        stderr: string
        timedOut?: boolean
        runId?: string
      }>,
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url) as Promise<{ ok: boolean }>,
  },
  /** Connector credential vault metadata; raw tokens stay in main. */
  secrets: {
    list: () =>
      ipcRenderer.invoke('secrets:list') as Promise<
        Array<{
          id: string
          tokenHint: string
          expiresAt?: number
          tokenType?: string
          updatedAt: string
          hasRefreshToken: boolean
          encrypted: boolean
        }>
      >,
    store: (input: {
      id: string
      token: string
      refreshToken?: string
      expiresIn?: number
      expiresAt?: number
      tokenType?: string
      keepRefreshToken?: boolean
      allowPlaintext?: boolean
    }) =>
      ipcRenderer.invoke('secrets:store', input) as Promise<
        { ok: true; meta: { id: string; tokenHint: string; expiresAt?: number; tokenType?: string; updatedAt: string; hasRefreshToken: boolean; encrypted: boolean } } | { ok: false; error: string; code?: string }
      >,
    clear: (id: string) => ipcRenderer.invoke('secrets:clear', id) as Promise<{ ok: boolean }>,
    migrate: (map: Record<string, unknown>) =>
      ipcRenderer.invoke('secrets:migrate', map) as Promise<{ ok: boolean; imported: number; error?: string }>,
    refresh: (input: {
      pluginId: string
      clientId: string
      clientSecret?: string
      tokenUrl: string
      tokenAuth?: 'body' | 'basic'
    }) =>
      ipcRenderer.invoke('secrets:refresh', input) as Promise<
        { ok: true; meta: { id: string; tokenHint: string; expiresAt?: number; tokenType?: string; updatedAt: string; hasRefreshToken: boolean; encrypted: boolean } } | { ok: false; error: string }
      >,
  },
  oauth: {
    run: (input: { pluginId: string; clientId: string; clientSecret?: string }) =>
      ipcRenderer.invoke('oauth:run', input) as Promise<{
        ok: boolean
        pluginId: string
        accessToken?: string
        refreshToken?: string
        expiresIn?: number
        tokenType?: string
        error?: string
      }>,
    refresh: (input: {
      pluginId: string
      refreshToken: string
      clientId: string
      clientSecret?: string
      tokenUrl: string
      tokenAuth?: 'body' | 'basic'
    }) =>
      ipcRenderer.invoke('oauth:refresh', input) as Promise<{
        ok: boolean
        pluginId: string
        accessToken?: string
        refreshToken?: string
        expiresIn?: number
        tokenType?: string
        error?: string
      }>,
    cancel: () => ipcRenderer.invoke('oauth:cancel') as Promise<{ ok: boolean }>,
    onStatus: (
      cb: (payload: {
        pluginId: string
        phase: string
        userCode?: string
        verificationUri?: string
        message?: string
        error?: string
      }) => void,
    ) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('oauth:status', handler)
      return () => {
        ipcRenderer.removeListener('oauth:status', handler)
      }
    },
  },
  contentPublishing: {
    oauth: (input: { platform: 'instagram' | 'linkedin' | 'x' | 'facebook' | 'youtube'; clientId?: string; clientSecret?: string }) =>
      ipcRenderer.invoke('contentPublishing:oauth', input) as Promise<{
        ok: true
        platform: 'instagram' | 'linkedin' | 'x' | 'facebook' | 'youtube'
        status: {
          platform: 'instagram' | 'linkedin' | 'x' | 'facebook' | 'youtube'
          label: string
          connected: boolean
          expiresAt?: number
          hasRefreshToken: boolean
          encrypted: boolean
          accountLabel?: string
          accountId?: string
          error?: string
        }
      } | {
        ok: false
        platform: string
        error: string
      }>,
    status: () => ipcRenderer.invoke('contentPublishing:status') as Promise<Array<{
      platform: 'instagram' | 'linkedin' | 'x' | 'facebook' | 'youtube'
      label: string
      connected: boolean
      expiresAt?: number
      hasRefreshToken: boolean
      encrypted: boolean
      accountLabel?: string
      accountId?: string
      error?: string
    }>>,
    disconnect: (platform: string) =>
      ipcRenderer.invoke('contentPublishing:disconnect', platform) as Promise<{ ok: boolean; error?: string }>,
    publish: (input: {
      scheduleId: string
      contentItemId: string
      platform: string
      scheduledAt: string
      title: string
      body: string
      mediaUrl?: string
      mediaPath?: string
      mediaMimeType?: string
      targetId?: string
      privacyStatus?: 'private' | 'public' | 'unlisted'
    }) => ipcRenderer.invoke('contentPublishing:publish', input) as Promise<PublishAdapterResult>,
  },
  project: {
    pick: (opts?: { defaultPath?: string }) =>
      ipcRenderer.invoke('project:pick', opts) as Promise<{
        canceled: boolean
        path: string | null
        error?: string
      }>,
    inspect: (root: string) =>
      ipcRenderer.invoke('project:inspect', root) as Promise<{
        root: string
        name: string
        isGit: boolean
        branch: string | null
        remote: string | null
        worktrees: Array<{
          path: string
          branch: string
          bare: boolean
          detached: boolean
        }>
        dirty: boolean
      }>,
    branches: (root: string) =>
      ipcRenderer.invoke('project:branches', root) as Promise<string[]>,
    /** G9 worktree 隔離:建立/套用/移除(delegate isolation=worktree 用) */
    worktreeCreate: (root: string, branchPrefix?: string) =>
      ipcRenderer.invoke('project:worktreeCreate', root, branchPrefix) as Promise<{
        ok: boolean
        path?: string
        branch?: string
        error?: string
      }>,
    worktreeApply: (root: string, worktreePath: string) =>
      ipcRenderer.invoke('project:worktreeApply', root, worktreePath) as Promise<{
        ok: boolean
        error?: string
      }>,
    worktreeRemove: (root: string, worktreePath: string) =>
      ipcRenderer.invoke('project:worktreeRemove', root, worktreePath) as Promise<{
        ok: boolean
        error?: string
      }>,
    /** Persistent project guidance (AGENTS.md / CLAUDE.md hierarchy, read-only).
     *  workPath: optional file/dir under root for subdirectory AGENTS layers. */
    agentsDocs: (root: string, workPath?: string) =>
      ipcRenderer.invoke('project:agentsDocs', root, workPath) as Promise<{
        docs: Array<{
          path: string
          scope: 'project' | 'project-parent' | 'project-subdir'
          bytes: number
          truncated: boolean
          mtimeMs: number
          content: string
        }>
      }>,
    /** Sync tools/bash cwd with ProjectContextBar */
    setActiveRoot: (root: string | null) =>
      ipcRenderer.invoke('project:setActiveRoot', root) as Promise<{
        ok: boolean
        root: string
        mode: 'project' | 'sandbox'
        error?: string
      }>,
    getActiveRoot: () =>
      ipcRenderer.invoke('project:getActiveRoot') as Promise<{
        root: string
        mode: 'project' | 'sandbox'
        projectRoot: string | null
      }>,
    /** App 選單 / 系統匣「選擇專案資料夾」推送的路徑 */
    onSelected: (cb: (path: string) => void) => {
      const handler = (_: unknown, p: string) => cb(p)
      ipcRenderer.on('project:selected', handler)
      return () => {
        ipcRenderer.removeListener('project:selected', handler)
      }
    },
  },
  cli: {
    which: (binary: string) =>
      ipcRenderer.invoke('cli:which', binary) as Promise<{
        found: boolean
        path: string | null
      }>,
    discover: () =>
      ipcRenderer.invoke('cli:discover') as Promise<{
        clis: Array<{
          id: string
          kind: string
          name: string
          foundBinary: boolean
          binaryPath: string | null
          configPaths: string[]
          hasAuth: boolean
          authNote: string
          models: Array<{ id: string; label: string; depths: string[] }>
          defaultModel?: string
          defaultDepth?: string
          notes: string[]
        }>
        summary: string
      }>,
    doctor: (currentProviders: unknown[] = []) =>
      ipcRenderer.invoke('cli:doctor', sanitizeCliDoctorProviders(currentProviders)) as Promise<{
        platform: string
        checkedAt: string
        readyToRun: boolean
        summary: string
        checks: Array<{
          id: string
          label: string
          status: 'ready' | 'missing' | 'needs-auth'
          detail: string
          remediation: string
          retryable: true
        }>
      }>,
    applyDiscovery: (currentProviders: unknown[]) =>
      ipcRenderer.invoke('cli:applyDiscovery', currentProviders) as Promise<{
        providers: unknown[]
        summary: string
        clis: unknown[]
        suggestedModel?: string
        suggestedDepth?: string
      }>,
    runAgent: (input: {
      kind: 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini' | 'cursor'
      binary?: string
      prompt: string
      cwd?: string
      model?: string
      depth?: string
      agentMode?: string
      approvalMode?: 'always' | 'auto' | 'full'
      unattended?: boolean
      timeoutMs?: number
      runId?: string
      conversationId?: string
      externalCliPolicy?: Record<string, number>
      requiredConnectors?: ExternalCliConnectorRequirement[]
      configSnapshot?: unknown
      /** Chat attachments (images as data URL) — written to disk for the CLI */
      attachments?: Array<{
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
        filePath?: string
      }>
      /** When isolation verified — main wraps CLI under seatbelt/bwrap */
      sandboxWrap?: {
        engine: 'seatbelt' | 'bwrap'
        viewRoot: string
      }
      /** Effective outbound guard mode for main sandbox admission. */
      effectiveMode?: 'off' | 'demo' | 'optional' | 'required'
      /** External CLI delegate/continue contract; no parent transcript. */
      externalCliContract?: unknown
    }) =>
      ipcRenderer.invoke('cli:runAgent', input) as Promise<{
        ok: boolean
        output: string
        command: string
        kind: string
        code: number | null
        timedOut?: boolean
        cancelled?: boolean
        error?: string
        runId?: string
        externalRun?: unknown
        terminalClassification?: ExternalCliTerminalClassification
      }>,
    /** Live CLI process events (thought / text / tool / log) for center feed */
    onStream: (
      cb: (ev: {
        runId?: string
        kind: string
        title?: string
        detail?: string
        tool?: string
        ok?: boolean
        delta?: string
        channel?: 'thought' | 'text' | 'stdout' | 'stderr'
        path?: string
        paths?: string[]
        added?: number
        removed?: number
        action?: 'edit' | 'create' | 'delete' | 'write' | 'read'
        /** kind=plan 時的任務清單快照（右側面板同步） */
        todos?: Array<{ text: string; status?: 'pending' | 'active' | 'done' }>
        sequence?: number
        sessionPhase?: ExternalCliRunPhase
        terminalClassification?: ExternalCliTerminalClassification
        providerSessionId?: string
      }) => void,
    ) => {
      const handler = (_: unknown, ev: unknown) => cb(ev as Parameters<typeof cb>[0])
      ipcRenderer.on('cli:stream', handler)
      return () => {
        ipcRenderer.removeListener('cli:stream', handler)
      }
    },
    /** Stop in-flight CLI agent (and tagged cli-agent bash) */
    cancel: (runId?: string) =>
      ipcRenderer.invoke('cli:cancel', runId) as Promise<{ ok: boolean; killed: number; confirmed?: boolean }>,
    /** Host-owned session reconstruction after a bounded yield or reload. */
    sessionSnapshot: (runId: string) =>
      ipcRenderer.invoke('cli:sessionSnapshot', runId) as Promise<unknown>,
    sessionSnapshots: () =>
      ipcRenderer.invoke('cli:sessionSnapshots') as Promise<unknown[]>,
    sessionRecovery: () =>
      ipcRenderer.invoke('cli:sessionRecovery') as Promise<unknown[]>,
    sessionEvents: (input: { runId: string; cursor?: number }) =>
      ipcRenderer.invoke('cli:sessionEvents', input) as Promise<unknown>,
    sessionYield: (runId: string) =>
      ipcRenderer.invoke('cli:sessionYield', runId) as Promise<unknown>,
    sessionInput: (input: { runId: string; value: string; providerSessionId?: string }) =>
      ipcRenderer.invoke('cli:sessionInput', input) as Promise<boolean>,
    sessionApproval: (input: { runId: string; approved: boolean; providerSessionId?: string }) =>
      ipcRenderer.invoke('cli:sessionApproval', input) as Promise<boolean>,
    sessionAck: (runId: string) =>
      ipcRenderer.invoke('cli:sessionAck', runId) as Promise<boolean>,
    sessionRecoveryAction: (input: { runId: string; action: 'resume' | 'retry' }) =>
      ipcRenderer.invoke('cli:sessionRecoveryAction', input) as Promise<{
        ok: boolean
        mode?: 'manual-retry'
        reason?: string
      }>,
  },
  /** Persist / reload chat attachments on disk */
  attachments: {
    materialize: (input: {
      attachments: Array<{
        id?: string
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
        filePath?: string
        size?: number
      }>
      projectRoot?: string
      sessionId?: string
    }) =>
      ipcRenderer.invoke('attachments:materialize', input) as Promise<{
        ok: boolean
        dir: string | null
        items: Array<{
          id: string
          name: string
          mimeType?: string
          kind?: 'image' | 'text' | 'binary'
          dataUrl?: string
          textContent?: string
          filePath?: string
          size: number
        }>
      }>,
    readDataUrl: (filePath: string) =>
      ipcRenderer.invoke('attachments:readDataUrl', filePath) as Promise<{
        ok: boolean
        dataUrl?: string
        error?: string
      }>,
  },
  /** CodeGraph — project code knowledge graph (local CLI) */
  codegraph: {
    detect: () =>
      ipcRenderer.invoke('codegraph:detect') as Promise<{
        installed: boolean
        binaryPath: string | null
        version: string | null
      }>,
    install: () =>
      ipcRenderer.invoke('codegraph:install') as Promise<{
        ok: boolean
        output: string
        version?: string | null
        error?: string
      }>,
    status: (projectRoot?: string) =>
      ipcRenderer.invoke('codegraph:status', projectRoot) as Promise<{
        installed: boolean
        binaryPath: string | null
        projectRoot: string
        indexed: boolean
        indexPath: string | null
        version: string | null
        raw: string
        error?: string
      }>,
    init: (projectRoot?: string) =>
      ipcRenderer.invoke('codegraph:init', projectRoot) as Promise<{
        ok: boolean
        output: string
        error?: string
      }>,
    sync: (projectRoot?: string) =>
      ipcRenderer.invoke('codegraph:sync', projectRoot) as Promise<{
        ok: boolean
        output: string
        error?: string
      }>,
    explore: (input: {
      projectRoot?: string
      query: string
      maxFiles?: number
    }) =>
      ipcRenderer.invoke('codegraph:explore', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
    query: (input: {
      projectRoot?: string
      search: string
      kind?: string
      limit?: number
      json?: boolean
    }) =>
      ipcRenderer.invoke('codegraph:query', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
    callers: (input: {
      projectRoot?: string
      symbol: string
      limit?: number
      json?: boolean
    }) =>
      ipcRenderer.invoke('codegraph:callers', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
    callees: (input: {
      projectRoot?: string
      symbol: string
      limit?: number
      json?: boolean
    }) =>
      ipcRenderer.invoke('codegraph:callees', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
    impact: (input: {
      projectRoot?: string
      symbol: string
      depth?: number
      json?: boolean
    }) =>
      ipcRenderer.invoke('codegraph:impact', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
    node: (input: { projectRoot?: string; name: string; file?: string }) =>
      ipcRenderer.invoke('codegraph:node', input) as Promise<{
        ok: boolean
        query: string
        projectRoot: string
        output: string
        json?: unknown
        error?: string
        command: string
      }>,
  },
  term: {
    create: (opts?: { cwd?: string; title?: string }) =>
      ipcRenderer.invoke('term:create', opts || {}) as Promise<{
        id: string
        title: string
        cwd: string
        alive: boolean
        createdAt: string
      }>,
    list: () =>
      ipcRenderer.invoke('term:list') as Promise<
        Array<{ id: string; title: string; cwd: string; alive: boolean; createdAt: string }>
      >,
    write: (id: string, data: string) =>
      ipcRenderer.invoke('term:write', id, data) as Promise<{ ok: boolean; error?: string }>,
    kill: (id: string) =>
      ipcRenderer.invoke('term:kill', id) as Promise<{ ok: boolean }>,
    killAll: () => ipcRenderer.invoke('term:killAll') as Promise<{ ok: boolean }>,
    onData: (
      cb: (payload: { id: string; stream: 'stdout' | 'stderr'; data: string }) => void,
    ) => {
      const handler = (_: unknown, payload: { id: string; stream: 'stdout' | 'stderr'; data: string }) =>
        cb(payload)
      ipcRenderer.on('term:data', handler)
      return () => ipcRenderer.removeListener('term:data', handler)
    },
    onExit: (cb: (payload: { id: string; code: number | null }) => void) => {
      const handler = (_: unknown, payload: { id: string; code: number | null }) => cb(payload)
      ipcRenderer.on('term:exit', handler)
      return () => ipcRenderer.removeListener('term:exit', handler)
    },
  },
  opencode: {
    scanAgents: (projectRoot?: string) =>
      ipcRenderer.invoke('opencode:scanAgents', projectRoot) as Promise<{
        global: Array<Record<string, unknown>>
        project: Array<Record<string, unknown>>
        dirs: string[]
        configHint?: string | null
        error?: string
      }>,
    loadBundle: (projectRoot?: string) =>
      ipcRenderer.invoke('opencode:loadBundle', projectRoot) as Promise<{
        layers: Array<{ path: string; data: Record<string, unknown> }>
        agents: Array<Record<string, unknown>>
        commands: Array<Record<string, unknown>>
        sources: string[]
        error?: string
      }>,
    detect: () =>
      ipcRenderer.invoke('opencode:detect') as Promise<{
        found: boolean
        path: string | null
        version: string | null
      }>,
    run: (input: { prompt: string; timeoutMs?: number; cwd?: string }) =>
      ipcRenderer.invoke('opencode:run', input) as Promise<{
        ok: boolean
        output: string
        error?: string
      }>,
    hint: () =>
      ipcRenderer.invoke('opencode:hint') as Promise<{ ok: boolean; message: string }>,
    resolveInstructions: (projectRoot: string, entries: string[]) =>
      ipcRenderer.invoke('opencode:resolveInstructions', { projectRoot, entries }) as Promise<
        Array<{ entry: string; path?: string; text: string; bytes: number; sha256: string }>
      >,
  },
  opencodeServer: {
    health: (url?: string) =>
      ipcRenderer.invoke('opencodeServer:health', url) as Promise<{
        ok: boolean
        baseUrl: string
        version?: string
        error?: string
      }>,
    info: (url?: string) =>
      ipcRenderer.invoke('opencodeServer:info', url) as Promise<{
        ok: boolean
        baseUrl: string
        version?: string
        error?: string
      }>,
    start: (opts?: { cwd?: string; port?: number }) =>
      ipcRenderer.invoke('opencodeServer:start', opts) as Promise<{
        ok: boolean
        started?: boolean
        baseUrl: string
        version?: string
        pid?: number
        error?: string
      }>,
    stop: () =>
      ipcRenderer.invoke('opencodeServer:stop') as Promise<{ ok: boolean; killed: number }>,
    abort: (runId?: string) =>
      ipcRenderer.invoke('opencodeServer:abort', runId) as Promise<{ ok: boolean; killed: number }>,
    config: (url: string) => ipcRenderer.invoke('opencodeServer:config', url) as Promise<unknown>,
    providers: (url: string) => ipcRenderer.invoke('opencodeServer:providers', url) as Promise<unknown>,
    experimentalToolIds: (url: string) => ipcRenderer.invoke('opencodeServer:experimentalToolIds', url) as Promise<unknown>,
    sessions: (url: string) => ipcRenderer.invoke('opencodeServer:sessions', url) as Promise<unknown>,
    children: (url: string, sessionId: string) => ipcRenderer.invoke('opencodeServer:children', { url, sessionId }) as Promise<unknown>,
    todo: (url: string, sessionId: string) => ipcRenderer.invoke('opencodeServer:todo', { url, sessionId }) as Promise<unknown>,
    fork: (url: string, sessionId: string, messageId?: string) => ipcRenderer.invoke('opencodeServer:fork', { url, sessionId, messageId }) as Promise<unknown>,
    diff: (url: string, sessionId: string) => ipcRenderer.invoke('opencodeServer:diff', { url, sessionId }) as Promise<unknown>,
    revert: (url: string, sessionId: string, messageId: string, partId?: string) =>
      ipcRenderer.invoke('opencodeServer:revert', { url, sessionId, messageId, partId }) as Promise<unknown>,
    lsp: (url: string) => ipcRenderer.invoke('opencodeServer:lsp', url) as Promise<unknown>,
    formatter: (url: string) => ipcRenderer.invoke('opencodeServer:formatter', url) as Promise<unknown>,
    mcp: (url: string) => ipcRenderer.invoke('opencodeServer:mcp', url) as Promise<unknown>,
    agents: (url: string) => ipcRenderer.invoke('opencodeServer:agents', url) as Promise<unknown>,
  },
  gateway: {
    telegramStart: (opts: { token: string; allowedChatIds?: string }) =>
      ipcRenderer.invoke('gateway:telegramStart', opts) as Promise<{
        telegram: {
          running: boolean
          botUsername: string | null
          lastError: string | null
          updateOffset: number
          messageCount: number
          lastMessageAt: string | null
        }
      }>,
    telegramStop: () =>
      ipcRenderer.invoke('gateway:telegramStop') as Promise<{
        telegram: {
          running: boolean
          botUsername: string | null
          lastError: string | null
          updateOffset: number
          messageCount: number
          lastMessageAt: string | null
        }
      }>,
    status: () =>
      ipcRenderer.invoke('gateway:status') as Promise<{
        telegram: {
          running: boolean
          botUsername: string | null
          lastError: string | null
          updateOffset: number
          messageCount: number
          lastMessageAt: string | null
        }
      }>,
    send: (input: {
      channel: 'telegram' | 'webhook' | 'system'
      chatId: string
      text: string
      token?: string
      runId?: string
    }) =>
      // evidence is issued in main after the send actually succeeded (ADR-0048)
      ipcRenderer.invoke('gateway:send', input) as Promise<{
        ok: boolean
        error?: string
        evidence?: import('../src/agent/evidence/sideEffectEvidence.ts').SideEffectEvidence
      }>,
    onInbound: (
      cb: (msg: {
        channel: 'telegram' | 'webhook' | 'system'
        chatId: string
        text: string
        from?: string
        messageId?: string | number
        receivedAt: string
        raw?: unknown
        attachments?: Array<{
          name: string
          mimeType: string
          kind: 'image' | 'text' | 'binary'
          dataUrl?: string
          size?: number
        }>
      }) => void,
    ) => {
      const handler = (_: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('gateway:inbound', handler)
      return () => {
        ipcRenderer.removeListener('gateway:inbound', handler)
      }
    },
  },
  outbound: {
    status: (opts?: { apiProvider?: string; baseUrl?: string }) =>
      ipcRenderer.invoke('outbound:status', opts || {}) as Promise<{
        deployGuard: string
        deployGuardError?: string
        policySource: string
        policySourceError?: string
        buildFlavor: string
        buildFlavorError?: string
        policyDir: string
        ledgerDir: string
        encryptionAvailable: boolean
        connectionId?: string
        policySummary?: string
        activeViews: number
      }>,
    ensurePolicy: (connectionId: string) =>
      ipcRenderer.invoke('outbound:ensurePolicy', connectionId) as Promise<unknown>,
    prepareRunView: (opts: {
      runId: string
      projectRoot: string
      apiProvider?: string
      baseUrl?: string
      connectionId?: string
      effectiveMode?: 'off' | 'demo' | 'optional' | 'required'
    }) =>
      ipcRenderer.invoke('outbound:prepareRunView', opts) as Promise<
        | {
            ok: true
            viewRoot: string
            connectionId: string
            exclusionCount: number
            skippedCount: number
            profileDegraded?: boolean
          }
        | { ok: false; reason: string }
      >,
    disposeRunView: (runId: string, opts?: { writeback?: boolean }) =>
      ipcRenderer.invoke('outbound:disposeRunView', runId, opts || {}) as Promise<{
        ok: boolean
        writeback?: { filesWritten: number; filesSkipped: number; withheldRanges: number }
      }>,
    viewRoot: (runId: string) =>
      ipcRenderer.invoke('outbound:viewRoot', runId) as Promise<string | null>,
    viewMeta: (runId: string) =>
      ipcRenderer.invoke('outbound:viewMeta', runId) as Promise<{
        viewRoot: string
        originalRoot: string
        connectionId: string
      } | null>,
    runEvidence: (runId: string) =>
      ipcRenderer.invoke('outbound:runEvidence', runId) as Promise<Array<{
        eventId: string
        eventType: string
        timestampUtc: string
        runId?: string
        providerId?: string
        effectiveGuardMode?: string
        policySource?: string
        filesystemIsolation?: string
        action?: string
        exclusionCount: number
        redactionSummary?: import('../src/agent/outbound/redactionTaxonomy.ts').RedactionSummaryEntry[]
        sealed: boolean
      }>>,
    appendEvidence: (
      input: Record<string, unknown>,
      sealed?: boolean,
    ) =>
      ipcRenderer.invoke('outbound:appendEvidence', input, sealed) as Promise<{
        ok: boolean
        reason?: string
      }>,
    sandboxProbe: (opts: { viewRoot: string; forbiddenCanaryPath: string }) =>
      ipcRenderer.invoke('outbound:sandboxProbe', opts) as Promise<{
        status: 'verified' | 'unverified' | 'unavailable'
        detail: string
        engine?: 'seatbelt' | 'bwrap' | 'none'
      }>,
    policyListActive: () =>
      ipcRenderer.invoke('outbound:policyListActive') as Promise<
        Array<{
          kind: string
          connectionId?: string
          version: number
          changeId: string
          path: string
          detectorCount: number
        }>
      >,
    policyListDrafts: () =>
      ipcRenderer.invoke('outbound:policyListDrafts') as Promise<
        Array<{
          id: string
          kind: string
          connectionId?: string
          updatedAtUtc: string
          version?: number
          changeId?: string
        }>
      >,
    policyReadDraft: (draftId: string) =>
      ipcRenderer.invoke('outbound:policyReadDraft', draftId) as Promise<
        { ok: true; draft: unknown } | { ok: false; reason: string }
      >,
    policySaveDraft: (input: {
      id: string
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      body: unknown
    }) =>
      ipcRenderer.invoke('outbound:policySaveDraft', input) as Promise<
        { ok: true; draft: unknown } | { ok: false; reason: string }
      >,
    policyActivateDraft: (draftId: string) =>
      ipcRenderer.invoke('outbound:policyActivateDraft', draftId) as Promise<
        { ok: true; active: unknown } | { ok: false; reason: string }
      >,
    policyRollback: (input: {
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      reason: string
      targetBody?: unknown
    }) =>
      ipcRenderer.invoke('outbound:policyRollback', input) as Promise<
        { ok: true; active: unknown } | { ok: false; reason: string }
      >,
    policySeedDraft: (input: {
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      draftId: string
    }) =>
      ipcRenderer.invoke('outbound:policySeedDraft', input) as Promise<
        { ok: true; draft: unknown } | { ok: false; reason: string }
      >,
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list') as Promise<unknown[]>,
    catalog: () => ipcRenderer.invoke('plugins:catalog') as Promise<unknown[]>,
    install: (input: { id: string; projectRoot?: string }) =>
      ipcRenderer.invoke('plugins:install', input) as Promise<{
        ok: boolean
        installed: boolean
        requiresSetup: boolean
        id: string
        error?: string
        log?: string
        setupHint?: string
        manifest?: unknown
        health?: unknown
      }>,
    health: (id: string) =>
      ipcRenderer.invoke('plugins:health', id) as Promise<{
        ok: boolean
        installed: boolean
        healthy: boolean
        id: string
        tools: unknown[]
        error?: string
      }>,
    uninstall: (id: string) =>
      ipcRenderer.invoke('plugins:uninstall', id) as Promise<{
        ok: boolean
        id: string
        installed: boolean
      }>,
    save: (manifest: unknown) =>
      ipcRenderer.invoke('plugins:save', manifest) as Promise<{ ok: boolean; path: string }>,
    delete: (id: string) =>
      ipcRenderer.invoke('plugins:delete', id) as Promise<{ ok: boolean }>,
    dir: () => ipcRenderer.invoke('plugins:dir') as Promise<string>,
  },
}

contextBridge.exposeInMainWorld('subagents', api)

export type SubAgentsAPI = typeof api
