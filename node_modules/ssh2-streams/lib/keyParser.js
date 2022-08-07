// TODO:
//    * utilize `crypto.create(Private|Public)Key()` and `keyObject.export()`
//    * handle multi-line header values (OpenSSH)?
//    * more thorough validation?

var crypto = require('crypto');
var cryptoSign = crypto.sign;
var cryptoVerify = crypto.verify;
var createSign = crypto.createSign;
var createVerify = crypto.createVerify;
var createDecipheriv = crypto.createDecipheriv;
var createHash = crypto.createHash;
var createHmac = crypto.createHmac;
var supportedOpenSSLCiphers = crypto.getCiphers();

var utils;
var Ber = require('asn1').Ber;
var bcrypt_pbkdf = require('bcrypt-pbkdf').pbkdf;

var bufferHelpers = require('./buffer-helpers');
var readUInt32BE = bufferHelpers.readUInt32BE;
var writeUInt32BE = bufferHelpers.writeUInt32BE;
var constants = require('./constants');
var SUPPORTED_CIPHER = constants.ALGORITHMS.SUPPORTED_CIPHER;
var CIPHER_INFO = constants.CIPHER_INFO;
var SSH_TO_OPENSSL = constants.SSH_TO_OPENSSL;
var EDDSA_SUPPORTED = constants.EDDSA_SUPPORTED;

var SYM_HASH_ALGO = Symbol('Hash Algorithm');
var SYM_PRIV_PEM = Symbol('Private key PEM');
var SYM_PUB_PEM = Symbol('Public key PEM');
var SYM_PUB_SSH = Symbol('Public key SSH');
var SYM_DECRYPTED = Symbol('Decrypted Key');

// Create OpenSSL cipher name -> SSH cipher name conversion table
var CIPHER_INFO_OPENSSL = Object.create(null);
(function() {
  var keys = Object.keys(CIPHER_INFO);
  for (var i = 0; i < keys.length; ++i) {
    var cipherName = SSH_TO_OPENSSL[keys[i]];
    if (!cipherName || CIPHER_INFO_OPENSSL[cipherName])
      continue;
    CIPHER_INFO_OPENSSL[cipherName] = CIPHER_INFO[keys[i]];
  }
})();

var trimStart = (function() {
  if (typeof String.prototype.trimStart === 'function') {
    return function trimStart(str) {
      return str.trimStart();
    };
  }

  return function trimStart(str) {
    var start = 0;
    for (var i = 0; i < str.length; ++i) {
      switch (str.charCodeAt(i)) {
        case 32: // ' '
        case 9: // '\t'
        case 13: // '\r'
        case 10: // '\n'
        case 12: // '\f'
          ++start;
          continue;
      }
      break;
    }
    if (start === 0)
      return str;
    return str.slice(start);
  };
})();

function makePEM(type, data) {
  data = data.toString('base64');
  return '-----BEGIN ' + type + ' KEY-----\n'
         + data.replace(/.{64}/g, '$&\n')
         + (data.length % 64 ? '\n' : '')
         + '-----END ' + type + ' KEY-----';
}

function combineBuffers(buf1, buf2) {
  var result = Buffer.allocUnsafe(buf1.length + buf2.length);
  buf1.copy(result, 0);
  buf2.copy(result, buf1.length);
  return result;
}

function skipFields(buf, nfields) {
  var bufLen = buf.length;
  var pos = (buf._pos || 0);
  for (var i = 0; i < nfields; ++i) {
    var left = (bufLen - pos);
    if (pos >= bufLen || left < 4)
      return false;
    var len = readUInt32BE(buf, pos);
    if (left < 4 + len)
      return false;
    pos += 4 + len;
  }
  buf._pos = pos;
  return true;
}

function genOpenSSLRSAPub(n, e) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // algorithm
    asnWriter.startSequence();
      asnWriter.writeOID('1.2.840.113549.1.1.1'); // rsaEncryption
      // algorithm parameters (RSA has none)
      asnWriter.writeNull();
    asnWriter.endSequence();

    // subjectPublicKey
    asnWriter.startSequence(Ber.BitString);
      asnWriter.writeByte(0x00);
      asnWriter.startSequence();
        asnWriter.writeBuffer(n, Ber.Integer);
        asnWriter.writeBuffer(e, Ber.Integer);
      asnWriter.endSequence();
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('PUBLIC', asnWriter.buffer);
}

function genOpenSSHRSAPub(n, e) {
  var publicKey = Buffer.allocUnsafe(4 + 7 // "ssh-rsa"
                                     + 4 + n.length
                                     + 4 + e.length);

  writeUInt32BE(publicKey, 7, 0);
  publicKey.write('ssh-rsa', 4, 7, 'ascii');

  var i = 4 + 7;
  writeUInt32BE(publicKey, e.length, i);
  e.copy(publicKey, i += 4);

  writeUInt32BE(publicKey, n.length, i += e.length);
  n.copy(publicKey, i + 4);

  return publicKey;
}

