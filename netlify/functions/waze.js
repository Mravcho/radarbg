const https = require('https');

exports.handler = async (event) => {
  const { lat, lng, radius } = event.queryStringParameters || {};
  
  if (!lat || !lng) {
    return { statusCode: 400, body: 'Missing lat/lng' };
  }

  const box = 0.016 * ((parseFloat(radius) || 5) + 1);
  const url = `https://www.waze.com/row-rtserver/web/TGeoRSS?tk=community&format=JSON`
    + `&left=${parseFloat(lng)-box*1.5}&right=${parseFloat(lng)+box*1.5}`
    + `&bottom=${parseFloat(lat)-box}&top=${parseFloat(lat)+box}`
    + `&ma=200&mj=200&mu=200&types=alerts,jams`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.waze.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: data,
        });
      });
    });
    req.on('error', (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ statusCode: 504, body: JSON.stringify({ error: 'timeout' }) });
    });
  });
};
