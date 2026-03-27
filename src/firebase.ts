import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { getDatabase, ref, get, set } from 'firebase/database'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getDatabase(app, import.meta.env.VITE_FIREBASE_DATABASE_URL)
const provider = new GoogleAuthProvider()

export { auth, provider }

export async function signInWithGoogle() {
  try {
    // 팝업 먼저 시도
    return await signInWithPopup(auth, provider)
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    // 팝업 차단 등 팝업 불가 시 리디렉트로 폴백
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
      return signInWithRedirect(auth, provider)
    }
    throw e
  }
}

export function getGoogleRedirectResult() {
  return getRedirectResult(auth)
}

export function signOutUser() {
  return signOut(auth)
}

export function onAuthChanged(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

export type { User }

const MAX_GROUP_SIZE = 10

// users/{uid}/watch 저장
export async function saveWatchList(uid: string, list: string[][]): Promise<void> {
  await set(ref(db, `users/${uid}/watch`), list)
}

// users/{uid}/watch — List<List<String>> 또는 Map<string, string[]>
export async function loadWatchList(uid: string): Promise<string[][]> {
  const snapshot = await get(ref(db, `users/${uid}/watch`))
  const val = snapshot.val()
  if (!val) return Array(MAX_GROUP_SIZE).fill([])

  if (Array.isArray(val)) {
    return val.map((g) => (Array.isArray(g) ? g : []))
  }
  if (typeof val === 'object') {
    return Array.from({ length: MAX_GROUP_SIZE }, (_, i) => val[String(i)] ?? [])
  }
  return Array(MAX_GROUP_SIZE).fill([])
}

// users/{uid}/watch-names — Map<string, string>
export async function loadWatchNames(uid: string): Promise<(string | null)[]> {
  const snapshot = await get(ref(db, `users/${uid}/watch-names`))
  const val = snapshot.val()
  if (!val || typeof val !== 'object') return Array(MAX_GROUP_SIZE).fill(null)
  return Array.from({ length: MAX_GROUP_SIZE }, (_, i) => val[String(i)] ?? null)
}

export interface StockInfo {
  nameKr: string
  prevPrice: string
  _halt?: boolean       // 마스터 파일 파싱 결과
  _designated?: boolean // 마스터 파일 파싱 결과
  attributes?: Record<string, string>  // Firebase 레거시
  [key: string]: unknown
}

export function isHalt(info: StockInfo): boolean {
  if (info._halt !== undefined) return info._halt
  const attrs = info.attributes as Record<string, string> | undefined
  if (!attrs) return false
  return attrs['거래정지'] === 'Y' || attrs['거래정지 여부'] === 'Y'
}

export function isDesignated(info: StockInfo): boolean {
  if (info._designated !== undefined) return info._designated
  const attrs = info.attributes as Record<string, string> | undefined
  if (!attrs) return false
  return attrs['관리종목'] === 'Y' || attrs['관리 종목 여부'] === 'Y'
}

// ── IndexedDB 캐시: stocks 데이터를 로컬에 저장 ──────────────────────────
const IDB_NAME = 'kei-cache'
const IDB_STORE = 'stocks'
const IDB_KEY = 'data'

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

interface StocksCache {
  timestamp: number
  data: Record<string, StockInfo>
}

async function readIDBCache(): Promise<StocksCache | null> {
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve((req.result as StocksCache) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function writeIDBCache(data: Record<string, StockInfo>): Promise<void> {
  try {
    const db = await openIDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put({ timestamp: Date.now(), data }, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) { console.warn('IDB write failed:', e) }
}

/** 오전 8시 / 오후 4시 이후가 됐는지 확인해 캐시 신선도 판단 */
function isStocksCacheValid(timestamp: number): boolean {
  const now = new Date()
  const cached = new Date(timestamp)

  // 오늘 08:00 / 16:00
  const t8 = new Date(now); t8.setHours(8, 0, 0, 0)
  const t16 = new Date(now); t16.setHours(16, 0, 0, 0)

  // 현재 시각이 속하는 "유효 구간" 시작점
  let validFrom: Date
  if (now >= t16) validFrom = t16         // 16:00 이후 → 16:00 이후 갱신된 것만 유효
  else if (now >= t8) validFrom = t8      // 08:00~16:00 → 08:00 이후 갱신된 것만 유효
  else {
    // 자정~08:00 → 전날 16:00 이후 갱신된 것만 유효
    validFrom = new Date(t16); validFrom.setDate(validFrom.getDate() - 1)
  }

  return cached >= validFrom
}

// stocks/kospi + stocks/kosdaq → Map<code, StockInfo>  (캐시 우선)
export async function loadStocks(): Promise<Map<string, StockInfo>> {
  // 1. 캐시 확인
  const cache = await readIDBCache()
  if (cache && isStocksCacheValid(cache.timestamp)) {
    console.log('[stocks] cache hit', new Date(cache.timestamp).toLocaleTimeString())
    const result = new Map<string, StockInfo>()
    for (const [code, info] of Object.entries(cache.data)) result.set(code, info)
    return result
  }

  // 2. Firebase에서 fetch
  console.log('[stocks] cache miss → fetching from Firebase')
  const snapshot = await get(ref(db, 'stocks'))
  const val = snapshot.val()
  if (!val) return new Map()

  const flat: Record<string, StockInfo> = {}
  const result = new Map<string, StockInfo>()
  for (const market of ['kospi', 'kosdaq']) {
    const items = val[market] ?? {}
    for (const [code, info] of Object.entries(items)) {
      const key = code.trim()
      flat[key] = info as StockInfo
      result.set(key, info as StockInfo)
    }
  }

  // 3. 캐시에 저장
  await writeIDBCache(flat)
  return result
}
