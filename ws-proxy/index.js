const { WebSocketServer, WebSocket } = require('ws')
const http = require('http')

const PORT = process.env.PORT || 8080
const KIS_WS_URL = 'ws://ops.koreainvestment.com:21000'

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200)
    res.end('OK')
    return
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' })
  res.end('WebSocket only')
})

const wss = new WebSocketServer({ server })

console.log(`KIS WebSocket proxy starting on port ${PORT}`)

wss.on('connection', (clientWs, req) => {
  console.log(`Client connected from ${req.socket.remoteAddress}`)

  // 클라이언트 → KIS 방향 연결
  const kisWs = new WebSocket(KIS_WS_URL)
  let kisReady = false
  const pendingMessages = []

  kisWs.on('open', () => {
    console.log('Connected to KIS WebSocket')
    kisReady = true
    // 연결 전에 받은 메시지 전송
    pendingMessages.forEach(msg => kisWs.send(msg))
    pendingMessages.length = 0
  })

  // KIS → 클라이언트
  kisWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString())
    }
  })

  kisWs.on('error', (err) => {
    console.error('KIS WebSocket error:', err.message)
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'KIS connection error')
    }
  })

  kisWs.on('close', (code, reason) => {
    console.log(`KIS WebSocket closed: ${code} ${reason}`)
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason)
    }
  })

  // 클라이언트 → KIS
  clientWs.on('message', (data) => {
    if (kisReady && kisWs.readyState === WebSocket.OPEN) {
      kisWs.send(data.toString())
    } else {
      pendingMessages.push(data.toString())
    }
  })

  clientWs.on('close', (code, reason) => {
    console.log(`Client disconnected: ${code} ${reason}`)
    if (kisWs.readyState === WebSocket.OPEN || kisWs.readyState === WebSocket.CONNECTING) {
      kisWs.close()
    }
  })

  clientWs.on('error', (err) => {
    console.error('Client WebSocket error:', err.message)
    kisWs.close()
  })
})

server.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`)
})
