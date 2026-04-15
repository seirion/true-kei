import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchPrice, fetchAskingPrice, getAccessToken, type KisPrice, type AskingPrice } from './kisApi'
import { loadKisConfig } from './KisSettings'
import { fetchBalance, type AssetItem } from './kisBalance'
import { placeOrder, modifyOrder, fetchBuyable, type OrderSide, type OrderType, ORDER_TYPE_LABEL } from './kisOrder'
import type { DailyOrderItem } from './kisDailyOrder'
import { type RealTimeOrderBook, type RealTimeTrade } from './kisWebSocket'
import { OrderHistoryView } from './OrderHistoryView'
import './OrderView.css'

type OrderSubTab = 'order' | 'history'

function fmt(n: number): string {
  return n.toLocaleString()
}

/** 국내 주식 호가 단위 */
function tickSize(price: number): number {
  if (price < 2000) return 1
  if (price < 5000) return 5
  if (price < 20000) return 10
  if (price < 50000) return 50
  if (price < 100000) return 100
  if (price < 500000) return 500
  return 1000
}

function stepPrice(price: number, up: boolean): number {
  const tick = tickSize(price)
  const next = up ? price + tick : price - tick
  return Math.max(1, next)
}

function formatChange(change: number, sign: string): { text: string; cls: string } {
  if (change === 0) return { text: '0', cls: '' }
  const isUp = sign === '1' || sign === '2'
  const isDown = sign === '4' || sign === '5'
  const prefix = isUp ? '+' : isDown ? '-' : ''
  return {
    text: `${prefix}${Math.abs(change).toLocaleString()}`,
    cls: isUp ? 'up' : isDown ? 'down' : '',
  }
}

interface StockSearchResult {
  code: string
  name: string
}

const ORDER_LAST_STOCK_KEY = 'order_last_stock'
const ORDER_RECENT_KEY = 'order_recent_stocks'
const RECENT_MAX = 20

