import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const statePath = process.env.PI_MCP_RELOAD_STATE
const transportFailure = process.env.PI_MCP_RELOAD_TRANSPORT_FAIL === '1'
const input = createInterface({ input: process.stdin })
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
const state = async () => JSON.parse(await readFile(statePath, 'utf8'))

input.on('line', async (line) => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'initialize') {
    reply(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'reload-fixture', version: '1.0.0' } })
    return
  }
  if (request.method === 'tools/list') {
    if (transportFailure) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32029, message: 'controlled MCP transport failure' } })}\n`)
      return
    }
    const current = await state()
    reply(request.id, { tools: current.tools || [] })
    return
  }
  if (request.method !== 'tools/call') return
  const current = await state()
  const args = request.params?.arguments || {}
  reply(request.id, {
    content: [{ type: 'text', text: `${current.resultPrefix || 'fixture'}:${request.params?.name}:${JSON.stringify(args)}` }],
  })
})