var genOpenSSLRSAPriv = (function() {
  function genRSAASN1Buf(n, e, d, p, q, dmp1, dmq1, iqmp) {
    var asnWriter = new Ber.Writer();
    asnWriter.startSequence();
      asnWriter.writeInt(0x00, Ber.Integer);
      asnWriter.writeBuffer(n, Ber.Integer);
      asnWriter.writeBuffer(e, Ber.Integer);
      asnWriter.writeBuffer(d, Ber.Integer);
      asnWriter.writeBuffer(p, Ber.Integer);
      asnWriter.writeBuffer(q, Ber.Integer);
      asnWriter.writeBuffer(dmp1, Ber.Integer);
      asnWriter.writeBuffer(dmq1, Ber.Integer);
      asnWriter.writeBuffer(iqmp, Ber.Integer);
    asnWriter.endSequence();
    return asnWriter.buffer;
  }

  function bigIntFromBuffer(buf) {
    return BigInt('0x' + buf.toString('hex'));
  }

  function bigIntToBuffer(bn) {
    var hex = bn.toString(16);
    if ((hex.length & 1) !== 0) {
      hex = '0' + hex;
    } else {
      var sigbit = hex.charCodeAt(0);
      // BER/DER integers require leading zero byte to denote a positive value
      // when first byte >= 0x80
      if (sigbit === 56 || (sigbit >= 97 && sigbit <= 102))
        hex = '00' + hex;
    }
    return Buffer.from(hex, 'hex');
  }

  // Feature detect native BigInt availability and use it when possible
  try {
    var code = [
      'return function genOpenSSLRSAPriv(n, e, d, iqmp, p, q) {',
      '  var bn_d = bigIntFromBuffer(d);',
      '  var dmp1 = bigIntToBuffer(bn_d % (bigIntFromBuffer(p) - 1n));',
      '  var dmq1 = bigIntToBuffer(bn_d % (bigIntFromBuffer(q) - 1n));',
      '  return makePEM(\'RSA PRIVATE\', '
        + 'genRSAASN1Buf(n, e, d, p, q, dmp1, dmq1, iqmp));',
      '};'
    ].join('\n');
    return new Function(
      'bigIntFromBuffer, bigIntToBuffer, makePEM, genRSAASN1Buf',
      code
    )(bigIntFromBuffer, bigIntToBuffer, makePEM, genRSAASN1Buf);
  } catch (ex) {
    return (function() {
      var BigInteger = require('./jsbn.js');
      return function genOpenSSLRSAPriv(n, e, d, iqmp, p, q) {
        var pbi = new BigInteger(p, 256);
        var qbi = new BigInteger(q, 256);
        var dbi = new BigInteger(d, 256);
        var dmp1bi = dbi.mod(pbi.subtract(BigInteger.ONE));
        var dmq1bi = dbi.mod(qbi.subtract(BigInteger.ONE));
        var dmp1 = Buffer.from(dmp1bi.toByteArray());
        var dmq1 = Buffer.from(dmq1bi.toByteArray());
        return makePEM('RSA PRIVATE',
                       genRSAASN1Buf(n, e, d, p, q, dmp1, dmq1, iqmp));
      };
    })();
  }
})();

function genOpenSSLDSAPub(p, q, g, y) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // algorithm
    asnWriter.startSequence();
      asnWriter.writeOID('1.2.840.10040.4.1'); // id-dsa
      // algorithm parameters
      asnWriter.startSequence();
        asnWriter.writeBuffer(p, Ber.Integer);
        asnWriter.writeBuffer(q, Ber.Integer);
        asnWriter.writeBuffer(g, Ber.Integer);
      asnWriter.endSequence();
    asnWriter.endSequence();

    // subjectPublicKey
    asnWriter.startSequence(Ber.BitString);
      asnWriter.writeByte(0x00);
      asnWriter.writeBuffer(y, Ber.Integer);
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('PUBLIC', asnWriter.buffer);
}

function genOpenSSHDSAPub(p, q, g, y) {
  var publicKey = Buffer.allocUnsafe(4 + 7 // ssh-dss
                                     + 4 + p.length
                                     + 4 + q.length
                                     + 4 + g.length
                                     + 4 + y.length);

  writeUInt32BE(publicKey, 7, 0);
  publicKey.write('ssh-dss', 4, 7, 'ascii');

  var i = 4 + 7;
  writeUInt32BE(publicKey, p.length, i);
  p.copy(publicKey, i += 4);

  writeUInt32BE(publicKey, q.length, i += p.length);
  q.copy(publicKey, i += 4);

  writeUInt32BE(publicKey, g.length, i += q.length);
  g.copy(publicKey, i += 4);

  writeUInt32BE(publicKey, y.length, i += g.length);
  y.copy(publicKey, i + 4);

  return publicKey;
}

function genOpenSSLDSAPriv(p, q, g, y, x) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    asnWriter.writeInt(0x00, Ber.Integer);
    asnWriter.writeBuffer(p, Ber.Integer);
    asnWriter.writeBuffer(q, Ber.Integer);
    asnWriter.writeBuffer(g, Ber.Integer);
    asnWriter.writeBuffer(y, Ber.Integer);
    asnWriter.writeBuffer(x, Ber.Integer);
  asnWriter.endSequence();
  return makePEM('DSA PRIVATE', asnWriter.buffer);
}

function genOpenSSLEdPub(pub) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // algorithm
    asnWriter.startSequence();
      asnWriter.writeOID('1.3.101.112'); // id-Ed25519
    asnWriter.endSequence();

    // PublicKey
    asnWriter.startSequence(Ber.BitString);
      asnWriter.writeByte(0x00);
      // XXX: hack to write a raw buffer without a tag -- yuck
      asnWriter._ensure(pub.length);
      pub.copy(asnWriter._buf, asnWriter._offset, 0, pub.length);
      asnWriter._offset += pub.length;
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('PUBLIC', asnWriter.buffer);
}

function genOpenSSHEdPub(pub) {
  var publicKey = Buffer.allocUnsafe(4 + 11 // ssh-ed25519
                                     + 4 + pub.length);

  writeUInt32BE(publicKey, 11, 0);
  publicKey.write('ssh-ed25519', 4, 11, 'ascii');

  writeUInt32BE(publicKey, pub.length, 15);
  pub.copy(publicKey, 19);

  return publicKey;
}

function genOpenSSLEdPriv(priv) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // version
    asnWriter.writeInt(0x00, Ber.Integer);

    // algorithm
    asnWriter.startSequence();
      asnWriter.writeOID('1.3.101.112'); // id-Ed25519
    asnWriter.endSequence();

    // PrivateKey
    asnWriter.startSequence(Ber.OctetString);
      asnWriter.writeBuffer(priv, Ber.OctetString);
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('PRIVATE', asnWriter.buffer);
}

function genOpenSSLECDSAPub(oid, Q) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // algorithm
    asnWriter.startSequence();
      asnWriter.writeOID('1.2.840.10045.2.1'); // id-ecPublicKey
      // algorithm parameters (namedCurve)
      asnWriter.writeOID(oid);
    asnWriter.endSequence();

    // subjectPublicKey
    asnWriter.startSequence(Ber.BitString);
      asnWriter.writeByte(0x00);
      // XXX: hack to write a raw buffer without a tag -- yuck
      asnWriter._ensure(Q.length);
      Q.copy(asnWriter._buf, asnWriter._offset, 0, Q.length);
      asnWriter._offset += Q.length;
      // end hack
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('PUBLIC', asnWriter.buffer);
}

