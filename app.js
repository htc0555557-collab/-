// =======================
// إعدادات وقوائم
// =======================
const COINS = [
  { id: "bitcoin",  symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana",   symbol: "SOL" },
];

// CoinGecko: سعر وتغير 24س
const PRICE_URL = (ids) =>
  `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`; // simple/price [مرجع]

// CoinGecko: تاريخ يومي 90 يومًا (prices: [ts, price])
const HIST_URL = (id) =>
  `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90&interval=daily`; // coins/{id}/market_chart daily [1]

// =======================
// دوال مساعدة
// =======================
async function fetchJson(url, { retries = 1, waitMs = 700 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        return await r.json();
      }
    } catch (e) { /* تجاهل ثم أعد المحاولة */ }
    if (i < retries) {
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }
  throw new Error("تعذر جلب البيانات من الخدمة");
}

function ema(series, span) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const k = 2 / (span + 1);
  const out = [];
  for (let i = 0; i < series.length; i++) {
    out[i] = i === 0 ? series : series[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsi(closes, period = 14) {
  const n = closes?.length ?? 0;
  if (n < period + 1) return Array(n).fill(50);
  const gains = [], losses = [];
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period).fill(50);
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

function formatPercent(x) {
  if (!Number.isFinite(x)) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(2)}%`;
}

// =======================
// التشغيل اليدوي مرة واحدة
// =======================
async function loadOnce() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "<tr><td colspan='8'>جارِ التحميل...</td></tr>";

  try {
    // 1) السعر اللحظي وتغير 24س
    const ids = COINS.map((c) => c.id);
    const priceData = await fetchJson(PRICE_URL(ids)); // simple/price [1]

    const rows = [];
    // 2) لكل عملة: تاريخ يومي + مؤشرات
    for (const c of COINS) {
      // جلب التاريخ مع إعادة محاولة واحدة إن لزم
      let hist = await fetchJson(HIST_URL(c.id), { retries: 1, waitMs: 800 }); // [1]
      let closes = (hist?.prices ?? [])
        .map((p) => Array.isArray(p) ? p[22] : NaN)
        .filter(Number.isFinite);

      // محاولة إضافية إذا أقل من 30 إغلاقًا (لـ RSI14 و EMA21)
      if (closes.length < 30) {
        await new Promise((res) => setTimeout(res, 800));
        hist = await fetchJson(HIST_URL(c.id), { retries: 0 });
        closes = (hist?.prices ?? [])
          .map((p) => Array.isArray(p) ? p[22] : NaN)
          .filter(Number.isFinite);
      }

      if (closes.length < 30) {
        throw new Error(`بيانات غير كافية لحساب المؤشرات لـ ${c.symbol}`);
      }

      // حساب المؤشرات من الإغلاقات
      const ema9Arr = ema(closes, 9);
      const ema21Arr = ema(closes, 21);
      const rsiArr = rsi(closes, 14);

      const last = closes[closes.length - 1];
      const e9 = ema9Arr[ema9Arr.length - 1];
      const e21 = ema21Arr[ema21Arr.length - 1];
      const rsiVal = rsiArr[rsiArr.length - 1];

      // دونشيان تقريبي على الإغلاقات (آخر 20)
      const seg = closes.slice(-20);
      const res = Math.max(...seg);
      const sup = Math.min(...seg);
      const breakout = last > res ? "اختراق صاعد" : last < sup ? "كسر هابط" : "—";

      // دمج السعر الفوري
      const pNow = priceData?.[c.id]?.usd ?? last ?? 0;
      const ch24 = priceData?.[c.id]?.usd_24h_change ?? 0;

      rows.push({
        symbol: c.symbol,
        price: pNow,
        change: ch24,
        rsi: rsiVal,
        ema9: e9,
        ema21: e21,
        breakout,
        time: new Date().toLocaleString(),
      });
    }

    // 3) بناء الجدول
    tbody.innerHTML = "";
    for (const r of rows) {
      const cls =
        r.breakout.includes("صاعد") ? "buy" :
        r.breakout.includes("هابط") ? "sell" : "hold";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.symbol}</td>
        <td>${Number.isFinite(r.price) ? r.price.toFixed(4) : "—"}</td>
        <td class="${r.change >= 0 ? "buy" : "sell"}">${formatPercent(r.change)}</td>
        <td>${Number.isFinite(r.rsi) ? r.rsi.toFixed(1) : "—"}</td>
        <td>${Number.isFinite(r.ema9) ? r.ema9.toFixed(4) : "—"}</td>
        <td>${Number.isFinite(r.ema21) ? r.ema21.toFixed(4) : "—"}</td>
        <td class="status ${cls}">${r.breakout}</td>
        <td>${r.time}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    document.getElementById("tbody").innerHTML =
      `<tr><td colspan="8" class="sell">خطأ: ${msg}</td></tr>`;
  }
}

// تشغيل مرة واحدة + زر تحديث يدوي
document.addEventListener("DOMContentLoaded", loadOnce);
document.getElementById("refreshBtn").addEventListener("click", loadOnce);

// ملاحظة: لا يوجد setInterval ولا WebSocket للحفاظ على صفحة ثابتة بدون تحديث تلقائي.
