# P0 fix: MCP secret ownership

## final result: **pass**

### Root cause
`syncPluginMcpServers` forced `pluginId: packageId`, wiping installer `pluginId: connectorId`, so enrich looked up the wrong secret.

### Fix
| Field | Meaning |
|-------|---------|
| `pluginId` | Package ownership (`github-mcp`) |
| `secretPluginId` | Token ownership (`github-connector`) |

- Installer writes both  
- `normalizePluginMcpServer` preserves `secretPluginId` on install/import/sync  
- `resolveMcpSecretOwnerId` prefers `secretPluginId`  
- Health/uninstall no longer require `pluginId === package id`  
- Fail-fast: custom tools + MCP call when secret missing  

### Regression
e2e: after sync-like shape (`pluginId=github-mcp`, `secretPluginId=github-connector`) env is filled from `github-connector` secret.
