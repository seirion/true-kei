/**
 * KIS 종목 마스터 파일 다운로드 & 파싱
 *
 * URL: https://new.real.download.dws.co.kr/common/master/{exchange}_code.mst.zip
 * 인코딩: CP949 (TextDecoder 'euc-kr' 사용)
 * 마스터 파일 업로드 시각 (HHMM): [600, 655, 735, 755, 845, 946, 1055, 1710, 1730, 1755, 1810, 1830, 1855]
 *
 * 파싱 규칙 (project 프로젝트 StockInfo.kt 참고):
 *   code     = str[0..8].trim()        (9자)
 *   nameKr   = str[21..len-ATTR_LEN].trim()
 *   attrs    = str.takeLast(ATTR_LEN)
 *
 * KOSPI  ATTRIBUTES_LEN = 227
 * KOSDAQ ATTRIBUTES_LEN = 221
 */

import type { StockInfo } from './firebase'

const MASTER_BASE = 'https://new.real.download.dws.co.kr/common/master'
const IDB_NAME = 'kei-master'
const IDB_STORE = 'stocks'
const IDB_KEY = 'data'

/** 마스터 파일이 업로드되는 시각 (HHMM 정수) */
const UPLOAD_TIMES = [600, 655, 735, 755, 845, 946, 1055, 1710, 1730, 1755, 1810, 1830, 1855]