function genOpenSSHECDSAPub(oid, Q) {
  var curveName;
  switch (oid) {
    case '1.2.840.10045.3.1.7':
      // prime256v1/secp256r1
      curveName = 'nistp256';
      break;
    case '1.3.132.0.34':
      // secp384r1
      curveName = 'nistp384';
      break;
    case '1.3.132.0.35':
      // secp521r1
      curveName = 'nistp521';
      break;
    default:
      return;
  }

  var publicKey = Buffer.allocUnsafe(4 + 19 // ecdsa-sha2-<curve name>
                                     + 4 + 8 // <curve name>
                                     + 4 + Q.length);

  writeUInt32BE(publicKey, 19, 0);
  publicKey.write('ecdsa-sha2-' + curveName, 4, 19, 'ascii');

  writeUInt32BE(publicKey, 8, 23);
  publicKey.write(curveName, 27, 8, 'ascii');

  writeUInt32BE(publicKey, Q.length, 35);
  Q.copy(publicKey, 39);

  return publicKey;
}

function genOpenSSLECDSAPriv(oid, pub, priv) {
  var asnWriter = new Ber.Writer();
  asnWriter.startSequence();
    // version
    asnWriter.writeInt(0x01, Ber.Integer);
    // privateKey
    asnWriter.writeBuffer(priv, Ber.OctetString);
    // parameters (optional)
    asnWriter.startSequence(0xA0);
      asnWriter.writeOID(oid);
    asnWriter.endSequence();
    // publicKey (optional)
    asnWriter.startSequence(0xA1);
      asnWriter.startSequence(Ber.BitString);
        asnWriter.writeByte(0x00);
        // XXX: hack to write a raw buffer without a tag -- yuck
        asnWriter._ensure(pub.length);
        pub.copy(asnWriter._buf, asnWriter._offset, 0, pub.length);
        asnWriter._offset += pub.length;
        // end hack
      asnWriter.endSequence();
    asnWriter.endSequence();
  asnWriter.endSequence();
  return makePEM('EC PRIVATE', asnWriter.buffer);
}

function genOpenSSLECDSAPubFromPriv(curveName, priv) {
  var tempECDH = crypto.createECDH(curveName);
  tempECDH.setPrivateKey(priv);
  return tempECDH.getPublicKey();
}

var baseKeySign = (function() {
  if (typeof cryptoSign === 'function') {
    return function sign(data) {
      var pem = this[SYM_PRIV_PEM];
      if (pem === null)
        return new Error('No private key available');
      try {
        return cryptoSign(this[SYM_HASH_ALGO], data, pem);
      } catch (ex) {
        return ex;
      }
    };
  } else {
    function trySign(signature, privKey) {
      try {
        return signature.sign(privKey);
      } catch (ex) {
        return ex;
      }
    }

    return function sign(data) {
      var pem = this[SYM_PRIV_PEM];
      if (pem === null)
        return new Error('No private key available');
      var signature = createSign(this[SYM_HASH_ALGO]);
      signature.update(data);
      return trySign(signature, pem);
    };
  }
})();

var baseKeyVerify = (function() {
  if (typeof cryptoVerify === 'function') {
    return function verify(data, signature) {
      var pem = this[SYM_PUB_PEM];
      if (pem === null)
        return new Error('No public key available');
      try {
        return cryptoVerify(this[SYM_HASH_ALGO], data, pem, signature);
      } catch (ex) {
        return ex;
      }
    };
  } else {
    function tryVerify(verifier, pubKey, signature) {
      try {
        return verifier.verify(pubKey, signature);
      } catch (ex) {
        return ex;
      }
    }

    return function verify(data, signature) {
      var pem = this[SYM_PUB_PEM];
      if (pem === null)
        return new Error('No public key available');
      var verifier = createVerify(this[SYM_HASH_ALGO]);
      verifier.update(data);
      return tryVerify(verifier, pem, signature);
    };
  }
})();

var BaseKey = {
  sign: baseKeySign,
  verify: baseKeyVerify,
  getPrivatePEM: function getPrivatePEM() {
    return this[SYM_PRIV_PEM];
  },
  getPublicPEM: function getPublicPEM() {
    return this[SYM_PUB_PEM];
  },
  getPublicSSH: function getPublicSSH() {
    return this[SYM_PUB_SSH];
  },
};



