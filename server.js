const express = require('express');
const fetch = require('node-fetch');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ──── CONFIG ────────────────────────────────────────────────────
const CONFIG = {
  CACHE_TTL: parseInt(process.env.CACHE_TTL || '10000'),
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT || '8000'),
};

// ──── MIDDLEWARE ────────────────────────────────────────────────
app.use(compression());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Rate limiting (exento para indices y quote)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/api/indices' || req.path === '/api/quote'
});
app.use('/api/', limiter);

// ──── HEADERS ────────────────────────────────────────────────────
const BH = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// ──── UTILITIES ─────────────────────────────────────────────────
const fetchWithTimeout = async (url, options = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
};

const validateSymbol = (s) => s && /^[A-Z0-9.\-\^%=]{1,20}$/i.test(s);

// ──── /api/proxy ────────────────────────────────────────────────
app.all('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const target = decodeURIComponent(url);
    const isPost = req.method === 'POST';
    const opts = {
      method: isPost ? 'POST' : 'GET',
      headers: { ...BH, 'Content-Type': 'application/json' },
    };
    if (isPost && req.body && Object.keys(req.body).length)
      opts.body = JSON.stringify(req.body);
    const r = await fetchWithTimeout(target, opts);
    const text = await r.text();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──── INDICES ────────────────────────────────────────────────────
const TV_INDICES = [
  // USA
  { tv: 'FOREXCOM:SPXUSD', yf: '%5EGSPC', label: 'S&P 500' },
  { tv: 'FOREXCOM:NSXUSD', yf: '%5EIXIC', label: 'Nasdaq Composite' },
  { tv: 'FOREXCOM:DJI', yf: '%5EDJI', label: 'Dow Jones' },
  { tv: 'INDEX:RUT', yf: '%5ERUT', label: 'Russell 2000' },
  { tv: 'CBOE:VIX', yf: '%5EVIX', label: 'VIX' },
  { tv: 'NASDAQ:NDX', yf: '%5ENDX', label: 'Nasdaq 100' },
  { tv: 'TVC:US10Y', yf: '%5ETNX', label: '10Y Treasury' },
  // Europa
  { tv: 'XETR:DAX', yf: '%5EGDAXI', label: 'DAX (Alemania)' },
  { tv: 'EURONEXT:CAC40', yf: '%5EFCHI', label: 'CAC 40 (Francia)' },
  { tv: 'LSE:UKX', yf: '%5EFTSE', label: 'FTSE 100 (UK)' },
  { tv: 'EURONEXT:AEX', yf: '%5EAEX', label: 'AEX (Países Bajos)' },
  { tv: 'SIX:SMI', yf: '%5ESSMI', label: 'SMI (Suiza)' },
  { tv: 'EURONEXT:BEL20', yf: '%5EBFX', label: 'BEL 20 (Bélgica)' },
  // Asia
  { tv: 'TVC:NI225', yf: '%5EN225', label: 'Nikkei 225 (Japón)' },
  { tv: 'INDEX:KOSPI', yf: '%5EKS11', label: 'KOSPI (Corea)' },
  { tv: 'SSE:000001', yf: '000001.SS', label: 'Shanghai (China)' },
  { tv: 'HKEX:HSI', yf: '%5EHSI', label: 'Hang Seng (Hong Kong)' },
  { tv: 'ASX:XJO', yf: '%5EAXJO', label: 'ASX 200 (Australia)' },
  { tv: 'NSE:NIFTY50', yf: '%5EGSPC', label: 'Nifty 50 (India)' },
  // Commodities
  { tv: 'TVC:GOLD', yf: 'GC%3DF', label: 'Oro' },
  { tv: 'TVC:SILVER', yf: 'SI%3DF', label: 'Plata' },
  { tv: 'TVC:USOIL', yf: 'CL%3DF', label: 'Petróleo WTI' },
  { tv: 'TVC:UKOIL', yf: 'BZ%3DF', label: 'Brent' },
  { tv: 'TVC:NATGAS', yf: 'NG%3DF', label: 'Gas Natural' },
  { tv: 'TVC:COPPER', yf: 'HG%3DF', label: 'Cobre' },
  // Forex
  { tv: 'TVC:DXY', yf: 'DX-Y.NYB', label: 'USD Index' },
  { tv: 'FX:EURUSD', yf: 'EURUSD%3DX', label: 'EUR/USD' },
  { tv: 'FX:GBPUSD', yf: 'GBPUSD%3DX', label: 'GBP/USD' },
  { tv: 'FX:USDJPY', yf: 'USDJPY%3DX', label: 'USD/JPY' },
  { tv: 'FX:USDCAD', yf: 'USDCAD%3DX', label: 'USD/CAD' },
  // Cripto
  { tv: 'BINANCE:BTCUSDT', yf: 'BTC-USD', label: 'Bitcoin' },
  { tv: 'BINANCE:ETHUSDT', yf: 'ETH-USD', label: 'Ethereum' },
  { tv: 'BINANCE:SOLUSDT', yf: 'SOL-USD', label: 'Solana' },
  { tv: 'BINANCE:BNBUSDT', yf: 'BNB-USD', label: 'BNB' },
  { tv: 'BINANCE:XRPUSDT', yf: 'XRP-USD', label: 'XRP' },
  { tv: 'BINANCE:ADAUSDT', yf: 'ADA-USD', label: 'Cardano' },
  { tv: 'BINANCE:DOGEUSDT', yf: 'DOGE-USD', label: 'Dogecoin' },
];

let _idxCache = null;
let _idxCacheTime = 0;

async function fetchTVIndices() {
  const r = await fetchWithTimeout('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: { tickers: TV_INDICES.map(i => i.tv) },
      columns: ['close', 'change_abs', 'change']
    })
  });
  if (!r.ok) throw new Error('TV Scanner error ' + r.status);
  const data = await r.json();
  const map = {};
  (data.data || []).forEach(row => { if (row.s && row.d) map[row.s] = row.d; });
  const valid = TV_INDICES.map(idx => {
    const d = map[idx.tv];
    if (!d || d[0] == null) return null;
    return { label: idx.label, lc: d[0], pch: d[2] || 0, src: 'tv' };
  }).filter(Boolean);
  if (valid.length < TV_INDICES.length * 0.3) throw new Error('TV: datos insuficientes');
  return valid;
}

