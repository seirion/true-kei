import { useState, useEffect, useRef } from 'react'
import type { StockInfo } from './firebase'
import './SearchModal.css'

interface Props {
  stocks: Map<string, StockInfo>
  watchList: string[][]
  activeGroup: number
  uid: string
  onWatchListChange: (newList: string[][]) => void
  onClose: () => void
}

export function SearchModal({ stocks, watchList, activeGroup, uid, onWatchListChange, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const currentGroup = watchList[activeGroup] ?? []
  const isInGroup = (code: string) => currentGroup.includes(code)

  const handleToggle = async (code: string) => {
    setSaving(code)
    try {
      const { saveWatchList } = await import('./firebase')
      const newList = watchList.map((g, i) => {
        if (i !== activeGroup) return g
        return isInGroup(code)
          ? g.filter(c => c !== code)
          : [...g, code]
      })
      await saveWatchList(uid, newList)
      onWatchListChange(newList)
    } catch (e) {
      console.error('watchList save failed:', e)
    } finally {
      setSaving(null)
    }
  }

  const q = query.trim().toLowerCase()
  const results = q.length < 1 ? [] : [...stocks.entries()]
    .filter(([code, info]) =>
      code.toLowerCase().includes(q) || info.nameKr.toLowerCase().includes(q)
    )
    .slice(0, 50)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="종목명 또는 코드 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="search-results">
          {q.length < 1 ? (
            <p className="search-hint">종목명 또는 코드를 입력하세요</p>
          ) : results.length === 0 ? (
            <p className="search-hint">검색 결과가 없습니다</p>
          ) : (
            results.map(([code, info]) => {
              const on = isInGroup(code)
              const isSaving = saving === code
              return (
                <div key={code} className="search-item">
                  <span className="search-name">{info.nameKr}</span>
                  <span className="search-code">{code}</span>
                  <button
                    className={`fav-btn ${on ? 'fav-on' : 'fav-off'}`}
                    onClick={() => handleToggle(code)}
                    disabled={isSaving}
                    title={on ? '관심 종목 제거' : '관심 종목 추가'}
                  >
                    {isSaving ? '…' : on ? '★' : '☆'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
