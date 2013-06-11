var
	serialport = require('serialport')
	, through = require('through')
	, stream = require('stream')
	, net = require('net')
	, fs = require('fs')
;

module.exports = deviceStream;

function deviceStream(platform) {

	platform.prototype.createStream = function createStream(opts) {

		var 
			opts = opts || this.app.opts
			, mod = this
			, str
		;
		if(this.retry.count++ >= this.retry.max) {

			this.log.debug(

				"ninja-arduino: Unable to connect to device (%s)"
				, this.app.opts.devicePath || this.app.opts.deviceHost
			);
			return;
		}
		if(opts.deviceHost) {
			
			return str = this.createNetStream(

				opts.deviceHost
				, opts.devicePort
			);
		}
		else {
		
			return str = this.createSerialStream(opts.devicePath);
		}
		return false;
	};

	platform.prototype.createNetStream = function createNetStream(host, port) {

		var mod = this;

		if(!host) { return false; }
		if(!port) { port = 9000; } // default!
		mod.app.opts.devicePath = undefined;
		mod.app.opts.deviceHost = host;
		mod.app.opts.devicePort = port;
		mod.device = net.connect(port, host, this.onOpen.bind(this));
		mod.bindStream(mod.device);

		mod.log.debug(

			"ninja-arduino: Opening net connection (%s:%s)"
			, mod.app.opts.deviceHost
			, mod.app.opts.devicePort
		);
		return mod.device;
	};

	platform.prototype.createSerialStream = function createSerialStream(path) {

		var mod = this;

		if(!fs.existsSync(mod.app.opts.devicePath)) { 

			mod.log.error(

				"ninja-arduino: Serial device path unavailable (%s)"
				, path
			);
			return;
		}
		if(!path) { return false; }
		mod.app.opts.deviceHost = undefined;
		mod.app.opts.devicePath = path;
		mod.device = new serialport.SerialPort(mod.app.opts.devicePath, {

			parser : serialport.parsers.readline("\n")
		});
		mod.device.on('open', this.onOpen.bind(this));
		mod.bindStream(mod.device);
		
		mod.log.debug(

			"ninja-arduino: Opening serial connection (%s)"
			, mod.app.opts.devicePath
		);
		return mod.device;
	};

	platform.prototype.bindStream = function bindStream(str) {

		var mod = this;
		if(!(str instanceof stream)) { return false; }
		str.on('error', mod.onError.bind(mod));
		str.on('close', mod.onClose.bind(mod));
		mod.channel = new through(mod.onData.bind(mod));
		str.pipe(mod.channel).pipe(str);
		return true;
	};
};
