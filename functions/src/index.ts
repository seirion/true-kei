import { onRequest } from "firebase-functions/v2/https";

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const ALLOWED_ORIGIN = "https://seirion.github.io";

// KIS OAuth 토큰 발급 프록시
export const kisToken = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const { appkey, appsecret } = req.body as {
      appkey?: string;
      appsecret?: string;
    };

    if (!appkey || !appsecret) {
      res.status(400).json({ error: "appkey and appsecret are required" });
      return;
    }

    try {
      const response = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey,
          appsecret,
        }),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      console.error("kisToken error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS WebSocket Approval Key 발급 프록시
export const kisApprovalKey = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const { appkey, appsecret } = req.body as { appkey?: string; appsecret?: string };
    if (!appkey || !appsecret) {
      res.status(400).json({ error: "appkey and appsecret are required" });
      return;
    }
    try {
      const response = await fetch(`${KIS_BASE}/oauth2/Approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey, secretkey: appsecret }),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 주식잔고 조회 프록시 (TTTC8434R)
export const kisBalance = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "GET") { res.status(405).send("Method Not Allowed"); return; }
    const { token, appkey, appsecret, accountNo, fk100 = "", nk100 = "" } =
      req.query as Record<string, string>;
    if (!token || !appkey || !appsecret || !accountNo) {
      res.status(400).json({ error: "token, appkey, appsecret, accountNo required" }); return;
    }
    const normalized = accountNo.replace(/[-\s]/g, "");
    const cano = normalized.slice(0, 8);
    const acntPrdtCd = normalized.slice(8);
    try {
      const params = new URLSearchParams({
        CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
        AFHR_FLPR_YN: "N", OFL_YN: "", INQR_DVSN: "02", UNPR_DVSN: "01",
        FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
        CTX_AREA_FK100: fk100, CTX_AREA_NK100: nk100,
      });
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
        { headers: { Authorization: `Bearer ${token}`, appkey, appsecret, tr_id: "TTTC8434R" } }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 주식 주문 프록시 (매수: TTTC0802U / 매도: TTTC0801U)
export const kisOrder = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }
    const { token, appkey, appsecret, cano, acntPrdtCd, side, PDNO, ORD_DVSN, ORD_QTY, ORD_UNPR } =
      req.body as Record<string, string>;
    if (!token || !appkey || !appsecret || !cano || !acntPrdtCd || !side || !PDNO || !ORD_DVSN || !ORD_QTY) {
      res.status(400).json({ error: "required params missing" }); return;
    }
    const trId = side === "buy" ? "TTTC0802U" : "TTTC0801U";
    try {
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/trading/order-cash`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            appkey, appsecret, tr_id: trId, custtype: "P",
          },
          body: JSON.stringify({
            CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
            PDNO, ORD_DVSN, ORD_QTY, ORD_UNPR: ORD_UNPR ?? "0",
          }),
        }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      console.error("kisOrder error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 매수 가능 조회 프록시 (TTTC8908R)
export const kisInquirePsbl = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "GET") { res.status(405).send("Method Not Allowed"); return; }
    const { token, appkey, appsecret, cano, acntPrdtCd, PDNO, ORD_UNPR, ORD_DVSN } =
      req.query as Record<string, string>;
    if (!token || !appkey || !appsecret || !cano || !acntPrdtCd || !PDNO || !ORD_UNPR) {
      res.status(400).json({ error: "required params missing" }); return;
    }
    try {
      const params = new URLSearchParams({
        CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
        PDNO, ORD_UNPR, ORD_DVSN: ORD_DVSN ?? "00",
        CMA_EVLU_AMT_ICLD_YN: "N", OVRS_ICLD_YN: "N",
      });
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-psbl-order?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            appkey, appsecret, tr_id: "TTTC8908R", custtype: "P",
          },
        }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      console.error("kisInquirePsbl error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 주문 정정 프록시 (TTTC0803U)
export const kisModifyOrder = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }
    const { token, appkey, appsecret, accountNo, orgOdno, ordQty, ordUnpr } =
      req.body as Record<string, string>;
    if (!token || !appkey || !appsecret || !accountNo || !orgOdno) {
      res.status(400).json({ error: "required params missing" }); return;
    }
    const _normalized1 = accountNo.replace(/[-\s]/g, "");
    const cano = _normalized1.slice(0, 8);
    const acntPrdtCd = _normalized1.slice(8);
    try {
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/trading/order-rvsecncl`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            appkey, appsecret, tr_id: "TTTC0803U", custtype: "P",
          },
          body: JSON.stringify({
            CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
            KRX_FWDG_ORD_ORGNO: "",
            ORGN_ODNO: orgOdno,
            ORD_DVSN: ordUnpr && ordUnpr !== "0" ? "00" : "01",
            RVSE_CNCL_DVSN_CD: "01",
            ORD_QTY: ordQty ?? "0",
            ORD_UNPR: ordUnpr ?? "0",
            QTY_ALL_ORD_YN: "Y",
          }),
        }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 당일 주문체결 조회 (TTTC8001R) - ccldDvsn: "00"=전체, "01"=체결, "02"=미체결
export const kisDailyOrder = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "GET") { res.status(405).send("Method Not Allowed"); return; }
    const { token, appkey, appsecret, accountNo, ccldDvsn = "00", fk100 = "", nk100 = "" } =
      req.query as Record<string, string>;
    if (!token || !appkey || !appsecret || !accountNo) {
      res.status(400).json({ error: "required params missing" }); return;
    }
    const _normalized2 = accountNo.replace(/[-\s]/g, "");
    const cano = _normalized2.slice(0, 8);
    const acntPrdtCd = _normalized2.slice(8);
    try {
      const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
        .replace(/\. /g, "").replace(".", "");
      const params = new URLSearchParams({
        CANO: cano, ACNT_PRDT_CD: acntPrdtCd,
        INQR_STRT_DT: today, INQR_END_DT: today,
        SLL_BUY_DVSN_CD: "00", INQR_DVSN: "01",
        PDNO: "", CCLD_DVSN: ccldDvsn,
        ORD_GNO_BRNO: "", ODNO: "", INQR_DVSN_3: "00",
        INQR_DVSN_1: "", CTX_AREA_FK100: fk100, CTX_AREA_NK100: nk100,
      });
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params}`,
        { headers: { Authorization: `Bearer ${token}`, appkey, appsecret, tr_id: "TTTC8001R", custtype: "P" } }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// KIS 현재가 조회 프록시
export const kisPrice = onRequest(
  { region: "asia-northeast3", cors: ALLOWED_ORIGIN, invoker: "public" },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const { code, token, appkey, appsecret } = req.query as Record<string, string>;

    if (!code || !token || !appkey || !appsecret) {
      res.status(400).json({ error: "code, token, appkey, appsecret are required" });
      return;
    }

    const market = (req.query.market as string) || "J"; // J=KRX, NX=NXT

    try {
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=${market}&FID_INPUT_ISCD=${code}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            appkey,
            appsecret,
            tr_id: "FHKST01010100",
            custtype: "P",
          },
        }
      );
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      console.error("kisPrice error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);
