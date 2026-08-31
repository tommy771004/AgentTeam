import { createHash } from 'node:crypto'

const JOB_HEADER = /^  ([a-zA-Z0-9_-]+):\s*$/gm
const CUSTOMER_PUBLISH_CREDENTIAL = /\bUPDATE_PUBLISH_(?:TOKEN|URL)\b/g
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
  '38505e104217d19579211f816211a8a028c302913972e0f891201a96ad29431e',
  'a86177eba04721423bc7ca5a9b90c1db5d737aa9fdf423f23129a601619bac75',
  '1bd06472ab80efaf85d9e43f5a3c8d05df1552edcca38c499e85deac1f80204d',
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
