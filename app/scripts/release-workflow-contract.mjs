import { createHash } from 'node:crypto'

const JOB_HEADER = /^  ([a-zA-Z0-9_-]+):\s*$/gm
const CUSTOMER_PUBLISH_CREDENTIAL = /\bUPDATE_(?:(?:BETA|STABLE)_PUBLISH_URL|PUBLISH_TOKEN)\b/g
const REMOTE_UPLOAD_PATTERNS = [
  /\bcurl\b[\s\S]*?(?:--upload-file|-T\s)/,
  /\baws\s+s3\s+(?:cp|sync)\b/,
  /\brclone\s+(?:copy|copyto|sync)\b/,
  /\bgh\s+release\s+upload\b/,
  /\b(?:scp|rsync)\b[^\n]*(?:@|ssh:)/,
  /\bnpm\s+publish\b/,
  /\bnode\b[^\n]*(?:publish|upload)[^\n]*\.(?:mjs|mts|js|ts)\b/,
]
const APPROVED_PRE_QUALIFICATION_ACTIONS = new Set([
  'actions/checkout@v4',
  'actions/setup-node@v4',
  'actions/upload-artifact@v4',
  'actions/download-artifact@v4',
])
const APPROVED_PRE_QUALIFICATION_JOB_DIGESTS = new Set([
  'd388c3bcaa7546138e2edbf10352267b8e2c21df6b80946141391e1a2fef66a4',
  'a86177eba04721423bc7ca5a9b90c1db5d737aa9fdf423f23129a601619bac75',
  '38dd37eb4370b90c1f4ad45c74cee2a81507d27bbf61e0c7f4b1e56943ad7af6',
])
const APPROVED_NON_PUBLISH_JOB_DIGESTS = new Set([
  ...APPROVED_PRE_QUALIFICATION_JOB_DIGESTS,
  'd34f37c26cdb25caf806010fc08d4bb8ee7dbef6dd2dbc49e63065581cbb696b',
])

function workflowJobsSource(workflowSource) {
  const jobsIndex = workflowSource.search(/^jobs:\s*$/m)
  if (jobsIndex < 0) throw new Error('Release workflow jobs section is missing')
  return workflowSource.slice(jobsIndex)
}

export function workflowJobSource(workflowSource, jobName) {
  const jobsSource = workflowJobsSource(workflowSource)
  const jobs = [...jobsSource.matchAll(JOB_HEADER)]
  const matchIndex = jobs.findIndex((match) => match[1] === jobName)
  if (matchIndex < 0) throw new Error(`Release workflow job is missing: ${jobName}`)
  const start = jobs[matchIndex].index
  const end = jobs[matchIndex + 1]?.index ?? jobsSource.length
  return jobsSource.slice(start, end)
}

function workflowJobNames(workflowSource) {
  return [...workflowJobsSource(workflowSource).matchAll(JOB_HEADER)].map((match) => match[1])
}

function jobNeeds(jobSource) {
  const value = jobSource.match(/^    needs:\s*(.+)$/m)?.[1]?.trim()
  if (!value) return []
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
  }
  return [value]
}

function jobCondition(jobSource) {
  return jobSource.match(/^    if:\s*(.+)$/m)?.[1]?.trim() || ''
}

function conditionAllowsRun(condition, outcomes, needs) {
  const expression = condition.startsWith('${{') && condition.endsWith('}}')
    ? condition.slice(3, -2).trim()
    : condition
  if (!expression) return needs.every((job) => outcomes.get(job) === 'success')
  if (expression === 'always()') return needs.every((job) => outcomes.has(job))
  const terms = expression.split(/\s*&&\s*/)
  if (terms.length === 0 || terms.some((term) => term.length === 0)) return null
  for (const term of terms) {
    const resultCheck = term.match(/^needs\.([a-zA-Z0-9_-]+)\.result\s*==\s*'([^']+)'$/)
    if (resultCheck) {
      if (outcomes.get(resultCheck[1]) !== resultCheck[2]) return false
      continue
    }
    const outputCheck = term.match(
      /^needs\.([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_-]+)\s*==\s*'([^']+)'$/,
    )
    if (outputCheck) return outcomes.get(outputCheck[1]) === 'skipped' ? false : null
    return null
  }
  return true
}

export function customerPublishCredentialReferences(jobSource) {
  return [...jobSource.matchAll(CUSTOMER_PUBLISH_CREDENTIAL)].map((match) => match[0])
}

export function remoteUploadRequests(jobSource) {
  const commandMatches = REMOTE_UPLOAD_PATTERNS.filter((pattern) => pattern.test(jobSource)).map(
    (pattern) => pattern.source,
  )
  const unapprovedActions = [...jobSource.matchAll(/^\s+uses:\s*(\S+)\s*$/gm)]
    .map((match) => match[1])
    .filter((action) => !APPROVED_PRE_QUALIFICATION_ACTIONS.has(action))
    .map((action) => `uses:${action}`)
  const digest = createHash('sha256').update(jobSource).digest('hex')
  const unapprovedJobSource = APPROVED_PRE_QUALIFICATION_JOB_DIGESTS.has(digest)
    ? []
    : [`unapproved-job-source:${digest}`]
  return [...commandMatches, ...unapprovedActions, ...unapprovedJobSource]
}

