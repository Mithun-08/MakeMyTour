class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

function sendError(res, error) {
  if (error instanceof HttpError) {
    const errorBody = {
      code: error.code,
      message: error.message
    };
    if (error.details) {
      errorBody.details = error.details;
    }
    return sendJson(res, error.status, {
      success: false,
      error: errorBody
    });
  }

  console.error('[Internal Error]', error);
  return sendJson(res, 500, {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    }
  });
}

function parseJsonBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let receivedBytes = 0;

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        req.destroy();
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeded 1MB limit'));
        return;
      }
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw || raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          reject(new HttpError(400, 'BAD_REQUEST', 'JSON payload must be an object'));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new HttpError(400, 'BAD_REQUEST', 'Malformed JSON payload'));
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  const parts = header.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function serializeCookie(name, val, options = {}) {
  const encVal = encodeURIComponent(val);
  const parts = [`${name}=${encVal}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

module.exports = {
  HttpError,
  sendJson,
  sendError,
  parseJsonBody,
  parseCookies,
  serializeCookie
};
