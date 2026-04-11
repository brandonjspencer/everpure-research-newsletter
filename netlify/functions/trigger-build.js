const https = require('https');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(body)
  };
}

function postJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const expected = process.env.REFRESH_TRIGGER_SECRET || '';
  const supplied = (event.queryStringParameters || {}).secret || (event.headers || {})['x-refresh-secret'] || '';
  if (!expected) {
    return json(500, { error: 'missing_refresh_secret_configuration' });
  }
  if (supplied !== expected) {
    return json(401, { error: 'unauthorized' });
  }
  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK_URL || '';
  if (!buildHookUrl) {
    return json(500, { error: 'missing_build_hook_url' });
  }
  try {
    const response = await postJson(buildHookUrl);
    return json(200, {
      ok: true,
      triggered: true,
      upstream_status: response.statusCode,
      upstream_body: response.body
    });
  } catch (error) {
    return json(500, { error: 'trigger_failed', message: String(error) });
  }
};