function remotePublicationMechanisms(jobSource) {
  const commands = REMOTE_UPLOAD_PATTERNS.filter((pattern) => pattern.test(jobSource)).map((pattern) => pattern.source)
  const actions = [...jobSource.matchAll(/^\s+uses:\s*(\S+)\s*$/gm)]
    .map((match) => match[1])
    .filter((action) => !APPROVED_PRE_QUALIFICATION_ACTIONS.has(action))
    .map((action) => `uses:${action}`)
  return [...commands, ...actions]
}

export function packageSuccessQualificationFailureOutcome(workflowSource) {
  const outcomes = new Map()
  const executedJobs = []
  const unsupportedConditions = []
  const pendingJobs = new Set(workflowJobNames(workflowSource))
  let progressed = true
  while (pendingJobs.size > 0 && progressed) {
    progressed = false
    for (const job of pendingJobs) {
      const source = workflowJobSource(workflowSource, job)
      const needs = jobNeeds(source)
      if (!needs.every((dependency) => outcomes.has(dependency))) continue
      const condition = jobCondition(source)
      const conditionResult = conditionAllowsRun(condition, outcomes, needs)
      if (conditionResult === false) {
        outcomes.set(job, 'skipped')
      } else {
        if (conditionResult === null) unsupportedConditions.push(`${job}:${condition}`)
        executedJobs.push(job)
        outcomes.set(job, job === 'release-qualification' ? 'failure' : 'success')
      }
      pendingJobs.delete(job)
      progressed = true
    }
  }
  return {
    executedJobs,
    unsupportedConditions,
    customerPublishCredentialReferences: executedJobs.flatMap((job) =>
      customerPublishCredentialReferences(workflowJobSource(workflowSource, job)),
    ),
    remoteUploadRequests: executedJobs.flatMap((job) =>
      remoteUploadRequests(workflowJobSource(workflowSource, job)),
    ),
  }
}

export function preQualificationPublicationBarrierErrors(workflowSource) {
  const errors = []
  const packageJob = workflowJobSource(workflowSource, 'package')
  const releaseReady = workflowJobSource(workflowSource, 'release-ready')
  const releaseReadyNeeds = jobNeeds(releaseReady)
  const releaseReadyCondition = jobCondition(releaseReady)
  if (customerPublishCredentialReferences(packageJob).length > 0) {
    errors.push('package references a customer publish credential')
  }
  if (remoteUploadRequests(packageJob).length > 0) {
    errors.push('package contains a remote publication mechanism')
  }
  if (!releaseReadyNeeds.includes('release-qualification')) {
    errors.push('release-ready does not depend on release-qualification')
  }
  if (!/needs\.release-qualification\.result\s*==\s*'success'/.test(releaseReadyCondition)) {
    errors.push('release-ready does not require successful release-qualification')
  }
  const failureOutcome = packageSuccessQualificationFailureOutcome(workflowSource)
  if (failureOutcome.unsupportedConditions.length > 0) {
    errors.push('workflow contains an unsupported job condition')
  }
  if (failureOutcome.customerPublishCredentialReferences.length > 0 || failureOutcome.remoteUploadRequests.length > 0) {
    errors.push('package success plus qualification failure can issue a customer publication request')
  }
  return errors
}

export function verifiedPromotionOwnerErrors(workflowSource) {
  const errors = []
  let publishJob
  try {
    publishJob = workflowJobSource(workflowSource, 'publish')
  } catch {
    return ['verified publish owner is missing']
  }
  const needs = jobNeeds(publishJob)
  if (needs.length !== 1 || needs[0] !== 'release-ready') {
    errors.push('publish owner does not depend only on release-ready')
  }
  const publishCondition = jobCondition(publishJob)
  if (!/needs\.release-ready\.result\s*==\s*'success'/.test(publishCondition)) {
    errors.push('publish owner does not require successful release-ready completion')
  }
  if (!/needs\.release-ready\.outputs\.verified\s*==\s*'true'/.test(publishCondition)) {
    errors.push('publish owner does not require a verified promotion receipt')
  }
  if (!/^    environment:\s*release-publishing\s*$/m.test(publishJob)) {
    errors.push('publish owner does not use the protected release-publishing environment')
  }
  const workflowCredentials = customerPublishCredentialReferences(workflowSource)
  const publishCredentials = customerPublishCredentialReferences(publishJob)
  if (workflowCredentials.length !== publishCredentials.length) {
    errors.push('customer publish credentials are referenced outside the publish owner')
  }
  for (const jobName of workflowJobNames(workflowSource)) {
    if (jobName === 'publish') continue
    const jobSource = workflowJobSource(workflowSource, jobName)
    const digest = createHash('sha256').update(jobSource).digest('hex')
    if (!APPROVED_NON_PUBLISH_JOB_DIGESTS.has(digest) || remotePublicationMechanisms(jobSource).length > 0) {
      errors.push(`remote publication mechanism exists outside publish owner: ${jobName}`)
    }
  }
  const publisherCalls = [...workflowSource.matchAll(/release-promotion\.mjs --publish/g)].length
  if (publisherCalls !== 1 || !/release-promotion\.mjs --publish/.test(publishJob)) {
    errors.push('workflow does not have exactly one promotion publisher call')
  }
  if (!/promotion-receipt\.json/.test(publishJob)) {
    errors.push('publish owner does not consume the verified promotion receipt')
  }
  return errors
}
