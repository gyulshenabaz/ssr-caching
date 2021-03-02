'use strict'

const prettyMs = require('pretty-ms')
const htmlParser = require('node-html-parser');

const Redis = require("ioredis");
const redis = new Redis({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOST
});

redis.on('error', err => {
  console.log('REDIS: FAILED')
})

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

var botRegex = new RegExp('(' + botUserAgents.join('|') + ')', 'ig');

function modifyHtmlContent (htmlContent, isBot) {
  const parsedHtml = htmlParser.parse(htmlContent, {
    script: true,
    noscript: true,
    style: true,
    pre: true
  });

  const body = parsedHtml.querySelector('body');
  const allScripts = body.querySelectorAll('script');

  if (isBot) {
    const head = parsedHtml.querySelector('head');
    const allLinks = head.querySelectorAll('link');

    const scriptsToBeRemoved = allScripts.filter(
      s => s.getAttribute('type') !== 'application/json'
    );

    const allLinksToBeRemoved = allLinks.filter(
      l => !l.rawAttrs.includes('canonical')
    );
    
    scriptsToBeRemoved.map(s => body.removeChild(s))
    allLinksToBeRemoved.map(l => head.removeChild(l))
  }
  else {
    allScripts.map(s => body.removeChild(s))

    const customScript = htmlParser.parse('<script></script>')
    const newScripts = `<script id="__preloader__">
        function docReady(fn) {
          // see if DOM is already available
          if (document.readyState === "complete") {
              // call on next available tick
              setTimeout(fn, 1);
          } else {
              window.addEventListener("load", fn);
          }
        }
        docReady(function () {
          let body = document.querySelector('body');
          let el;
          ${allScripts.reduce((acc, s) => {
            let attr;
            let attrValue;
            let curr;
            const attrPairs = s.rawAttrs.split(' ');
            curr = acc.concat(`\nel = document.createElement('script');`);
            attrPairs.forEach(pair => {
              const splitPair = pair.split(/=(.+)/);
              attr = splitPair[0];
              attrValue =
                attr === 'async' || attr === 'nomodule' ? true : splitPair[1];
              curr = curr.concat(`el["${attr}"] = ${attrValue};`);
            });
            return curr.concat(`body.appendChild(el);`);
          }, '')}
          setTimeout(() => document.querySelector('#__preloader__').remove(), 50)
        });
      </script>`;
     
      customScript.textContent = newScripts
      body.appendChild(allScripts)
      body.appendChild(customScript)
  }

  return parsedHtml.toString();
}

function isUserAgentBot(req) {
  botRegex.lastIndex = 0;
	return botRegex.test(req.header('user-agent')?.toLowerCase());
}

const _getKey = (req, isBot) => {
  const url = req.headers.host + req.url
  return isBot ? `bot-${url}` : `user-${url}`;
}

const _getTtl = (isBot) => {
  return isBot ? 1728 * 1000 * 100 : 1000 * 60 * 20;
}

const toSeconds = ms => Math.floor(ms / 1000)

const createSetHeaders = ({ revalidate }) => {
  return ({ res, isCached, ttl }) => {
    const maxAge = toSeconds(ttl)

    res.setHeader(
      'Cache-Control',
      `public, must-revalidate, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${toSeconds(revalidate(ttl))}`
    )

    res.setHeader('X-Cache-Status', isCached ? 'HIT' : 'MISS')
    res.setHeader('X-Cache-Expired-At', prettyMs(ttl))
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
    
    const isBot = isUserAgentBot(req);

    const key = getKey(req, isBot)
    const defaultTtl = getTtl(isBot)
  
    const isCached = await redis.exists(key)
    const result = isCached ? await redis.get(key) : await get(opts)

    if (!result) return

    const ttl = isCached ? await redis.ttl(key) * 1000 : defaultTtl

    const modifiedHtml = isCached ? result : modifyHtmlContent(result.html, isBot);
    
    setHeaders({
      res,
      isCached,
      ttl
    })

    if (!isCached) {
      await redis.set(key, modifiedHtml, "PX", ttl);
    }

    return send({ html: modifiedHtml, res, req })
  }
}

module.exports.getKey = _getKey
module.exports.getTtl = _getTtl