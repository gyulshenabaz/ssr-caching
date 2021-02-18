'use strict'

const prettyMs = require('pretty-ms')
const getEtag = require('etag')
const htmlParser = require('node-html-parser');

const Redis = require("ioredis");
const redis = new Redis();

const botUserAgents = [
  'applebot',
  'baiduspider',
  'bingbot',
  'chrome-lighthouse',
  'embedly',
  'facebookexternalhit',
  'facebot',
  'google page speed insights',
  'google-structured-html-testing-tool',
  'gsa-crawler',
  'googlebot',
  'ia_archiver',
  'linkedinbot',
  'outbrain',
  'pingdom',
  'pinterest',
  'quora link preview',
  'rogerbot',
  'seositecheckup',
  'showyoubot',
  'slackbot',
  'telegrambot',
  'twitterbot',
  'vkshare',
  'w3c_validator',
  'whatsapp',
  'screaming frog',
  'zoominfobot',
  'ifttt',
  'sogou',
  'ru_bot',
  'researchscan',
  'nimbostratus-bot',
  'slack-imgproxy',
  'node-superagent'
];

function modifyHtmlContent (htmlContent, userAgent) {
  const parsedHtml = htmlParser.parse(htmlContent, {
    script: true,
    noscript: true,
    style: true,
    pre: true
  });
  
  if (isBot(userAgent)) {
    const body = parsedHtml.querySelector('body');
    const head = parsedHtml.querySelector('head');
  
    const allScripts = body.querySelectorAll('script');
    const allLinks = body.querySelectorAll('script');

    const scriptsToBeRemoved = allScripts.filter(
      s => s.rawAttrs.includes('development') ||
      s.rawAttrs.includes('react-refresh') ||
      s.rawAttrs.includes('polyfills'),
    );

    const allLinksToBeRemoved = allLinks.filter(
      l => !l.rawAttrs.includes('canonical')
    );
    
    scriptsToBeRemoved.map(s => body.removeChild(s))
    allLinksToBeRemoved.map(l => head.removeChild(l))
  }

  return parsedHtml.toString();
}

function isEmpty (value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'object' && Object.keys(value).length === 0) ||
    (typeof value === 'string' && value.trim().length === 0)
  )
}

function isBot (userAgent) {
  return botUserAgents.includes(userAgent);
}

const _getKey = ({ req }) => {
  const userAgent = req.header('user-agent');
  const url = isBot(userAgent) ? `bot-${req.url}` : `user-${req.url}`;

  return url;
}

const _getTtl = ({ req }) => {
  const userAgent = req.header('user-agent');
  const ttl = isBot(userAgent) ? 1728 * 1000 * 100 : 1000 * 60 * 20;

  return ttl;
}

const toSeconds = ms => Math.floor(ms / 1000)

const createSetHeaders = ({ revalidate }) => {
  return ({ res, createdAt, isCached, ttl, hasForce, etag }) => {
    const diff = hasForce ? 0 : createdAt + ttl - Date.now()
    const maxAge = toSeconds(diff)

    res.setHeader(
      'Cache-Control',
      `public, must-revalidate, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${
        hasForce ? 0 : toSeconds(revalidate(ttl))
      }`
    )

    res.setHeader('X-Cache-Status', isCached ? 'HIT' : 'MISS')
    res.setHeader('X-Cache-Expired-At', prettyMs(diff))
    res.setHeader('ETag', etag)
  }
}

module.exports = ({
  get,
  send,
  getKey = _getKey,
  getTtl = _getTtl,
  revalidate = ttl => ttl * 0.8
}) => {

  const setHeaders = createSetHeaders({
    revalidate: typeof revalidate === 'function' ? revalidate : () => revalidate
  })

  return async opts => {
    const { req, res } = opts
    const hasForce = Boolean(
      req.query ? req.query.force : parse(req.url.split('?')[1]).force
    )

    const key = getKey(opts)
    const ttl = getTtl(opts)

    const cachedResult = await redis.hgetall(key)
    
    const isCached = !hasForce && !isEmpty(cachedResult)
    const result = isCached ? cachedResult : await get(opts)

    if (!result) return

    if (isCached) {
      cachedResult.ttl = parseInt(cachedResult.ttl)
      cachedResult.createdAt = parseInt(cachedResult.createdAt)
    }

    const {
      etag: cachedEtag,
      ttl: defaultTtl = 7200000,
      createdAt = Date.now(),
      html,
    } = result

    const modifiedHtml = isCached ? html : modifyHtmlContent(html, req.header('user-agent'));
   
    const etag = cachedEtag || getEtag(modifiedHtml)
    const ifNoneMatch = req.headers['if-none-match']
    const isModified = etag !== ifNoneMatch

    setHeaders({
      etag,
      res,
      createdAt,
      isCached,
      ttl,
      hasForce
    })

    if (!isModified) {
      res.statusCode = 304
      res.end()
      return
    }

    if (!isCached) {
      const payload = { etag, createdAt, ttl, html: modifiedHtml }

      await redis.hmset(key, payload);
      redis.expire(key, toSeconds(ttl))
    }

    return send({ html: modifiedHtml, res, req })
  }
}

module.exports.getKey = _getKey
module.exports.getTtl = _getTtl