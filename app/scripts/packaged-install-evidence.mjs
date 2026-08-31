export const PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION = 2

const RAW_DIFF_HEADER = /^(?:diff --git |--- |\+\+\+ |@@ )/m

export function buildPackagedFirstTaskEvidence({
  resultVisible,
  changedFileCount,
  additions,
  removals,
  changedLines,
  firstTaskSessionMessages,
  settingsPersisted,
  restartedSessionMessages,
  platform,
}) {
  const preview = Array.isArray(changedLines)
    ? changedLines.map((line) => String(line).trimEnd()).filter((line) => line.trim()).join('\n').slice(0, 600)
    : ''
  return {
    resultVisible: resultVisible === true,
    change: {
      visible: Boolean(preview.trim()),
      changedFileCount: Number(changedFileCount),
      additions: Number(additions),
      removals: Number(removals),
      preview,
    },
    firstTaskSessionMessages: Number(firstTaskSessionMessages) || 0,
    settingsPersisted: settingsPersisted === true,
    restartedSessionMessages: Number(restartedSessionMessages) || 0,
    platform,
  }
}

function invalid(reason, schemaVersion = null) {
  return { ok: false, compatibility: 'invalid', schemaVersion, reason }
}

export function validatePackagedInstallEvidence(evidence, expectedPlatform) {
  if (!evidence || typeof evidence !== 'object') {
    return invalid('Packaged lifecycle evidence must be an object')
  }
  if (evidence.schemaVersion == null) {
    return {
      ok: false,
      compatibility: 'legacy',
      schemaVersion: null,
      reason: 'Packaged lifecycle evidence uses the legacy diff contract; rerun packaged qualification',
    }
  }
  if (evidence.schemaVersion !== PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION) {
    return invalid(
      `Unsupported packaged lifecycle evidence schema: ${String(evidence.schemaVersion)}`,
      Number.isInteger(evidence.schemaVersion) ? evidence.schemaVersion : null,
    )
  }
  if (evidence.platform !== expectedPlatform) {
    return invalid(`Lifecycle platform mismatch: ${String(evidence.platform)}`, evidence.schemaVersion)
  }
  const firstTask = evidence.firstTask
  const change = firstTask?.change
  if (firstTask?.resultVisible !== true) {
    return invalid('Packaged first task result was not visible', evidence.schemaVersion)
  }
  if (
    change?.visible !== true ||
    !Number.isInteger(change.changedFileCount) || change.changedFileCount < 1 ||
    !Number.isInteger(change.additions) || change.additions < 0 ||
    !Number.isInteger(change.removals) || change.removals < 0 ||
    change.additions + change.removals < 1 ||
    typeof change.preview !== 'string' || !change.preview.trim()
  ) {
    return invalid('Packaged first task change evidence is incomplete', evidence.schemaVersion)
  }
  if (change.preview.length > 600) {
    return invalid('Packaged first task change preview exceeds the bounded evidence limit', evidence.schemaVersion)
  }
  if (RAW_DIFF_HEADER.test(change.preview)) {
    return invalid('Packaged first task change preview contains raw diff headers', evidence.schemaVersion)
  }
  if (firstTask.settingsPersisted !== true || !(firstTask.restartedSessionMessages > 0)) {
    return invalid('Packaged restart persistence evidence is incomplete', evidence.schemaVersion)
  }
  if (evidence.uninstall?.removed !== true) {
    return invalid('Packaged uninstall/removal evidence is missing', evidence.schemaVersion)
  }
  return {
    ok: true,
    compatibility: 'current',
    schemaVersion: PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
  }
}
