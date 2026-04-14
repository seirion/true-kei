// KIS WebSocket 프록시 URL (Cloud Run)
// Cloud Run은 HTTPS/WSS를 자동 처리
const WS_PROXY_URL = 'wss://kis-proxy.seirion.workers.dev/ws'

export interface RealTimeTrade {
  code: string
  price: number
  delta: number   // 전일 대비 증감
  rate: number    // 전일 대비율(%)
  volume: number  // 누적 거래량
  openPrice: number   // 시가
  highPrice: number   // 고가
  lowPrice: number    // 저가
  isNxt: boolean  // NXT 거래소 여부
}

// 주문 체결 통보
export interface OrderExecution {
  code: string        // 종목코드
  side: 'buy' | 'sell'
  execQty: number     // 체결수량
  execPrice: number   // 체결단가
  execTime: string    // 체결시각 (HHMMSS)
  orderQty: number    // 주문수량
  isFilled: boolean   // 체결여부 (1=체결, 2=확인, 3=취소)
}

export interface OrderBookLevel {
  price: number
  qty: number
}

export interface RealTimeOrderBook {
  code: string
  asks: OrderBookLevel[]  // 매도호가 [0]=최우선매도(가장 낮은), [9]=가장 높은
  bids: OrderBookLevel[]  // 매수호가 [0]=최우선매수(가장 높은), [9]=가장 낮은
}

// 현재 NXT 시간대 여부
export function isNxtHour(): boolean {
  const now = new Date()
  const total = now.getHours() * 60 + now.getMinutes()
  return (total >= 8 * 60 && total < 9 * 60) || (total >= 15 * 60 + 30 && total < 20 * 60)
}

// 정규장 시간대 여부 (09:00~15:30)
export function isRegularHour(): boolean {
  const now = new Date()
  const total = now.getHours() * 60 + now.getMinutes()
  return total >= 9 * 60 && total < 15 * 60 + 30
}

type TradeCallback = (trade: RealTimeTrade) => void
type OrderBookCallback = (ob: RealTimeOrderBook) => void
type ExecutionCallback = (exec: OrderExecution) => void

