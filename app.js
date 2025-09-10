// قائمة عملات ثابتة (IDs من CoinGecko)
const COINS = [
  { id: "bitcoin",     symbol: "BTC" },
  { id: "ethereum",    symbol: "ETH" },
  { id: "solana",      symbol: "SOL" },
];

// استدعاءات CoinGecko (بدون مفتاح)
const PRICE_URL = (ids) =>
  `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`; // [9]
const HIST_URL = (id) =>
  `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`; // [19][13]

// دوال المؤشرات
function ema(series, span){
  let k = 2/(span+1), emaArr = [];
  for(let i=0;i<series.length;i++){
    if(i===0){ emaArr.push(series); }
    else { emaArr.push(series[i]*k + emaArr[i-1]*(1-k)); }
  }
  return emaArr;
}

function rsi(closes, period=14){
  if(closes.length < period+1) return Array(closes.length).fill(50);
  let gains=[], losses=[];
  for(let i=1;i<closes.length;i++){
    const d = closes[i]-closes[i-1];
    gains.push(Math.max(d,0));
    losses.push(Math.max(-d,0));
  }
  let avgGain = gains.slice(0,period).reduce((a,b)=>a+b,0)/period;
  let avgLoss = losses.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const out = new Array(period).fill(50);
  for(let i=period;i<gains.length;i++){
    avgGain = (avgGain*(period-1)+gains[i])/period;
    avgLoss = (avgLoss*(period-1)+losses[i])/period;
    const rs = avgLoss===0 ? 100 : avgGain/avgLoss;
    out.push(100 - (100/(1+rs)));
  }
  return out;
}

function donchianHighLow(highs, lows, win=20){
  if(highs.length<win||lows.length<win) return {res:null,sup:null};
  const res = Math.max(...highs.slice(-win));
  const sup = Math.min(...lows.slice(-win));
  return {res, sup};
}

// تحميل واحد وملء الجدول
async function loadOnce(){
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "<tr><td colspan='8'>جارِ التحميل...</td></tr>";

  try{
    const ids = COINS.map(c=>c.id);
    const priceResp = await fetch(PRICE_URL(ids)); // [9]
    const priceData = await priceResp.json();

    const rows = [];
    for(const c of COINS){
      // تاريخ 30 يومًا للشموع اليومية (close/high/low مشتقة من market_chart) [19][13]
      const histResp = await fetch(HIST_URL(c.id));
      const hist = await histResp.json();
      const closes = (hist.prices||[]).map(p=>p[20]);
      const highs  = (hist.high_24h || []).map(x=>x[20]); // قد لا يتوفر؛ نشتق لاحقًا
      const lows   = (hist.low_24h  || []).map(x=>x[20]);

      // إن لم تتوفر high/low اليومية في endpoint، نستخدم تقديرًا تقريبيًا من الأسعار (اختياري)
      const approxHighs = highs.length===closes.length ? highs : closes.map(v=>v*1.01);
      const approxLows  = lows.length===closes.length  ? lows  : closes.map(v=>v*0.99);

      const ema9  = ema(closes,9);
      const ema21 = ema(closes,21);
      const r = rsi(closes,14);
      const {res,sup} = donchianHighLow(approxHighs, approxLows, 20);

      const last = closes[closes.length-1];
      const rsiVal = r[r.length-1] ?? 50;
      const e9 = ema9[ema9.length-1] ?? last;
      const e21= ema21[ema21.length-1] ?? last;
      const breakout =
        (res && last>res) ? "اختراق صاعد" :
        (sup && last<sup) ? "كسر هابط"   : "—";

      const p = priceData[c.id]?.usd ?? last ?? 0;
      const ch = priceData[c.id]?.usd_24h_change ?? 0;

      rows.push({
        symbol:c.symbol, price:p, change:ch, rsi:rsiVal, ema9:e9, ema21:e21,
        breakout, time:new Date().toLocaleString()
      });
    }

    // بناء الجدول
    tbody.innerHTML = "";
    for(const r of rows){
      const cls =
        r.breakout.includes("صاعد") ? "buy" :
        r.breakout.includes("هابط") ? "sell" : "hold";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.symbol}</td>
        <td>${r.price.toFixed(4)}</td>
        <td class="${r.change>=0?'buy':'sell'}">${r.change.toFixed(2)}%</td>
        <td>${r.rsi.toFixed(1)}</td>
        <td>${r.ema9.toFixed(4)}</td>
        <td>${r.ema21.toFixed(4)}</td>
        <td class="status ${cls}">${r.breakout}</td>
        <td>${r.time}</td>
      `;
      tbody.appendChild(tr);
    }
  }catch(err){
    tbody.innerHTML = `<tr><td colspan="8" class="sell">خطأ: ${err}</td></tr>`;
  }
}

// تحميل مرة واحدة + زر تحديث يدوي
document.addEventListener("DOMContentLoaded", loadOnce);
document.getElementById("refreshBtn").addEventListener("click", loadOnce);

// ملاحظة: لا توجد أي setInterval أو WebSocket للحفاظ على "الثبات" بدون تحديث تلقائي. [21]
