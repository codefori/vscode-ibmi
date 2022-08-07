var Ber = require('asn1').Ber;

var readUInt32BE = require('./buffer-helpers').readUInt32BE;
var writeUInt32BE = require('./buffer-helpers').writeUInt32BE;

// XXX the value of 2400 from dropbear is only for certain strings, not all
// strings. for example the list strings used during handshakes
var MAX_STRING_LEN = Infinity;//2400; // taken from dropbear

module.exports = {
  iv_inc: iv_inc,
  readInt: readInt,
  readString: readString,
  parseKey: require('./keyParser').parseKey,
  sigSSHToASN1: sigSSHToASN1,
  DSASigBERToBare: DSASigBERToBare,
  ECDSASigASN1ToSSH: ECDSASigASN1ToSSH
};

function iv_inc(iv) {
  var n = 12;
  var c = 0;
  do {
    --n;
    c = iv[n];
    if (c === 255)
      iv[n] = 0;
    else {
      iv[n] = ++c;
      return;
    }
  } while (n > 4);
}

function readInt(buffer, start, stream, cb) {
  var bufferLen = buffer.length;
  if (start < 0 || start >= bufferLen || (bufferLen - start) < 4) {
    stream && stream._cleanup(cb);
    return false;
  }

  return readUInt32BE(buffer, start);
}

function DSASigBERToBare(signature) {
  if (signature.length <= 40)
    return signature;
  // This is a quick and dirty way to get from BER encoded r and s that
  // OpenSSL gives us, to just the bare values back to back (40 bytes
  // total) like OpenSSH (and possibly others) are expecting
  var asnReader = new Ber.Reader(signature);
  asnReader.readSequence();
  var r = asnReader.readString(Ber.Integer, true);
  var s = asnReader.readString(Ber.Integer, true);
  var rOffset = 0;
  var sOffset = 0;
  if (r.length < 20) {
    var rNew = Buffer.allocUnsafe(20);
    r.copy(rNew, 1);
    r = rNew;
    r[0] = 0;
  }
  if (s.length < 20) {
    var sNew = Buffer.allocUnsafe(20);
    s.copy(sNew, 1);
    s = sNew;
    s[0] = 0;
  }
  if (r.length > 20 && r[0] === 0x00)
    rOffset = 1;
  if (s.length > 20 && s[0] === 0x00)
    sOffset = 1;
  var newSig = Buffer.allocUnsafe((r.length - rOffset) + (s.length - sOffset));
  r.copy(newSig, 0, rOffset);
  s.copy(newSig, r.length - rOffset, sOffset);
  return newSig;
}

function ECDSASigASN1ToSSH(signature) {
  if (signature[0] === 0x00)
    return signature;
  // Convert SSH signature parameters to ASN.1 BER values for OpenSSL
  var asnReader = new Ber.Reader(signature);
  asnReader.readSequence();
  var r = asnReader.readString(Ber.Integer, true);
  var s = asnReader.readString(Ber.Integer, true);
  if (r === null || s === null)
    return false;
  var newSig = Buffer.allocUnsafe(4 + r.length + 4 + s.length);
  writeUInt32BE(newSig, r.length, 0);
  r.copy(newSig, 4);
  writeUInt32BE(newSig, s.length, 4 + r.length);
  s.copy(newSig, 4 + 4 + r.length);
  return newSig;
}

function sigSSHToASN1(sig, type, self, callback) {
  var asnWriter;
  switch (type) {
    case 'ssh-dss':
      if (sig.length > 40)
        return sig;
      // Change bare signature r and s values to ASN.1 BER values for OpenSSL
      asnWriter = new Ber.Writer();
      asnWriter.startSequence();
      var r = sig.slice(0, 20);
      var s = sig.slice(20);
      if (r[0] & 0x80) {
        var rNew = Buffer.allocUnsafe(21);
        rNew[0] = 0x00;
        r.copy(rNew, 1);
        r = rNew;
      } else if (r[0] === 0x00 && !(r[1] & 0x80)) {
        r = r.slice(1);
      }
      if (s[0] & 0x80) {
        var sNew = Buffer.allocUnsafe(21);
        sNew[0] = 0x00;
        s.copy(sNew, 1);
        s = sNew;
      } else if (s[0] === 0x00 && !(s[1] & 0x80)) {
        s = s.slice(1);
      }
      asnWriter.writeBuffer(r, Ber.Integer);
      asnWriter.writeBuffer(s, Ber.Integer);
      asnWriter.endSequence();
      return asnWriter.buffer;
    case 'ecdsa-sha2-nistp256':
    case 'ecdsa-sha2-nistp384':
    case 'ecdsa-sha2-nistp521':
      var r = readString(sig, 0, self, callback);
      if (r === false)
        return false;
      var s = readString(sig, sig._pos, self, callback);
      if (s === false)
        return false;

      asnWriter = new Ber.Writer();
      asnWriter.startSequence();
      asnWriter.writeBuffer(r, Ber.Integer);
      asnWriter.writeBuffer(s, Ber.Integer);
      asnWriter.endSequence();
      return asnWriter.buffer;
    default:
      return sig;
  }
}

function readString(buffer, start, encoding, stream, cb, maxLen) {
  if (encoding && !Buffer.isBuffer(encoding) && typeof encoding !== 'string') {
    if (typeof cb === 'number')
      maxLen = cb;
    cb = stream;
    stream = encoding;
    encoding = undefined;
  }

  start || (start = 0);
  var bufferLen = buffer.length;
  var left = (bufferLen - start);
  var len;
  var end;
  if (start < 0 || start >= bufferLen || left < 4) {
    stream && stream._cleanup(cb);
    return false;
  }

  len = readUInt32BE(buffer, start);
  if (len > (maxLen || MAX_STRING_LEN) || left < (4 + len)) {
    stream && stream._cleanup(cb);
    return false;
  }

  start += 4;
  end = start + len;
  buffer._pos = end;

  if (encoding) {
    if (Buffer.isBuffer(encoding)) {
      buffer.copy(encoding, 0, start, end);
      return encoding;
    } else {
      return buffer.toString(encoding, start, end);
    }
  } else {
    return buffer.slice(start, end);
  }
}

