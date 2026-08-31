export { configureVaultTestEnvironment, safeStorage } from './credential-vault-electron.mts'
export { handleCredentialVaultIntent } from '../../electron/integrationCredentialVault'
export { resolveSecretPlaceholders } from '../../electron/secretsVault'
export { executeBashTemplate, executeConfiguredCustomTool, executeHttpTemplate } from '../../electron/customToolExecution'
export { buildCustomToolsPack } from '../../electron/piExtensionPacks/customToolsPack'
export { configurePiHostServiceTransport, resolvePiHostServiceResponse } from '../../electron/piHostServices'
export { mcpHttpRpcWithSecretPlaceholders } from '../../electron/mcpBridge'
export {
  encryptLegacyCustomToolSecrets,
  migrateCustomToolCredentials,
  migrateCustomToolSettingsFile,
} from '../../electron/customToolCredentialMigration'
