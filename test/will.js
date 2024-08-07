'use strict'

var test = require('tape').test
var memory = require('aedes-persistence')
var helper = require('./helper')
var setup = helper.setup
var connect = helper.connect
var aedes = require('../')

function willConnect (s, opts, connected) {
  opts = opts || {}
  opts.will = {
    topic: 'mywill',
    payload: new Buffer('last will'),
    qos: 0,
    retain: false
  }

  return connect(s, opts, connected)
}

test('delivers a will', function (t) {
  var opts = {}
  // willConnect populates opts with a will
  var s = willConnect(setup(), opts)

  s.broker.mq.on('mywill', function (packet, cb) {
    t.equal(packet.topic, opts.will.topic, 'topic matches')
    t.deepEqual(packet.payload, opts.will.payload, 'payload matches')
    t.equal(packet.qos, opts.will.qos, 'qos matches')
    t.equal(packet.retain, opts.will.retain, 'retain matches')
    cb()
    t.end()
  })

  s.conn.destroy()
})

test('delivers old will in case of a crash', function (t) {
  t.plan(7)
  var persistence = memory()
  var will = {
    topic: 'mywill',
    payload: new Buffer('last will'),
    qos: 0,
    retain: false
  }

  persistence.broker = {
    id: 'anotherBroker'
  }

  persistence.putWill({
    id: 'myClientId42'
  }, will, function (err) {
    t.error(err, 'no error')

    var interval = 10 // ms, so that the will check happens fast!
    var broker = aedes({
      persistence: persistence,
      heartbeatInterval: interval
    })
    var start = Date.now()

    broker.mq.on('mywill', check)

    function check (packet, cb) {
      broker.mq.removeListener('mywill', check)
      t.ok(Date.now() - start >= 3 * interval, 'the will needs to be emitted after 3 heartbeats')
      t.equal(packet.topic, will.topic, 'topic matches')
      t.deepEqual(packet.payload, will.payload, 'payload matches')
      t.equal(packet.qos, will.qos, 'qos matches')
      t.equal(packet.retain, will.retain, 'retain matches')
      broker.mq.on('mywill', function (packet) {
        t.fail('the will must be delivered only once')
      })
      setTimeout(function () {
        broker.close(t.pass.bind(t, 'server closes'))
      }, 15)
      cb()
    }
  })
})

test('store the will in the persistence', function (t) {
  var opts = {
    clientId: 'abcde'
  }

  // willConnect populates opts with a will
  var s = willConnect(setup(), opts)

  s.broker.persistence.getWill({
    id: opts.clientId
  }, function (err, packet) {
    t.error(err, 'no error')
    t.deepEqual(packet.topic, opts.will.topic, 'will topic matches')
    t.deepEqual(packet.payload, opts.will.payload, 'will payload matches')
    t.deepEqual(packet.qos, opts.will.qos, 'will qos matches')
    t.deepEqual(packet.retain, opts.will.retain, 'will retain matches')
    t.end()
  })
})

test('delivers a will with authorization', function (t) {
  let authorized = false
  var opts = {}
  // willConnect populates opts with a will
  var s = willConnect(setup(aedes({ authorizePublish: (_1, _2, callback) => { authorized = true; callback(null) } })), opts)

  s.broker.on('clientDisconnect', function () {
    t.end()
  })

  s.broker.mq.on('mywill', function (packet, cb) {
    t.equal(packet.topic, opts.will.topic, 'topic matches')
    t.deepEqual(packet.payload, opts.will.payload, 'payload matches')
    t.equal(packet.qos, opts.will.qos, 'qos matches')
    t.equal(packet.retain, opts.will.retain, 'retain matches')
    t.equal(authorized, true, 'authorization called')
    cb()
  })

  s.conn.destroy()
})

test('does not deliver a will without authorization', function (t) {
  let authorized = false
  var opts = {}
  // willConnect populates opts with a will
  var s = willConnect(setup(aedes({ authorizePublish: (_1, _2, callback) => { authorized = true; callback(new Error()) } })), opts)

  s.broker.on('clientDisconnect', function () {
    t.equal(authorized, true, 'authorization called')
    t.end()
  })

  s.broker.mq.on('mywill', function (packet, cb) {
    t.fail('received will without authorization')
    cb()
  })

  s.conn.destroy()
})
