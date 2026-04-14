/**
 * KIS API Proxy — Cloudflare Worker
 *
 * Firebase Functions(kisToken, kisApprovalKey, kisPrice, kisBalance,
 * kisOrder, kisInquirePsbl, kisModifyOrder, kisDailyOrder)와
 * WebSocket 프록시(ws-proxy)를 모두 대체합니다.
 *
 * Routes:
 *   POST /token           - OAuth 토큰 발급
 *   POST /approval-key    - WebSocket Approval Key 발급
 *   GET  /price           - 현재가 조회
 *   GET  /balance         - 주식 잔고 조회
 *   POST /order           - 매수/매도 주문
 *   GET  /inquire-psbl    - 매수 가능 조회
 *   POST /modify-order    - 주문 정정
 *   GET  /daily-order     - 당일 주문체결 조회
 *   GET  /ws              - WebSocket 프록시 (KIS ↔ 브라우저)
 */

const KIS_BASE = 'https://openapi.koreainvestment.com:9443'
const KIS_WS_URL = 'wss://ops.koreainvestment.com:31000' // wss 포트 (21000 ws → 31000 wss)
const ALLOWED_ORIGIN = 'https://seirion.github.io'

export default {
  async fetch(request: Request): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }))
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      let res: Response

      if (path === '/token' && request.method === 'POST') {
        res = await handleToken(request)
      } else if (path === '/approval-key' && request.method === 'POST') {
        res = await handleApprovalKey(request)
      } else if (path === '/price' && request.method === 'GET') {
        res = await handlePrice(request)
      } else if (path === '/balance' && request.method === 'GET') {
        res = await handleBalance(request)
      } else if (path === '/order' && request.method === 'POST') {
        res = await handleOrder(request)
      } else if (path === '/inquire-psbl' && request.method === 'GET') {
        res = await handleInquirePsbl(request)
      } else if (path === '/modify-order' && request.method === 'POST') {
        res = await handleModifyOrder(request)
      } else if (path === '/daily-order' && request.method === 'GET') {
        res = await handleDailyOrder(request)
      } else if (path === '/ws') {
        // WebSocket 업그레이드
        const upgradeHeader = request.headers.get('Upgrade')
        if (upgradeHeader !== 'websocket') {
          return corsResponse(new Response('WebSocket only', { status: 426 }))
        }
        return handleWebSocket(request)
      } else {
        res = new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
      }

      return corsResponse(res)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Internal Server Error'
      return corsResponse(
        new Response(JSON.stringify({ error: msg }), { status: 500 })
      )
    }
  },
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function corsResponse(res: Response): Response {
  const newRes = new Response(res.body, res)
  const headers = corsHeaders()
  for (const [k, v] of Object.entries(headers)) {
    newRes.headers.set(k, v)
  }
  return newRes
}