interface MasterCache {
  timestamp: number         // Date.now() ms
  lastModified: string      // HTTP Last-Modified 헤더값
  data: Record<string, { nameKr: string; prevPrice: string; halt: boolean; designated: boolean }>
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readCache(): Promise<MasterCache | null> {
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve((req.result as MasterCache) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function writeCache(cache: MasterCache): Promise<void> {
  try {
    const db = await openIDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(cache, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) { console.warn('[master] IDB write failed:', e) }
}

/** 현재 시각 기준 가장 최근 업로드 시각 이후에 캐시가 만들어졌으면 유효 */
function isCacheValid(cache: MasterCache): boolean {
  const now = new Date()
  const cached = new Date(cache.timestamp)
  const todayHHMM = now.getHours() * 100 + now.getMinutes()

  // 가장 최근 업로드 시각 찾기
  const lastUpload = [...UPLOAD_TIMES].reverse().find(t => t <= todayHHMM) ?? 0
  const validFrom = new Date(now)

  if (lastUpload === 0) {
    // 아직 첫 업로드 전 → 전날 마지막 업로드(1855) 이후 캐시가 유효
    validFrom.setDate(validFrom.getDate() - 1)
    validFrom.setHours(18, 55, 0, 0)
  } else {
    const hh = Math.floor(lastUpload / 100)
    const mm = lastUpload % 100
    validFrom.setHours(hh, mm, 0, 0)
  }

  return cached >= validFrom
}

// CP949 디코딩: TextDecoder 'euc-kr' 사용
function decodeCP949(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('euc-kr').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

/** ZIP을 ArrayBuffer로 받아 첫 번째 파일을 읽음 (fflate 없이 직접 파싱) */
async function unzipFirst(buf: ArrayBuffer): Promise<ArrayBuffer> {
  // ZIP Local File Header: signature 0x04034b50
  const view = new DataView(buf)
  const sig = view.getUint32(0, true)
  if (sig !== 0x04034b50) throw new Error('Not a ZIP file')

  const fnLen = view.getUint16(26, true)
  const extraLen = view.getUint16(28, true)
  const dataOffset = 30 + fnLen + extraLen
  const compSize = view.getUint32(18, true)
  const uncompSize = view.getUint32(22, true)
  const method = view.getUint16(8, true)

  const compressedData = buf.slice(dataOffset, dataOffset + compSize)

  if (method === 0) {
    // Store (no compression)
    return compressedData
  } else if (method === 8) {
    // Deflate
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    writer.write(new Uint8Array(compressedData))
    writer.close()
    const chunks: Uint8Array[] = []
    const reader = ds.readable.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const result = new Uint8Array(uncompSize)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return result.buffer
  }
  throw new Error(`Unsupported ZIP method: ${method}`)
}

function parseKospi(line: string): { code: string; nameKr: string; halt: boolean; designated: boolean; prevPrice: string } | null {
  const ATTR_LEN = 227
  if (line.length < 21 + ATTR_LEN) return null
  const code = line.substring(0, 9).trim()
  if (!code) return null
  const nameKr = line.substring(21, line.length - ATTR_LEN).trim()
  const attrs = line.slice(-ATTR_LEN)
  // fieldSpecs indices for 거래정지(33=61..62) 관리종목(35=62..63)
  // From project: fieldSpecs[33]=61, [34]=62 (거래정지), fieldSpecs[35]=62, [36]=63 (관리종목)
  // 직접 offset: 거래정지=61, 관리종목=62 (각 1자)
  const halt = attrs.substring(61, 62) === 'Y'
  const designated = attrs.substring(62, 63) === 'Y'
  const prevPrice = attrs.substring(26, 31).trim() // 기준가 fieldSpecs[31]=26, [32]=31 (5자)
  return { code, nameKr, halt, designated, prevPrice }
}

function parseKosdaq(line: string): { code: string; nameKr: string; halt: boolean; designated: boolean; prevPrice: string } | null {
  const ATTR_LEN = 221
  if (line.length < 21 + ATTR_LEN) return null
  const code = line.substring(0, 9).trim()
  if (!code) return null
  const nameKr = line.substring(21, line.length - ATTR_LEN).trim()
  const attrs = line.slice(-ATTR_LEN)
  // 거래정지 여부: fieldSpecs[29]=55, [30]=56 (1자)
  // 관리 종목 여부: fieldSpecs[31]=57, [32]=58 (1자)
  const halt = attrs.substring(55, 56) === 'Y'
  const designated = attrs.substring(57, 58) === 'Y'
  const prevPrice = attrs.substring(26, 31).trim() // 주식 기준가 fieldSpecs[26]=26, [27]=31
  return { code, nameKr, halt, designated, prevPrice }
}

async function downloadAndParse(exchange: 'kospi' | 'kosdaq'): Promise<Record<string, { nameKr: string; prevPrice: string; halt: boolean; designated: boolean }>> {
  const url = `${MASTER_BASE}/${exchange}_code.mst.zip`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`마스터 파일 다운로드 실패: ${res.status}`)

  const lastModified = res.headers.get('last-modified') ?? ''
  const zipBuf = await res.arrayBuffer()
  const mstBuf = await unzipFirst(zipBuf)
  const text = decodeCP949(mstBuf)
  const lines = text.split('\n')

  const result: Record<string, { nameKr: string; prevPrice: string; halt: boolean; designated: boolean }> = {}
  const parser = exchange === 'kospi' ? parseKospi : parseKosdaq
  for (const line of lines) {
    const parsed = parser(line)
    if (parsed) result[parsed.code] = { nameKr: parsed.nameKr, prevPrice: parsed.prevPrice, halt: parsed.halt, designated: parsed.designated }
  }
  console.log(`[master] ${exchange} parsed: ${Object.keys(result).length} stocks, lastModified: ${lastModified}`)
  return result
}

/** 마스터 파일 로드 (캐시 우선, 필요 시 다운로드) */
export async function loadStocksFromMaster(): Promise<Map<string, StockInfo>> {
  const cache = await readCache()

  if (cache && isCacheValid(cache)) {
    console.log('[master] cache hit', new Date(cache.timestamp).toLocaleTimeString())
    return cacheToMap(cache.data)
  }

  console.log('[master] downloading master files...')
  try {
    const [kospi, kosdaq] = await Promise.all([
      downloadAndParse('kospi'),
      downloadAndParse('kosdaq'),
    ])
    const merged = { ...kospi, ...kosdaq }
    await writeCache({ timestamp: Date.now(), lastModified: '', data: merged })
    return cacheToMap(merged)
  } catch (e) {
    console.error('[master] download failed, using cache if available:', e)
    if (cache) return cacheToMap(cache.data)
    throw e
  }
}

function cacheToMap(data: MasterCache['data']): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>()
  for (const [code, info] of Object.entries(data)) {
    map.set(code, {
      nameKr: info.nameKr,
      prevPrice: info.prevPrice,
      _halt: info.halt,
      _designated: info.designated,
    } as StockInfo)
  }
  return map
}
