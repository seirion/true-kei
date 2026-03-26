import { useEffect, useState } from 'react'
import { fetchBalance, type AssetItem, type AccountSummary } from './kisBalance'
import './AssetsView.css'

function formatNum(n: number): string {
  return n.toLocaleString()
}

function ProfitBadge({ value, rate }: { value: number; rate?: number }) {
  const cls = value > 0 ? 'profit-up' : value < 0 ? 'profit-down' : ''
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`profit-badge ${cls}`}>
      {sign}{formatNum(value)}
      {rate !== undefined && ` (${sign}${rate.toFixed(2)}%)`}
    </span>
  )
}

export function AssetsView() {
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (loading) return <div className="assets-center">잔고 조회 중...</div>
  if (error) return <div className="assets-center error-msg">{error}</div>

  return (
    <div className="assets-view">
      {summary && (
        <div className="summary-card">
          <div className="summary-total">
            <span className="summary-label">총평가금액</span>
            <span className="summary-value">{formatNum(summary.totalEvaluationAmount)}원</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">순자산</span>
            <span className="summary-value">{formatNum(summary.netAssetAmount)}원</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">예수금 (D+2)</span>
            <span className="summary-value">{formatNum(summary.depositAmount)}원</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">주식평가금액</span>
            <span className="summary-value">{formatNum(summary.stockEvaluationAmount)}원</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">매입금액</span>
            <span className="summary-value">{formatNum(summary.purchaseAmountTotal)}원</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">평가손익</span>
            <ProfitBadge value={summary.profitLossTotal} />
          </div>
        </div>
      )}

      <div className="assets-section-title">
        보유 종목 ({assets.length})
        <button className="btn-small" onClick={load}>새로고침</button>
      </div>

      {assets.length === 0 ? (
        <p className="assets-empty">보유 종목이 없습니다.</p>
      ) : (
        <div className="asset-list">
          {assets.map((item) => (
            <div key={item.code} className="asset-item">
              <div className="asset-top">
                <span className="asset-name">{item.nameKr}</span>
                <span className="asset-code">{item.code}</span>
                <span className="asset-eval">{formatNum(item.evaluationAmount)}원</span>
              </div>
              <div className="asset-bottom">
                <span className="asset-detail">{formatNum(item.holdingQty)}주 · 평균 {formatNum(item.purchaseAvgPrice)}원</span>
                <ProfitBadge value={item.profitLossAmount} rate={item.profitLossRate} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
