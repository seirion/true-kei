import { useState, useEffect, useRef } from 'react'
import type { StockInfo } from './firebase'
import './SearchModal.css'

interface Props {
  stocks: Map<string, StockInfo>
  onClose: () => void
}

export function SearchModal({ stocks, onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
            results.map(([code, info]) => (
              <div key={code} className="search-item">
                <span className="search-name">{info.nameKr}</span>
                <span className="search-code">{code}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