function OpenSSH_Private(type, comment, privPEM, pubPEM, pubSSH, algo, decrypted) {
  this.type = type;
  this.comment = comment;
  this[SYM_PRIV_PEM] = privPEM;
  this[SYM_PUB_PEM] = pubPEM;
  this[SYM_PUB_SSH] = pubSSH;
  this[SYM_HASH_ALGO] = algo;
  this[SYM_DECRYPTED] = decrypted;
}
OpenSSH_Private.prototype = BaseKey;
(function() {
  var regexp = /^-----BEGIN OPENSSH PRIVATE KEY-----(?:\r\n|\n)([\s\S]+)(?:\r\n|\n)-----END OPENSSH PRIVATE KEY-----$/;
  OpenSSH_Private.parse = function(str, passphrase) {
    var m = regexp.exec(str);
    if (m === null)
      return null;
    var ret;
    var data = Buffer.from(m[1], 'base64');
    if (data.length < 31) // magic (+ magic null term.) + minimum field lengths
      return new Error('Malformed OpenSSH private key');
    var magic = data.toString('ascii', 0, 15);
    if (magic !== 'openssh-key-v1\0')
      return new Error('Unsupported OpenSSH key magic: ' + magic);

    // avoid cyclic require by requiring on first use
    if (!utils)
      utils = require('./utils');

    var cipherName = utils.readString(data, 15, 'ascii');
    if (cipherName === false)
      return new Error('Malformed OpenSSH private key');
    if (cipherName !== 'none' && SUPPORTED_CIPHER.indexOf(cipherName) === -1)
      return new Error('Unsupported cipher for OpenSSH key: ' + cipherName);

    var kdfName = utils.readString(data, data._pos, 'ascii');
    if (kdfName === false)
      return new Error('Malformed OpenSSH private key');
    if (kdfName !== 'none') {
      if (cipherName === 'none')
        return new Error('Malformed OpenSSH private key');
      if (kdfName !== 'bcrypt')
        return new Error('Unsupported kdf name for OpenSSH key: ' + kdfName);
      if (!passphrase) {
        return new Error(
          'Encrypted private OpenSSH key detected, but no passphrase given'
        );
      }
    } else if (cipherName !== 'none') {
      return new Error('Malformed OpenSSH private key');
    }

    var encInfo;
    var cipherKey;
    var cipherIV;
    if (cipherName !== 'none')
      encInfo = CIPHER_INFO[cipherName];
    var kdfOptions = utils.readString(data, data._pos);
    if (kdfOptions === false)
      return new Error('Malformed OpenSSH private key');
    if (kdfOptions.length) {
      switch (kdfName) {
        case 'none':
          return new Error('Malformed OpenSSH private key');
        case 'bcrypt':
          /*
            string salt
            uint32 rounds
          */
          var salt = utils.readString(kdfOptions, 0);
          if (salt === false || kdfOptions._pos + 4 > kdfOptions.length)
            return new Error('Malformed OpenSSH private key');
          var rounds = readUInt32BE(kdfOptions, kdfOptions._pos);
          var gen = Buffer.allocUnsafe(encInfo.keyLen + encInfo.ivLen);
          var r = bcrypt_pbkdf(passphrase,
                               passphrase.length,
                               salt,
                               salt.length,
                               gen,
                               gen.length,
                               rounds);
          if (r !== 0)
            return new Error('Failed to generate information to decrypt key');
          cipherKey = gen.slice(0, encInfo.keyLen);
          cipherIV = gen.slice(encInfo.keyLen);
          break;
      }
    } else if (kdfName !== 'none') {
      return new Error('Malformed OpenSSH private key');
    }

    var keyCount = utils.readInt(data, data._pos);
    if (keyCount === false)
      return new Error('Malformed OpenSSH private key');
    data._pos += 4;

    if (keyCount > 0) {
      // TODO: place sensible limit on max `keyCount`

      // Read public keys first
      for (var i = 0; i < keyCount; ++i) {
        var pubData = utils.readString(data, data._pos);
        if (pubData === false)
          return new Error('Malformed OpenSSH private key');
        var type = utils.readString(pubData, 0, 'ascii');
        if (type === false)
          return new Error('Malformed OpenSSH private key');
      }

      var privBlob = utils.readString(data, data._pos);
      if (privBlob === false)
        return new Error('Malformed OpenSSH private key');

      if (cipherKey !== undefined) {
        // encrypted private key(s)
        if (privBlob.length < encInfo.blockLen
            || (privBlob.length % encInfo.blockLen) !== 0) {
          return new Error('Malformed OpenSSH private key');
        }
        try {
          var options = { authTagLength: encInfo.authLen };
          var decipher = createDecipheriv(SSH_TO_OPENSSL[cipherName],
                                          cipherKey,
                                          cipherIV,
                                          options);
          if (encInfo.authLen > 0) {
            if (data.length - data._pos < encInfo.authLen)
              return new Error('Malformed OpenSSH private key');
            decipher.setAuthTag(
              data.slice(data._pos, data._pos += encInfo.authLen)
            );
          }
          privBlob = combineBuffers(decipher.update(privBlob),
                                    decipher.final());
        } catch (ex) {
          return ex;
        }
      }
      // Nothing should we follow the private key(s), except a possible
      // authentication tag for relevant ciphers
      if (data._pos !== data.length)
        return new Error('Malformed OpenSSH private key');

      ret = parseOpenSSHPrivKeys(privBlob, keyCount, cipherKey !== undefined);
    } else {
      ret = [];
    }
    return ret;
  };

  function parseOpenSSHPrivKeys(data, nkeys, decrypted) {
    var keys = [];
    /*
      uint32	checkint
      uint32	checkint
      string	privatekey1
      string	comment1
      string	privatekey2
      string	comment2
      ...
      string	privatekeyN
      string	commentN
      char	1
      char	2
      char	3
      ...
      char	padlen % 255
    */
    if (data.length < 8)
      return new Error('Malformed OpenSSH private key');
    var check1 = readUInt32BE(data, 0);
    var check2 = readUInt32BE(data, 4);
    if (check1 !== check2) {
      if (decrypted)
        return new Error('OpenSSH key integrity check failed -- bad passphrase?');
      return new Error('OpenSSH key integrity check failed');
    }
    data._pos = 8;
    var i;
    var oid;
    for (i = 0; i < nkeys; ++i) {
      var algo = undefined;
      var privPEM = undefined;
      var pubPEM = undefined;
      var pubSSH = undefined;
      // The OpenSSH documentation for the key format actually lies, the entirety
      // of the private key content is not contained with a string field, it's
      // actually the literal contents of the private key, so to be able to find
      // the end of the key data you need to know the layout/format of each key
      // type ...
      var type = utils.readString(data, data._pos, 'ascii');
      if (type === false)
        return new Error('Malformed OpenSSH private key');

      switch (type) {
        case 'ssh-rsa':
          /*
            string  n -- public
            string  e -- public
            string  d -- private
            string  iqmp -- private
            string  p -- private
            string  q -- private
          */
          var n = utils.readString(data, data._pos);
          if (n === false)
            return new Error('Malformed OpenSSH private key');
          var e = utils.readString(data, data._pos);
          if (e === false)
            return new Error('Malformed OpenSSH private key');
          var d = utils.readString(data, data._pos);
          if (d === false)
            return new Error('Malformed OpenSSH private key');
          var iqmp = utils.readString(data, data._pos);
          if (iqmp === false)
            return new Error('Malformed OpenSSH private key');
          var p = utils.readString(data, data._pos);
          if (p === false)
            return new Error('Malformed OpenSSH private key');
          var q = utils.readString(data, data._pos);
          if (q === false)
            return new Error('Malformed OpenSSH private key');

          pubPEM = genOpenSSLRSAPub(n, e);
          pubSSH = genOpenSSHRSAPub(n, e);
          privPEM = genOpenSSLRSAPriv(n, e, d, iqmp, p, q);
          algo = 'sha1';
          break;
        case 'ssh-dss':
          /*
            string  p -- public
            string  q -- public
            string  g -- public
            string  y -- public
            string  x -- private
          */
          var p = utils.readString(data, data._pos);
          if (p === false)
            return new Error('Malformed OpenSSH private key');
          var q = utils.readString(data, data._pos);
          if (q === false)
            return new Error('Malformed OpenSSH private key');
          var g = utils.readString(data, data._pos);
          if (g === false)
            return new Error('Malformed OpenSSH private key');
          var y = utils.readString(data, data._pos);
          if (y === false)
            return new Error('Malformed OpenSSH private key');
          var x = utils.readString(data, data._pos);
          if (x === false)
            return new Error('Malformed OpenSSH private key');

          pubPEM = genOpenSSLDSAPub(p, q, g, y);
          pubSSH = genOpenSSHDSAPub(p, q, g, y);
          privPEM = genOpenSSLDSAPriv(p, q, g, y, x);
          algo = 'sha1';
          break;
        case 'ssh-ed25519':
          if (!EDDSA_SUPPORTED)
            return new Error('Unsupported OpenSSH private key type: ' + type);
          /*
            * string  public key
            * string  private key + public key
          */
          var edpub = utils.readString(data, data._pos);
          if (edpub === false || edpub.length !== 32)
            return new Error('Malformed OpenSSH private key');
          var edpriv = utils.readString(data, data._pos);
          if (edpriv === false || edpriv.length !== 64)
            return new Error('Malformed OpenSSH private key');

          pubPEM = genOpenSSLEdPub(edpub);
          pubSSH = genOpenSSHEdPub(edpub);
          privPEM = genOpenSSLEdPriv(edpriv.slice(0, 32));
          algo = null;
          break;
        case 'ecdsa-sha2-nistp256':
          algo = 'sha256';
          oid = '1.2.840.10045.3.1.7';
        case 'ecdsa-sha2-nistp384':
          if (algo === undefined) {
            algo = 'sha384';
            oid = '1.3.132.0.34';
          }
        case 'ecdsa-sha2-nistp521':
          if (algo === undefined) {
            algo = 'sha512';
            oid = '1.3.132.0.35';
          }
          /*
            string  curve name
            string  Q -- public
            string  d -- private
          */
          // TODO: validate curve name against type
          if (!skipFields(data, 1)) // Skip curve name
            return new Error('Malformed OpenSSH private key');
          var ecpub = utils.readString(data, data._pos);
          if (ecpub === false)
            return new Error('Malformed OpenSSH private key');
          var ecpriv = utils.readString(data, data._pos);
          if (ecpriv === false)
            return new Error('Malformed OpenSSH private key');

          pubPEM = genOpenSSLECDSAPub(oid, ecpub);
          pubSSH = genOpenSSHECDSAPub(oid, ecpub);
          privPEM = genOpenSSLECDSAPriv(oid, ecpub, ecpriv);
          break;
        default:
          return new Error('Unsupported OpenSSH private key type: ' + type);
      }

      var privComment = utils.readString(data, data._pos, 'utf8');
      if (privComment === false)
        return new Error('Malformed OpenSSH private key');

      keys.push(
        new OpenSSH_Private(type, privComment, privPEM, pubPEM, pubSSH, algo,
                            decrypted)
      );
    }
    var cnt = 0;
    for (i = data._pos; i < data.length; ++i) {
      if (data[i] !== (++cnt % 255))
        return new Error('Malformed OpenSSH private key');
    }

    return keys;
  }
})();



