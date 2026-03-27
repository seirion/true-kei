import { useEffect, useState, useCallback, useRef } from 'react'
import {
  signInWithGoogle,
  signOutUser,
  onAuthChanged,
  getGoogleRedirectResult,
  loadWatchList,
  loadWatchNames,
  loadStocks,
  type User,
  type StockInfo,
  isHalt,
  isDesignated,
} from './firebase'
import { KisSettingsModal, loadKisConfig } from './KisSettings'
import { SearchModal } from './SearchModal'
import { AssetsView } from './AssetsView'
import { OrderView } from './OrderView'
import { fetchPrices, type KisPrice } from './kisApi'
import { KisWebSocket, fetchWsApprovalKey, isNxtHour, isRegularHour, type RealTimeTrade, type RealTimeOrderBook, type OrderExecution } from './kisWebSocket'
import './App.css'

type TabId = 'assets' | 'watchlist' | 'order'

interface PriceInfo {
  price: string; priceChange: string; priceChangeSign: string; priceChangeRate: string
}

interface StockRow {
  code: string; nameKr: string; halt: boolean; designated: boolean
  krx: PriceInfo | null; nxt: PriceInfo | null
  priceLoading: boolean
}

function formatPrice(p: string): string {
  const n = parseInt(p, 10); return isNaN(n) ? p : n.toLocaleString()
}

