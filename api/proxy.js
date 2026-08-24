export default async function handler(req, res) {
  // Ambil URL backend dari Vercel Environment Variables
  const backendUrl = process.env.FABALES_BACKEND_URL;

  if (!backendUrl) {
    return res.status(500).json({ error: "FABALES_BACKEND_URL is missing in Vercel ENV." });
  }

  // Parse path & query string
  const { path } = req.query;
  const pathString = Array.isArray(path) ? path.join('/') : (path || '');
  
  // Bersihkan URL target
  const cleanBackendUrl = backendUrl.trim().replace(/\/$/, '');
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `${cleanBackendUrl}/api/${pathString}${queryString}`;

  try {
    // Siapkan header forwarding
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'X-Bubalinum-Seed': req.headers['x-bubalinum-seed'] || '',
      'X-Bubalinum-Chrono': req.headers['x-bubalinum-chrono'] || '',
      'X-Turnstile-Token': req.headers['x-turnstile-token'] || '',
      'Origin': req.headers['origin'] || 'https://nimedesu.vercel.app',
      'Referer': req.headers['referer'] || 'https://nimedesu.vercel.app/',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
    };

    // Siapkan opsi fetch
    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // Sertakan body HANYA untuk method yang membawa payload
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
    console.error("Vercel Proxy Error:", error);
    return res.status(502).json({ 
      error: "Gateway Connection Error", 
      details: error.message,
      target: targetUrl 
    });
  }
}