function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', { status: 405 })
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// POST /token — OAuth 토큰 발급
async function handleToken(request: Request): Promise<Response> {
  const { appkey, appsecret } = (await request.json()) as Record<string, string>
  if (!appkey || !appsecret) {
    return new Response(JSON.stringify({ error: 'appkey and appsecret are required' }), { status: 400 })
  }
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, appsecret }),
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// POST /approval-key — WebSocket Approval Key 발급
async function handleApprovalKey(request: Request): Promise<Response> {
  const { appkey, appsecret } = (await request.json()) as Record<string, string>
  if (!appkey || !appsecret) {
    return new Response(JSON.stringify({ error: 'appkey and appsecret are required' }), { status: 400 })
  }
  const res = await fetch(`${KIS_BASE}/oauth2/Approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, secretkey: appsecret }),
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /price — 현재가 조회
async function handlePrice(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const { code, token, appkey, appsecret, market = 'J' } = Object.fromEntries(url.searchParams)
  if (!code || !token || !appkey || !appsecret) {
    return new Response(JSON.stringify({ error: 'code, token, appkey, appsecret are required' }), { status: 400 })
  }
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=${market}&FID_INPUT_ISCD=${code}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        appkey,
        appsecret,
        tr_id: 'FHKST01010100',
        custtype: 'P',
      },
    }
  )
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /balance — 주식 잔고 조회
async function handleBalance(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const { token, appkey, appsecret, accountNo, fk100 = '', nk100 = '' } = Object.fromEntries(url.searchParams)
  if (!token || !appkey || !appsecret || !accountNo) {
    return new Response(JSON.stringify({ error: 'token, appkey, appsecret, accountNo required' }), { status: 400 })
  }
  const normalized = accountNo.replace(/[-\s]/g, '')
  const cano = normalized.slice(0, 8)
  const acntPrdtCd = normalized.slice(8)
  const params = new URLSearchParams({
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '00',
    CTX_AREA_FK100: fk100,
    CTX_AREA_NK100: nk100,
  })
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
    { headers: { Authorization: `Bearer ${token}`, appkey, appsecret, tr_id: 'TTTC8434R' } }
  )
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// POST /order — 매수/매도 주문
async function handleOrder(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, string>
  const { token, appkey, appsecret, cano, acntPrdtCd, side, PDNO, ORD_DVSN, ORD_QTY, ORD_UNPR } = body
  if (!token || !appkey || !appsecret || !cano || !acntPrdtCd || !side || !PDNO || !ORD_DVSN || !ORD_QTY) {
    return new Response(JSON.stringify({ error: 'required params missing' }), { status: 400 })
  }
  const trId = side === 'buy' ? 'TTTC0802U' : 'TTTC0801U'
  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/order-cash`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: trId,
      custtype: 'P',
    },
    body: JSON.stringify({
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      PDNO,
      ORD_DVSN,
      ORD_QTY,
      ORD_UNPR: ORD_UNPR ?? '0',
    }),
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /inquire-psbl — 매수 가능 조회
async function handleInquirePsbl(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const { token, appkey, appsecret, cano, acntPrdtCd, PDNO, ORD_UNPR, ORD_DVSN = '00' } = Object.fromEntries(url.searchParams)
  if (!token || !appkey || !appsecret || !cano || !acntPrdtCd || !PDNO || !ORD_UNPR) {
    return new Response(JSON.stringify({ error: 'required params missing' }), { status: 400 })
  }
  const params = new URLSearchParams({
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    PDNO,
    ORD_UNPR,
    ORD_DVSN,
    CMA_EVLU_AMT_ICLD_YN: 'N',
    OVRS_ICLD_YN: 'N',
  })
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-psbl-order?${params}`,
    { headers: { Authorization: `Bearer ${token}`, appkey, appsecret, tr_id: 'TTTC8908R', custtype: 'P' } }
  )
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// POST /modify-order — 주문 정정
async function handleModifyOrder(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, string>
  const { token, appkey, appsecret, accountNo, orgOdno, ordQty, ordUnpr } = body
  if (!token || !appkey || !appsecret || !accountNo || !orgOdno) {
    return new Response(JSON.stringify({ error: 'required params missing' }), { status: 400 })
  }
  const normalized = accountNo.replace(/[-\s]/g, '')
  const cano = normalized.slice(0, 8)
  const acntPrdtCd = normalized.slice(8)
  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: 'TTTC0803U',
      custtype: 'P',
    },
    body: JSON.stringify({
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: orgOdno,
      ORD_DVSN: ordUnpr && ordUnpr !== '0' ? '00' : '01',
      RVSE_CNCL_DVSN_CD: '01',
      ORD_QTY: ordQty ?? '0',
      ORD_UNPR: ordUnpr ?? '0',
      QTY_ALL_ORD_YN: 'Y',
    }),
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /daily-order — 당일 주문체결 조회
async function handleDailyOrder(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const { token, appkey, appsecret, accountNo, ccldDvsn = '00', fk100 = '', nk100 = '' } = Object.fromEntries(url.searchParams)
  if (!token || !appkey || !appsecret || !accountNo) {
    return new Response(JSON.stringify({ error: 'required params missing' }), { status: 400 })
  }
  const normalized = accountNo.replace(/[-\s]/g, '')
  const cano = normalized.slice(0, 8)
  const acntPrdtCd = normalized.slice(8)
  const today = new Date()
    .toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '')
    .replace('.', '')
  const params = new URLSearchParams({
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    INQR_STRT_DT: today,
    INQR_END_DT: today,
    SLL_BUY_DVSN_CD: '00',
    INQR_DVSN: '01',
    PDNO: '',
    CCLD_DVSN: ccldDvsn,
    ORD_GNO_BRNO: '',
    ODNO: '',
    INQR_DVSN_3: '00',
    INQR_DVSN_1: '',
    CTX_AREA_FK100: fk100,
    CTX_AREA_NK100: nk100,
  })
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params}`,
    { headers: { Authorization: `Bearer ${token}`, appkey, appsecret, tr_id: 'TTTC8001R', custtype: 'P' } }
  )
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET /ws — WebSocket 프록시
function handleWebSocket(request: Request): Response {
  const { 0: clientWs, 1: serverWs } = new WebSocketPair()

  serverWs.accept()

  // KIS WebSocket 연결
  const kisWs = new WebSocket(KIS_WS_URL)

  kisWs.addEventListener('message', (event) => {
    if (serverWs.readyState === WebSocket.OPEN) {
      serverWs.send(event.data)
    }
  })

  kisWs.addEventListener('close', (event) => {
    serverWs.close(event.code, event.reason)
  })

  kisWs.addEventListener('error', () => {
    serverWs.close(1011, 'KIS connection error')
  })

  serverWs.addEventListener('message', (event) => {
    if (kisWs.readyState === WebSocket.OPEN) {
      kisWs.send(event.data)
    }
  })

  serverWs.addEventListener('close', (event) => {
    kisWs.close(event.code, event.reason)
  })

  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  })
}
