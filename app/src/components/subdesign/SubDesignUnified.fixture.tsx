/**
 * DEV-only visual QA fixture for the production SubDesignProjectStudio.
 * It supplies deterministic state without bypassing the real component tree.
 */
import { useState } from 'react'
import type { DesignSystemSummary, SubDesignArtifact, SubDesignBrief } from '../../agent/subdesign/types'
import { deriveSubDesignWorkspace } from '../../agent/subdesign/workspace'
import type { Thread } from '../../store/threadStore'
import { SubDesignProjectStudio } from './SubDesignProjectStudio'
import { DEFAULT_STORYBOOK_PROVIDER_SETTINGS } from '../../agent/subdesign/providers/providerSettings.ts'

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
  const [designSystem, setDesignSystem] = useState<DesignSystemSummary | null>(null)
  const workspace = deriveSubDesignWorkspace({
    brief: fixtureBrief,
    artifacts: [artifact],
    selectedArtifact,
    runStatus: runIsLive ? 'running' : 'idle',
  })
  return (
    <SubDesignProjectStudio
      brief={fixtureBrief}
      workspace={workspace}
      designSystem={designSystem}
      thread={fixtureThread}
      artifacts={[artifact]}
      selectedArtifact={selectedArtifact}
      critique={null}
      critiquePassed={false}
      runIsLive={runIsLive}
      runId={runIsLive ? 'run_visual_qa' : null}
      startingRun={false}
      onBack={() => window.history.back()}
      onOpenDesignSystems={() => setDesignSystem((current) => current ? null : {
        id: 'fixture-system',
        title: 'Fixture Design System',
        sourcePath: '.subagents/subdesign/design-systems/fixture/DESIGN.md',
        colors: ['#151713', '#c8d4b8'],
        tokenPaths: [],
        sections: ['Color', 'Typography'],
      })}
      onStartRun={() => setRunIsLive(true)}
      onStopRun={() => setRunIsLive(false)}
      onSubmitFollowUp={async (value) => {
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
      onOpenTranscript={() => setFixtureThread((current) => ({ ...current, title: `${current.title} · Transcript` }))}
      onSelectArtifact={setSelectedArtifact}
      onSelectDirection={(directionId) => setFixtureBrief((current) => ({
        ...current,
        selectedDirectionId: directionId,
        stage: 'build',
        updatedAt: new Date().toISOString(),
      }))}
      storybookSettings={DEFAULT_STORYBOOK_PROVIDER_SETTINGS}
      latestStorybookRun={null}
      onSaveStorybookSettings={async () => ({ ok: true })}
    />
  )
}
