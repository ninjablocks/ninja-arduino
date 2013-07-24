/**
 * Ninja Blocks arduino controller
 */

var serialport = require('serialport');
var stream = require('stream');
var util = require('util');
var path = require('path');
var net = require('net');
var fs = require('fs');
var metaEvents = require('./lib/meta-events.js');
var deviceStream = require('./lib/device-stream.js');
var platformDevice = require('./lib/platform-device.js');
var deviceHandlers = require('./lib/handlers.js');
var configHandlers = require('./lib/config');
var spawn = require('child_process').spawn;

const kUtilBinPath = "/opt/utilities/bin/";
const kArduinoFlashScript = "ninja_upate_arduino";

const kArduinoParamsFile = "/etc/opt/ninja/.arduino_update_params";
const kArduinoUpdatedFile = "/etc/opt/ninja/.has_updated_arduino";

/**
 * platform.device = serial / net stream to device data (JSON stream)
 *
 */
function platform(opts, app, version) {

	var str = undefined
	var mod = this

	this.retry = {

		delay : 3000
		, timer : null
		, count : 0
		, max : 3
	};

	stream.call(this);
	this.app = app;
	this.log = app.log;
	this.opts = opts || { };
	this.queue = [ ];
	this.device = undefined;
	this.channel = undefined;
	this.FlashStatusType = {
		NONE : 0
		, REQUESTED : 1
		, FLASHING : 2
	}
	this.flashStatus = this.FlashStatusType.NONE;
	this.flashScriptPath = "/opt/utilities/bin/ninja_update_arduino"
	this.flashScriptProcess = undefined;
	this.debounce = [ ];

	this.registeredDevices = [ ];

	this.statusLights = [

		{
			state : "client::down"
			, color : "FFFF00"
		}
		, {
			state : "client::up"
			, color : "00FF00"
		}
		, {
			state : "client::authed"
			, color : "00FFFF"
		}
		, {
			state : "client::activation"
			, color : "FF00FF"
		}
		, {
			state : "client::invalidToken"
			, color : "0000FF"
		}
		, {
			state : "client::reconnecting"
			, color : "00FFFF"
		}
		, {
			state : "client::updating"
			, color : "FFFFFF"
		}
	];
	// assume down
	this.currentStatus = this.statusLights[0];

	if((!app.opts.devicePath) && app.opts.env == "production") {

		this.app.opts.devicePath = "/dev/ttyO1";
	}
	// don't bother if neither are specified
	if(!app.opts.devicePath && !app.opts.deviceHost) {

		return this.log.info("ninja-arduino: No device specified");
	}
	else {

		if(!this.createStream(this.app.opts)) {

			this.log.error("ninja-arduino: Error creating device stream");
		}
	}

	/**
	 * Bind listeners for app state
	 * make the status LED do its thing
	 */
	this.statusLights.forEach(function(state) {
		app.on(state.state, function() {
			this.currentStatus = state;
			this.updateLEDWithStatus();
		}.bind(this));
	}.bind(this));

	/**
	 * Get version from arduino
	 */
	function getVersion() {
		if (!mod.device || (mod.flashStatus != mod.FlashStatusType.NONE)) { return; }
		mod.device.write('{"DEVICE":[{"G":"0","V":0,"D":1003,"DA":"VNO"}]}');
	};

	this.once('open', function() {

		var versionSpam = setInterval(function() {

			getVersion();
		}, 500);

		mod.once('version', function(ver) {

			version(ver);
			clearTimeout(versionSpam);
		});

		setTimeout(function() {

			clearTimeout(versionSpam);
		}, 2000);
	});

	//app.on('device::command', mod.onCommand.bind(mod));
	app.on('client::up', mod.restorePersistantDevices.bind(mod));

};

util.inherits(platform, stream);

deviceHandlers(platform);
deviceStream(platform);
metaEvents(platform);

platform.prototype.updateLEDWithStatus = function() {
	if(!this.device || (this.flashStatus != this.FlashStatusType.NONE)) { return; }
	this.device.write(JSON.stringify({
		DEVICE : [
			{
				G : "0"
				, V : 0
				, D : 999
				, DA : this.currentStatus.color
			}
		]
	}));
}

