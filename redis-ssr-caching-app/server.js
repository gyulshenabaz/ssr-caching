const redisResponse = require('./redis-cacheable-response')
const express = require('express')
const next = require('next')

const port = parseInt(process.env.PORT, 10) || 3000
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })

const handle = app.getRequestHandler()

const renderAndCache = redisResponse({
  get: async ({req, res}) => {
  const rawResEnd = res.end
  const html = await new Promise((resolve) => {
    res.end = (payload) => {
      resolve(payload)
    }
    app.render(req, res, req.path, req.query);
  })
  res.end = rawResEnd

  if (res.statusCode != 200) {
    res.send(html)
    return;
  }

  return { html }
},
send: ({ html, res }) => res.send(html),
})

app.prepare().then(() => {
  const server = express()

  server.get('/_next/*', (req, res) => {
    handle(req, res);
  });

  server.get('*', (req, res) => {
    return renderAndCache({req, res});
  });

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://localhost:${port}`)
  })
})