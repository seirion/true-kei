import { useEffect, useState } from 'react'
import { fetchBalance, type AssetItem, type AccountSummary } from './kisBalance'
import { type StockInfo, isHalt, isDesignated } from './firebase'
import { AssetsSkeleton } from './AssetsSkeleton'
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

interface AssetsViewProps {
  onOrder?: (code: string, name: string) => void
  stocks?: Map<string, StockInfo>
}

export function AssetsView({ onOrder, stocks }: AssetsViewProps) {
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDaily, setShowDaily] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchBalance()
      setAssets(result.assets)
      setSummary(result.summary)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '잔고 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // 초기 로딩 (데이터 없음): 스켈레톤
  if (loading && assets.length === 0) return <AssetsSkeleton />
  if (error) return (
    <div className="assets-center" style={{ flexDirection: 'column', gap: '1rem' }}>
      <div className="error-msg" style={{ margin: 0 }}>{error}</div>
      <button className="btn-small" onClick={load}>다시 시도</button>
    </div>
  )

  return (
    <div className="assets-view">
      {/* 새로고침 중 (기존 데이터 있음): 상단 인디케이터 */}
      {loading && assets.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0', marginBottom: '4px' }}>
          <div className="refresh-spinner" />
        </div>
      )}
      {summary && (
        <div className="summary-card">
          <div className="summary-total-row">
            <span className="summary-total-label">총평가금액</span>
            <span className="summary-total-value">{fmt(summary.totalEvaluationAmount)}원</span>
          </div>
          <div className="summary-grid">
            <div className="summary-cell">
              <span className="summary-label">순자산</span>
              <span className="summary-value">{fmt(summary.netAssetAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">주식평가</span>
              <span className="summary-value">{fmt(summary.stockEvaluationAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">예수금(D+2)</span>
              <span className="summary-value">{fmt(summary.depositAmount)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">매입금액</span>
              <span className="summary-value">{fmt(summary.purchaseAmountTotal)}원</span>
            </div>
            <div className="summary-cell">
              <span className="summary-label">총평가손익</span>
              <SummaryProfitValue value={summary.profitLossTotal} />
            </div>
            <div className="summary-cell">
              <span className="summary-label">일간평가손익</span>
              <SummaryProfitValue value={assets.reduce((sum, item) => sum + item.dailyProfitLoss, 0)} />
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
          {assets.map((item) => {
            const prevPrice = item.currentPrice - item.priceChange
            const dailyRate = prevPrice > 0 ? item.priceChange / prevPrice * 100 : 0
            const pnlValue = showDaily ? item.dailyProfitLoss : item.profitLossAmount
            const pnlRate = showDaily ? dailyRate : item.profitLossRate
            return (
              <div key={item.code} className="asset-item">
                {/* 줄 1: 종목명+코드 (왼) | 현재가+손익뱃지 (오) */}
                <div className="asset-row1">
                  <div className="asset-name-block">
                    <span className="asset-name">{item.nameKr}</span>
                    {(() => { const si = stocks?.get(item.code); return si && isHalt(si) ? <span className="badge badge-halt">정</span> : null })()}
                    {(() => { const si = stocks?.get(item.code); return si && isDesignated(si) ? <span className="badge badge-designated">관</span> : null })()}
                    <span className="asset-code">{item.code}</span>
                  </div>
                  <div className="asset-price-block">
                    <span className="asset-current-price">{fmt(item.currentPrice)}원</span>
                    <ProfitBadge value={pnlValue} rate={pnlRate} />
                  </div>
                </div>
                {/* 줄 2: 수량·평균가 (왼) | 평가금액 + 주문버튼 (오) */}
                <div className="asset-row2">
                  <span className="asset-qty-avg">
                    {fmt(item.holdingQty)}주 · 평균 {fmt(Math.round(item.purchaseAvgPrice))}원
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="asset-eval-value">{fmt(item.evaluationAmount)}원</span>
                    {onOrder && <button className="btn-order" onClick={() => onOrder(item.code, item.nameKr)}>주문</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