function loadLastStock(): { code: string; name: string } {
  try {
    const raw = localStorage.getItem(ORDER_LAST_STOCK_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { code: '005930', name: '삼성전자' }
}

function saveLastStock(code: string, name: string) {
  localStorage.setItem(ORDER_LAST_STOCK_KEY, JSON.stringify({ code, name }))
}

function loadRecentStocks(): { code: string; name: string }[] {
  try {
    const raw = localStorage.getItem(ORDER_RECENT_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveRecentStock(code: string, name: string) {
  const list = loadRecentStocks().filter(s => s.code !== code)
  list.unshift({ code, name })
  localStorage.setItem(ORDER_RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
}

interface Props {
  stocks: Map<string, { nameKr: string; prevPrice?: string }>
  initialCode?: string
  initialName?: string
  // App에서 주입하는 실시간 데이터
  orderBook?: RealTimeOrderBook | null
  liveTrade?: RealTimeTrade | null
  // 종목 변경 시 App에 알려 WS 구독 교체
  onStockChange?: (code: string, name: string) => void
  // REST로 조회한 초기 호가 데이터를 App에 전달 (WS 연결 전 선표시용)
  onInitialOrderBook?: (ob: AskingPrice) => void
  // 주문 수정 모드
  modifyTarget?: DailyOrderItem | null
  onModifyDone?: () => void
}

export function OrderView({ stocks, initialCode, initialName, orderBook = null, liveTrade = null, onStockChange, onInitialOrderBook, modifyTarget, onModifyDone }: Props) {
  const [subTab, setSubTab] = useState<OrderSubTab>('order')
  const [internalModifyTarget, setInternalModifyTarget] = useState<DailyOrderItem | null>(null)
  const [holdings, setHoldings] = useState<AssetItem[]>([])
  const [side, setSide] = useState<OrderSide>('buy')
  const [orderType, setOrderType] = useState<OrderType>('00')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
  const [searchFocused, setSearchFocused] = useState(false)
  const [recentVer, setRecentVer] = useState(0)  // recent 업데이트 트리거
  const recentStocks = useMemo(() => loadRecentStocks(), [recentVer]) // eslint-disable-line react-hooks/exhaustive-deps
  const last = loadLastStock()
  const [selectedCode, setSelectedCode] = useState(initialCode ?? last.code)
  const [selectedName, setSelectedName] = useState(initialName ?? last.name)
  const [currentPrice, setCurrentPrice] = useState<KisPrice | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [inputPrice, setInputPrice] = useState('')
  const [inputQty, setInputQty] = useState('')
  const [buyableInfo, setBuyableInfo] = useState<{ maxBuyQty: number; buyableAmount: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 초기 종목 자동 조회
  useEffect(() => {
    if (selectedCode && selectedName) {
      selectStock(selectedCode, selectedName)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 외부(주문 버튼)에서 종목 변경 시
  useEffect(() => {
    if (initialCode && initialName && initialCode !== selectedCode) {
      selectStock(initialCode, initialName)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, initialName])

  // 수정 모드 진입 시 종목/단가/수량 초기화
  useEffect(() => {
    const t = internalModifyTarget ?? modifyTarget ?? null
    if (!t) return
    selectStock(t.code, t.nameKr)
    setSide(t.side)
    setInputPrice(String(t.orderPrice))
    setInputQty(String(t.remainQty))
    setSubTab('order')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalModifyTarget, modifyTarget])

  const activeModify = internalModifyTarget ?? modifyTarget ?? null

  // 탭 진입 시 보유 종목 자동 로드
  useEffect(() => {
    const cfg = loadKisConfig()
    if (!cfg.appKey || !cfg.appSecret || !cfg.accountNo) return
    fetchBalance()
      .then(r => setHoldings(r.assets))
      .catch(e => console.warn('보유종목 로드 실패:', e))
  }, [])

  // 종목 검색
  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([])
      return
    }
    const q = searchQuery.toLowerCase()
    const results: StockSearchResult[] = []
    for (const [code, info] of stocks.entries()) {
      if (code.includes(q) || info.nameKr.toLowerCase().includes(q)) {
        results.push({ code, name: info.nameKr })
      }
      if (results.length >= 8) break
    }
    setSearchResults(results)
  }, [searchQuery, stocks])

  // 종목 선택 시 현재가 조회
  const selectStock = useCallback(async (code: string, name: string) => {
    setSelectedCode(code)
    setSelectedName(name)
    saveLastStock(code, name)
    saveRecentStock(code, name)
    setRecentVer(v => v + 1)
    setSearchQuery('')
    setSearchResults([])
    setCurrentPrice(null)
    setInputPrice('')
    setBuyableInfo(null)
    setResult(null)
    setError(null)
    setPriceLoading(true)
    onStockChange?.(code, name)
    try {
      const config = loadKisConfig()
      if (config.appKey && config.appSecret) {
        const token = await getAccessToken()
        // 현재가 + 호가 병렬 조회
        const [price, askingPrice] = await Promise.all([
          fetchPrice(code, token),
          fetchAskingPrice(code, token),
        ])
        if (price) {
          setCurrentPrice(price)
          if (orderType === '00') setInputPrice(price.price)
        }
        if (askingPrice) {
          onInitialOrderBook?.(askingPrice)
        }
      }
    } catch (e) {
      console.error('현재가 조회 실패:', e)
    } finally {
      setPriceLoading(false)
    }
  }, [orderType, onStockChange])

  // 보유 종목에서 바로 선택 (매도 시 편의)
  const selectHolding = useCallback((item: AssetItem) => {
    selectStock(item.code, item.nameKr)
    if (side === 'sell') {
      setInputQty(String(item.holdingQty))
    }
  }, [selectStock, side])

  // 호가 클릭 → 단가 입력
  const handleAskClick = useCallback((price: number) => {
    setInputPrice(String(price))
  }, [])

  // 주문 단가 변경 시 매수 가능 수량 조회
  const fetchBuyableForPrice = useCallback(async (priceVal: number) => {
    if (!selectedCode || side !== 'buy') return
    if (isNaN(priceVal) || priceVal <= 0) return
    try {
      const info = await fetchBuyable(selectedCode, priceVal)
      setBuyableInfo(info)
    } catch (e) {
      console.warn('매수가능조회 실패:', e)
    }
  }, [selectedCode, side])

  const handlePriceBlur = useCallback(async () => {
    const price = parseInt(inputPrice.replace(/,/g, ''), 10)
    await fetchBuyableForPrice(price)
  }, [inputPrice, fetchBuyableForPrice])

  // 수량 퀵 입력
  const setQtyPercent = (pct: number) => {
    if (side === 'buy' && buyableInfo) {
      setInputQty(String(Math.floor(buyableInfo.maxBuyQty * pct)))
    } else if (side === 'sell') {
      const holding = holdings.find(h => h.code === selectedCode)
      if (holding) setInputQty(String(Math.floor(holding.holdingQty * pct)))
    }
  }

  const handleOrder = async () => {
    setError(null)
    setResult(null)

    if (!selectedCode) { setError('종목을 선택해주세요.'); return }
    const qty = parseInt(inputQty, 10)
    if (isNaN(qty) || qty <= 0) { setError('수량을 입력해주세요.'); return }
    const price = orderType === '01' ? 0 : parseInt(inputPrice.replace(/,/g, ''), 10)
    if (orderType === '00' && (isNaN(price) || price <= 0)) { setError('단가를 입력해주세요.'); return }

    const totalAmount = price * qty
    const confirmMsg = orderType === '01'
      ? `[${selectedName}] ${side === 'buy' ? '매수' : '매도'} 시장가 ${fmt(qty)}주 주문하시겠습니까?`
      : `[${selectedName}] ${side === 'buy' ? '매수' : '매도'} ${fmt(price)}원 × ${fmt(qty)}주 = ${fmt(totalAmount)}원\n주문하시겠습니까?`

    if (!window.confirm(confirmMsg)) return

    setLoading(true)
    try {
      if (activeModify) {
        const res = await modifyOrder(activeModify.orderNo, qty, price)
        setResult(`✅ 정정 완료! 주문번호: ${res.ordNo}`)
        setInternalModifyTarget(null)
        onModifyDone?.()
      } else {
        const res = await placeOrder({ code: selectedCode, side, orderType, qty, price })
        setResult(`✅ 주문 완료! 주문번호: ${res.ordNo}`)
      }
      setInputQty('')
    } catch (e) {
      setError(e instanceof Error ? e.message : activeModify ? '정정 실패' : '주문 실패')
    } finally {
      setLoading(false)
    }
  }

  const priceNum = parseInt(inputPrice.replace(/,/g, ''), 10)
  const qtyNum = parseInt(inputQty, 10)
  const totalAmount = !isNaN(priceNum) && !isNaN(qtyNum) ? priceNum * qtyNum : 0
  const holdingItem = holdings.find(h => h.code === selectedCode)

  const changeInfo = currentPrice
    ? formatChange(parseInt(currentPrice.priceChange, 10), currentPrice.priceChangeSign)
    : null

  // 호가창: asks는 매도(낮은→높은), bids는 매수(높은→낮은)
  // 화면에는 위=높은가격, 아래=낮은가격으로 표시
  // 가격 0인 항목: 매도는 상단(spread에서 멀리), 매수는 하단으로 이동
  const sortedAsks = orderBook
    ? [...orderBook.asks].sort((a, b) => {
        if (a.price === 0 && b.price === 0) return 0
        if (a.price === 0) return -1  // 0은 상단으로
        if (b.price === 0) return 1
        return b.price - a.price      // 나머지는 높은 가격이 위
      })
    : []
  const sortedBids = orderBook
    ? [...orderBook.bids].sort((a, b) => {
        if (a.price === 0 && b.price === 0) return 0
        if (a.price === 0) return 1   // 0은 하단으로
        if (b.price === 0) return -1
        return b.price - a.price      // 나머지는 높은 가격이 위
      })
    : []
  const maxQty = orderBook
    ? Math.max(...orderBook.asks.map(a => a.qty), ...orderBook.bids.map(b => b.qty), 1)
    : 1

  return (
    <div className="order-root">
      {/* 주문 / 내역 서브탭 */}
      <div className="order-top-tabs">
        <button className={`order-top-tab ${subTab === 'order' ? 'active' : ''}`} onClick={() => setSubTab('order')}>주문</button>
        <button className={`order-top-tab ${subTab === 'history' ? 'active' : ''}`} onClick={() => setSubTab('history')}>주문내역</button>
      </div>

      {subTab === 'history' ? (
        <OrderHistoryView onModify={(item) => {
          setInternalModifyTarget(item)
          setSubTab('order')
        }} />
      ) : null}

    <div className="order-layout" style={{ display: subTab === 'order' ? 'flex' : 'none' }}>
      {/* ===== 좌측: 호가창 ===== */}
      <div className="orderbook-panel">
        <div className="ob-title">호가</div>
        {!selectedCode ? (
          <div className="ob-empty">종목을 선택하세요</div>
        ) : !orderBook ? (
          <div className="ob-empty">호가 수신 대기 중…</div>
        ) : (
          <div className="ob-table">
            {/* 매도호가 (위=비쌈) */}
            {sortedAsks.map((level, i) => (
              <div
                key={`ask-${i}`}
                className="ob-row ob-ask"
                onClick={() => handleAskClick(level.price)}
              >
                <span className="ob-qty ob-ask-qty">
                  <span
                    className="ob-bar ob-ask-bar"
                    style={{ width: `${Math.min(100, (level.qty / maxQty) * 100)}%` }}
                  />
                  <span className="ob-qty-text">{fmt(level.qty)}</span>
                </span>
                <span className="ob-price ob-ask-price">{fmt(level.price)}</span>
              </div>
            ))}
            {/* 현재가 구분선 */}
            <div className="ob-spread-row">
              {currentPrice ? (
                <span className={`ob-cur-price ${changeInfo?.cls ?? ''}`}>
                  {fmt(parseInt(currentPrice.price, 10))}
                  {changeInfo && <span className="ob-cur-change"> {changeInfo.text}</span>}
                </span>
              ) : <span className="ob-cur-price">—</span>}
            </div>
            {/* 매수호가 (위=비쌈) */}
            {sortedBids.map((level, i) => (
              <div
                key={`bid-${i}`}
                className="ob-row ob-bid"
                onClick={() => handleAskClick(level.price)}
              >
                <span className="ob-price ob-bid-price">{fmt(level.price)}</span>
                <span className="ob-qty ob-bid-qty">
                  <span
                    className="ob-bar ob-bid-bar"
                    style={{ width: `${Math.min(100, (level.qty / maxQty) * 100)}%` }}
                  />
                  <span className="ob-qty-text">{fmt(level.qty)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 우측: 주문폼 ===== */}
      <div className="order-view">
        {/* 매수/매도 탭 */}
        {activeModify && (
          <div className="modify-banner">
            ✏️ 주문 정정 모드 — {activeModify.side === 'buy' ? '매수' : '매도'} · 잔여 {activeModify.remainQty.toLocaleString()}주
            <button className="dismiss-btn" onClick={() => setInternalModifyTarget(null)}>✕</button>
          </div>
        )}
        <div className="order-side-tabs" style={{ display: activeModify ? 'none' : undefined }}>
          <button
            className={`side-btn buy-btn ${side === 'buy' ? 'active' : ''}`}
            onClick={() => { setSide('buy'); setInputQty(''); setBuyableInfo(null) }}
          >매수</button>
          <button
            className={`side-btn sell-btn ${side === 'sell' ? 'active' : ''}`}
            onClick={() => { setSide('sell'); setInputQty('') }}
          >매도</button>
        </div>

        {/* 종목 검색 */}
        <div className="order-section">
          <label className="order-label">종목</label>
          <div className="stock-search-wrap">
            <div className="search-input-row">
              <input
                className="order-input"
                type="text"
                placeholder="종목명 또는 코드 검색"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]); setSearchFocused(false) } }}
              />
              {searchQuery && (
                <button className="search-cancel-btn" onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchFocused(false) }}>✕</button>
              )}
            </div>
            {/* 검색 결과 또는 최근 종목 suggestion */}
            {(searchResults.length > 0 || (searchFocused && !searchQuery && recentStocks.length > 0)) && (
              <>
                <div className="search-backdrop" onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchFocused(false) }} />
                <div className="search-dropdown">
                  {searchResults.length > 0 ? (
                    searchResults.map(r => (
                      <div key={r.code} className="search-item" onClick={() => { selectStock(r.code, r.name); setSearchFocused(false) }}>
                        <span className="search-name">{r.name}</span>
                        <span className="search-code">{r.code}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="search-section-label">최근 종목</div>
                      {recentStocks.map(r => (
                        <div key={r.code} className="search-item" onClick={() => { selectStock(r.code, r.name); setSearchFocused(false) }}>
                          <span className="search-name">{r.name}</span>
                          <span className="search-code">{r.code}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {selectedCode && (
            <div className="selected-stock">
              <span className="selected-name">{selectedName}</span>
              <span className="selected-code">{selectedCode}</span>
              {priceLoading ? (
                <span className="price-loading-sm">조회 중…</span>
              ) : currentPrice ? (
                <span className={`selected-price ${changeInfo?.cls ?? ''}`}>
                  {fmt(parseInt(currentPrice.price, 10))}원
                  {changeInfo && <span className="price-change-sm"> {changeInfo.text} ({currentPrice.priceChangeRate}%)</span>}
                </span>
              ) : null}
            </div>
          )}

          {/* OHLCV: REST 초기값, 이후 체결 데이터로 업데이트 */}
          {selectedCode && (currentPrice || liveTrade) && (() => {
            const open  = liveTrade?.openPrice  ?? parseInt(currentPrice?.openPrice  ?? '0', 10)
            const high  = liveTrade?.highPrice  ?? parseInt(currentPrice?.highPrice  ?? '0', 10)
            const low   = liveTrade?.lowPrice   ?? parseInt(currentPrice?.lowPrice   ?? '0', 10)
            const close = liveTrade?.price      ?? parseInt(currentPrice?.price      ?? '0', 10)
            const vol   = liveTrade?.volume     ?? parseInt(currentPrice?.volume     ?? '0', 10)
            return (
              <div className="ohlcv-row">
                <span><span className="ohlcv-label">시</span>{fmt(open)}</span>
                <span><span className="ohlcv-label up">고</span><span className="up">{fmt(high)}</span></span>
                <span><span className="ohlcv-label down">저</span><span className="down">{fmt(low)}</span></span>
                <span><span className="ohlcv-label">종</span>{fmt(close)}</span>
                <span><span className="ohlcv-label">량</span>{vol >= 1000000 ? (vol/1000000).toFixed(1)+'M' : vol >= 1000 ? (vol/1000).toFixed(0)+'K' : fmt(vol)}</span>
              </div>
            )
          })()}
        </div>

        {/* 보유 종목 빠른 선택 (매도) */}
        {side === 'sell' && holdings.length > 0 && (
          <div className="order-section">
            <label className="order-label">보유 종목</label>
            <div className="holdings-list">
              {holdings.map(item => (
                <div
                  key={item.code}
                  className={`holding-chip ${item.code === selectedCode ? 'selected' : ''}`}
                  onClick={() => selectHolding(item)}
                >
                  <span>{item.nameKr}</span>
                  <span className="holding-qty">{fmt(item.holdingQty)}주</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 주문 유형 + 단가/수량 그리드 */}
        <div className="order-type-inputs-grid">
          {/* 좌: 주문 유형 버튼 세로 배치 */}
          <div className="order-type-col">
            <span className="order-label">유형</span>
            {(Object.entries(ORDER_TYPE_LABEL) as [OrderType, string][]).map(([val, label]) => (
              <button
                key={val}
                className={`order-type-btn ${orderType === val ? 'active' : ''}`}
                onClick={() => {
                  setOrderType(val)
                  if (val === '01') setInputPrice('')
                  else if (currentPrice) setInputPrice(currentPrice.price)
                }}
              >{label}</button>
            ))}
          </div>

          {/* 우: 단가 + 수량 세로 배치 */}
          <div className="order-inputs-col">
            {/* 단가 */}
            <div className="order-input-row">
              <span className="order-label-inline">{orderType === '00' ? '단가' : '단가'}</span>
              <div className={`price-input-wrap${orderType === '01' ? ' disabled' : ''}`}>
                <button className="step-btn" disabled={orderType === '01'} onClick={() => {
                  const p = parseInt(inputPrice.replace(/,/g, ''), 10)
                  if (!isNaN(p)) { const next = stepPrice(p, false); setInputPrice(String(next)); fetchBuyableForPrice(next) }
                }}>▼</button>
                <input
                  className="order-input"
                  type="number"
                  placeholder={orderType === '01' ? '시장가' : '주문 단가'}
                  disabled={orderType === '01'}
                  value={inputPrice}
                  onChange={e => setInputPrice(e.target.value)}
                  onBlur={handlePriceBlur}
                />
                <button className="step-btn" disabled={orderType === '01'} onClick={() => {
                  const p = parseInt(inputPrice.replace(/,/g, ''), 10)
                  if (!isNaN(p)) { const next = stepPrice(p, true); setInputPrice(String(next)); fetchBuyableForPrice(next) }
                }}>▲</button>
                <span className="input-unit">원</span>
              </div>
            </div>

            {/* 수량 */}
            <div className="order-input-row">
              <span className="order-label-inline">수량</span>
              <div className="price-input-wrap">
                <button className="step-btn" onClick={() => {
                  const q = parseInt(inputQty, 10)
                  if (!isNaN(q) && q > 1) setInputQty(String(q - 1))
                }}>▼</button>
                <input
                  className="order-input"
                  type="number"
                  placeholder="주문 수량"
                  value={inputQty}
                  onChange={e => setInputQty(e.target.value)}
                />
                <button className="step-btn" onClick={() => {
                  const q = parseInt(inputQty, 10)
                  setInputQty(String(isNaN(q) ? 1 : q + 1))
                }}>▲</button>
                <span className="input-unit">주</span>
              </div>
            </div>
          </div>
        </div>

        {/* 보조 정보 + 수량 빠른 버튼 */}
        <div className="order-aux-row">
          <div className="qty-quick">
            {[0.1, 0.25, 0.5, 1].map(pct => (
              <button key={pct} className="qty-btn" onClick={() => setQtyPercent(pct)}>
                {pct * 100}%
              </button>
            ))}
          </div>
          {orderType === '00' && currentPrice && (
            <div className="price-hint">현재가 <strong>{fmt(parseInt(currentPrice.price, 10))}</strong>원</div>
          )}
          {side === 'buy' && buyableInfo && (
            <div className="price-hint">
              매수가능 <strong>{fmt(buyableInfo.maxBuyQty)}</strong>주
            </div>
          )}
          {side === 'sell' && holdingItem && (
            <div className="price-hint">
              보유 <strong>{fmt(holdingItem.holdingQty)}</strong>주
            </div>
          )}
        </div>

        {/* 총 주문 금액 */}
        {orderType === '00' && totalAmount > 0 && (
          <div className="order-total">
            총 주문금액: <strong>{fmt(totalAmount)}</strong>원
          </div>
        )}

        {/* 결과 / 오류 */}
        {result && (
          <div className="order-result">
            <span>{result}</span>
            <button className="dismiss-btn" onClick={() => setResult(null)}>✕</button>
          </div>
        )}
        {error && (
          <div className="order-error">
            <span>{error}</span>
            <button className="dismiss-btn" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* 주문 버튼 */}
        <button
          className={`order-submit-btn ${activeModify ? 'submit-modify' : side === 'buy' ? 'submit-buy' : 'submit-sell'}`}
          onClick={handleOrder}
          disabled={loading || !selectedCode}
        >
          {loading ? '처리 중…' : activeModify ? `정정 주문 (원번호: ${activeModify.orderNo})` : side === 'buy' ? '매수 주문' : '매도 주문'}
        </button>
      </div>
    </div>
    </div>
  )
}
