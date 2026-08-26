/**
 * Renderer → Host skill push（技能推送）.
 *
 * Skills auto-load ONLY through the Host-owned directory (ADR-0034): Pi's
 * resource loader discovers it, advertises `<available_skills>`, and expands
 * pinned bodies up front. The first-boot migration seeds that directory once
 * (App.tsx `SkillsMigrationBootstrap`); THIS module keeps it true afterwards —
 * every skillsStore mutation re-pushes the FULL list through the same bridge,
 * so save / pin / remove / import all reach the loader without a restart.
 *
 * The bridge is feature-detected (`window.subagents?.x` rule): in a plain
 * browser there is nothing to push to and this is a no-op. Failures are
 * reported into the migration-report store — the same doctor-pattern place
 * the Learning page already reads, so a failed push is visible where skills
 * live instead of vanishing.
 */

import { useSkillMigrationStore } from '../../store/skillMigrationStore.ts'
import { skillsStore } from './skills.ts'

export type HostSkillStatus = 'active' | 'pinned' | 'archived'

/** The whole current list, shaped for `resources/sync-skills`. */
export function buildHostSkillPayload(): Array<{ name: string; description: string; body: string; status: HostSkillStatus }> {
  return skillsStore.list().map((skill) => ({
    name: skill.meta.name,
    description: skill.meta.description || '',
    body: skill.body,
    status: skill.meta.status === 'archived' ? 'archived' : skill.meta.status === 'pinned' ? 'pinned' : 'active',
  }))
}

/**
 * Push the full list now. Fire-and-forget by design: callers react to a
 * mutation and must never block or throw on the bridge being slow or absent.
 */
export function pushSkillsToHost(): void {
  void (async () => {
    const sync = window.subagents?.piHost?.resources?.syncSkills
    if (!sync) return
    // Full-state sync REQUIRES a complete list. Both guards below refuse to
    // push rather than reconcile real Host skills away:
    // 1. an old preload without the read bridge means completeness can't be
    //    established — version skew must degrade to no-op, not data loss;
    // 2. the store may not be hydrated yet (mutation before LearningPage's
    //    load), so force hydration first; if THAT fails, skip this push —
    //    a delayed deletion beats a wiped directory.
    if (!window.subagents?.piHost?.resources?.listSkillFiles) {
      console.warn('[skills] preload 缺少 listSkillFiles，略過推送以避免覆蓋 Host 技能')
      return
    }
    try {
      const { useLearningStore } = await import('../../store/learningStore.ts')
      if (!useLearningStore.getState().loaded) await useLearningStore.getState().load()
    } catch (error) {
      console.warn('[skills] 技能清單尚未水合，本輪推送已跳過（Host 維持原狀）', error)
      return
    }
    try {
      const payload = buildHostSkillPayload()
      const report = await sync(payload)
      // Same union rebuild as the boot migration: a result claiming success
      // without a slug is recorded as a failure, not as a silent success.
      const outcomes = report.results.map((result) => (result.ok && typeof result.slug === 'string'
        ? { name: result.name, ok: true as const, slug: result.slug }
        : { name: result.name, ok: false as const, error: typeof result.error === 'string' && result.error ? result.error : '同步未回報原因' }))
      useSkillMigrationStore.getState().setReport({
        at: new Date().toISOString(),
        skillsDir: report.skillsDir,
        complete: outcomes.every((outcome) => outcome.ok),
        outcomes,
      })
    } catch (error) {
      // A stale「complete」report would say the Host is in sync exactly when
      // it is not（"we could not reach the Host" must not look like "migrated
      // fine"）— publish the failed attempt like the boot migration does.
      const previous = useSkillMigrationStore.getState().report
      useSkillMigrationStore.getState().setReport({
        at: new Date().toISOString(),
        skillsDir: previous?.skillsDir || '',
        complete: false,
        unreachable: true,
        outcomes: [],
      })
      console.warn('[skills] 推送到 Host 技能目錄失敗', error)
    }
  })()
}