function OpenSSH_Old_Private(type, comment, privPEM, pubPEM, pubSSH, algo, decrypted) {
  this.type = type;
  this.comment = comment;
  this[SYM_PRIV_PEM] = privPEM;
  this[SYM_PUB_PEM] = pubPEM;
  this[SYM_PUB_SSH] = pubSSH;
  this[SYM_HASH_ALGO] = algo;
  this[SYM_DECRYPTED] = decrypted;
}
OpenSSH_Old_Private.prototype = BaseKey;
(function() {
  var regexp = /^-----BEGIN (RSA|DSA|EC) PRIVATE KEY-----(?:\r\n|\n)((?:[^:]+:\s*[\S].*(?:\r\n|\n))*)([\s\S]+)(?:\r\n|\n)-----END (RSA|DSA|EC) PRIVATE KEY-----$/;
  OpenSSH_Old_Private.parse = function(str, passphrase) {
    var m = regexp.exec(str);
    if (m === null)
      return null;
    var privBlob = Buffer.from(m[3], 'base64');
    var headers = m[2];
    var decrypted = false;
    if (headers !== undefined) {
      // encrypted key
      headers = headers.split(/\r\n|\n/g);
      for (var i = 0; i < headers.length; ++i) {
        var header = headers[i];
        var sepIdx = header.indexOf(':');
        if (header.slice(0, sepIdx) === 'DEK-Info') {
          var val = header.slice(sepIdx + 2);
          sepIdx = val.indexOf(',');
          if (sepIdx === -1)
            continue;
          var cipherName = val.slice(0, sepIdx).toLowerCase();
          if (supportedOpenSSLCiphers.indexOf(cipherName) === -1) {
            return new Error(
              'Cipher ('
              + cipherName
              + ') not supported for encrypted OpenSSH private key'
            );
          }
          var encInfo = CIPHER_INFO_OPENSSL[cipherName];
          if (!encInfo) {
            return new Error(
              'Cipher ('
              + cipherName
              + ') not supported for encrypted OpenSSH private key'
            );
          }
          var cipherIV = Buffer.from(val.slice(sepIdx + 1), 'hex');
          if (cipherIV.length !== encInfo.ivLen)
            return new Error('Malformed encrypted OpenSSH private key');
          if (!passphrase) {
            return new Error(
              'Encrypted OpenSSH private key detected, but no passphrase given'
            );
          }
          var cipherKey = createHash('md5')
                            .update(passphrase)
                            .update(cipherIV.slice(0, 8))
                            .digest();
          while (cipherKey.length < encInfo.keyLen) {
            cipherKey = combineBuffers(
              cipherKey,
              (createHash('md5')
                .update(cipherKey)
                .update(passphrase)
                .update(cipherIV)
                .digest()).slice(0, 8)
            );
          }
          if (cipherKey.length > encInfo.keyLen)
            cipherKey = cipherKey.slice(0, encInfo.keyLen);
          try {
            var decipher = createDecipheriv(cipherName, cipherKey, cipherIV);
            decipher.setAutoPadding(false);
            privBlob = combineBuffers(decipher.update(privBlob),
                                      decipher.final());
            decrypted = true;
          } catch (ex) {
            return ex;
          }
        }
      }
    }

    var type;
    var privPEM;
    var pubPEM;
    var pubSSH;
    var algo;
    var reader;
    var errMsg = 'Malformed OpenSSH private key';
    if (decrypted)
      errMsg += '. Bad passphrase?';
    switch (m[1]) {
      case 'RSA':
        type = 'ssh-rsa';
        privPEM = makePEM('RSA PRIVATE', privBlob);
        try {
          reader = new Ber.Reader(privBlob);
          reader.readSequence();
          reader.readInt(); // skip version
          var n = reader.readString(Ber.Integer, true);
          if (n === null)
            return new Error(errMsg);
          var e = reader.readString(Ber.Integer, true);
          if (e === null)
            return new Error(errMsg);
          pubPEM = genOpenSSLRSAPub(n, e);
          pubSSH = genOpenSSHRSAPub(n, e);
        } catch (ex) {
          return new Error(errMsg);
        }
        algo = 'sha1';
        break;
      case 'DSA':
        type = 'ssh-dss';
        privPEM = makePEM('DSA PRIVATE', privBlob);
        try {
          reader = new Ber.Reader(privBlob);
          reader.readSequence();
          reader.readInt(); // skip version
          var p = reader.readString(Ber.Integer, true);
          if (p === null)
            return new Error(errMsg);
          var q = reader.readString(Ber.Integer, true);
          if (q === null)
            return new Error(errMsg);
          var g = reader.readString(Ber.Integer, true);
          if (g === null)
            return new Error(errMsg);
          var y = reader.readString(Ber.Integer, true);
          if (y === null)
            return new Error(errMsg);
          pubPEM = genOpenSSLDSAPub(p, q, g, y);
          pubSSH = genOpenSSHDSAPub(p, q, g, y);
        } catch (ex) {
          return new Error(errMsg);
        }
        algo = 'sha1';
        break;
      case 'EC':
        var ecSSLName;
        var ecPriv;
        try {
          reader = new Ber.Reader(privBlob);
          reader.readSequence();
          reader.readInt(); // skip version
          ecPriv = reader.readString(Ber.OctetString, true);
          reader.readByte(); // Skip "complex" context type byte
          var offset = reader.readLength(); // Skip context length
          if (offset !== null) {
            reader._offset = offset;
            var oid = reader.readOID();
            if (oid === null)
              return new Error(errMsg);
            switch (oid) {
              case '1.2.840.10045.3.1.7':
                // prime256v1/secp256r1
                ecSSLName = 'prime256v1';
                type = 'ecdsa-sha2-nistp256';
                algo = 'sha256';
                break;
              case '1.3.132.0.34':
                // secp384r1
                ecSSLName = 'secp384r1';
                type = 'ecdsa-sha2-nistp384';
                algo = 'sha384';
                break;
              case '1.3.132.0.35':
                // secp521r1
                ecSSLName = 'secp521r1';
                type = 'ecdsa-sha2-nistp521';
                algo = 'sha512';
                break;
              default:
                return new Error('Unsupported private key EC OID: ' + oid);
            }
          } else {
            return new Error(errMsg);
          }
        } catch (ex) {
          return new Error(errMsg);
        }
        privPEM = makePEM('EC PRIVATE', privBlob);
        var pubBlob = genOpenSSLECDSAPubFromPriv(ecSSLName, ecPriv);
        pubPEM = genOpenSSLECDSAPub(oid, pubBlob);
        pubSSH = genOpenSSHECDSAPub(oid, pubBlob);
        break;
    }

    return new OpenSSH_Old_Private(type, '', privPEM, pubPEM, pubSSH, algo,
                                   decrypted);
  };
})();



