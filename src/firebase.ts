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
import { getDatabase, ref, get } from 'firebase/database'

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
  [key: string]: unknown
}

// stocks/kospi + stocks/kosdaq → Map<code, StockInfo>
export async function loadStocks(): Promise<Map<string, StockInfo>> {
  const snapshot = await get(ref(db, 'stocks'))
  const val = snapshot.val()
  if (!val) return new Map()

  const result = new Map<string, StockInfo>()
  for (const market of ['kospi', 'kosdaq']) {
    const items = val[market] ?? {}
    for (const [code, info] of Object.entries(items)) {
      result.set(code.trim(), info as StockInfo)
    }
  }
  return result
}
