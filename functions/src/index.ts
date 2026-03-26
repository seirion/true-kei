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

    try {
      const response = await fetch(
        `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
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
