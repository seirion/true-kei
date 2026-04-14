import { loadKisConfig } from './KisSettings'
import { getAccessToken } from './kisApi'

const KIS_DAILY_ORDER_PROXY = 'https://kis-proxy.seirion.workers.dev/daily-order'

export type CcldDvsn = '00' | '01' | '02' // 00=전체, 01=체결, 02=미체결

export interface DailyOrderItem {
  orderNo: string       // 주문번호
  code: string          // 종목코드
  nameKr: string        // 종목명
  side: 'buy' | 'sell'  // 매수/매도
  orderQty: number      // 주문수량
  orderPrice: number    // 주문단가
  execQty: number       // 체결수량
  execAvgPrice: number  // 체결평균가
  execAmount: number    // 체결금액
  remainQty: number     // 잔여수량
  orderTime: string     // 주문시각
  status: string        // 주문상태명
  orderType: string     // 주문구분명 (지정가/시장가 등)
}

export async function fetchDailyOrders(ccldDvsn: CcldDvsn = '00'): Promise<DailyOrderItem[]> {
  const config = loadKisConfig()
  if (!config.accountNo || !config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다.')
  }
  const token = await getAccessToken()
  const items: DailyOrderItem[] = []
  let fk100 = '', nk100 = ''

  while (true) {
    const params = new URLSearchParams({ token, appkey: config.appKey, appsecret: config.appSecret, accountNo: config.accountNo, ccldDvsn, fk100, nk100 })
    const res = await fetch(`${KIS_DAILY_ORDER_PROXY}?${params}`)
    if (!res.ok) throw new Error(`주문내역 조회 실패: ${res.status}`)
    const data = await res.json()
    if (data.rt_cd !== '0') throw new Error(data.msg1 ?? '주문내역 오류')

    for (const o of data.output1 ?? []) {
      items.push({
        orderNo: o.odno,
        code: o.pdno,
        nameKr: o.prdt_name,
        side: o.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell',
        orderQty: parseInt(o.ord_qty, 10),
        orderPrice: parseInt(o.ord_unpr, 10),
        execQty: parseInt(o.tot_ccld_qty, 10),
        execAvgPrice: parseFloat(o.avg_prvs),
        execAmount: parseInt(o.tot_ccld_amt, 10),
        remainQty: parseInt(o.rmn_qty, 10),
        orderTime: o.ord_tmd,
        status: o.ord_stts,
        orderType: o.ord_dvsn_name,
      })
    }

    const nextFk = data.ctx_area_fk100?.trim() ?? ''
    const nextNk = data.ctx_area_nk100?.trim() ?? ''
    if (nextFk && nextNk && (nextFk !== fk100 || nextNk !== nk100)) {
      fk100 = nextFk; nk100 = nextNk
    } else break
  }
  return items
}
