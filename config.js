exports.http = { port: parseInt(process.env.HTTP_PORT || 8000, 10) }

exports.hook = {}

exports.hook.setup = function(context, cb) {
  var token = context.req.headers['x-token']

  if (token === 'secret') {
    cb(null, context)
  } else {
    context.end('error', 'Unauthorized', 401)
  }
}
