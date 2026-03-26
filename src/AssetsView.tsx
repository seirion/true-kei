import { useEffect, useState } from 'react'
import { fetchBalance, type AssetItem, type AccountSummary } from './kisBalance'
import { fetchPrices, type KisPrice } from './kisApi'
import './AssetsView.css'

function fmt(n: number): string {
  return n.toLocaleString()
}

function ProfitBadge({ value, rate, label }: { value: number; rate?: number; label?: string }) {
  const cls = value > 0 ? 'badge-up' : value < 0 ? 'badge-down' : 'badge-flat'
  const sign = value > 0 ? '+' : ''
  const rateStr = rate !== undefined ? ` (${sign}${rate.toFixed(2)}%)` : ''
  return (
    <span className={`profit-badge ${cls}`}>
      {label && <span style={{ opacity: 0.7, marginRight: 3 }}>{label}</span>}
      {sign}{fmt(value)}{rateStr}
    </span>
  )
}

function SummaryProfitValue({ value }: { value: number }) {
  const cls = value > 0 ? 'profit-up' : value < 0 ? 'profit-down' : ''
  const sign = value > 0 ? '+' : ''
  return <span className={`summary-value ${cls}`}>{sign}{fmt(value)}원</span>
}

export function AssetsView() {
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [livePrices, setLivePrices] = useState<Map<string, KisPrice>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [showDaily, setShowDaily] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchBalance()
      setAssets(result.assets)
      setSummary(result.summary)
      // 보유 종목 현재가 조회 (전일 대비 계산용)
      const codes = result.assets.map(a => a.code)
      if (codes.length > 0) {
        const priceMap = new Map<string, KisPrice>()
        await fetchPrices(codes, (code, price) => {
          if (price) { priceMap.set(code, price); setLivePrices(new Map(priceMap)) }
        })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '잔고 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="assets-center">잔고 조회 중...</div>
  if (error) return (
    <div className="assets-center" style={{ flexDirection: 'column', gap: '1rem' }}>
      <div className="error-msg" style={{ margin: 0 }}>{error}</div>
      <button className="btn-small" onClick={load}>다시 시도</button>
    </div>
  )

  return (
    <div className="assets-view">
      {summary && (
        <div className="summary-card">
          <div className="summary-total-row">
            <div className="summary-total-label">총평가금액</div>
            <div className="summary-total-value">{fmt(summary.totalEvaluationAmount)}원</div>
          </div>
          <div className="summary-grid">
            <div className="summary-cell">
              <span className="summary-label">순자산</span>
              <span className="summary-value">{fmt(summary.netAssetAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">예수금 (D+2)</span>
              <span className="summary-value">{fmt(summary.depositAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">주식평가금액</span>
              <span className="summary-value">{fmt(summary.stockEvaluationAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">매입금액</span>
              <span className="summary-value">{fmt(summary.purchaseAmountTotal)}원</span>
            </div>
            <div className="summary-cell" style={{ gridColumn: '1 / -1' }}>
              <span className="summary-label">{showDaily ? '일간 평가손익' : '평가손익'}</span>
              {showDaily ? (
                <SummaryProfitValue value={assets.reduce((sum, item) => {
                  const live = livePrices.get(item.code)
                  const toSigned2 = (abs: number, sign?: string) =>
                    (sign === '4' || sign === '5') ? -abs : abs
                  const dailyChange = live
                    ? toSigned2(parseInt(live.priceChange, 10), live.priceChangeSign)
                    : item.priceChange
                  return sum + dailyChange * item.holdingQty
                }, 0)} />
              ) : (
                <SummaryProfitValue value={summary.profitLossTotal} />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="assets-section-title">
        <span>보유 종목 ({assets.length})</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="profit-toggle">
            <button
              className={`toggle-btn ${!showDaily ? 'toggle-active' : ''}`}
              onClick={() => setShowDaily(false)}
            >총수익</button>
            <button
              className={`toggle-btn ${showDaily ? 'toggle-active' : ''}`}
              onClick={() => setShowDaily(true)}
            >일간수익</button>
          </div>
          <button className="btn-small" onClick={load}>새로고침</button>
        </div>
      </div>

      {assets.length === 0 ? (
        <p className="assets-empty">보유 종목이 없습니다.</p>
      ) : (
        <div className="asset-list">
          {assets.map((item) => (
            <div key={item.code} className="asset-item">
              {/* 줄 1: 종목명 + 코드 */}
              <div className="asset-row1">
                <span className="asset-name">{item.nameKr}</span>
                <span className="asset-code">{item.code}</span>
              </div>
              {/* 줄 2: 수량/평균가 + 현재가 */}
              <div className="asset-row2">
                <span className="asset-qty-avg">
                  {fmt(item.holdingQty)}주 · 평균 {fmt(Math.round(item.purchaseAvgPrice))}원
                </span>
                <div className="asset-price-block">
                  <span className="asset-current-price">{fmt(item.currentPrice)}원</span>
                </div>
              </div>
              {/* 줄 3: 평가금액 + 손익 */}
              {(() => {
                // 일간 손익: (현재가 - 전일종가) × 수량
                // live.priceChange 는 절댓값, sign으로 방향 결정
                const live = livePrices.get(item.code)
                // priceChange는 절댓값, sign으로 방향 결정
                // sign: 1=상한 2=상승 3=보합 4=하한 5=하락
                const toSigned = (abs: number, sign?: string) =>
                  (sign === '4' || sign === '5') ? -abs : abs
                const dailyChange = live
                  ? toSigned(parseInt(live.priceChange, 10), live.priceChangeSign)
                  : item.priceChange
                const dailyRate = live
                  ? toSigned(parseFloat(live.priceChangeRate), live.priceChangeSign)
                  : item.priceChangeRate
                const dailyPnl = dailyChange * item.holdingQty
                return (
                  <div className="asset-row3">
                    <div>
                      <span className="asset-eval-label">평가금액 </span>
                      <span className="asset-eval-value">{fmt(item.evaluationAmount)}원</span>
                    </div>
                    {showDaily
                      ? <ProfitBadge value={dailyPnl} rate={dailyRate} label="일간" />
                      : <ProfitBadge value={item.profitLossAmount} rate={item.profitLossRate} />
                    }
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
