import type { ViteDevServer } from 'vite'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { handleNodeRequest } from './static'

const port = Number(process.env.PORT) || 5173
const production = isProductionRuntime()

const server = createServer((req, res) => {
  void dispatch(req, res).catch((error: unknown) => {
    console.error(error)
    if (res.headersSent) return
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'The query failed.' }))
  })
})

let vite: ViteDevServer | undefined

if (!production) {
  const { createServer: createViteServer } = await import('vite')
  vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
}

server.listen(port, '0.0.0.0', () => {
  console.log(`WorldPulse listening on ${port}`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})

async function dispatch(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api') || production) {
    await handleNodeRequest(req, res)
    return
  }
  vite?.middlewares(req, res, (error?: unknown) => {
    if (error) console.error(error)
  })
}

function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === 'development') return false
  if (process.env.NODE_ENV === 'production') return true
  return !import.meta.url.replaceAll('\\', '/').includes('/src/server/')
}
