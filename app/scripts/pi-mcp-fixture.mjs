import { createInterface } from 'node:readline'

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } } })}\n`)
  } else if (request.method === 'tools/list') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object' } }] } })}\n`)
  } else if (request.method === 'tools/call') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `echo:${request.params?.arguments?.text || ''}` }] } })}\n`)
  }
})
