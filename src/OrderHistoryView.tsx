import { useEffect, useState, useCallback } from 'react'
import { fetchDailyOrders, type DailyOrderItem, type CcldDvsn } from './kisDailyOrder'
import './OrderHistoryView.css'

function fmt(n: number): string { return n.toLocaleString() }

function fmtTime(t: string): string {
  if (t.length < 6) return t
  return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`
}

type SubTab = 'all' | 'exec' | 'unexec'

const SUB_TAB_LABELS: Record<SubTab, string> = {
  all: '전체',
  exec: '체결',
  unexec: '미체결',
}

const SUB_TAB_DVSN: Record<SubTab, CcldDvsn> = {
  all: '00',
  exec: '01',
  unexec: '02',
}

interface Props {
  onModify?: (item: DailyOrderItem) => void
}

export function OrderHistoryView({ onModify }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('all')
  const [items, setItems] = useState<DailyOrderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (tab: SubTab) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDailyOrders(SUB_TAB_DVSN[tab])
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(subTab) }, [subTab, load])

  return (
    <div className="history-view">
      {/* 서브탭 */}
      <div className="history-sub-tabs">
        {(Object.keys(SUB_TAB_LABELS) as SubTab[]).map(t => (
          <button
            key={t}
            className={`history-sub-btn ${subTab === t ? 'active' : ''}`}
            onClick={() => setSubTab(t)}
          >{SUB_TAB_LABELS[t]}</button>
        ))}
        <button className="history-refresh-btn" onClick={() => load(subTab)}>↻</button>
      </div>

      {loading && <div className="history-center">조회 중…</div>}
      {error && <div className="history-error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="history-center">내역이 없습니다.</div>
      )}

      {!loading && items.length > 0 && (
        <div className="history-list">
          {items.map((item, i) => {
            const isBuy = item.side === 'buy'
            const isExec = item.execQty > 0
            return (
              <div key={`${item.orderNo}-${i}`} className="history-item">
                <div className="history-row1">
                  <span className={`history-side ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? '매수' : '매도'}</span>
                  <span className="history-name">{item.nameKr}</span>
                  <span className="history-code">{item.code}</span>
                  <span className="history-time">{fmtTime(item.orderTime)}</span>
                </div>
                <div className="history-row2">
                  <span className="history-order-type">{item.orderType}</span>
                  <span className="history-qty">
                    주문 <strong>{fmt(item.orderQty)}</strong>주
                    {isExec && <> · 체결 <strong className={isBuy ? 'buy' : 'sell'}>{fmt(item.execQty)}</strong>주</>}
                    {item.remainQty > 0 && <> · 잔여 {fmt(item.remainQty)}주</>}
                  </span>
                  <span className="history-price">
                    {item.orderPrice > 0 ? `${fmt(item.orderPrice)}원` : '시장가'}
                    {isExec && item.execAvgPrice > 0 && (
                      <span className="history-exec-price"> → {fmt(Math.round(item.execAvgPrice))}원</span>
                    )}
                  </span>
                </div>
                {isExec && item.execAmount > 0 && (
                  <div className="history-row3">
                    <span className="history-status">{item.status}</span>
                    <span className="history-amount">체결금액 <strong>{fmt(item.execAmount)}</strong>원</span>
                  </div>
                )}
                {!isExec && (
                  <div className="history-row3">
                    <span className="history-status pending">{item.status || '미체결'}</span>
                    {onModify && item.remainQty > 0 && (
                      <button className="history-modify-btn" onClick={() => onModify(item)}>정정</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