export class KisWebSocket {
  private ws: WebSocket | null = null
  private approvalKey: string
  private subscribedCodes = new Set<string>()
  private subscribedAspCodes = new Set<string>()
  private onTrade: TradeCallback
  private onOrderBook: OrderBookCallback | null
  private onExecution: ExecutionCallback | null
  private onStatusChange: (connected: boolean) => void
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    approvalKey: string,
    onTrade: TradeCallback,
    onStatusChange: (connected: boolean) => void,
    onOrderBook?: OrderBookCallback,
    onExecution?: ExecutionCallback
  ) {
    this.approvalKey = approvalKey
    this.onTrade = onTrade
    this.onStatusChange = onStatusChange
    this.onOrderBook = onOrderBook ?? null
    this.onExecution = onExecution ?? null
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
      this.subscribedAspCodes.forEach(code => this.sendSubscribeAsp(code, true))
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

  // 체결통보 구독 (tr_key: userId|accountNo)
  subscribeExecution(trKey: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribeExecution(trKey, true)
    }
  }

  private sendSubscribeExecution(trKey: string, subscribe: boolean) {
    const msg = JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: subscribe ? '1' : '2',
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: 'H0STCNI0', tr_key: trKey } },
    })
    this.ws?.send(msg)
  }

  unsubscribeAll() {
    const codes = [...this.subscribedCodes]
    this.unsubscribe(codes)
    const aspCodes = [...this.subscribedAspCodes]
    this.unsubscribeAsp(aspCodes)
  }

  subscribeAsp(codes: string[]) {
    codes.forEach(code => {
      if (!this.subscribedAspCodes.has(code)) {
        this.subscribedAspCodes.add(code)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSubscribeAsp(code, true)
        }
      }
    })
  }

  unsubscribeAsp(codes: string[]) {
    codes.forEach(code => {
      if (this.subscribedAspCodes.has(code)) {
        this.subscribedAspCodes.delete(code)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSubscribeAsp(code, false)
        }
      }
    })
  }

  private getTrId(): string {
    // NXT 운영 시간: 08:00~09:00, 15:30~20:00
    const now = new Date()
    const h = now.getHours()
    const m = now.getMinutes()
    const total = h * 60 + m
    const isNxt =
      (total >= 8 * 60 && total < 9 * 60) ||
      (total >= 15 * 60 + 30 && total < 20 * 60)
    return isNxt ? 'H0NXCNT0' : 'H0STCNT0'
  }

  private sendSubscribe(code: string, subscribe: boolean) {
    const msg = JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: subscribe ? '1' : '2',
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: this.getTrId(), tr_key: code } },
    })
    this.ws?.send(msg)
  }

  private sendSubscribeAsp(code: string, subscribe: boolean) {
    // H0STASP0: 국내 호가, H0NXASP0: NXT 호가
    const now = new Date()
    const total = now.getHours() * 60 + now.getMinutes()
    const isNxt = (total >= 8 * 60 && total < 9 * 60) || (total >= 15 * 60 + 30 && total < 20 * 60)
    const trId = isNxt ? 'H0NXASP0' : 'H0STASP0'
    const msg = JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: subscribe ? '1' : '2',
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: trId, tr_key: code } },
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

    // 실시간 데이터: "0|TR_ID|COUNT|DATA"
    const parts = raw.split('|')
    if (parts.length < 4) return
    const trId = parts[1]

    // 실시간 체결 (H0STCNT0 / H0NXCNT0)
    if (trId === 'H0STCNT0' || trId === 'H0NXCNT0') {
      const fields = parts[3].split('^')
      if (fields.length < 6) return
      const trade: RealTimeTrade = {
        code: fields[0],
        price: parseFloat(fields[2]),
        delta: parseFloat(fields[4]),
        rate: parseFloat(fields[5]),
        openPrice: parseFloat(fields[7] ?? '0'),
        highPrice: parseFloat(fields[8] ?? '0'),
        lowPrice: parseFloat(fields[9] ?? '0'),
        volume: parseFloat(fields[13] ?? '0'),
        isNxt: trId === 'H0NXCNT0',
      }
      this.onTrade(trade)
      return
    }

    // 실시간 호가 (H0STASP0 / H0NXASP0)
    if ((trId === 'H0STASP0' || trId === 'H0NXASP0') && this.onOrderBook) {
      const fields = parts[3].split('^')
      // KIS 호가 필드 순서:
      // [0]: 종목코드
      // [3]~[12]:   매도호가1~10 (낮은→높은)
      // [13]~[22]:  매수호가1~10 (높은→낮은)
      // [23]~[32]:  매도호가잔량1~10
      // [33]~[42]:  매수호가잔량1~10
      if (fields.length < 43) return
      const asks: OrderBookLevel[] = []
      const bids: OrderBookLevel[] = []
      for (let i = 0; i < 10; i++) {
        asks.push({ price: parseFloat(fields[3 + i]), qty: parseFloat(fields[23 + i]) })
        bids.push({ price: parseFloat(fields[13 + i]), qty: parseFloat(fields[33 + i]) })
      }
      // asks: 낮은가격순(최우선매도 = asks[0]), bids: 높은가격순(최우선매수 = bids[0])
      this.onOrderBook({ code: fields[0], asks, bids })
    }

    // 체결통보 (H0STCNI0)
    // 암호화된 메시지이므로 parts[0]='0', parts[1]='H0STCNI0', parts[2]='count', parts[3]=데이터
    if (trId === 'H0STCNI0' && this.onExecution) {
      const fields = parts[3].split('^')
      // [4]: SELN_BYOV_CLS 01=매도 02=매수
      // [8]: STCK_SHRN_ISCD 종목코드
      // [9]: CNTG_QTY 체결수량
      // [10]: CNTG_UNPR 체결단가
      // [11]: STCK_CNTG_HOUR 체결시각
      // [13]: CNTG_YN 1=체결 2=확인 3=취소
      // [16]: ODER_QTY 주문수량
      if (fields.length < 17) return
      const cntgYn = fields[13]
      if (cntgYn !== '1') return  // 체결만 처리
      this.onExecution({
        code: fields[8],
        side: fields[4] === '02' ? 'buy' : 'sell',
        execQty: parseInt(fields[9], 10),
        execPrice: parseInt(fields[10], 10),
        execTime: fields[11],
        orderQty: parseInt(fields[16], 10),
        isFilled: true,
      })
    }
  }
}

const KIS_APPROVAL_KEY_PROXY = 'https://kis-proxy.seirion.workers.dev/approval-key'

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
