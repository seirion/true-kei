import { loadKisConfig } from './KisSettings'

const KIS_BASE = 'https://openapi.koreainvestment.com:9443'
const KIS_TOKEN_PROXY = 'https://kistoken-ncgnzcdzqa-du.a.run.app'
const TOKEN_STORAGE_KEY = 'kis_token'

interface TokenCache {
  accessToken: string
  expiresAt: number // ms
}

function loadTokenCache(): TokenCache | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as TokenCache
  } catch {}
  return null
}

function saveTokenCache(token: string, expiresInSec: number) {
  const cache: TokenCache = {
    accessToken: token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000, // 1분 여유
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(cache))
}

async function getAccessToken(): Promise<string> {
  // 캐시된 토큰이 유효하면 재사용
  const cache = loadTokenCache()
  if (cache && Date.now() < cache.expiresAt) {
    return cache.accessToken
  }

  const config = loadKisConfig()
  if (!config.appKey || !config.appSecret) {
    throw new Error('KIS API 설정이 없습니다. ⚙️ 버튼을 눌러 설정해주세요.')
  }

  const res = await fetch(`${KIS_TOKEN_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appkey: config.appKey,
      appsecret: config.appSecret,
    }),
  })

  if (!res.ok) throw new Error(`토큰 발급 실패: ${res.status}`)
  const data = await res.json()
  const token = data.access_token as string
  const expiresIn = (data.expires_in as number) ?? 86400
  saveTokenCache(token, expiresIn)
  return token
}

export interface KisPrice {
  price: string        // stck_prpr 현재가
  priceChange: string  // prdy_vrss 전일 대비
  priceChangeSign: string // 1:상한 2:상승 3:보합 4:하한 5:하락
  priceChangeRate: string // prdy_ctrt 등락률
}

export async function fetchPrice(code: string, token: string): Promise<KisPrice | null> {
  const config = loadKisConfig()
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        appkey: config.appKey,
        appsecret: config.appSecret,
        tr_id: 'FHKST01010100',
        custtype: 'P',
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  if (data.rt_cd !== '0') return null
  const o = data.output
  return {
    price: o.stck_prpr,
    priceChange: o.prdy_vrss,
    priceChangeSign: o.prdy_vrss_sign,
    priceChangeRate: o.prdy_ctrt,
  }
}

// 여러 종목 현재가를 순차 조회 (API 부하 방지용 딜레이 포함)
export async function fetchPrices(
  codes: string[],
  onProgress?: (code: string, price: KisPrice | null) => void
): Promise<Map<string, KisPrice>> {
  const token = await getAccessToken()
  const result = new Map<string, KisPrice>()

  for (const code of codes) {
    try {
      const price = await fetchPrice(code, token)
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
