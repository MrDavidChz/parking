require('date-utils');
var fs = require('fs');
var ini = require('ini');
var exec = require('child_process').exec;
var ps = require('ps-node');
var fivebeans = require('fivebeans');
var led = require('./led.js');
led.init();

const ALPRD_CONF = '/etc/openalpr/alprd.conf';
const OPENALPR_CONF = '/etc/openalpr/openalpr.conf';
const ALPRD_CONF_TMP = '/tmp/alprd.conf';
const OPENALPR_CONF_TMP = '/tmp/openalpr.conf';

const TOPIC = 'alprd';

const CONFIDENCE = 88;  // 88% confidence

var config = ini.parse(fs.readFileSync(ALPRD_CONF, 'utf-8'));
fs.createReadStream(OPENALPR_CONF).pipe(fs.createWriteStream(OPENALPR_CONF_TMP));

function processClient(client, publisher, thingName, state) {
  client.watch('alprd', function(err, numwatched) {
    if (err) {
      throw err;
    } else {
      loop(client, publisher, thingName, state);
    }
  });
}

// Infinite loop
function loop(client, publisher, thingName, state) {

  // receives an event from the queue in beanstalkd
  client.reserve(function(err, jobid, payload) {
    var data = JSON.parse(payload.toString());
    var result = data.results[0];
    var plate = result.plate;
    var confidence = result.confidence;
    var processing_time_ms = result.processing_time_ms;
    var site_id = data.site_id;
    console.log(plate);
    console.log(confidence);
    console.log(processing_time_ms);
    console.log(site_id);

    // an event to be published to MQTT broker on AWS IoT
    var car_id = state.garage_id + ':' + plate;
    var t = new Date();
    var timestamp = t.getTime().toString();
    var record = {
      car_id: car_id,
      timestamp: timestamp,
      confidence: confidence,
      processing_time_ms: processing_time_ms,
      thing_name: thingName,
      site_id: site_id
    };
    if (confidence >= CONFIDENCE) {
      publisher.publish(TOPIC, JSON.stringify(record));
      led.blink('blue'); 
    } else {
      led.blink('red');
    }

    // removes the event in the queue
    client.destroy(jobid, function(err) {
      if (err) {
        throw err;
      } else {
        // starts another reserve recursively
        setTimeout(loop(client, publisher, thingName, state), 0);
      }
    });
  });
}


exports.startPublishing = function(publisher, thingName, state) {
  console.log(state);
  client = new fivebeans.client('127.0.0.1', 11300);
  client
    .on('connect', function()
    {
      // client can now be used
      console.log('connected');
      processClient(client, publisher, thingName, state);
    })
    .on('error', function(err)
    {
      // connection failure
      throw err;
    })
    .on('close', function()
    {
      // underlying connection has closed
      console.log('connection closed');
    })
    .connect();
}

// launches alprd
exports.start = function(site_id, upload_address) {
  config.daemon.site_id = site_id;
  config.daemon.upload_address = upload_address;
  fs.writeFileSync(ALPRD_CONF_TMP, ini.stringify(config));
  var cmd = 'sudo /usr/bin/alprd -l /tmp/alprd.log --config /tmp';
  exec(cmd, function(err, stdout, stderr) {
    if (err) {
      throw new Error(err);
    }
  });
}

// kills all the running alprd daemons
exports.kill = function() {
  ps.lookup({
    command: 'alprd',
    psargs: 'ax'
  }, function(err, resultList) {
    resultList.forEach(function(process) {
      if (process) {
        ps.kill(process.pid, function(err) {
          if (err) {
            throw err;
          } else {
            console.log('alprd(' + process.pid +') killed');
          }
        });
      }
    });
  });
}
