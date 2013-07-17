var exports = module.exports;
var messages = require('./config_messages');
var request = require('request');

exports.menu = function(cb) {
  cb(null, messages.platformWelcome);
};

exports.manual_board_version = function(params,cb) {
  var msgToShow = messages.flashduinoFetchVersionNumber;
  var optionArr = [{name:"V12", value:"V12"}, {name:"V11", value:"V11"}];
  msgToShow.contents[1].options = optionArr;
  cb(null, msgToShow);
};
exports.manual_hex_location = function(params,cb) {
  cb(null, messages.flashduinoFetchHexURL);
};

exports.confirm_flash_arduino = function(params,cb) {
  if (typeof params.arduino_board_version !== 'undefined') {
    this.setArduinoVersionToDownload.call(this, params.arduino_board_version);
    cb(null, messages.flashduinoConfirmToFlash);
  } else if (typeof params.arduino_hex_url !== 'undefined') {
    //verify url
    request.head(params.arduino_hex_url, function(error, response, body) {
      if (!error && response.statusCode == 200) {
        this.setArduinoHexURLToDownload.call(this, params.arduino_hex_url);
        cb(null, messages.flashduinoConfirmToFlash);
      } else {
      	cb(null, messages.invalidURL);
      }
    }.bind(this));
  }
  else {
  	return;
  }
};

exports.flashduino_begin = function(params,cb) {
  cb(null, messages.flashduinoFlashingArduino);
  this.flashArduino.call(this, null);
};

