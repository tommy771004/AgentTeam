import { join } from 'node:path'
import { piCodingAgentModule } from './piVendor.ts'
import { resolvePiAgentDir } from './piUserConfig.ts'

/** Catalog lookup only: never resolves, refreshes or replaces credentials. */
export async function assertPiModelConfigured(provider: string, model: string): Promise<void> {
  const agentDir = resolvePiAgentDir()
  const runtime = await piCodingAgentModule.ModelRuntime.create({
    ...(agentDir ? { authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') } : {}),
  })
  if (!provider || !runtime.getModel(provider, model)) {
    throw new Error(`Pi model is not configured: ${provider}/${model}（未儲存：請選擇正確的訂閱供應商／模型，或設定自訂 API 的 Base URL。）`)
  }
}