function formatChange(change: string, sign: string, rate: string): { text: string; cls: string } {
  const n = parseFloat(change)
  if (isNaN(n) || n === 0) return { text: '0', cls: '' }
  const isUp = sign === '1' || sign === '2'
  const isDown = sign === '4' || sign === '5'
  const prefix = isUp ? '+' : isDown ? '-' : ''
  const rateN = parseFloat(rate)
  const rateStr = isNaN(rateN) ? '' : ` (${prefix}${Math.abs(rateN).toFixed(2)}%)`
  return { text: `${prefix}${Math.abs(n).toLocaleString()}${rateStr}`, cls: isUp ? 'up' : isDown ? 'down' : '' }
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>(
    () => (localStorage.getItem('last_tab') as TabId) ?? 'watchlist'
  )

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    localStorage.setItem('last_tab', tab)
    const newMode = tab === 'order' ? 'order' : 'watchlist'
    if (newMode !== wsModeRef.current) {
      wsModeRef.current = newMode
      const ws = kisWsRef.current
      if (ws) applyWsSubscription(ws, newMode)
    }
  }
  const [watchList, setWatchList] = useState<string[][]>([])
  const [watchNames, setWatchNames] = useState<(string | null)[]>([])
  const [stocks, setStocks] = useState<Map<string, StockInfo>>(new Map())
  const [prices, setPrices] = useState<Map<string, KisPrice>>(new Map())
  const [nxtPrices, setNxtPrices] = useState<Map<string, KisPrice>>(new Map())
  const [priceLoading, setPriceLoading] = useState(false)
  const [activeGroup, setActiveGroup] = useState(0)
  // activeGroup이 바뀌면 ref도 동기화
  useEffect(() => { activeGroupRef.current = activeGroup }, [activeGroup])
  const [error, setError] = useState<string | null>(null)
  const [showKisSettings, setShowKisSettings] = useState(false)
  const closeKisSettings = useCallback(() => setShowKisSettings(false), [])
  const [showSearch, setShowSearch] = useState(false)
  const closeSearch = useCallback(() => setShowSearch(false), [])
  const [wsConnected, setWsConnected] = useState(false)
  const [assetsKey, setAssetsKey] = useState(0)
  const [orderCode, setOrderCode] = useState<string | undefined>()
  const [orderName, setOrderName] = useState<string | undefined>()
  const [orderBook, setOrderBook] = useState<RealTimeOrderBook | null>(null)
  const [liveOrderTrade, setLiveOrderTrade] = useState<RealTimeTrade | null>(null)
  const [execToasts, setExecToasts] = useState<(OrderExecution & { id: number })[]>([])

  const kisWsRef = useRef<KisWebSocket | null>(null)
  const approvalKeyRef = useRef<string>('')
  const watchListRef = useRef<string[][]>([])
  // 현재 WS 구독 모드: 'watchlist' | 'order'
  const wsModeRef = useRef<'watchlist' | 'order'>('watchlist')
  const orderCodeRef = useRef<string>((() => {
    try { return (JSON.parse(localStorage.getItem('order_last_stock') ?? '{}') as { code?: string }).code ?? '' } catch { return '' }
  })())
  const activeGroupRef = useRef<number>(0)

  const goToOrder = useCallback((code?: string, name?: string) => {
    if (code) {
      setOrderCode(code); setOrderName(name ?? code)
      orderCodeRef.current = code
    }
    handleTabChange('order')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // WS 구독 교체: 탭/종목에 따라 체결+호가 구독 결정
  const applyWsSubscription = useCallback((ws: KisWebSocket, mode: 'watchlist' | 'order') => {
    ws.unsubscribeAll()
    setOrderBook(null)
    setLiveOrderTrade(null)
    if (mode === 'watchlist') {
      const codes = [...new Set((watchListRef.current[activeGroupRef.current] ?? []).filter(Boolean))]
      if (codes.length > 0) ws.subscribe(codes)
    } else {
      const code = orderCodeRef.current
      if (code) {
        ws.subscribe([code])
        ws.subscribeAsp([code])
      }
    }
  }, [])

  // Page Visibility API: hidden → disconnect, visible → reconnect + 재구독
  useEffect(() => {
    const handleVisibility = () => {
      const ws = kisWsRef.current
      if (!ws) return
      if (document.hidden) {
        ws.disconnect()
      } else {
        ws.connect()
        // connect 후 onopen에서 자동 복원되나, 구독 목록은 applyWsSubscription으로 최신화
        // (onopen에서 subscribedCodes를 다시 보내므로 여기서는 재적용만)
        applyWsSubscription(ws, wsModeRef.current)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [applyWsSubscription])

  useEffect(() => {
    getGoogleRedirectResult().catch((e) => console.error('redirect result error:', e))
    const unsubscribe = onAuthChanged(async (u) => {
      setUser(u); setLoading(false)
      if (u) {
        setDataLoading(true); setError(null)
        try {
          const [list, names, stockMap] = await Promise.all([
            loadWatchList(u.uid), loadWatchNames(u.uid), loadStocks(),
          ])
          watchListRef.current = list
          setWatchList(list); setWatchNames(names); setStocks(stockMap)
          const cfg = loadKisConfig()
          if (cfg.appKey && cfg.appSecret) {
            try {
              const key = await fetchWsApprovalKey(cfg.appKey, cfg.appSecret)
              approvalKeyRef.current = key
              initWs(key)
            } catch (e) { console.error('Approval key failed:', e) }
            const codes = [...new Set((list[0] ?? []).filter(Boolean))]
            if (codes.length > 0) loadGroupPrices(codes)
          }
        } catch (e) {
          setError('데이터를 불러오는 데 실패했습니다.')
        } finally { setDataLoading(false) }
      }
    })
    return () => { unsubscribe(); kisWsRef.current?.disconnect() }
  }, [])

  const handleGroupChange = useCallback((idx: number) => {
    setActiveGroup(idx)
    activeGroupRef.current = idx
    setPrices(new Map()); setNxtPrices(new Map())
    const codes = [...new Set((watchListRef.current[idx] ?? []).filter(Boolean))]
    if (codes.length > 0) loadGroupPrices(codes)
    const ws = kisWsRef.current
    if (ws && wsModeRef.current === 'watchlist') applyWsSubscription(ws, 'watchlist')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyWsSubscription])

  const initWs = useCallback((approvalKey: string) => {
    kisWsRef.current?.disconnect()
    const ws = new KisWebSocket(
      approvalKey,
      (trade: RealTimeTrade) => {
        if (wsModeRef.current === 'order') {
          setLiveOrderTrade(trade)
        } else {
          const sign = trade.delta > 0 ? '2' : trade.delta < 0 ? '5' : '3'
          const info: KisPrice = {
            price: String(trade.price),
            prevPrice: String(Math.round(trade.price - trade.delta)),
            priceChange: String(Math.abs(trade.delta)),
            priceChangeSign: sign,
            priceChangeRate: String(Math.abs(trade.rate)),
          }
          if (trade.isNxt) setNxtPrices(prev => new Map(prev).set(trade.code, info))
          else setPrices(prev => new Map(prev).set(trade.code, info))
        }
      },
      setWsConnected,
      (ob) => setOrderBook(ob),
      (exec: OrderExecution) => {
        const id = Date.now()
        setExecToasts(prev => [...prev, { ...exec, id }])
        setTimeout(() => setExecToasts(prev => prev.filter(t => t.id !== id)), 5000)
      },
    )
    kisWsRef.current = ws
    ws.connect()
    applyWsSubscription(ws, wsModeRef.current)
    // 체결통보 구독 (userId|accountNo 형식)
    const cfg = loadKisConfig()
    if (cfg.userId && cfg.accountNo) {
      ws.subscribeExecution(`${cfg.userId}|${cfg.accountNo}`)
    }
  }, [applyWsSubscription])

  const handleAccountChange = useCallback(async () => {
    setAssetsKey((k) => k + 1)  // AssetsView 리마운트 → 자산 재조회
    const cfg = loadKisConfig()
    if (!cfg.appKey || !cfg.appSecret) return
    try {
      const key = await fetchWsApprovalKey(cfg.appKey, cfg.appSecret)
      approvalKeyRef.current = key
      initWs(key)
      const codes = [...new Set((watchListRef.current[activeGroup] ?? []).filter(Boolean))]
      if (codes.length > 0) loadGroupPrices(codes)
    } catch (e) { console.error('계정 전환 후 WebSocket 재시작 실패:', e) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  const loadGroupPrices = async (codes: string[]) => {
    setPriceLoading(true); setError(null)
    try {
      const result = new Map<string, KisPrice>()
      await fetchPrices(codes, (code, price) => {
        if (price) { result.set(code, price); setPrices(new Map(result)) }
      }, 'J')
      if (!isRegularHour()) {
        const nxtResult = new Map<string, KisPrice>()
        await fetchPrices(codes, (code, price) => {
          if (price) { nxtResult.set(code, price); setNxtPrices(new Map(nxtResult)) }
        }, 'NX')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '현재가 조회 실패')
    } finally { setPriceLoading(false) }
  }

  const buildRows = (codes: string[]): StockRow[] =>
    codes.map((code) => {
      const info = stocks.get(code); const p = prices.get(code); const nxt = nxtPrices.get(code)
      const krx: PriceInfo = p
        ? { price: p.price, priceChange: p.priceChange, priceChangeSign: p.priceChangeSign, priceChangeRate: p.priceChangeRate }
        : { price: info?.prevPrice ?? '-', priceChange: '0', priceChangeSign: '3', priceChangeRate: '0' }
      return {
        code, nameKr: info?.nameKr ?? code,
        halt: info ? isHalt(info) : false,
        designated: info ? isDesignated(info) : false,
        krx,
        nxt: nxt ? { price: nxt.price, priceChange: nxt.priceChange, priceChangeSign: nxt.priceChangeSign, priceChangeRate: nxt.priceChangeRate } : null,
        priceLoading: !p && priceLoading,
      }
    })

  const currentCodes = [...new Set((watchList[activeGroup] ?? []).filter(Boolean))]

  if (loading) return <div className="container center">로딩 중...</div>

  return (
    <div className="container">
      {user ? (
        <div className="app-layout">
          {/* 헤더 */}
          <header className="header">
            <h1>참교육 K</h1>
            <div className="user-info">
              {user.photoURL && <img src={user.photoURL} alt="profile" className="avatar-sm" />}
              <span>{user.displayName}</span>
              <span className={`ws-badge ${wsConnected ? 'ws-on' : 'ws-off'}`}>
                {wsConnected ? '● 실시간' : '○ 대기'}
              </span>
              <button className="btn btn-icon" onClick={() => setShowSearch(true)} title="종목 검색">🔍</button>
              <button className="btn btn-icon" onClick={() => setShowKisSettings(true)} title="KIS API 설정">⚙️</button>
              <button className="btn btn-signout" onClick={signOutUser}>로그아웃</button>
            </div>
          </header>

          {showKisSettings && <KisSettingsModal onClose={closeKisSettings} onAccountChange={handleAccountChange} />}
          {showSearch && (
            <SearchModal
              stocks={stocks} watchList={watchList} activeGroup={activeGroup}
              uid={user.uid}
              onWatchListChange={(newList) => { watchListRef.current = newList; setWatchList(newList) }}
              onClose={closeSearch}
            />
          )}

          {/* 탭 컨텐츠 */}
          <div className="tab-content">
            {error && <div className="error-msg" style={{ margin: '0 1rem 0.5rem' }}>{error}</div>}

            <div style={{ display: activeTab === 'assets' ? undefined : 'none' }}>
              <AssetsView key={assetsKey} onOrder={goToOrder} stocks={stocks} />
            </div>

            {activeTab === 'watchlist' && (
              dataLoading ? <div className="center-text">데이터 불러오는 중...</div> : (
                <div className="main">
                  <div className="group-tabs">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button key={i} className={`tab ${activeGroup === i ? 'active' : ''}`} onClick={() => handleGroupChange(i)}>
                        {watchNames[i] || `그룹 ${i}`}
                      </button>
                    ))}
                  </div>
                  {priceLoading && <div className="price-loading">현재가 조회 중... ({prices.size}/{currentCodes.length})</div>}
                  <div className="stock-table">
                    <div className="stock-header">
                      <span className="col-name">종목명</span>
                      <span className="col-price-wrap">현재가{!isRegularHour() && isNxtHour() ? ' / NXT' : ''}</span>
                      <span className="col-change-wrap">등락</span>
                      <span className="col-order-placeholder" />
                    </div>
                    {currentCodes.length > 0 ? buildRows(watchList[activeGroup] ?? []).map((row) => {
                      const krxChange = formatChange(row.krx?.priceChange ?? '0', row.krx?.priceChangeSign ?? '3', row.krx?.priceChangeRate ?? '0')
                      const nxtChange = row.nxt ? formatChange(row.nxt.priceChange, row.nxt.priceChangeSign, row.nxt.priceChangeRate) : null
                      const showNxt = row.nxt !== null && parseInt(row.nxt.price, 10) > 0
                      return (
                        <div key={row.code} className="stock-row">
                          <span className="col-name">
                            <span className="stock-name">{row.nameKr}</span>
                            {row.halt && <span className="badge badge-halt">정</span>}
                            {row.designated && <span className="badge badge-designated">관</span>}
                            <span className="stock-code">{row.code}</span>
                          </span>
                          <span className="col-price-wrap">
                            <span className={`col-price ${krxChange.cls}`}>{row.priceLoading ? '…' : formatPrice(row.krx?.price ?? '-')}</span>
                            {showNxt && <span className={`col-price nxt-price ${nxtChange!.cls}`}>NXT {formatPrice(row.nxt!.price)}</span>}
                          </span>
                          <span className="col-change-wrap">
                            <span className={`col-change ${krxChange.cls}`}>{row.priceLoading ? '' : krxChange.text}</span>
                            {showNxt && nxtChange && <span className={`col-change nxt-change ${nxtChange.cls}`}>{nxtChange.text}</span>}
                          </span>
                          <span style={{ width: '6px', flexShrink: 0 }} />
                          <button className="btn-order" onClick={() => goToOrder(row.code, row.nameKr)}>주문</button>
                        </div>
                      )
                    }) : <p className="empty">이 그룹에 종목이 없습니다.</p>}
                  </div>
                </div>
              )
            )}

            <div style={{ display: activeTab === 'order' ? undefined : 'none' }}>
              <OrderView
                stocks={stocks}
                initialCode={orderCode}
                initialName={orderName}
                orderBook={orderBook}
                liveTrade={liveOrderTrade}
                onStockChange={(code, name) => {
                  orderCodeRef.current = code
                  setOrderCode(code); setOrderName(name)
                  setOrderBook(null); setLiveOrderTrade(null)
                  const ws = kisWsRef.current
                  if (ws && wsModeRef.current === 'order') applyWsSubscription(ws, 'order')
                }}
              />
            </div>
          </div>

          {/* 하단 탭 네비게이션 */}
          <nav className="bottom-nav">
            <button className={`nav-btn ${activeTab === 'assets' ? 'nav-active' : ''}`} onClick={() => handleTabChange('assets')}>
              <span className="nav-icon">💰</span>
              <span className="nav-label">총자산</span>
            </button>
            <button className={`nav-btn ${activeTab === 'watchlist' ? 'nav-active' : ''}`} onClick={() => handleTabChange('watchlist')}>
              <span className="nav-icon">⭐</span>
              <span className="nav-label">관심종목</span>
            </button>
            <button className={`nav-btn ${activeTab === 'order' ? 'nav-active' : ''}`} onClick={() => handleTabChange('order')}>
              <span className="nav-icon">📋</span>
              <span className="nav-label">주식주문</span>
            </button>
          </nav>

          {/* 체결 토스트 */}
          {execToasts.length > 0 && (
            <div className="exec-toast-container">
              {execToasts.map(t => (
                <div key={t.id} className={`exec-toast ${t.side === 'buy' ? 'exec-buy' : 'exec-sell'}`}>
                  <span className="exec-toast-side">{t.side === 'buy' ? '매수' : '매도'} 체결</span>
                  <span className="exec-toast-code">{t.code}</span>
                  <span className="exec-toast-info">{t.execQty.toLocaleString()}주 × {t.execPrice.toLocaleString()}원</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="login">
          <h1>참교육 K</h1>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-google" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google로 로그인
          </button>
        </div>
      )}
    </div>
  )
}

export default App
