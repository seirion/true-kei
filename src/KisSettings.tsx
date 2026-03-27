import { useState, useEffect } from 'react'
import './KisSettings.css'

export interface KisConfig {
  name: string
  accountNo: string
  userId: string
  appKey: string
  appSecret: string
}

const ACCOUNTS_KEY = 'kis_accounts'
const ACTIVE_KEY = 'kis_active_account'

export function loadAllAccounts(): KisConfig[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (raw) return JSON.parse(raw) as KisConfig[]
  } catch {}
  // 구버전 단일 설정 마이그레이션
  try {
    const legacy = localStorage.getItem('kis_config')
    if (legacy) {
      const parsed = JSON.parse(legacy) as Omit<KisConfig, 'name'>
      if (parsed.appKey) {
        const migrated: KisConfig = { name: '기본 계정', ...parsed }
        saveAllAccounts([migrated])
        localStorage.removeItem('kis_config')
        return [migrated]
      }
    }
  } catch {}
  return []
}

export function saveAllAccounts(accounts: KisConfig[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function loadActiveAccountName(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? ''
}

export function saveActiveAccountName(name: string) {
  localStorage.setItem(ACTIVE_KEY, name)
  // 계정 전환 시 토큰 캐시 무효화
  localStorage.removeItem('kis_token')
}

export function loadKisConfig(): KisConfig {
  const accounts = loadAllAccounts()
  if (accounts.length === 0) return { name: '', accountNo: '', userId: '', appKey: '', appSecret: '' }
  const activeName = loadActiveAccountName()
  return accounts.find((a) => a.name === activeName) ?? accounts[0]
}

const EMPTY_CONFIG: KisConfig = { name: '', accountNo: '', userId: '', appKey: '', appSecret: '' }

interface Props {
  onClose: () => void
  onAccountChange?: () => void
}

export function KisSettingsModal({ onClose, onAccountChange }: Props) {
  const [accounts, setAccounts] = useState<KisConfig[]>(loadAllAccounts)
  const [activeName, setActiveName] = useState<string>(loadActiveAccountName)
  // editing: null = 목록, string = 편집 중인 계정 name ('' = 신규)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<KisConfig>(EMPTY_CONFIG)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { editing !== null ? setEditing(null) : onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing])

  const setField = (key: keyof KisConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const openNew = () => {
    setForm(EMPTY_CONFIG)
    setEditing('')
  }

  const openEdit = (acc: KisConfig) => {
    setForm({ ...acc })
    setEditing(acc.name)
  }

  const handleSaveForm = () => {
    const trimmed = { ...form, name: form.name.trim() }
    if (!trimmed.name) return alert('계정 이름을 입력해 주세요.')
    if (!trimmed.appKey || !trimmed.appSecret) return alert('App Key와 App Secret을 입력해 주세요.')

    let updated: KisConfig[]
    if (editing === '') {
      // 신규
      if (accounts.some((a) => a.name === trimmed.name)) return alert('이미 같은 이름의 계정이 있습니다.')
      updated = [...accounts, trimmed]
    } else {
      // 수정 (이름이 바뀔 수 있음)
      if (trimmed.name !== editing && accounts.some((a) => a.name === trimmed.name)) {
        return alert('이미 같은 이름의 계정이 있습니다.')
      }
      updated = accounts.map((a) => (a.name === editing ? trimmed : a))
      // activeName이 수정된 계정이었으면 새 이름으로 갱신
      if (activeName === editing) {
        setActiveName(trimmed.name)
        saveActiveAccountName(trimmed.name)
      }
    }
    saveAllAccounts(updated)
    setAccounts(updated)
    setEditing(null)
  }

  const handleDelete = (name: string) => {
    if (!confirm(`"${name}" 계정을 삭제할까요?`)) return
    const updated = accounts.filter((a) => a.name !== name)
    saveAllAccounts(updated)
    setAccounts(updated)
    if (activeName === name) {
      const next = updated[0]?.name ?? ''
      setActiveName(next)
      saveActiveAccountName(next)
    }
    if (editing === name) setEditing(null)
  }

  const handleActivate = (name: string) => {
    setActiveName(name)
    saveActiveAccountName(name)
    onAccountChange?.()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={editing !== null ? undefined : onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editing !== null ? (editing === '' ? '계정 추가' : '계정 편집') : 'KIS 계정 관리'}</h2>
          <button className="modal-close" onClick={editing !== null ? () => setEditing(null) : onClose}>✕</button>
        </div>

        {editing !== null ? (
          /* ─── 폼 화면 ─── */
          <>
            <div className="modal-body">
              <p className="modal-note">입력한 정보는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>

              <label>계정 이름 *</label>
              <input type="text" placeholder="예) 내 계좌" value={form.name} onChange={setField('name')} />

              <label>계좌번호</label>
              <input type="text" placeholder="예) 00000000-01" value={form.accountNo} onChange={setField('accountNo')} />

              <label>사용자 ID</label>
              <input type="text" placeholder="KIS 사용자 ID" value={form.userId} onChange={setField('userId')} />

              <label>App Key *</label>
              <input type="text" placeholder="App Key" value={form.appKey} onChange={setField('appKey')} />

              <label>App Secret *</label>
              <input type="password" placeholder="App Secret" value={form.appSecret} onChange={setField('appSecret')} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-cancel" onClick={() => setEditing(null)}>취소</button>
              <button className="btn btn-save" onClick={handleSaveForm}>저장</button>
            </div>
          </>
        ) : (
          /* ─── 목록 화면 ─── */
          <>
            <div className="modal-body account-list-body">
              {accounts.length === 0 ? (
                <p className="empty-accounts">등록된 계정이 없습니다.</p>
              ) : (
                <ul className="account-list">
                  {accounts.map((acc) => (
                    <li key={acc.name} className={`account-item ${acc.name === activeName ? 'account-active' : ''}`}>
                      <div className="account-info" onClick={() => handleActivate(acc.name)}>
                        <span className="account-name">{acc.name}</span>
                        <span className="account-sub">{acc.accountNo || acc.userId || acc.appKey.slice(0, 8) + '…'}</span>
                        {acc.name === activeName && <span className="account-badge">사용 중</span>}
                      </div>
                      <div className="account-actions">
                        <button className="btn-icon-sm" onClick={() => openEdit(acc)} title="편집">✏️</button>
                        <button className="btn-icon-sm btn-danger" onClick={() => handleDelete(acc.name)} title="삭제">🗑️</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-cancel" onClick={onClose}>닫기</button>
              <button className="btn btn-save" onClick={openNew}>+ 계정 추가</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
