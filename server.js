'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const app     = express();

const PORT = process.env.PORT || 3000;

// ── CRÍTICO para Render: confiar en el proxy inverso ────────
// Sin esto, express-rate-limit tira ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

// ── CORS: solo tu dominio ───────────────────────────────────
const ALLOWED = [
  'https://stockanalyzerpro.com.ar',
  'https://www.stockanalyzerpro.com.ar',
  'http://localhost',
  'http://127.0.0.1',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('CORS bloqueado: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json({ limit: '1mb' }));
app.options('*', cors());

// ── Headers de browser para pasar filtros ──────────────────
const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
  'Cache-Control':   'no-cache',
};

const fetchTimeout = (url, opts = {}, ms = 12000) => {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
};

// ═══════════════════════════════════════════════════════════
// GET /health
// ═══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.1.0' });
});

// ═══════════════════════════════════════════════════════════
// GET /api/yahoo?sym=SPY&interval=1d&range=6mo
// ═══════════════════════════════════════════════════════════
app.get('/api/yahoo', async (req, res) => {
  const { sym, interval = '1d', range = '6mo' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });

  const validIntervals = ['1m','5m','15m','30m','1h','4h','1d','1wk','1mo'];
  const validRanges    = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','max'];
  const iv = validIntervals.includes(interval) ? interval : '1d';
  const rn = validRanges.includes(range)       ? range    : '6mo';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${rn}`;
  try {
    const r    = await fetchTimeout(url, { headers: HEADERS });
    const data = await r.json();
    return res.json(data);
  } catch {
    try {
      const r2   = await fetchTimeout(url.replace('query1','query2'), { headers: HEADERS });
      const data = await r2.json();
      return res.json(data);
    } catch (e) {
      return res.status(502).json({ error: 'Yahoo no responde', detail: e.message });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/scanner  body: { url, body }
// ═══════════════════════════════════════════════════════════
const ALLOWED_TV = [
  'https://scanner.tradingview.com/america/scan',
  'https://scanner.tradingview.com/global/scan',
  'https://scanner.tradingview.com/crypto/scan',
];

app.post('/api/scanner', async (req, res) => {
  const input  = req.body || {};
  let tvUrl    = input.url  || 'https://scanner.tradingview.com/america/scan';
  let bodyData = input.body || input;

  // Si vino el body del scanner directamente (tiene 'symbols')
  if (input.symbols) {
    tvUrl    = 'https://scanner.tradingview.com/america/scan';
    bodyData = input;
  }

  if (!ALLOWED_TV.includes(tvUrl)) {
    return res.status(400).json({ error: 'URL TV no permitida' });
  }

  const bodyStr = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
  if (!bodyStr || bodyStr === '{}') {
    return res.status(400).json({ error: 'Body vacío' });
  }

  try {
    const r = await fetchTimeout(tvUrl, {
      method:  'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'Origin':        'https://www.tradingview.com',
        'Referer':       'https://www.tradingview.com/',
      },
      body: bodyStr,
    });
    const data = await r.json();
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: 'TradingView no responde', detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/finviz?sym=AAPL
// ═══════════════════════════════════════════════════════════
app.get('/api/finviz', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });

  const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(sym)}&ty=c&ta=1&p=d`;
  try {
    const r    = await fetchTimeout(url, { headers: { ...HEADERS, Referer: 'https://finviz.com/' } });
    const html = await r.text();
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (e) {
    return res.status(502).json({ error: 'Finviz no responde', detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/news?sym=AAPL&source=yahoo
// ═══════════════════════════════════════════════════════════
const RSS = {
  yahoo:        s => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${s}&region=US&lang=en-US`,
  seekingalpha: s => `https://seekingalpha.com/api/sa/combined/${s}.xml`,
  cnbc:         () => 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
  bloomberg:    () => 'https://feeds.bloomberg.com/markets/news.rss',
  reuters:      () => 'https://feeds.reuters.com/reuters/businessNews',
  investing:    () => 'https://www.investing.com/rss/news.rss',
  investopedia: () => 'https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline',
  bitfinanzas:  () => 'https://bitfinanzas.com/feed/',
};

app.get('/api/news', async (req, res) => {
  const { sym = '', source = 'yahoo' } = req.query;
  const fn  = RSS[source];
  if (!fn) return res.status(400).json({ error: 'Fuente inválida' });

  const url = fn(sym);
  if (!url) return res.status(400).json({ error: 'sym requerido para esta fuente' });

  try {
    const r   = await fetchTimeout(url, { headers: HEADERS });
    const xml = await r.text();
    res.setHeader('Content-Type', 'application/xml');
    return res.send(xml);
  } catch (e) {
    return res.status(502).json({ error: 'RSS no responde', detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// Iniciar
// ═══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ StockPro backend en puerto ${PORT}`);
  console.log(`   /health → ok`);
});
