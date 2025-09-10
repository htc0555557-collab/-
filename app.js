// قائمة العملات (CoinGecko IDs)
const COINS = [
  { id: "bitcoin",  symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana",   symbol: "SOL" },
];

// CoinGecko: سعر لحظي وتغيّر 24س
const PRICE_URL = (ids) =>
  `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`; // وثائق simple/price
// CoinGecko: تاريخ يومي 60 يوم (يضم prices: [timestamp, price])
const HIST_URL = (id) =>
  `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=60&interval=daily`; // coins/{id}/market_chart daily
// ملاحظة: interval=daily موصوف في الوثائق الرسمية ويكفي لحساب RSI وEMA من الإغلاقات اليومية [4]

// دوال المؤشرات
function ema(series, span) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const k = 2 / (span + 1);
  const out = [];
  for (let i = 0; i < series.length; i++) {
    if (i === 0) out.push(series);
    else out.push(series[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return Array(Math.max(closes?.length ?? 0, 0)).fill(50);
  }
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  // متوسطات أولية بسيطة
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const out = new Array(period).fill(50);
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
    const value = 100 - 100 / (1 + rs);
    out.push(value);
  }
  return out;
}

function formatPercent(x) {
  if (typeof x !== "number" || !isFinite(x)) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(2)}%`;
}

async function loadOnce() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "<tr><td colspan='8'>جارِ التحميل...</td></tr>";

  try {
    // جلب السعر الحالي وتغير 24س
    const ids = COINS.map((c) => c.id);
    const priceResp = await fetch(PRICE_URL(ids));
    const priceData = await priceResp.json(); // يشمل usd و usd_24h_change [4]

    const rows = [];
    for (const c of COINS) {
      // جلب تاريخ يومي 60 يومًا
      const histResp = await fetch(HIST_URL(c.id));
      const hist = await histResp.json(); // يحتوي prices: [[ts, price], ...] [4]

      const closes = (hist?.prices ?? [])
        .map((p) => Array.isArray(p) ? p[22] : NaN)
        .filter(Number.isFinite);

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

      // دونشيان تقريبي على الإغلاقات فقط
      const win = 20;
      const segment = closes.slice(-win);
      const res = Math.max(...segment);
      const sup = Math.min(...segment);
      const breakout =
        last > res ? "اختراق صاعد" : last < sup ? "كسر هابط" : "—";

      // دمج السعر الفوري ونسبة 24س
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

    // رسم الجدول
    tbody.innerHTML = "";
    for (const r of rows) {
      const cls =
        r.breakout.includes("صاعد") ? "buy" :
        r.breakout.includes("هابط") ? "sell" : "hold";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.symbol}</td>
        <td>${isFinite(r.price) ? r.price.toFixed(4) : "—"}</td>
        <td class="${r.change >= 0 ? "buy" : "sell"}">${formatPercent(r.change)}</td>
        <td>${isFinite(r.rsi) ? r.rsi.toFixed(1) : "—"}</td>
        <td>${isFinite(r.ema9) ? r.ema9.toFixed(4) : "—"}</td>
        <td>${isFinite(r.ema21) ? r.ema21.toFixed(4) : "—"}</td>
        <td class="status ${cls}">${r.breakout}</td>
        <td>${r.time}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="sell">خطأ: ${String(err)}</td></tr>`;
  }
}

// تحميل مرة واحدة + زر تحديث يدوي
document.addEventListener("DOMContentLoaded", loadOnce);
document.getElementById("refreshBtn").addEventListener("click", loadOnce);

// ملاحظة: لا setInterval ولا WebSocket للحفاظ على “الصفحة ثابتة” بدون تحديث تلقائي.
