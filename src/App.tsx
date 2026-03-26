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
} from './firebase'
import { KisSettingsModal, loadKisConfig } from './KisSettings'
import { SearchModal } from './SearchModal'
import { AssetsView } from './AssetsView'
import { OrderView } from './OrderView'
import { fetchPrices, type KisPrice } from './kisApi'
import { KisWebSocket, fetchWsApprovalKey, isNxtHour, isRegularHour, type RealTimeTrade } from './kisWebSocket'
import './App.css'

type TabId = 'assets' | 'watchlist' | 'order'

interface PriceInfo {
  price: string; priceChange: string; priceChangeSign: string; priceChangeRate: string
}

interface StockRow {
  code: string; nameKr: string
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
  }
  const [watchList, setWatchList] = useState<string[][]>([])
  const [watchNames, setWatchNames] = useState<(string | null)[]>([])
  const [stocks, setStocks] = useState<Map<string, StockInfo>>(new Map())
  const [prices, setPrices] = useState<Map<string, KisPrice>>(new Map())
  const [nxtPrices, setNxtPrices] = useState<Map<string, KisPrice>>(new Map())
  const [priceLoading, setPriceLoading] = useState(false)
  const [activeGroup, setActiveGroup] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showKisSettings, setShowKisSettings] = useState(false)
  const closeKisSettings = useCallback(() => setShowKisSettings(false), [])
  const [showSearch, setShowSearch] = useState(false)
  const closeSearch = useCallback(() => setShowSearch(false), [])
  const [wsConnected, setWsConnected] = useState(false)
  const kisWsRef = useRef<KisWebSocket | null>(null)
  const approvalKeyRef = useRef<string>('')
  const watchListRef = useRef<string[][]>([])

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
              initWsWithCodes(key, list[0] ?? [])
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
    setActiveGroup(idx); setPrices(new Map()); setNxtPrices(new Map())
    const codes = [...new Set((watchListRef.current[idx] ?? []).filter(Boolean))]
    if (codes.length === 0) return
    const cfg = loadKisConfig()
    if (!cfg.appKey || !cfg.appSecret) return
    if (kisWsRef.current) {
      kisWsRef.current.unsubscribeAll(); kisWsRef.current.subscribe(codes)
    } else if (approvalKeyRef.current) {
      initWsWithCodes(approvalKeyRef.current, watchListRef.current[idx] ?? [])
    }
    loadGroupPrices(codes)
  }, [])

  const initWsWithCodes = (approvalKey: string, rawCodes: string[]) => {
    kisWsRef.current?.disconnect()
    const codes = [...new Set(rawCodes.filter(Boolean))]
    if (codes.length === 0) return
    const kisWs = new KisWebSocket(
      approvalKey,
      (trade: RealTimeTrade) => {
        const sign = trade.delta > 0 ? '2' : trade.delta < 0 ? '5' : '3'
        const info: KisPrice = {
          price: String(trade.price),
          prevPrice: String(Math.round(trade.price - trade.delta)),
          priceChange: String(Math.abs(trade.delta)),
          priceChangeSign: sign, priceChangeRate: String(Math.abs(trade.rate)),
        }
        if (trade.isNxt) setNxtPrices(prev => new Map(prev).set(trade.code, info))
        else setPrices(prev => new Map(prev).set(trade.code, info))
      },
      setWsConnected
    )
    kisWsRef.current = kisWs; kisWs.connect(); kisWs.subscribe(codes)
  }

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
        code, nameKr: info?.nameKr ?? code, krx,
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

          {showKisSettings && <KisSettingsModal onClose={closeKisSettings} />}
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

            {activeTab === 'assets' && <AssetsView />}

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
                    </div>
                    {currentCodes.length > 0 ? buildRows(watchList[activeGroup] ?? []).map((row) => {
                      const krxChange = formatChange(row.krx?.priceChange ?? '0', row.krx?.priceChangeSign ?? '3', row.krx?.priceChangeRate ?? '0')
                      const nxtChange = row.nxt ? formatChange(row.nxt.priceChange, row.nxt.priceChangeSign, row.nxt.priceChangeRate) : null
                      const showNxt = row.nxt !== null && parseInt(row.nxt.price, 10) > 0
                      return (
                        <div key={row.code} className="stock-row">
                          <span className="col-name">
                            <span className="stock-name">{row.nameKr}</span>
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
                        </div>
                      )
                    }) : <p className="empty">이 그룹에 종목이 없습니다.</p>}
                  </div>
                </div>
              )
            )}

            {activeTab === 'order' && (
              <OrderView stocks={stocks} approvalKey={approvalKeyRef.current} />
            )}
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
