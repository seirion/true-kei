import { useState, useEffect } from 'react'
import './KisSettings.css'

export interface KisConfig {
  accountNo: string
  userId: string
  appKey: string
  appSecret: string
}

const STORAGE_KEY = 'kis_config'

export function loadKisConfig(): KisConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as KisConfig
  } catch {}
  return { accountNo: '', userId: '', appKey: '', appSecret: '' }
}

export function saveKisConfig(config: KisConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

interface Props {
  onClose: () => void
}

export function KisSettingsModal({ onClose }: Props) {
  const [config, setConfig] = useState<KisConfig>(loadKisConfig)

  const set = (key: keyof KisConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSave = () => {
    saveKisConfig(config)
    onClose()
  }

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>KIS API 설정</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-note">입력한 정보는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>

          <label>계좌번호</label>
          <input
            type="text"
            placeholder="예) 64369441-01"
            value={config.accountNo}
            onChange={set('accountNo')}
          />

          <label>사용자 ID</label>
          <input
            type="text"
            placeholder="KIS 사용자 ID"
            value={config.userId}
            onChange={set('userId')}
          />

          <label>App Key</label>
          <input
            type="text"
            placeholder="App Key"
            value={config.appKey}
            onChange={set('appKey')}
          />

          <label>App Secret</label>
          <input
            type="password"
            placeholder="App Secret"
            value={config.appSecret}
            onChange={set('appSecret')}
          />
        </div>

        <div className="modal-footer">
          <button className="btn btn-cancel" onClick={onClose}>취소</button>
          <button className="btn btn-save" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  )
}
