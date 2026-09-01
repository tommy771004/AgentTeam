/**
 * DEV-only visual QA fixture for the production SubDesignProjectStudio.
 * It supplies deterministic state without bypassing the real component tree.
 */
import { useEffect, useState } from 'react'
import type { SubDesignArtifact, SubDesignBrief } from '../../agent/subdesign/types'
import { deriveSubDesignWorkspace } from '../../agent/subdesign/workspace'
import type { Thread } from '../../store/threadStore'
import { SubDesignProjectStudio } from './SubDesignProjectStudio'
import { DEFAULT_STORYBOOK_PROVIDER_SETTINGS } from '../../agent/subdesign/providers/providerSettings.ts'
import { useRunActivityStore } from '../../store/runActivityStore.ts'

const now = '2026-08-20T14:30:00.000Z'

const brief: SubDesignBrief = {
  id: 'brief_visual_qa',
  threadId: 'thread_visual_qa',
  surface: 'deck',
  objective: '設計一份產品策略簡報，整合品牌敘事、產品畫面與可執行的下一步。',
  audience: '產品與品牌決策者',
  platform: 'web-desktop',
  fidelity: 'high-fidelity',
  constraints: ['介面整潔簡潔', '保留完整執行過程', '方向確認後才進入 Build'],
  acceptanceCriteria: ['可比較三個方向', '預覽與對話並列', 'Critique 前不可交付'],
  references: [{
    id: 'reference_visual_qa',
    kind: 'screenshot',
    source: 'references/brand-moodboard.png',
    storedPath: '.subdesign/references/brand-moodboard.png',
    title: 'Brand moodboard',
    importedAt: now,
    sha256: 'a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3b4a4c3',
  }],
  provenance: [{
    source: 'open-design',
    recordId: 'open-design-visual-qa',
    title: 'Editorial layout reference',
    sourcePath: 'references/editorial-layout.md',
    sourceUrl: 'https://example.invalid/editorial-layout',
    upstreamCommit: 'b032abed00ab0000000000000000000000000000',
    digest: 'b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6e7b5d6',
    licensePaths: ['LICENSE'],
    indexedAt: now,
  }],
  directions: [
    { id: 'editorial', title: 'Editorial Focus', summary: '清晰敘事與大比例作品畫面。', rationale: '最適合跨部門快速理解策略與證據。' },
    { id: 'product', title: 'Product Canvas', summary: '以真實產品介面作為核心 artifact。', rationale: '把設計結果放在工作流程中心。' },
    { id: 'signal', title: 'Signal Deck', summary: '用少量高對比訊息建立簡報節奏。', rationale: '適合高階決策會議與快速掃讀。' },
  ],
  stage: 'direction',
  createdAt: now,
  updatedAt: now,
}

const artifact: SubDesignArtifact = {
  id: 'artifact_visual_qa',
  briefId: brief.id,
  kind: 'deck',
  title: 'Product strategy deck',
  entry: '/open-design/plugins/_official/examples/html-ppt-zhangzara-biennale-yellow/example.html',
  renderer: 'deck-html',
  exports: ['html', 'pdf', 'pptx'],
  supportingFiles: [],
  status: 'complete',
  revision: 2,
  createdAt: now,
  updatedAt: now,
}

const thread: Thread = {
  id: brief.threadId,
  title: brief.objective,
  model: '',
  thinkingDepth: 'deep',
  speed: 'standard',
  agentMode: 'build',
  runner: 'builtin',
  loopType: 'Goal-based',
  bubbles: [
    { id: 'u1', role: 'user', content: brief.objective, at: '2026-08-20T14:29:00.000Z' },
    { id: 'a1', role: 'assistant', content: '我已整理 brief，並把三個可比較的視覺方向放在右側。先選擇方向，確認後再進入 Build。', at: now },
  ],
  createdAt: now,
  updatedAt: now,
  lastStatus: 'idle',
  subDesignBriefId: brief.id,
}