async function fetchYFIndices() {
  const results = await Promise.allSettled(TV_INDICES.map(async idx => {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${idx.yf}?interval=1d&range=5d`,
      { headers: BH }
    );
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    let lc = meta.regularMarketPrice || meta.chartPreviousClose;
    let pc = meta.previousClose || meta.chartPreviousClose;
    if (!lc || !pc) {
      const closes = result.indicators.quote[0].close.filter(Boolean);
      if (closes.length < 2) return null;
      lc = closes[closes.length - 1];
      pc = closes[closes.length - 2];
    }
    return { label: idx.label, lc, pch: ((lc - pc) / pc) * 100, src: 'yf' };
  }));
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

app.get('/api/indices', async (req, res) => {
  try {
    const now = Date.now();
    if (_idxCache && (now - _idxCacheTime) < CONFIG.CACHE_TTL) {
      return res.json(_idxCache);
    }
    // Try TV Scanner first
    try {
      const data = await fetchTVIndices();
      _idxCache = data;
      _idxCacheTime = now;
      return res.json(data);
    } catch (tvErr) {
      console.log('TV Scanner falló, usando Yahoo:', tvErr.message);
    }
    // Fallback Yahoo
    const data = await fetchYFIndices();
    _idxCache = data;
    _idxCacheTime = now;
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// ──── /api/quote ────────────────────────────────────────────────
app.get('/api/quote', async (req, res) => {
  const { sym } = req.query;
  if (!sym || !validateSymbol(sym)) return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.toUpperCase())}?interval=1d&range=5d`,
      { headers: BH }
    );
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const meta = result.meta || {};
    const lc = meta.regularMarketPrice || meta.chartPreviousClose;
    const pc = meta.previousClose || meta.chartPreviousClose;
    res.json({
      ticker: sym.toUpperCase(),
      lc,
      pch: lc && pc ? ((lc - pc) / pc) * 100 : 0,
      name: meta.shortName || sym,
      currency: meta.currency || 'USD'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──── /api/candles ──────────────────────────────────────────────
app.get('/api/candles', async (req, res) => {
  const { sym, range = '6mo', interval = '1d' } = req.query;
  if (!sym || !validateSymbol(sym)) return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.toUpperCase())}?interval=${interval}&range=${range}`,
      { headers: BH }
    );
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const ts = result.timestamp, q = result.indicators.quote[0], meta = result.meta || {};
    const candles = ts.map((t, i) => ({
      time: t, open: q.open[i], high: q.high[i],
      low: q.low[i], close: q.close[i], volume: q.volume[i]
    })).filter(c => c.open && c.close);
    res.json({
      ticker: sym.toUpperCase(),
      candles,
      name: meta.shortName || sym,
      range,
      interval
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──── /api/finviz ───────────────────────────────────────────────
app.get('/api/finviz', async (req, res) => {
  const { sym } = req.query;
  if (!sym || !validateSymbol(sym)) return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const r = await fetchWithTimeout(
      `https://finviz.com/quote.ashx?t=${sym.toUpperCase()}&ty=c&ta=1&p=d`,
      { headers: { ...BH, 'Referer': 'https://finviz.com/' } }
    );
    const html = await r.text();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──── /api/news ─────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  const { sym } = req.query;
  if (!sym || !validateSymbol(sym)) return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const r = await fetchWithTimeout(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym.toUpperCase()}&region=US&lang=en-US`,
      { headers: BH }
    );
    const xml = await r.text();
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'ok',
  service: 'Stock Analyzer Proxy',
  version: '2.0.0',
  env: NODE_ENV,
  endpoints: ['/api/indices', '/api/quote', '/api/candles', '/api/finviz', '/api/news', '/api/proxy']
}));

// ──── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () =>
  console.log(`✅ Stock Analyzer Proxy v2.0 corriendo en puerto ${PORT} [${NODE_ENV}]`)
);

module.exports = app;
