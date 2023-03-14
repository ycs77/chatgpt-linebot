const { createHmac } = require('crypto')

const BASE64_REPLACE = { '+': '-', '/': '_', '=': '' }

function urlsafe(string) {
  return string.replace(/[+/=]/g, c => BASE64_REPLACE[c]);
}

function sign(data) {
  const encoded = createHmac('sha256', process.env.APP_KEY).update(data).digest('base64')
  return urlsafe(encoded)
}

function verify(data, signed) {
  return signed === sign(data)
}

module.exports = { sign, verify, urlsafe }