function PPK_Private(type, comment, privPEM, pubPEM, pubSSH, algo, decrypted) {
  this.type = type;
  this.comment = comment;
  this[SYM_PRIV_PEM] = privPEM;
  this[SYM_PUB_PEM] = pubPEM;
  this[SYM_PUB_SSH] = pubSSH;
  this[SYM_HASH_ALGO] = algo;
  this[SYM_DECRYPTED] = decrypted;
}
PPK_Private.prototype = BaseKey;
(function() {
  var EMPTY_PASSPHRASE = Buffer.alloc(0);
  var PPK_IV = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  var PPK_PP1 = Buffer.from([0, 0, 0, 0]);
  var PPK_PP2 = Buffer.from([0, 0, 0, 1]);
  var regexp = /^PuTTY-User-Key-File-2: (ssh-(?:rsa|dss))\r?\nEncryption: (aes256-cbc|none)\r?\nComment: ([^\r\n]*)\r?\nPublic-Lines: \d+\r?\n([\s\S]+?)\r?\nPrivate-Lines: \d+\r?\n([\s\S]+?)\r?\nPrivate-MAC: ([^\r\n]+)/;
  PPK_Private.parse = function(str, passphrase) {
    var m = regexp.exec(str);
    if (m === null)
      return null;
    // m[1] = key type
    // m[2] = encryption type
    // m[3] = comment
    // m[4] = base64-encoded public key data:
    //         for "ssh-rsa":
    //          string "ssh-rsa"
    //          mpint  e    (public exponent)
    //          mpint  n    (modulus)
    //         for "ssh-dss":
    //          string "ssh-dss"
    //          mpint p     (modulus)
    //          mpint q     (prime)
    //          mpint g     (base number)
    //          mpint y     (public key parameter: g^x mod p)
    // m[5] = base64-encoded private key data:
    //         for "ssh-rsa":
    //          mpint  d    (private exponent)
    //          mpint  p    (prime 1)
    //          mpint  q    (prime 2)
    //          mpint  iqmp ([inverse of q] mod p)
    //         for "ssh-dss":
    //          mpint x     (private key parameter)
    // m[6] = SHA1 HMAC over:
    //          string  name of algorithm ("ssh-dss", "ssh-rsa")
    //          string  encryption type
    //          string  comment
    //          string  public key data
    //          string  private-plaintext (including the final padding)
    var cipherName = m[2];
    var encrypted = (cipherName !== 'none');
    if (encrypted && !passphrase) {
      return new Error(
        'Encrypted PPK private key detected, but no passphrase given'
      );
    }

    var privBlob = Buffer.from(m[5], 'base64');

    if (encrypted) {
      var encInfo = CIPHER_INFO[cipherName];
      var cipherKey = combineBuffers(
        createHash('sha1').update(PPK_PP1).update(passphrase).digest(),
        createHash('sha1').update(PPK_PP2).update(passphrase).digest()
      );
      if (cipherKey.length > encInfo.keyLen)
        cipherKey = cipherKey.slice(0, encInfo.keyLen);
      try {
        var decipher = createDecipheriv(SSH_TO_OPENSSL[cipherName],
                                        cipherKey,
                                        PPK_IV);
        decipher.setAutoPadding(false);
        privBlob = combineBuffers(decipher.update(privBlob),
                                  decipher.final());
        decrypted = true;
      } catch (ex) {
        return ex;
      }
    }

    var type = m[1];
    var comment = m[3];
    var pubBlob = Buffer.from(m[4], 'base64');

    var mac = m[6];
    var typeLen = type.length;
    var cipherNameLen = cipherName.length;
    var commentLen = Buffer.byteLength(comment);
    var pubLen = pubBlob.length;
    var privLen = privBlob.length;
    var macData = Buffer.allocUnsafe(4 + typeLen
                                     + 4 + cipherNameLen
                                     + 4 + commentLen
                                     + 4 + pubLen
                                     + 4 + privLen);
    var p = 0;

    writeUInt32BE(macData, typeLen, p);
    macData.write(type, p += 4, typeLen, 'ascii');
    writeUInt32BE(macData, cipherNameLen, p += typeLen);
    macData.write(cipherName, p += 4, cipherNameLen, 'ascii');
    writeUInt32BE(macData, commentLen, p += cipherNameLen);
    macData.write(comment, p += 4, commentLen, 'utf8');
    writeUInt32BE(macData, pubLen, p += commentLen);
    pubBlob.copy(macData, p += 4);
    writeUInt32BE(macData, privLen, p += pubLen);
    privBlob.copy(macData, p + 4);

    if (!passphrase)
      passphrase = EMPTY_PASSPHRASE;

    var calcMAC = createHmac('sha1',
                             createHash('sha1')
                               .update('putty-private-key-file-mac-key')
                               .update(passphrase)
                               .digest())
                    .update(macData)
                    .digest('hex');

    if (calcMAC !== mac) {
      if (encrypted) {
        return new Error(
          'PPK private key integrity check failed -- bad passphrase?'
        );
      } else {
        return new Error('PPK private key integrity check failed');
      }
    }

    // avoid cyclic require by requiring on first use
    if (!utils)
      utils = require('./utils');

    var pubPEM;
    var pubSSH;
    var privPEM;
    pubBlob._pos = 0;
    skipFields(pubBlob, 1); // skip (duplicate) key type
    switch (type) {
      case 'ssh-rsa':
        var e = utils.readString(pubBlob, pubBlob._pos);
        if (e === false)
          return new Error('Malformed PPK public key');
        var n = utils.readString(pubBlob, pubBlob._pos);
        if (n === false)
          return new Error('Malformed PPK public key');
        var d = utils.readString(privBlob, 0);
        if (d === false)
          return new Error('Malformed PPK private key');
        var p = utils.readString(privBlob, privBlob._pos);
        if (p === false)
          return new Error('Malformed PPK private key');
        var q = utils.readString(privBlob, privBlob._pos);
        if (q === false)
          return new Error('Malformed PPK private key');
        var iqmp = utils.readString(privBlob, privBlob._pos);
        if (iqmp === false)
          return new Error('Malformed PPK private key');
        pubPEM = genOpenSSLRSAPub(n, e);
        pubSSH = genOpenSSHRSAPub(n, e);
        privPEM = genOpenSSLRSAPriv(n, e, d, iqmp, p, q);
        break;
      case 'ssh-dss':
        var p = utils.readString(pubBlob, pubBlob._pos);
        if (p === false)
          return new Error('Malformed PPK public key');
        var q = utils.readString(pubBlob, pubBlob._pos);
        if (q === false)
          return new Error('Malformed PPK public key');
        var g = utils.readString(pubBlob, pubBlob._pos);
        if (g === false)
          return new Error('Malformed PPK public key');
        var y = utils.readString(pubBlob, pubBlob._pos);
        if (y === false)
          return new Error('Malformed PPK public key');
        var x = utils.readString(privBlob, 0);
        if (x === false)
          return new Error('Malformed PPK private key');

        pubPEM = genOpenSSLDSAPub(p, q, g, y);
        pubSSH = genOpenSSHDSAPub(p, q, g, y);
        privPEM = genOpenSSLDSAPriv(p, q, g, y, x);
        break;
    }

    return new PPK_Private(type, comment, privPEM, pubPEM, pubSSH, 'sha1',
                           encrypted);
  };
})();


