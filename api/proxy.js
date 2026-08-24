export default async function handler(req, res) {
  const backendUrl = process.env.FABALES_BACKEND_URL;

  if (!backendUrl) {
    return res.status(500).json({ error: "Backend URL is not configured in Vercel ENV." });
  }

  const { path } = req.query;
  const pathString = Array.isArray(path) ? path.join('/') : (path || '');
  
  const targetUrl = `${backendUrl.replace(/\/$/, '')}/api/${pathString}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'X-Bubalinum-Seed': req.headers['x-bubalinum-seed'] || '',
        'X-Bubalinum-Chrono': req.headers['x-bubalinum-chrono'] || '',
        'X-Turnstile-Token': req.headers['x-turnstile-token'] || '',
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Gateway connection error." });
  }
}
