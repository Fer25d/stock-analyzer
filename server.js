const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── CORS: permite cualquier origen (tu archivo HTML local o en la web) ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Headers comunes para imitar un browser ──
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control':   'no-cache',
};

// ────────────────────────────────────────────
// /api/quote?sym=AAPL
// Precio + cambio % de un ticker (Yahoo Finance)
// ────────────────────────────────────────────
app.get('/api/quote', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const r   = await fetch(url, { headers: BROWSER_HEADERS });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const meta = result.meta || {};
    const lc   = meta.regularMarketPrice || meta.chartPreviousClose;
    const pc   = meta.previousClose      || meta.chartPreviousClose;
    const pch  = lc && pc ? ((lc - pc) / pc) * 100 : 0;
    res.json({ lc, pch, name: meta.shortName || sym });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────
// /api/candles?sym=AAPL&range=6mo&interval=1d
// Velas OHLCV (Yahoo Finance)
// ────────────────────────────────────────────
app.get('/api/candles', async (req, res) => {
  const { sym, range = '6mo', interval = '1d' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
    const r    = await fetch(url, { headers: BROWSER_HEADERS });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const ts = result.timestamp;
    const q  = result.indicators.quote[0];
    const meta = result.meta || {};
    const candles = ts.map((t, i) => ({
      time:   t,
      open:   q.open[i],
      high:   q.high[i],
      low:    q.low[i],
      close:  q.close[i],
      volume: q.volume[i],
    })).filter(c => c.open && c.high && c.low && c.close);
    res.json({
      candles,
      name:    meta.shortName || sym,
      currency: meta.currency || 'USD',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────
// /api/finviz?sym=AAPL
// Fundamentals scraping de Finviz
// ────────────────────────────────────────────
app.get('/api/finviz', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const url = `https://finviz.com/quote.ashx?t=${sym}&ty=c&ta=1&p=d`;
    const r   = await fetch(url, {
      headers: { ...BROWSER_HEADERS, 'Referer': 'https://finviz.com/' }
    });
    const html = await r.text();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────
// /api/news?sym=AAPL
// Noticias RSS de Yahoo Finance
// ────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`;
    const r   = await fetch(url, { headers: BROWSER_HEADERS });
    const xml = await r.text();
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────
// /api/indices
// Todos los índices de una sola llamada
// ────────────────────────────────────────────
const INDICES_SYMS = [
  { sym: '%5EGSPC',   label: 'S&P 500' },
  { sym: '%5EIXIC',   label: 'Nasdaq' },
  { sym: '%5EDJI',    label: 'Dow Jones' },
  { sym: '%5ERUT',    label: 'Russell 2000' },
  { sym: '%5EVIX',    label: 'VIX' },
  { sym: '%5EGDAXI',  label: 'DAX' },
  { sym: 'GC%3DF',    label: 'Oro' },
  { sym: 'CL%3DF',    label: 'Petróleo WTI' },
  { sym: 'DX-Y.NYB',  label: 'USD Index' },
  { sym: '%5ETNX',    label: '10Y Treasury' },
  { sym: 'BTC-USD',   label: 'Bitcoin' },
  { sym: '%5EN225',   label: 'Nikkei 225' },
  { sym: '%5EKS11',   label: 'KOSPI (Corea)' },
  { sym: '000001.SS', label: 'Shanghai (China)' },
];

app.get('/api/indices', async (req, res) => {
  try {
    const results = await Promise.all(INDICES_SYMS.map(async idx => {
      try {
        const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${idx.sym}?interval=1d&range=5d`;
        const r    = await fetch(url, { headers: BROWSER_HEADERS });
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        const meta = result.meta || {};
        let lc = meta.regularMarketPrice || meta.chartPreviousClose;
        let pc = meta.previousClose      || meta.chartPreviousClose;
        if (!lc || !pc) {
          const closes = result.indicators.quote[0].close.filter(Boolean);
          if (closes.length < 2) return null;
          lc = closes[closes.length - 1];
          pc = closes[closes.length - 2];
        }
        const pch = ((lc - pc) / pc) * 100;
        return { label: idx.label, lc, pch };
      } catch { return null; }
    }));
    res.json(results.filter(Boolean));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────
// /api/proxy?url=...
// Proxy genérico para cualquier URL
// ────────────────────────────────────────────
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const r    = await fetch(decodeURIComponent(url), { headers: BROWSER_HEADERS });
    const text = await r.text();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Stock Proxy' }));

app.listen(PORT, () => console.log(`Stock Proxy corriendo en puerto ${PORT}`));
