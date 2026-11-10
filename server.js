import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAudit, listTenders, getTender, defaultProfile } from './lib/pipeline.js'
import { applyAmendments } from './lib/corrigendum.js'
import { checkInstrument } from './lib/security-check.js'

const PUBLIC = resolve(fileURLToPath(new URL('.', import.meta.url)), 'public')
const PORT = Number(process.env.PORT || 3000)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function send(res, code, body) {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) })
  res.end(s)
}

function readBody(req) {
  return new Promise((done, fail) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) {
        fail(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        done(data ? JSON.parse(data) : {})
      } catch {
        fail(new Error('invalid JSON body'))
      }
    })
    req.on('error', fail)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, llm: Boolean(process.env.LLM_API_KEY), model: process.env.LLM_MODEL || null })
    }
    if (url.pathname === '/api/tenders' && req.method === 'GET') {
      return send(res, 200, { tenders: listTenders(), profile: defaultProfile })
    }
    if (url.pathname.startsWith('/api/tender/') && req.method === 'GET') {
      const t = getTender(decodeURIComponent(url.pathname.slice('/api/tender/'.length)))
      return t ? send(res, 200, t) : send(res, 404, { error: 'unknown tender' })
    }
    if (url.pathname === '/api/security-check' && req.method === 'POST') {
      const body = await readBody(req)
      const tender = getTender(body?.tenderId)
      if (!tender) return send(res, 404, { error: 'unknown tender' })
      const corr = applyAmendments(tender)
      return send(res, 200, checkInstrument(body.instrument || {}, { security: tender.security, submission: corr.submission }))
    }
    if (url.pathname === '/api/audit' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body?.tenderId) return send(res, 400, { error: 'tenderId is required' })
      const audit = await runAudit({ tenderId: body.tenderId, profile: { ...defaultProfile, ...(body.profile || {}) } })
      return send(res, 200, audit)
    }

    let path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = resolve(join(PUBLIC, normalize(decodeURIComponent(path))))
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' })
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  } catch (err) {
    if (err?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('Not found')
    }
    send(res, 500, { error: String(err?.message || err) })
  }
})

server.listen(PORT, () => {
  console.log(`Dorpotro running at http://localhost:${PORT}  (llm: ${process.env.LLM_API_KEY ? 'live' : 'deterministic fallback'})`)
})
