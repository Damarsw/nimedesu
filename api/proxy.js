export default async function handler(req, res) {
  const backendUrl = process.env.FABALES_BACKEND_URL;

  if (!backendUrl) {
    return res.status(500).json({ error: "Missing" });
  }

  const { path } = req.query;
  const pathString = Array.isArray(path) ? path.join('/') : (path || '');
  
  const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `${cleanBackendUrl}/api/${pathString}${queryString}`;

  try {
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'X-Bubalinum-Seed': req.headers['x-bubalinum-seed'] || '',
      'X-Bubalinum-Chrono': req.headers['x-bubalinum-chrono'] || '',
      'X-Turnstile-Token': req.headers['x-turnstile-token'] || '',
      'Origin': 'https://nimedesu.vercel.app',
      'Referer': 'https://nimedesu.vercel.app/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase()) && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const textData = await response.text();
      return res.status(response.status).send(textData);
    }

  } catch (error) {
    return res.status(502).json({ 
      error: "Gateway Connection Error", 
      details: error.message,
      target: targetUrl
    });
  }
}
