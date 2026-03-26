import { loadKisConfig } from './KisSettings'
import { getAccessToken } from './kisApi'

const KIS_ORDER_PROXY = 'https://asia-northeast3-true-project-9bd97.cloudfunctions.net/kisOrder'
const KIS_INQUIRE_PSBL_PROXY = 'https://asia-northeast3-true-project-9bd97.cloudfunctions.net/kisInquirePsbl'

export type OrderSide = 'buy' | 'sell'
export type OrderType = '00' | '01' // 00: 지정가, 01: 시장가

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  '00': '지정가',
  '01': '시장가',
}

export interface OrderRequest {
  code: string
  side: OrderSide
  orderType: OrderType
  qty: number
  price: number // 시장가일 때는 0
}

export interface OrderResult {
  ordNo: string
  ordTime: string
}

export interface BuyableInfo {
  maxBuyQty: number       // 최대 매수 가능 수량
  buyableAmount: number   // 매수 가능 금액
}

export interface SellableInfo {
  sellableQty: number     // 매도 가능 수량
}

function parseAccountNo(accountNo: string): [string, string] {
  const clean = accountNo.replace('-', '')
  return [clean.slice(0, 8), clean.slice(8)]
}

export async function placeOrder(req: OrderRequest): Promise<OrderResult> {
  const config = loadKisConfig()
  if (!config.accountNo || !config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다. ⚙️ 버튼을 눌러 설정해주세요.')
  }

  const token = await getAccessToken()
  const [cano, acntPrdtCd] = parseAccountNo(config.accountNo)

  const res = await fetch(KIS_ORDER_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      appkey: config.appKey,
      appsecret: config.appSecret,
      cano,
      acntPrdtCd,
      side: req.side,
      PDNO: req.code,
      ORD_DVSN: req.orderType,
      ORD_QTY: String(req.qty),
      ORD_UNPR: String(req.orderType === '01' ? 0 : req.price),
    }),
  })

  if (!res.ok) throw new Error(`주문 요청 실패: HTTP ${res.status}`)
  const data = await res.json()
  if (data.rt_cd !== '0') throw new Error(data.msg1 ?? '주문 오류')

  return {
    ordNo: (data.output?.KRX_FWDG_ORD_ORGNO ?? '') + (data.output?.IONO_ORD_NO ?? ''),
    ordTime: data.output?.ORD_TMD ?? '',
  }
}

export async function fetchBuyable(code: string, price: number): Promise<BuyableInfo> {
  const config = loadKisConfig()
  if (!config.accountNo || !config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다.')
  }

  const token = await getAccessToken()
  const [cano, acntPrdtCd] = parseAccountNo(config.accountNo)

  const params = new URLSearchParams({
    token,
    appkey: config.appKey,
    appsecret: config.appSecret,
    cano,
    acntPrdtCd,
    PDNO: code,
    ORD_UNPR: String(price),
    ORD_DVSN: price === 0 ? '01' : '00',
  })

  const res = await fetch(`${KIS_INQUIRE_PSBL_PROXY}?${params}`)
  if (!res.ok) throw new Error(`매수가능조회 실패: HTTP ${res.status}`)
  const data = await res.json()
  if (data.rt_cd !== '0') throw new Error(data.msg1 ?? '매수가능조회 오류')

  return {
    maxBuyQty: parseInt(data.output?.max_buy_qty ?? '0', 10),
    buyableAmount: parseInt(data.output?.ord_psbl_cash ?? '0', 10),
  }
}
