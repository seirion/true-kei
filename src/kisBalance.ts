import { loadKisConfig } from './KisSettings'
import { getAccessToken } from './kisApi'

const KIS_BALANCE_PROXY = 'https://kis-proxy.seirion.workers.dev/balance'

export interface AssetItem {
  code: string
  nameKr: string
  holdingQty: number
  purchaseAvgPrice: number
  purchaseAmount: number
  currentPrice: number
  priceChange: number      // 전일 대비 가격 변동
  priceChangeRate: number  // 전일 대비 등락률 (%)
  evaluationAmount: number
  profitLossAmount: number // 총 평가손익
  profitLossRate: number   // 총 평가손익률
  dailyProfitLoss: number  // 일간 손익 = priceChange * holdingQty
}

export interface AccountSummary {
  depositAmount: number      // 예수금 (D+2)
  stockEvaluationAmount: number  // 주식 평가금액
  totalEvaluationAmount: number  // 총평가금액
  purchaseAmountTotal: number    // 매입금액합계
  profitLossTotal: number        // 평가손익합계
  netAssetAmount: number         // 순자산
}

export async function fetchBalance(): Promise<{ assets: AssetItem[]; summary: AccountSummary }> {
  const config = loadKisConfig()
  if (!config.accountNo || !config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다. ⚙️ 버튼을 눌러 설정해주세요.')
  }

  const token = await getAccessToken()
  const assets: AssetItem[] = []
  let summary: AccountSummary | null = null
  let fk100 = ''
  let nk100 = ''

  // 연속 조회 처리
  while (true) {
    const params = new URLSearchParams({ token, appkey: config.appKey, appsecret: config.appSecret, accountNo: config.accountNo, fk100, nk100 })
    const res = await fetch(`${KIS_BALANCE_PROXY}?${params}`)
    if (!res.ok) throw new Error(`잔고 조회 실패: ${res.status}`)
    const data = await res.json()
    if (data.rt_cd !== '0') throw new Error(data.msg1 ?? '잔고 조회 오류')

    // 보유 종목
    for (const item of data.output1 ?? []) {
      if (parseInt(item.hldg_qty, 10) <= 0) continue
      const holdingQty = parseInt(item.hldg_qty, 10)
      const priceChange = parseInt(item.bfdy_cprs_icdc, 10) || 0
      assets.push({
        code: item.pdno,
        nameKr: item.prdt_name,
        holdingQty,
        purchaseAvgPrice: parseFloat(item.pchs_avg_pric),
        purchaseAmount: parseInt(item.pchs_amt, 10),
        currentPrice: parseInt(item.prpr, 10),
        priceChange,
        priceChangeRate: parseFloat(item.fltt_rt) || 0,
        evaluationAmount: parseInt(item.evlu_amt, 10),
        profitLossAmount: parseInt(item.evlu_pfls_amt, 10),
        profitLossRate: parseFloat(item.evlu_pfls_rt),
        dailyProfitLoss: priceChange * holdingQty,
      })
    }

    // 요약 (마지막 페이지에만 정확한 값)
    const d = data.output2?.[0]
    if (d) {
      summary = {
        depositAmount: parseInt(d.prvs_rcdl_excc_amt, 10),  // D+2 예수금
        stockEvaluationAmount: parseInt(d.scts_evlu_amt, 10),
        totalEvaluationAmount: parseInt(d.tot_evlu_amt, 10),
        purchaseAmountTotal: parseInt(d.pchs_amt_smtl_amt, 10),
        profitLossTotal: parseInt(d.evlu_pfls_smtl_amt, 10),
        netAssetAmount: parseInt(d.nass_amt, 10),
      }
    }

    // 연속 조회 여부 — fk100/nk100 모두 공백이면 마지막 페이지
    const nextFk = data.ctx_area_fk100?.trim() ?? ''
    const nextNk = data.ctx_area_nk100?.trim() ?? ''
    if (nextFk && nextNk && (nextFk !== fk100 || nextNk !== nk100)) {
      fk100 = nextFk
      nk100 = nextNk
    } else {
      break
    }
  }

  return {
    assets,
    summary: summary ?? {
      depositAmount: 0, stockEvaluationAmount: 0, totalEvaluationAmount: 0,
      purchaseAmountTotal: 0, profitLossTotal: 0, netAssetAmount: 0,
    },
  }
}
