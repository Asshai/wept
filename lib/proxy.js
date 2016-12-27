'use strict'
const parseUrl = require('url').parse
const http = require('http')
const https = require('https')
const axios = require('axios')
const assign = require('object-assign')
const tunnel = require('tunnel')
const config = require('./config')
const cache = require('./cache')
const fs = require('fs')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
const CACHE_DIR = `${process.cwd()}/cache/`

module.exports = function* (context) {
  let url = context.request.header['x-remote'] || context.request.query.url
  if (!url) throw new Error('header X-Remote required')
  const key = Buffer.from(url).toString('base64')
  let conf = yield config()
  const useCache = context.request.query.cache
  if (useCache) {
    let data = cache.get(url)
    if (!data) {
      try {
        data = fs.readFileSync(CACHE_DIR + key, 'utf-8') + ''
      } catch (e) { }
    }
    if (data) {
      console.log('load from cache', url)
      context.status = 200
      context.body = data + ''
      return
    }
  }
  let headers = assign({}, context.header, conf.headers)
  delete headers['x-remote']
  delete headers['host']
  let urlObj = parseUrl(url)
  let port = urlObj.port || (urlObj.protocol == 'https:' ? 443 : 80)
  let isHttps  = /^https/.test(urlObj.protocol)
  let requestClient =  isHttps ? https : http
  let timeout = conf.networkTimeout ? conf.networkTimeout.request : 30000
  timeout = timeout || 30000
  headers['host'] =urlObj.hostname
  let opt = {
    path: urlObj.path,
    protocol: urlObj.protocol,
    host: urlObj.hostname,
    hostname: urlObj.hostname,
    port: port,
    method: context.method.toUpperCase(),
    headers,
    timeout
  }
  if (conf.proxy) {
    let proxyMethod = isHttps ? 'httpsOverHttp' : 'httpOverHttp'
    opt.agent = tunnel[proxyMethod]({proxy: conf.proxy})
  }
  let req = requestClient.request(opt)
  let res = yield pipeRequest(context.req, req)
  for (var name in res.headers) {
      // http://stackoverflow.com/questions/35525715/http-get-parse-error-code-hpe-unexpected-content-length
    if (name === 'transfer-encoding') {
      continue;
    }
    context.set(name, res.headers[name]);
  }
  context.status = res.statusCode
  context.body = res
  if (useCache) {
    const res = yield axios.get(url, {responseType: 'text'})
    cache.set(url, res.data)
    try {
      fs.writeFileSync(CACHE_DIR + key, res.data)
    } catch (e) { console.error(e) }
  }
}

function pipeRequest(readable, request) {
  return function (cb) {
    readable.on('data', buf => {
      request.write(buf)
    })
    readable.on('end', buf => {
      request.end(buf)
    })
    readable.on('error', err => {
      console.error(err.stack)
      request.end()
      cb(err)
    })
    request.on('error', err => {
      cb(err)
    })
    request.on('response', res => {
      cb(null, res)
    })
  }
}
