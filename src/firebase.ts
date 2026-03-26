import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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

export function signInWithGoogle() {
  return signInWithPopup(auth, provider)
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

  // Array 형식
  if (Array.isArray(val)) {
    return val.map((g) => (Array.isArray(g) ? g : []))
  }

  // Map 형식 (이전 버전 호환)
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
