const redisResponse = require('./redis-cacheable-response')
const express = require('express')
const next = require('next')

const port = parseInt(process.env.PORT, 10) || 3000
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })

const handle = app.getRequestHandler()

const renderAndCache = redisResponse({
    get: async ({ req, res }) => {
    const rawResEnd = res.end
    const html = await new Promise((resolve) => {
      res.end = (payload) => {
        resolve(res.statusCode === 200 && payload)
      }
      app.renderToHTML(req, res, req.path, req.query);
    })
    res.end = rawResEnd
    return { html }
  },
  send: ({ html, res }) => res.send(html),
})

app.prepare().then(() => {
  const server = express()

  server.get('/', (req, res) => renderAndCache({ req, res }))

  server.get('/blog/:id', (req, res) => {
    return renderAndCache({ req, res })
  })

  server.get('*', (req, res) => handle(req, res))

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://localhost:${port}`)
  })
})
