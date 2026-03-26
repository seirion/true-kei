// KIS WebSocket 프록시 URL (Cloud Run)
// Cloud Run은 HTTPS/WSS를 자동 처리
const WS_PROXY_URL = 'wss://kis-ws-proxy-581599038344.asia-northeast3.run.app'

export interface RealTimeTrade {
  code: string
  price: number
  delta: number   // 전일 대비 증감
  rate: number    // 전일 대비율(%)
  volume: number  // 누적 거래량
}

type TradeCallback = (trade: RealTimeTrade) => void

export class KisWebSocket {
  private ws: WebSocket | null = null
  private approvalKey: string
  private subscribedCodes = new Set<string>()
  private onTrade: TradeCallback
  private onStatusChange: (connected: boolean) => void
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    approvalKey: string,
    onTrade: TradeCallback,
    onStatusChange: (connected: boolean) => void
  ) {
    this.approvalKey = approvalKey
    this.onTrade = onTrade
    this.onStatusChange = onStatusChange
  }

  connect() {
    if (this.ws) return
    console.log('Connecting to KIS WebSocket proxy...')
    this.ws = new WebSocket(WS_PROXY_URL)

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.onStatusChange(true)
      // 기존 구독 복원
      this.subscribedCodes.forEach(code => this.sendSubscribe(code, true))
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string)
    }

    this.ws.onclose = () => {
      console.log('WebSocket disconnected')
      this.ws = null
      this.onStatusChange(false)
      // 3초 후 재연결
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      this.ws?.close()
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.subscribedCodes.clear()
  }

  subscribe(codes: string[]) {
    codes.forEach(code => {
      if (!this.subscribedCodes.has(code)) {
        this.subscribedCodes.add(code)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSubscribe(code, true)
        }
      }
    })
  }

  unsubscribe(codes: string[]) {
    codes.forEach(code => {
      if (this.subscribedCodes.has(code)) {
        this.subscribedCodes.delete(code)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSubscribe(code, false)
        }
      }
    })
  }

  private sendSubscribe(code: string, subscribe: boolean) {
    const msg = JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: subscribe ? '1' : '2',
        'content-type': 'utf-8',
      },
      body: {
        input: {
          tr_id: 'H0STCNT0', // 실시간 체결
          tr_key: code,
        },
      },
    })
    this.ws?.send(msg)
  }

  private handleMessage(raw: string) {
    // PINGPONG 처리
    if (raw === 'PINGPONG') {
      this.ws?.send('PINGPONG')
      return
    }

    // JSON 메시지 (구독 응답 등)
    if (raw.startsWith('{')) {
      try {
        const msg = JSON.parse(raw)
        const trId = msg?.header?.tr_id
        if (trId === 'PINGPONG') {
          this.ws?.send('PINGPONG')
        }
      } catch {}
      return
    }

    // 실시간 체결 데이터: "0|H0STCNT0|001|종목코드^..."
    const parts = raw.split('|')
    if (parts.length < 4) return
    const trId = parts[1]
    if (trId !== 'H0STCNT0' && trId !== 'H0NXCNT0') return

    const fields = parts[3].split('^')
    if (fields.length < 6) return

    const trade: RealTimeTrade = {
      code: fields[0],
      price: parseFloat(fields[2]),
      delta: parseFloat(fields[4]),
      rate: parseFloat(fields[5]),
      volume: parseFloat(fields[13] ?? '0'),
    }
    this.onTrade(trade)
  }
}

const KIS_APPROVAL_KEY_PROXY = 'https://asia-northeast3-true-project-9bd97.cloudfunctions.net/kisApprovalKey'

// WebSocket Approval Key 발급 (Firebase Function 경유)
export async function fetchWsApprovalKey(appKey: string, appSecret: string): Promise<string> {
  const res = await fetch(KIS_APPROVAL_KEY_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appkey: appKey, appsecret: appSecret }),
  })
  if (!res.ok) throw new Error(`Approval key 발급 실패: ${res.status}`)
  const data = await res.json()
  if (!data.approval_key) throw new Error(data.error_description ?? 'Approval key 없음')
  return data.approval_key as string
}