export function SubDesignUnifiedFixture() {
  const [fixtureBrief, setFixtureBrief] = useState(brief)
  const [fixtureThread, setFixtureThread] = useState(thread)
  const [runIsLive, setRunIsLive] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<SubDesignArtifact | null>(artifact)
  const [pinFixtureState, setPinFixtureState] = useState<'idle' | 'submitted'>('idle')
  const workspace = deriveSubDesignWorkspace({
    brief: fixtureBrief,
    artifacts: [artifact],
    selectedArtifact,
    runStatus: runIsLive ? 'running' : 'idle',
  })
  useEffect(() => () => useRunActivityStore.getState().clear('run_visual_qa'), [])
  const startFixtureRun = () => {
    const activity = useRunActivityStore.getState()
    activity.begin('run_visual_qa')
    activity.setTasks([
      { text: '整理 brief 驗收條件', status: 'done' },
      { text: '比較視覺方向與 references', status: 'done' },
      { text: '建立 deck artifact', status: 'active' },
      { text: '執行 critique gate', status: 'pending' },
    ], 'run_visual_qa')
    activity.push({ kind: 'tool', runId: 'run_visual_qa', title: 'Read references', detail: 'brand-moodboard.png', tool: 'read_file', callId: 'fixture-read' })
    activity.push({ kind: 'file', runId: 'run_visual_qa', title: '已編輯 deck.html', path: 'artifacts/deck.html', added: 74, removed: 12 })
    setRunIsLive(true)
  }
  const stopFixtureRun = () => {
    useRunActivityStore.getState().end('run_visual_qa', 'Fixture stopped')
    setRunIsLive(false)
  }
  return (
    <div className="relative h-full" data-pin-fixture-state={pinFixtureState}>
      <output className="sr-only" data-testid="pin-fixture-state">{pinFixtureState}</output>
      <SubDesignProjectStudio
      brief={fixtureBrief}
      workspace={workspace}
      thread={fixtureThread}
      artifacts={[artifact]}
      selectedArtifact={selectedArtifact}
      critique={null}
      critiquePassed={false}
      runIsLive={runIsLive}
      runId={runIsLive ? 'run_visual_qa' : null}
      startingRun={false}
      onBack={() => window.history.back()}
      onStartRun={startFixtureRun}
      onStopRun={stopFixtureRun}
      onSubmitFollowUp={async (value) => {
        startFixtureRun()
        const at = new Date().toISOString()
        setFixtureThread((current) => ({
          ...current,
          bubbles: [
            ...current.bubbles,
            { id: `u_${current.bubbles.length}`, role: 'user', content: value, at },
            { id: `a_${current.bubbles.length + 1}`, role: 'assistant', content: 'Fixture 已收到後續指令。', at },
          ],
          updatedAt: at,
        }))
      }}
      onSubmitPinnedComments={async () => {
        setPinFixtureState('submitted')
        return { ok: true, runId: 'run_pin_fixture' }
      }}
      onOpenTranscript={() => setFixtureThread((current) => ({ ...current, title: `${current.title} · Transcript` }))}
      onSelectArtifact={setSelectedArtifact}
      onSelectDirection={(directionId) => setFixtureBrief((current) => ({
        ...current,
        selectedDirectionId: directionId,
        stage: 'build',
        updatedAt: new Date().toISOString(),
      }))}
      onCreateDirection={(title) => setFixtureBrief((current) => {
        const direction = { id: `fixture-custom-${current.directions.length + 1}`, title, summary: '自訂方向' }
        return {
          ...current,
          directions: [...current.directions, direction],
          selectedDirectionId: direction.id,
          stage: 'build',
          updatedAt: new Date().toISOString(),
        }
      })}
      storybookSettings={DEFAULT_STORYBOOK_PROVIDER_SETTINGS}
      latestStorybookRun={null}
      onSaveStorybookSettings={async () => ({ ok: true })}
      />
    </div>
  )
}
