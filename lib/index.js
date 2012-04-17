var async = require('async')
  , express = require('express')
  , mcollective = require('mcollective')
  , path = require('path')
  , uuid = require('node-uuid')

exports.createServer = function(options) {
  var app = express.createServer()
    , filterList = ['agent', 'class', 'fact', 'identity']

  if (!options.hook) options.hook = {}

  var setup = function(context, cb) {
    var req = context.req
      , mco = new mcollective.Request(req.params.agent, req.params.action)

    if (req.query.timeout) mco.timeout(parseInt(req.query.timeout, 10))
    if (req.query.discovery_timeout) mco.discoveryTimeout(parseInt(req.query.discovery_timeout, 10))

    filterList.forEach(function(name) {
      var query = req.query[name]

      if (query === undefined) return
      if (typeof(query) === 'string') query = [query]

      if (name == 'fact') {
        query.forEach(function(d) {
          d = d.match(/([^:]*):(.*)/)
          if (d) mco.factFilter(d[1], d[2])
        })
      } else {
        query.forEach(function(d) {
          mco[name + 'Filter'](d)
        })
      }
    })

    context.mco = mco

    cb(null, context)
  }

  var send = function(context, cb) {
    var mco = context.mco
      , body = context.req.body

    var events = mco.send(body)
      , data = []
      , error = []

    events.on('data', function(d) { data.push(d) })
    events.on('error', function(d) { error.push(d) })

    events.on('end', function(code) {
    context.events = events
    context.data = data
    context.error = error
      cb(null, context)
    })
  }

  var emit = function(res, err, data, statusCode) {
    var r = { id: uuid.v4() }
    if (err) {
      r.error = typeof(err) === 'object' && err.message ? err.message : err
      if (!Array.isArray(r.error)) r.error = [r.error]
    }
    if (data) r.data = Array.isArray(data) ? data : [data]
    if (options.hook.emit && options.hook.emit(r, { res: res })) return
    if (!statusCode) statusCode = r.error ? 400 : 200
    res.json(r, statusCode)
  }

  app.configure(function() {
    app.use(express['static'](path.join(__dirname, '..', 'static')))
    app.use(express.cookieParser())
    app.use(express.bodyParser())
  })

  if (options.hook.route) options.hook.route(app)

  app.post('/api/:agent/:action', function(req, res) {
    var sent = false

    var end = function(err, data, statusCode) {
      if (!sent) emit(res, err, data, statusCode)
      sent = true
    }

    if (!req.is('json')) return end(new Error('request not supported format'), null, 415)

    var work = [function(cb) { cb(null, { req: req, end: end }) }]

    if (options.hook.setup) work.push(options.hook.setup)
    work.push(setup)

    if (options.hook.send) work.push(options.hook.send)
    work.push(send)

    if (options.hook.handle) work.push(options.hook.handle)

    async.waterfall(work, function(err, result) {
      if (err) return end(err)
      end(result.error.length ? result.error.map(function(d) { return '' + d }) : null, result.data)
    })

    if (req.query.async == 'true') end(null, null, 202)
  })

  app.use(function(err, req, res, next){
    if (!err) return next.call(this, arguments)
    if (err && err['arguments'].length && err['arguments'][0] == 'ILLEGAL') {
      return emit(res, new Error('parse error'), null, 415)
    }
    emit(res, err)
  })

  return app
}
