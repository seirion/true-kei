import { useState, useEffect, useCallback } from 'react'
import { fetchPrice, getAccessToken, type KisPrice } from './kisApi'
import { loadKisConfig } from './KisSettings'
import { fetchBalance, type AssetItem } from './kisBalance'
import { placeOrder, fetchBuyable, type OrderSide, type OrderType, ORDER_TYPE_LABEL } from './kisOrder'
import { type RealTimeOrderBook, type RealTimeTrade } from './kisWebSocket'
import './OrderView.css'

function fmt(n: number): string {
  return n.toLocaleString()
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

interface Props {
  stocks: Map<string, { nameKr: string; prevPrice?: string }>
  initialCode?: string
  initialName?: string
  // App에서 주입하는 실시간 데이터
  orderBook?: RealTimeOrderBook | null
  liveTrade?: RealTimeTrade | null
  // 종목 변경 시 App에 알려 WS 구독 교체
  onStockChange?: (code: string, name: string) => void
}

export function OrderView({ stocks, initialCode, initialName, orderBook = null, liveTrade = null, onStockChange }: Props) {
  const [holdings, setHoldings] = useState<AssetItem[]>([])
  const [side, setSide] = useState<OrderSide>('buy')
  const [orderType, setOrderType] = useState<OrderType>('00')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
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
        const price = await fetchPrice(code, token)
        if (price) {
          setCurrentPrice(price)
          if (orderType === '00') setInputPrice(price.price)
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
  const handlePriceBlur = useCallback(async () => {
    if (!selectedCode || side !== 'buy') return
    const price = parseInt(inputPrice.replace(/,/g, ''), 10)
    if (isNaN(price) || price <= 0) return
    try {
      const info = await fetchBuyable(selectedCode, price)
      setBuyableInfo(info)
    } catch (e) {
      console.warn('매수가능조회 실패:', e)
    }
  }, [selectedCode, inputPrice, side])

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
      const res = await placeOrder({ code: selectedCode, side, orderType, qty, price })
      setResult(`✅ 주문 완료! 주문번호: ${res.ordNo}`)
      setInputQty('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '주문 실패')
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
  const sortedAsks = orderBook ? [...orderBook.asks].sort((a, b) => b.price - a.price) : []
  const sortedBids = orderBook ? [...orderBook.bids].sort((a, b) => b.price - a.price) : []
  const maxQty = orderBook
    ? Math.max(...orderBook.asks.map(a => a.qty), ...orderBook.bids.map(b => b.qty), 1)
    : 1

  return (
    <div className="order-layout">
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
        <div className="order-side-tabs">
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
                onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]) } }}
              />
              {searchQuery && (
                <button className="search-cancel-btn" onClick={() => { setSearchQuery(''); setSearchResults([]) }}>✕</button>
              )}
            </div>
            {searchResults.length > 0 && (
              <>
                <div className="search-backdrop" onClick={() => { setSearchQuery(''); setSearchResults([]) }} />
                <div className="search-dropdown">
                  {searchResults.map(r => (
                    <div key={r.code} className="search-item" onClick={() => selectStock(r.code, r.name)}>
                      <span className="search-name">{r.name}</span>
                      <span className="search-code">{r.code}</span>
                    </div>
                  ))}
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

        {/* 주문 유형 */}
        <div className="order-section">
          <label className="order-label">주문 유형</label>
          <div className="order-type-group">
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
        </div>

        {/* 단가 */}
        {orderType === '00' && (
          <div className="order-section">
            <label className="order-label">단가</label>
            <div className="price-input-wrap">
              <input
                className="order-input"
                type="number"
                placeholder="주문 단가"
                value={inputPrice}
                onChange={e => setInputPrice(e.target.value)}
                onBlur={handlePriceBlur}
              />
              <span className="input-unit">원</span>
            </div>
            {currentPrice && (
              <div className="price-hint">
                현재가 <strong>{fmt(parseInt(currentPrice.price, 10))}</strong>원
              </div>
            )}
          </div>
        )}

        {/* 수량 */}
        <div className="order-section">
          <label className="order-label">수량</label>
          <div className="price-input-wrap">
            <input
              className="order-input"
              type="number"
              placeholder="주문 수량"
              value={inputQty}
              onChange={e => setInputQty(e.target.value)}
            />
            <span className="input-unit">주</span>
          </div>
          <div className="qty-quick">
            {[0.1, 0.25, 0.5, 1].map(pct => (
              <button key={pct} className="qty-btn" onClick={() => setQtyPercent(pct)}>
                {pct * 100}%
              </button>
            ))}
          </div>
          {side === 'buy' && buyableInfo && (
            <div className="price-hint">
              매수 가능: <strong>{fmt(buyableInfo.maxBuyQty)}</strong>주 ({fmt(buyableInfo.buyableAmount)}원)
            </div>
          )}
          {side === 'sell' && holdingItem && (
            <div className="price-hint">
              보유: <strong>{fmt(holdingItem.holdingQty)}</strong>주
              (매입가 {fmt(holdingItem.purchaseAvgPrice)}원)
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
        {result && <div className="order-result">{result}</div>}
        {error && <div className="order-error">{error}</div>}

        {/* 주문 버튼 */}
        <button
          className={`order-submit-btn ${side === 'buy' ? 'submit-buy' : 'submit-sell'}`}
          onClick={handleOrder}
          disabled={loading || !selectedCode}
        >
          {loading ? '처리 중…' : side === 'buy' ? '매수 주문' : '매도 주문'}
        </button>
      </div>
    </div>
  )
}
