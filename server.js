const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const BH = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// /api/proxy?url=...  GET o POST
app.all('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const target = decodeURIComponent(url);
    const isPost = req.method === 'POST';
    const opts = { method: isPost ? 'POST' : 'GET', headers: { ...BH, 'Content-Type': 'application/json' } };
    if (isPost && req.body && Object.keys(req.body).length) opts.body = JSON.stringify(req.body);
    const r = await fetch(target, opts);
    const text = await r.text();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/quote?sym=AAPL
app.get('/api/quote', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { headers: BH });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const meta = result.meta || {};
    const lc = meta.regularMarketPrice || meta.chartPreviousClose;
    const pc = meta.previousClose || meta.chartPreviousClose;
    res.json({ lc, pch: lc && pc ? ((lc-pc)/pc)*100 : 0, name: meta.shortName || sym });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/candles?sym=AAPL&range=6mo
app.get('/api/candles', async (req, res) => {
  const { sym, range='6mo', interval='1d' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: BH });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    const ts = result.timestamp, q = result.indicators.quote[0], meta = result.meta||{};
    const candles = ts.map((t,i)=>({time:t,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume[i]})).filter(c=>c.open&&c.close);
    res.json({ candles, name: meta.shortName||sym });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/finviz?sym=AAPL
app.get('/api/finviz', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const r = await fetch(`https://finviz.com/quote.ashx?t=${sym}&ty=c&ta=1&p=d`, { headers: { ...BH, 'Referer':'https://finviz.com/' } });
    const html = await r.text();
    res.setHeader('Content-Type','text/html');
    res.send(html);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/news?sym=AAPL
app.get('/api/news', async (req, res) => {
  const { sym } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym requerido' });
  try {
    const r = await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`, { headers: BH });
    const xml = await r.text();
    res.setHeader('Content-Type','application/xml');
    res.send(xml);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/indices  — TradingView primero, Yahoo fallback
const TV_INDICES = [
  {tv:'FOREXCOM:SPXUSD',yf:'%5EGSPC',label:'S&P 500'},
  {tv:'FOREXCOM:NSXUSD',yf:'%5ENDX',label:'Nasdaq 100'},
  {tv:'FOREXCOM:DJI',yf:'%5EDJI',label:'Dow Jones'},
  {tv:'INDEX:RUT',yf:'%5ERUT',label:'Russell 2000'},
  {tv:'CBOE:VIX',yf:'%5EVIX',label:'VIX'},
  {tv:'XETR:DAX',yf:'%5EGDAXI',label:'DAX'},
  {tv:'TVC:GOLD',yf:'GC%3DF',label:'Oro'},
  {tv:'TVC:USOIL',yf:'CL%3DF',label:'Petróleo WTI'},
  {tv:'TVC:DXY',yf:'DX-Y.NYB',label:'USD Index'},
  {tv:'TVC:US10Y',yf:'%5ETNX',label:'10Y Treasury'},
  {tv:'BINANCE:BTCUSDT',yf:'BTC-USD',label:'Bitcoin'},
  {tv:'TVC:NI225',yf:'%5EN225',label:'Nikkei 225'},
  {tv:'INDEX:KOSPI',yf:'%5EKS11',label:'KOSPI (Corea)'},
  {tv:'SSE:000001',yf:'000001.SS',label:'Shanghai (China)'},
];

app.get('/api/indices', async (req, res) => {
  try {
    const tvResp = await fetch('https://scanner.tradingview.com/global/scan', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({symbols:{tickers:TV_INDICES.map(i=>i.tv)},columns:['close','change_abs','change']})
    });
    if (tvResp.ok) {
      const tvData = await tvResp.json();
      const map = {};
      (tvData.data||[]).forEach(r=>{if(r.s&&r.d)map[r.s]=r.d;});
      const valid = TV_INDICES.map(idx=>{const d=map[idx.tv];if(!d||d[0]==null)return null;return{label:idx.label,lc:d[0],pch:d[2]||0};}).filter(Boolean);
      if (valid.length >= TV_INDICES.length * 0.7) return res.json(valid);
    }
  } catch {}
  try {
    const results = await Promise.all(TV_INDICES.map(async idx => {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${idx.yf}?interval=1d&range=5d`,{headers:BH});
        const data = await r.json();
        const result = data?.chart?.result?.[0]; if(!result) return null;
        const meta = result.meta||{};
        let lc=meta.regularMarketPrice||meta.chartPreviousClose;
        let pc=meta.previousClose||meta.chartPreviousClose;
        if(!lc||!pc){const closes=result.indicators.quote[0].close.filter(Boolean);if(closes.length<2)return null;lc=closes[closes.length-1];pc=closes[closes.length-2];}
        return {label:idx.label,lc,pch:((lc-pc)/pc)*100};
      } catch {return null;}
    }));
    res.json(results.filter(Boolean));
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/', (req,res)=>res.json({status:'ok',service:'Stock Analyzer Proxy',endpoints:['/api/proxy','/api/quote','/api/candles','/api/finviz','/api/news','/api/indices']}));

app.listen(PORT, ()=>console.log(`Stock Proxy en puerto ${PORT}`));