function parseDER(data, baseType, comment, fullType) {
  // avoid cyclic require by requiring on first use
  if (!utils)
    utils = require('./utils');

  var algo;
  var pubPEM = null;
  var pubSSH = null;
  switch (baseType) {
    case 'ssh-rsa':
      var e = utils.readString(data, data._pos);
      if (e === false)
        return new Error('Malformed OpenSSH public key');
      var n = utils.readString(data, data._pos);
      if (n === false)
        return new Error('Malformed OpenSSH public key');
      pubPEM = genOpenSSLRSAPub(n, e);
      pubSSH = genOpenSSHRSAPub(n, e);
      algo = 'sha1';
      break;
    case 'ssh-dss':
      var p = utils.readString(data, data._pos);
      if (p === false)
        return new Error('Malformed OpenSSH public key');
      var q = utils.readString(data, data._pos);
      if (q === false)
        return new Error('Malformed OpenSSH public key');
      var g = utils.readString(data, data._pos);
      if (g === false)
        return new Error('Malformed OpenSSH public key');
      var y = utils.readString(data, data._pos);
      if (y === false)
        return new Error('Malformed OpenSSH public key');
      pubPEM = genOpenSSLDSAPub(p, q, g, y);
      pubSSH = genOpenSSHDSAPub(p, q, g, y);
      algo = 'sha1';
      break;
    case 'ssh-ed25519':
      var edpub = utils.readString(data, data._pos);
      if (edpub === false || edpub.length !== 32)
        return new Error('Malformed OpenSSH public key');
      pubPEM = genOpenSSLEdPub(edpub);
      pubSSH = genOpenSSHEdPub(edpub);
      algo = null;
      break;
    case 'ecdsa-sha2-nistp256':
      algo = 'sha256';
      oid = '1.2.840.10045.3.1.7';
    case 'ecdsa-sha2-nistp384':
      if (algo === undefined) {
        algo = 'sha384';
        oid = '1.3.132.0.34';
      }
    case 'ecdsa-sha2-nistp521':
      if (algo === undefined) {
        algo = 'sha512';
        oid = '1.3.132.0.35';
      }
      // TODO: validate curve name against type
      if (!skipFields(data, 1)) // Skip curve name
        return new Error('Malformed OpenSSH public key');
      var ecpub = utils.readString(data, data._pos);
      if (ecpub === false)
        return new Error('Malformed OpenSSH public key');
      pubPEM = genOpenSSLECDSAPub(oid, ecpub);
      pubSSH = genOpenSSHECDSAPub(oid, ecpub);
      break;
    default:
      return new Error('Unsupported OpenSSH public key type: ' + baseType);
  }

  return new OpenSSH_Public(fullType, comment, pubPEM, pubSSH, algo);
}
function OpenSSH_Public(type, comment, pubPEM, pubSSH, algo) {
  this.type = type;
  this.comment = comment;
  this[SYM_PRIV_PEM] = null;
  this[SYM_PUB_PEM] = pubPEM;
  this[SYM_PUB_SSH] = pubSSH;
  this[SYM_HASH_ALGO] = algo;
  this[SYM_DECRYPTED] = false;
}
OpenSSH_Public.prototype = BaseKey;
(function() {
  var regexp;
  if (EDDSA_SUPPORTED)
    regexp = /^(((?:ssh-(?:rsa|dss|ed25519))|ecdsa-sha2-nistp(?:256|384|521))(?:-cert-v0[01]@openssh.com)?) ([A-Z0-9a-z\/+=]+)(?:$|\s+([\S].*)?)$/;
  else
    regexp = /^(((?:ssh-(?:rsa|dss))|ecdsa-sha2-nistp(?:256|384|521))(?:-cert-v0[01]@openssh.com)?) ([A-Z0-9a-z\/+=]+)(?:$|\s+([\S].*)?)$/;
  OpenSSH_Public.parse = function(str) {
    var m = regexp.exec(str);
    if (m === null)
      return null;
    // m[1] = full type
    // m[2] = base type
    // m[3] = base64-encoded public key
    // m[4] = comment

    // avoid cyclic require by requiring on first use
    if (!utils)
      utils = require('./utils');

    var fullType = m[1];
    var baseType = m[2];
    var data = Buffer.from(m[3], 'base64');
    var comment = (m[4] || '');

    var type = utils.readString(data, data._pos, 'ascii');
    if (type === false || type.indexOf(baseType) !== 0)
      return new Error('Malformed OpenSSH public key');

    return parseDER(data, baseType, comment, fullType);
  };
})();