platform.prototype.config = function(rpc,cb) {
  var self = this;
  if (!rpc) {
    return configHandlers.menu.call(this,cb);
  }
  else if (typeof configHandlers[rpc.method] === "function") {
    return configHandlers[rpc.method].call(this,rpc.params,cb);
  }
  else {
    return cb(true);
  }
};


platform.prototype.restorePersistantDevices = function() {
	var persistantDevices = this.opts.persistantDevices;


	if (!persistantDevices) {
		return;
	}

	var persistantGuid;
	persistantDevices.forEach(function(persistantGuid){

		deviceAttributes = persistantGuid.split('_');
		if (deviceAttributes.length < 3) {
			return;
		}

		this.registerDevice(deviceAttributes[0]
			, deviceAttributes[1]
			, deviceAttributes[2]
		);

	}.bind(this));

}

platform.prototype.setArduinoVersionToDownload = function(version) {
	this.arduinoCustomHexURLToDownload = "";
	this.arduinoVersionToDownload = version;
}
platform.prototype.setArduinoHexURLToDownload = function(hexURL) {
	this.arduinoVersionToDownload = "";
	this.arduinoCustomHexURLToDownload = hexURL;
}

platform.prototype.requestFlashArduino = function() {
	this.log.info('ninja-arduino: flash arduino requested');
	this.device.write(JSON.stringify({
		DEVICE : [{
				G : "0"
				, V : 0
				, D : 999
				, DA : "FFFFFF" 
			}]
	}));
	this.flashStatus = this.FlashStatusType.REQUESTED;
	this.closeSerialStream();
}
platform.prototype.flashArduino = function() {
	var params;
	if (this.arduinoVersionToDownload !== "") {
		params = ['-f', this.arduinoVersionToDownload];
	} else if (this.arduinoCustomHexURLToDownload !== "") {
		params = ['-u', this.arduinoCustomHexURLToDownload];
	} else {
		this.flashStatus = this.FlashStatusType.NONE;
		return;
	}
	this.log.info('ninja-arduino: flashing using params, \'' + params + '\'');

	//flash here
	this.flashStatus = this.FlashStatusType.FLASHING;
	this.flashProcess = spawn(this.flashScriptPath, params);
	this.flashProcess.on('close', this.finishedFlashing.bind(this));
	self = this;
/*
	fs.writeFile(kArduinoParamsFile, params, function(err) { //write params to file
   		if(err) {
        		console.log(err);
    		} else {
			fs.unlink(kArduinoUpdatedFile, function (err) { //delete file to trigger update on next run
				self.log.info('ninja-arduino: flashing arduino...');
				process.exit(); //restart so /etc/init/ninjablock.conf can run
			});
		}
	});*/
}
platform.prototype.finishedFlashing = function(code) {
	this.log.info('ninja-arduino: finished flashing (' + code + ')');
	this.flashStatus = this.FlashStatusType.NONE;
	this.createStream();
}

function guid(device) {
	return [device.G,device.V,device.D].join('_');
}

platform.prototype.registerDevice = function(deviceG, deviceV, deviceD) {

	var device = new platformDevice(deviceG, deviceV, deviceD);
	// If we already have a device for this guid, bail.
	if (this.registeredDevices[guid(device)]) return;

	device.write = function(DA) {
		this.onCommand.call(this,{
			G:device.G,
			V:device.V,
			D:device.D,
			DA:DA
		});
	}.bind(this);

	this.emit('register', device);
	this.registeredDevices[guid(device)] = device;
	return device;
}

platform.prototype.sendData = function(deviceObj) {
	if(!deviceObj) { return; }
	var device = this.registeredDevices[guid(deviceObj)];
	if (!device) {
		device = this.registerDevice(deviceObj.G, deviceObj.V, deviceObj.D);
	}
	device.emit('data',deviceObj.DA);
};

platform.prototype.sendConfig = function(type, dat) {

	if(!dat) { return; }
	dat.type = type;
	this.emit('config', dat);
};

platform.prototype.getJSON = function getJSON(data) {

	try {

		return JSON.parse(data);
	}
	catch(e) { }
	return null;
};

module.exports = platform;
