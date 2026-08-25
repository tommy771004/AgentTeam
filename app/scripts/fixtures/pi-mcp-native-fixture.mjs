import { appendFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const logPath = process.env.PI_MCP_NATIVE_FIXTURE_LOG
const input = createInterface({ input: process.stdin })
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)

input.on('line', async (line) => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'initialize') {
    reply(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'native-fixture', version: '1.0.0' } })
    return
  }
  if (request.method === 'tools/list') {
    reply(request.id, {
      tools: [{
        name: 'inspect-item',
        description: 'Inspect one controlled MCP fixture item',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', minLength: 3 },
            mode: { type: 'string', enum: ['success', 'expected', 'transport'], default: 'success' },
            options: {
              type: 'object',
              properties: { limit: { type: 'integer', minimum: 1, maximum: 5, default: 2 } },
              additionalProperties: false,
            },
          },
          required: ['itemId'],
          additionalProperties: false,
        },
      }],
    })
    return
  }
  if (request.method !== 'tools/call') return
  if (logPath) await appendFile(logPath, `${JSON.stringify(request.params)}\n`)
  const args = request.params?.arguments || {}
  if (args.mode === 'transport') {
    process.exit(23)
  }
  if (args.mode === 'expected') {
    reply(request.id, { isError: true, content: [{ type: 'text', text: `fixture rejected:${args.itemId}` }] })
    return
  }
  reply(request.id, { content: [{ type: 'text', text: `fixture ok:${args.itemId}:${args.options?.limit ?? 2}` }] })
})
