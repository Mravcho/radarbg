const https = require('https');

exports.handler = async (event) => {
  const { lat, lng, radius, onlyFast } = event.queryStringParameters || {};

  if (!lat || !lng) {
    return { statusCode: 400, body: 'Missing lat/lng' };
  }

  const url = `https://api.openchargemap.io/v3/poi/?output=json`
    + `&latitude=${lat}&longitude=${lng}`
    + `&distance=${radius || 5}&distanceunit=KM`
    + `&maxresults=100&compact=true&verbose=false&countrycode=BG`
    + `&key=e65cde82-2e3f-4d44-842e-a8d3e2fba648`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'RadarBG/1.0',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          let pois = JSON.parse(data);
          if (onlyFast === 'true') {
            pois = pois.filter(poi => {
              const maxKw = Math.max(0, ...(poi.Connections || []).map(c => c.PowerKW || 0));
              return maxKw >= 50;
            });
          }
          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(pois),
          });
        } catch(e) {
          resolve({ statusCode: 500, body: JSON.stringify({ error: 'parse error' }) });
        }
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
