import { loadKisConfig } from './KisSettings'

const WORKER_BASE = 'https://kis-proxy.seirion.workers.dev'
const KIS_PRICE_PROXY = `${WORKER_BASE}/price`
const KIS_TOKEN_PROXY = `${WORKER_BASE}/token`
const TOKEN_STORAGE_PREFIX = 'kis_token_'

interface TokenCache {
  accessToken: string
  expiresAt: number // ms
}

function tokenKey(appKey: string): string {
  // appKey 앞 12자로 식별 (충분히 고유)
  return TOKEN_STORAGE_PREFIX + appKey.slice(0, 12)
}

function loadTokenCache(appKey: string): TokenCache | null {
  try {
    const raw = localStorage.getItem(tokenKey(appKey))
    if (raw) return JSON.parse(raw) as TokenCache
  } catch {}
  return null
}

function saveTokenCache(appKey: string, token: string, expiresInSec: number) {
  const cache: TokenCache = {
    accessToken: token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000,
  }
  localStorage.setItem(tokenKey(appKey), JSON.stringify(cache))
}

export async function getAccessToken(): Promise<string> {
  const config = loadKisConfig()
  if (!config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다. ⚙️ 버튼을 눌러 설정해주세요.')
  }

  // 계정별 캐시 확인
  const cache = loadTokenCache(config.appKey)
  if (cache && Date.now() < cache.expiresAt) {
    return cache.accessToken
  }

  const res = await fetch(`${KIS_TOKEN_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appkey: config.appKey,
      appsecret: config.appSecret,
    }),
  })

  if (!res.ok) {
    throw new Error(`토큰 발급 실패: ${res.status}`)
  }
  const data = await res.json()
  if (!data.access_token) {
    throw new Error(data.error_description ?? '토큰 발급 실패')
  }
  const token = data.access_token as string
  const expiresIn = (data.expires_in as number) ?? 86400
  saveTokenCache(config.appKey, token, expiresIn)
  return token
}

export interface KisPrice {
  price: string           // stck_prpr 현재가
  prevPrice: string       // stck_sdpr 전일종가
  priceChange: string     // prdy_vrss 전일 대비 (절댓값)
  priceChangeSign: string // 1:상한 2:상승 3:보합 4:하한 5:하락
  priceChangeRate: string // prdy_ctrt 등락률
  openPrice?: string      // stck_oprc 시가
  highPrice?: string      // stck_hgpr 고가
  lowPrice?: string       // stck_lwpr 저가
  volume?: string         // acml_vol 누적거래량
}

export async function fetchPrice(code: string, token: string, market = 'J'): Promise<KisPrice | null> {
  const config = loadKisConfig()
  const params = new URLSearchParams({
    code,
    token,
    appkey: config.appKey,
    appsecret: config.appSecret,
    market,
  })
  const res = await fetch(`${KIS_PRICE_PROXY}?${params}`)
  if (!res.ok) {
    console.error(`fetchPrice ${code} HTTP ${res.status}`)
    return null
  }
  const data = await res.json()
  if (data.rt_cd !== '0') {
    console.error(`fetchPrice ${code} rt_cd=${data.rt_cd} msg=${data.msg1}`)
    return null
  }
  const o = data.output
  return {
    price: o.stck_prpr,
    prevPrice: o.stck_sdpr,
    priceChange: o.prdy_vrss,
    priceChangeSign: o.prdy_vrss_sign,
    priceChangeRate: o.prdy_ctrt,
    openPrice: o.stck_oprc,
    highPrice: o.stck_hgpr,
    lowPrice: o.stck_lwpr,
    volume: o.acml_vol,
  }
}

// 여러 종목 현재가를 순차 조회 (API 부하 방지용 딜레이 포함)
export async function fetchPrices(
  codes: string[],
  onProgress?: (code: string, price: KisPrice | null) => void,
  market = 'J'
): Promise<Map<string, KisPrice>> {
  const token = await getAccessToken()
  const result = new Map<string, KisPrice>()

  for (const code of codes) {
    try {
      const price = await fetchPrice(code, token, market)
      if (price) {
        result.set(code, price)
        onProgress?.(code, price)
      }
    } catch (e) {
      console.warn(`fetchPrice failed for ${code}:`, e)
      onProgress?.(code, null)
    }
    // KIS API rate limit 대응: 초당 20건 이하
    await new Promise((r) => setTimeout(r, 60))
  }

  return result
}
