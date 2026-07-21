/**
 * Office/PDF structure extract + sanitize sidecar (no binary fallthrough).
 * Run: node --experimental-strip-types scripts/smoke-office-extract.mts
 */
import assert from 'node:assert/strict'
import {
  extractDocxStructure,
  extractPdfStructure,
  listZipEntries,
  parseWorkbookSheetNames,
} from '../src/agent/outbound/officeZipExtract.ts'
import { buildSanitizedSidecar } from '../src/agent/outbound/sanitizedSidecar.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-office-extract')

const profile = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:doc'),
)

/** Build a minimal store-method ZIP with one uncompressed entry. */
function zipStore(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8')
  const nameBuf = Buffer.from(name, 'utf8')
  const local = Buffer.alloc(30 + nameBuf.length + data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(0, 8) // store
  local.writeUInt16LE(0, 10)
  local.writeUInt16LE(0, 12)
  local.writeUInt32LE(0, 14) // crc skip
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)
  nameBuf.copy(local, 30)
  data.copy(local, 30 + nameBuf.length)

  // central directory
  const central = Buffer.alloc(46 + nameBuf.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42) // relative offset of local header
  nameBuf.copy(central, 46)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([local, central, end])
}

await test('listZipEntries reads store entry', () => {
  const z = zipStore('word/document.xml', '<w:p>Hello</w:p>')
  const entries = listZipEntries(z)
  assert.ok(entries.some((e) => e.name === 'word/document.xml'))
})

await test('DOCX extract produces paragraph markers and sanitizes secrets', () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>Safe intro</w:t></w:r></w:p>
    <w:p><w:r><w:t>api_key: sk-DOCX-SECRET</w:t></w:r></w:p>
  </w:body></w:document>`
  const z = zipStore('word/document.xml', xml)
  const ex = extractDocxStructure(z)
  assert.ok(ex)
  assert.match(ex!.body, /\[\[paragraph:1\]\]/)
  assert.match(ex!.body, /sk-DOCX-SECRET/)

  const side = buildSanitizedSidecar({
    relPath: 'notes.docx',
    bytes: z,
    profile,
  })
  assert.equal(side.ok, true)
  if (!side.ok) return
  assert.doesNotMatch(side.markdown, /sk-DOCX-SECRET/)
  assert.match(side.markdown, new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(side.originalImmutable, true)
})

await test('PDF string harvest extracts Tj text and redacts', () => {
  // Minimal fake PDF-ish content with text operators
  const pdf = Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
BT (Hello PDF) Tj (api_key: sk-PDF-BIN) Tj ET
%%EOF`,
    'latin1',
  )
  const ex = extractPdfStructure(pdf)
  assert.ok(ex)
  assert.match(ex!.body, /Hello PDF/)
  const side = buildSanitizedSidecar({
    relPath: 'a.pdf',
    bytes: pdf,
    profile,
  })
  assert.equal(side.ok, true)
  if (!side.ok) return
  assert.doesNotMatch(side.markdown, /sk-PDF-BIN/)
})

await test('unparseable binary stays unavailable — no bytes field', () => {
  const r = buildSanitizedSidecar({
    relPath: 'x.docx',
    bytes: Buffer.from([0, 1, 2, 3, 4, 255, 254]),
    profile,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.ok(!('bytes' in r) && !('binary' in r))
})

await test('synthetic marker fixtures still work', () => {
  const fixture = '[[page:1]]\nhello\napi_key: sk-FIX\n'
  const r = buildSanitizedSidecar({
    relPath: 's.pdf',
    bytes: Buffer.from(fixture, 'utf8'),
    profile,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.doesNotMatch(r.markdown, /sk-FIX/)
})


await test('parseWorkbookSheetNames reads name attributes', () => {
  const names = parseWorkbookSheetNames(
    `<sheets><sheet name="Budget" sheetId="1"/><sheet name="Payroll" sheetId="2"/></sheets>`,
  )
  assert.deepEqual(names, ['Budget', 'Payroll'])
})

console.log(`\n${passed} tests passed`)
