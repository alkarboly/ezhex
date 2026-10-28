import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseCookies } from '../lib/auth-cookies'
import { BodyTooLargeError, InvalidJsonError, readJsonBody, routeApi } from './api'

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api')) {
    await handleApi(req, res, url.pathname)
    return
  }
  serveClient(req, res, url.pathname)
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }
  let body: unknown
  if (method === 'POST' || method === 'PATCH') {
    const type = req.headers['content-type'] ?? ''
    if (!type.includes('application/json')) {
      sendJson(res, 415, { error: 'Content-Type must be application/json.' })
      return
    }
    try {
      body = await readJsonBody(req)
    } catch (error) {
      if (error instanceof BodyTooLargeError || error instanceof InvalidJsonError) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
  }
  const result = await routeApi(method, pathname, body, { cookies: parseCookies(req.headers.cookie) })
  sendJson(res, result.status, result.body, result.cookies)
}

function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }
  const decoded = decodePath(pathname)
  if (!decoded) {
    sendJson(res, 400, { error: 'Bad path.' })
    return
  }
  const file = resolveFile(decoded)
  if (file) {
    sendFile(req, res, file, path.extname(file) === '.html')
    return
  }
  if (path.extname(decoded) !== '') {
    sendJson(res, 404, { error: 'Not found.' })
    return
  }
  const index = path.join(CLIENT_ROOT, 'index.html')
  if (!existsSync(index)) {
    sendJson(res, 500, { error: 'The client build is missing. Run npm run build.' })
    return
  }
  sendFile(req, res, index, true)
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

function resolveFile(pathname: string): string | null {
  const relative = pathname.replace(/^\/+/, '')
  if (relative.length === 0) return null
  const resolved = path.resolve(CLIENT_ROOT, relative)
  const fromRoot = path.relative(CLIENT_ROOT, resolved)
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null
  return resolved
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, html: boolean) {
  const extension = path.extname(file)
  res.statusCode = 200
  res.setHeader('Content-Type', TYPES[extension] ?? 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', html ? 'no-cache' : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file)
  void pipeline(stream, res).catch(() => {
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown, cookies?: string[]) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  if (cookies && cookies.length > 0) res.setHeader('Set-Cookie', cookies)
  res.end(JSON.stringify(body))
}