function RFC4716_Public(type, comment, pubPEM, pubSSH, algo) {
  this.type = type;
  this.comment = comment;
  this[SYM_PRIV_PEM] = null;
  this[SYM_PUB_PEM] = pubPEM;
  this[SYM_PUB_SSH] = pubSSH;
  this[SYM_HASH_ALGO] = algo;
  this[SYM_DECRYPTED] = false;
}
RFC4716_Public.prototype = BaseKey;
(function() {
  var regexp = /^---- BEGIN SSH2 PUBLIC KEY ----(?:\r\n|\n)((?:(?:[\x21-\x7E]+?):(?:(?:.*?\\\r?\n)*.*)(?:\r\n|\n))*)((?:[A-Z0-9a-z\/+=]+(?:\r\n|\n))+)---- END SSH2 PUBLIC KEY ----$/;
  var RE_HEADER = /^([\x21-\x7E]+?):((?:.*?\\\r?\n)*.*)$/gm;
  var RE_HEADER_ENDS = /\\\r?\n/g;
  RFC4716_Public.parse = function(str) {
    var m = regexp.exec(str);
    if (m === null)
      return null;
    // m[1] = header(s)
    // m[2] = base64-encoded public key

    var headers = m[1];
    var data = Buffer.from(m[2], 'base64');
    var comment = '';

    if (headers !== undefined) {
      while (m = RE_HEADER.exec(headers)) {
        if (m[1].toLowerCase() === 'comment') {
          comment = trimStart(m[2].replace(RE_HEADER_ENDS, ''));
          if (comment.length > 1
              && comment.charCodeAt(0) === 34/*'"'*/
              && comment.charCodeAt(comment.length - 1) === 34/*'"'*/) {
            comment = comment.slice(1, -1);
          }
        }
      }
    }

    // avoid cyclic require by requiring on first use
    if (!utils)
      utils = require('./utils');

    var type = utils.readString(data, 0, 'ascii');
    if (type === false)
      return new Error('Malformed RFC4716 public key');

    var pubPEM = null;
    var pubSSH = null;
    switch (type) {
      case 'ssh-rsa':
        var e = utils.readString(data, data._pos);
        if (e === false)
          return new Error('Malformed RFC4716 public key');
        var n = utils.readString(data, data._pos);
        if (n === false)
          return new Error('Malformed RFC4716 public key');
        pubPEM = genOpenSSLRSAPub(n, e);
        pubSSH = genOpenSSHRSAPub(n, e);
        break;
      case 'ssh-dss':
        var p = utils.readString(data, data._pos);
        if (p === false)
          return new Error('Malformed RFC4716 public key');
        var q = utils.readString(data, data._pos);
        if (q === false)
          return new Error('Malformed RFC4716 public key');
        var g = utils.readString(data, data._pos);
        if (g === false)
          return new Error('Malformed RFC4716 public key');
        var y = utils.readString(data, data._pos);
        if (y === false)
          return new Error('Malformed RFC4716 public key');
        pubPEM = genOpenSSLDSAPub(p, q, g, y);
        pubSSH = genOpenSSHDSAPub(p, q, g, y);
        break;
      default:
        return new Error('Malformed RFC4716 public key');
    }

    return new RFC4716_Public(type, comment, pubPEM, pubSSH, 'sha1');
  };
})();



module.exports = {
  parseDERKey: function parseDERKey(data, type) {
    return parseDER(data, type, '', type);
  },
  parseKey: function parseKey(data, passphrase) {
    if (Buffer.isBuffer(data))
      data = data.toString('utf8').trim();
    else if (typeof data !== 'string')
      return new Error('Key data must be a Buffer or string');
    else
      data = data.trim();

    // intentional !=
    if (passphrase != undefined) {
      if (typeof passphrase === 'string')
        passphrase = Buffer.from(passphrase);
      else if (!Buffer.isBuffer(passphrase))
        return new Error('Passphrase must be a string or Buffer when supplied');
    }

    var ret;

    // Private keys
    if ((ret = OpenSSH_Private.parse(data, passphrase)) !== null)
      return ret;
    if ((ret = OpenSSH_Old_Private.parse(data, passphrase)) !== null)
      return ret;
    if ((ret = PPK_Private.parse(data, passphrase)) !== null)
      return ret;

    // Public keys
    if ((ret = OpenSSH_Public.parse(data)) !== null)
      return ret;
    if ((ret = RFC4716_Public.parse(data)) !== null)
      return ret;

    return new Error('Unsupported key format');
  }
}
