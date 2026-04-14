# Firebase → Cloudflare Workers 마이그레이션

## 배포 방법

```bash
cd workers
npm install
npm run deploy
```

배포 후 Worker URL이 출력됩니다 (예: `https://kis-proxy.YOUR_SUBDOMAIN.workers.dev`)

## 프론트엔드 URL 업데이트

`src/kisApi.ts` 와 `src/kisWebSocket.ts` 에서 URL을 교체하세요:

### kisApi.ts

```ts
// Before
const KIS_PRICE_PROXY = 'https://asia-northeast3-true-project-9bd97.cloudfunctions.net/kisPrice'
const KIS_TOKEN_PROXY = 'https://kistoken-ncgnzcdzqa-du.a.run.app'

// After
const WORKER_BASE = 'https://kis-proxy.YOUR_SUBDOMAIN.workers.dev'
const KIS_PRICE_PROXY = `${WORKER_BASE}/price`
const KIS_TOKEN_PROXY = `${WORKER_BASE}/token`
```

### kisBalance.ts / kisOrder.ts / kisDailyOrder.ts

각 파일의 Firebase URL을 아래 패턴으로 교체:

| Firebase Function        | Worker 엔드포인트            |
|--------------------------|------------------------------|
| `/kisToken`              | `WORKER_BASE/token`          |
| `/kisApprovalKey`        | `WORKER_BASE/approval-key`   |
| `/kisPrice`              | `WORKER_BASE/price`          |
| `/kisBalance`            | `WORKER_BASE/balance`        |
| `/kisOrder`              | `WORKER_BASE/order`          |
| `/kisInquirePsbl`        | `WORKER_BASE/inquire-psbl`   |
| `/kisModifyOrder`        | `WORKER_BASE/modify-order`   |
| `/kisDailyOrder`         | `WORKER_BASE/daily-order`    |

### kisWebSocket.ts

```ts
// Before
const WS_PROXY_URL = 'wss://kis-ws-proxy-ncgnzcdzqa-du.a.run.app'

// After
const WS_PROXY_URL = 'wss://kis-proxy.YOUR_SUBDOMAIN.workers.dev/ws'
```

## KIS WebSocket 포트 관련

기존 `ws-proxy`는 `ws://ops.koreainvestment.com:21000` (plain ws, 비표준 포트)을 사용했습니다.
Cloudflare Workers에서는 `wss://` 만 지원되므로 `wss://ops.koreainvestment.com:31000` 으로 연결합니다.

KIS가 wss 포트를 제공하지 않는 경우, Worker의 WebSocket 프록시 대신
기존 Cloud Run 컨테이너(`ws-proxy`)를 유지하는 것을 권장합니다.
