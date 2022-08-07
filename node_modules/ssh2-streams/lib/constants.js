var i;
var keys;
var len;

var crypto = require('crypto');
var eddsaSupported = (function() {
  if (typeof crypto.sign === 'function'
      && typeof crypto.verify === 'function') {
    var key = '-----BEGIN PRIVATE KEY-----\r\nMC4CAQAwBQYDK2VwBCIEIHKj+sVa9WcD'
              + '/q2DJUJaf43Kptc8xYuUQA4bOFj9vC8T\r\n-----END PRIVATE KEY-----';
    var data = Buffer.from('a');
    var sig;
    var verified;
    try {
      sig = crypto.sign(null, data, key);
      verified = crypto.verify(null, data, key, sig);
    } catch (ex) {}
    return (Buffer.isBuffer(sig) && sig.length === 64 && verified === true);
  }

  return false;
})();

var curve25519Supported = (typeof crypto.diffieHellman === 'function'
                           && typeof crypto.generateKeyPairSync === 'function'
                           && typeof crypto.createPublicKey === 'function');

var MESSAGE = exports.MESSAGE = {
  // Transport layer protocol -- generic (1-19)
  DISCONNECT: 1,
  IGNORE: 2,
  UNIMPLEMENTED: 3,
  DEBUG: 4,
  SERVICE_REQUEST: 5,
  SERVICE_ACCEPT: 6,

  // Transport layer protocol -- algorithm negotiation (20-29)
  KEXINIT: 20,
  NEWKEYS: 21,

  // Transport layer protocol -- key exchange method-specific (30-49)

  // User auth protocol -- generic (50-59)
  USERAUTH_REQUEST: 50,
  USERAUTH_FAILURE: 51,
  USERAUTH_SUCCESS: 52,
  USERAUTH_BANNER: 53,

  // User auth protocol -- user auth method-specific (60-79)

  // Connection protocol -- generic (80-89)
  GLOBAL_REQUEST: 80,
  REQUEST_SUCCESS: 81,
  REQUEST_FAILURE: 82,

  // Connection protocol -- channel-related (90-127)
  CHANNEL_OPEN: 90,
  CHANNEL_OPEN_CONFIRMATION: 91,
  CHANNEL_OPEN_FAILURE: 92,
  CHANNEL_WINDOW_ADJUST: 93,
  CHANNEL_DATA: 94,
  CHANNEL_EXTENDED_DATA: 95,
  CHANNEL_EOF: 96,
  CHANNEL_CLOSE: 97,
  CHANNEL_REQUEST: 98,
  CHANNEL_SUCCESS: 99,
  CHANNEL_FAILURE: 100

  // Reserved for client protocols (128-191)

  // Local extensions (192-155)
};
for (i = 0, keys = Object.keys(MESSAGE), len = keys.length; i < len; ++i)
  MESSAGE[MESSAGE[keys[i]]] = keys[i];
// context-specific message codes:
MESSAGE.KEXDH_INIT = 30;
MESSAGE.KEXDH_REPLY = 31;
MESSAGE.KEXDH_GEX_REQUEST = 34;
MESSAGE.KEXDH_GEX_GROUP = 31;
MESSAGE.KEXDH_GEX_INIT = 32;
MESSAGE.KEXDH_GEX_REPLY = 33;
MESSAGE.KEXECDH_INIT = 30; // included here for completeness
MESSAGE.KEXECDH_REPLY = 31; // included here for completeness
MESSAGE.USERAUTH_PASSWD_CHANGEREQ = 60;
MESSAGE.USERAUTH_PK_OK = 60;
MESSAGE.USERAUTH_INFO_REQUEST = 60;
MESSAGE.USERAUTH_INFO_RESPONSE = 61;

var DYNAMIC_KEXDH_MESSAGE = exports.DYNAMIC_KEXDH_MESSAGE = {};
DYNAMIC_KEXDH_MESSAGE[MESSAGE.KEXDH_GEX_GROUP] = 'KEXDH_GEX_GROUP';
DYNAMIC_KEXDH_MESSAGE[MESSAGE.KEXDH_GEX_REPLY] = 'KEXDH_GEX_REPLY';

var KEXDH_MESSAGE = exports.KEXDH_MESSAGE = {};
KEXDH_MESSAGE[MESSAGE.KEXDH_INIT] = 'KEXDH_INIT';
KEXDH_MESSAGE[MESSAGE.KEXDH_REPLY] = 'KEXDH_REPLY';

var DISCONNECT_REASON = exports.DISCONNECT_REASON = {
  HOST_NOT_ALLOWED_TO_CONNECT: 1,
  PROTOCOL_ERROR: 2,
  KEY_EXCHANGE_FAILED: 3,
  RESERVED: 4,
  MAC_ERROR: 5,
  COMPRESSION_ERROR: 6,
  SERVICE_NOT_AVAILABLE: 7,
  PROTOCOL_VERSION_NOT_SUPPORTED: 8,
  HOST_KEY_NOT_VERIFIABLE: 9,
  CONNECTION_LOST: 10,
  BY_APPLICATION: 11,
  TOO_MANY_CONNECTIONS: 12,
  AUTH_CANCELED_BY_USER: 13,
  NO_MORE_AUTH_METHODS_AVAILABLE: 14,
  ILLEGAL_USER_NAME: 15
};
for (i = 0, keys = Object.keys(DISCONNECT_REASON), len = keys.length;
     i < len;
     ++i) {
  DISCONNECT_REASON[DISCONNECT_REASON[keys[i]]] = keys[i];
}

var CHANNEL_OPEN_FAILURE = exports.CHANNEL_OPEN_FAILURE = {
  ADMINISTRATIVELY_PROHIBITED: 1,
  CONNECT_FAILED: 2,
  UNKNOWN_CHANNEL_TYPE: 3,
  RESOURCE_SHORTAGE: 4
};
for (i = 0, keys = Object.keys(CHANNEL_OPEN_FAILURE), len = keys.length;
     i < len;
     ++i) {
  CHANNEL_OPEN_FAILURE[CHANNEL_OPEN_FAILURE[keys[i]]] = keys[i];
}

var TERMINAL_MODE = exports.TERMINAL_MODE = {
  TTY_OP_END: 0,        // Indicates end of options.
  VINTR: 1,             // Interrupt character; 255 if none. Similarly for the
                        //  other characters.  Not all of these characters are
                        //  supported on all systems.
  VQUIT: 2,             // The quit character (sends SIGQUIT signal on POSIX
                        //  systems).
  VERASE: 3,            // Erase the character to left of the cursor.
  VKILL: 4,             // Kill the current input line.
  VEOF: 5,              // End-of-file character (sends EOF from the terminal).
  VEOL: 6,              // End-of-line character in addition to carriage return
                        //  and/or linefeed.
  VEOL2: 7,             // Additional end-of-line character.
  VSTART: 8,            // Continues paused output (normally control-Q).
  VSTOP: 9,             // Pauses output (normally control-S).
  VSUSP: 10,            // Suspends the current program.
  VDSUSP: 11,           // Another suspend character.
  VREPRINT: 12,         // Reprints the current input line.
  VWERASE: 13,          // Erases a word left of cursor.
  VLNEXT: 14,           // Enter the next character typed literally, even if it
                        //  is a special character
  VFLUSH: 15,           // Character to flush output.
  VSWTCH: 16,           // Switch to a different shell layer.
  VSTATUS: 17,          // Prints system status line (load, command, pid, etc).
  VDISCARD: 18,         // Toggles the flushing of terminal output.
  IGNPAR: 30,           // The ignore parity flag.  The parameter SHOULD be 0
                        //  if this flag is FALSE, and 1 if it is TRUE.
  PARMRK: 31,           // Mark parity and framing errors.
  INPCK: 32,            // Enable checking of parity errors.
  ISTRIP: 33,           // Strip 8th bit off characters.
  INLCR: 34,            // Map NL into CR on input.
  IGNCR: 35,            // Ignore CR on input.
  ICRNL: 36,            // Map CR to NL on input.
  IUCLC: 37,            // Translate uppercase characters to lowercase.
  IXON: 38,             // Enable output flow control.
  IXANY: 39,            // Any char will restart after stop.
  IXOFF: 40,            // Enable input flow control.
  IMAXBEL: 41,          // Ring bell on input queue full.
  ISIG: 50,             // Enable signals INTR, QUIT, [D]SUSP.
  ICANON: 51,           // Canonicalize input lines.
  XCASE: 52,            // Enable input and output of uppercase characters by
                        //  preceding their lowercase equivalents with "\".
  ECHO: 53,             // Enable echoing.
  ECHOE: 54,            // Visually erase chars.
  ECHOK: 55,            // Kill character discards current line.
  ECHONL: 56,           // Echo NL even if ECHO is off.
  NOFLSH: 57,           // Don't flush after interrupt.
  TOSTOP: 58,           // Stop background jobs from output.
  IEXTEN: 59,           // Enable extensions.
  ECHOCTL: 60,          // Echo control characters as ^(Char).
  ECHOKE: 61,           // Visual erase for line kill.
  PENDIN: 62,           // Retype pending input.
  OPOST: 70,            // Enable output processing.
  OLCUC: 71,            // Convert lowercase to uppercase.
  ONLCR: 72,            // Map NL to CR-NL.
  OCRNL: 73,            // Translate carriage return to newline (output).
  ONOCR: 74,            // Translate newline to carriage return-newline
                        // (output).
  ONLRET: 75,           // Newline performs a carriage return (output).
  CS7: 90,              // 7 bit mode.
  CS8: 91,              // 8 bit mode.
  PARENB: 92,           // Parity enable.
  PARODD: 93,           // Odd parity, else even.
  TTY_OP_ISPEED: 128,   // Specifies the input baud rate in bits per second.
  TTY_OP_OSPEED: 129    // Specifies the output baud rate in bits per second.
};
for (i = 0, keys = Object.keys(TERMINAL_MODE), len = keys.length; i < len; ++i)
  TERMINAL_MODE[TERMINAL_MODE[keys[i]]] = keys[i];

var CHANNEL_EXTENDED_DATATYPE = exports.CHANNEL_EXTENDED_DATATYPE = {
  STDERR: 1
};
for (i = 0, keys = Object.keys(CHANNEL_EXTENDED_DATATYPE), len = keys.length;
     i < len;
     ++i) {
  CHANNEL_EXTENDED_DATATYPE[CHANNEL_EXTENDED_DATATYPE[keys[i]]] = keys[i];
}

exports.SIGNALS = ['ABRT', 'ALRM', 'FPE', 'HUP', 'ILL', 'INT',
                   'QUIT', 'SEGV', 'TERM', 'USR1', 'USR2', 'KILL',
                   'PIPE'];

var DEFAULT_KEX = [
  // https://tools.ietf.org/html/rfc5656#section-10.1
  'ecdh-sha2-nistp256',
  'ecdh-sha2-nistp384',
  'ecdh-sha2-nistp521',

  // https://tools.ietf.org/html/rfc4419#section-4
  'diffie-hellman-group-exchange-sha256',

  'diffie-hellman-group14-sha256',
  'diffie-hellman-group16-sha512',
  'diffie-hellman-group18-sha512',

  'diffie-hellman-group14-sha1', // REQUIRED
];
if (curve25519Supported) {
  DEFAULT_KEX.unshift('curve25519-sha256');
  DEFAULT_KEX.unshift('curve25519-sha256@libssh.org');
}
var SUPPORTED_KEX = [
  // https://tools.ietf.org/html/rfc4419#section-4
  'diffie-hellman-group-exchange-sha1',

  'diffie-hellman-group1-sha1'  // REQUIRED
];
var KEX_BUF = Buffer.from(DEFAULT_KEX.join(','), 'ascii');
SUPPORTED_KEX = DEFAULT_KEX.concat(SUPPORTED_KEX);

var DEFAULT_SERVER_HOST_KEY = [
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-rsa',
];
if (eddsaSupported)
  DEFAULT_SERVER_HOST_KEY.unshift('ssh-ed25519');
var SUPPORTED_SERVER_HOST_KEY = [
  'ssh-dss'
];
var SERVER_HOST_KEY_BUF = Buffer.from(DEFAULT_SERVER_HOST_KEY.join(','),
                                      'ascii');
SUPPORTED_SERVER_HOST_KEY = DEFAULT_SERVER_HOST_KEY.concat(
  SUPPORTED_SERVER_HOST_KEY
);

var DEFAULT_CIPHER = [
  // http://tools.ietf.org/html/rfc4344#section-4
  'aes128-ctr',
  'aes192-ctr',
  'aes256-ctr',

  // http://tools.ietf.org/html/rfc5647
  'aes128-gcm',
  'aes128-gcm@openssh.com',
  'aes256-gcm',
  'aes256-gcm@openssh.com'
];
var SUPPORTED_CIPHER = [
  'aes256-cbc',
  'aes192-cbc',
  'aes128-cbc',
  'blowfish-cbc',
  '3des-cbc',

  // http://tools.ietf.org/html/rfc4345#section-4:
  'arcfour256',
  'arcfour128',

  'cast128-cbc',
  'arcfour'
];
var CIPHER_BUF = Buffer.from(DEFAULT_CIPHER.join(','), 'ascii');
SUPPORTED_CIPHER = DEFAULT_CIPHER.concat(SUPPORTED_CIPHER);

var DEFAULT_HMAC = [
  'hmac-sha2-256',
  'hmac-sha2-512',
  'hmac-sha1',
];
var SUPPORTED_HMAC = [
  'hmac-md5',
  'hmac-sha2-256-96', // first 96 bits of HMAC-SHA256
  'hmac-sha2-512-96', // first 96 bits of HMAC-SHA512
  'hmac-ripemd160',
  'hmac-sha1-96',     // first 96 bits of HMAC-SHA1
  'hmac-md5-96'       // first 96 bits of HMAC-MD5
];
var HMAC_BUF = Buffer.from(DEFAULT_HMAC.join(','), 'ascii');
SUPPORTED_HMAC = DEFAULT_HMAC.concat(SUPPORTED_HMAC);

var DEFAULT_COMPRESS = [
  'none',
  'zlib@openssh.com', // ZLIB (LZ77) compression, except
                      // compression/decompression does not start until after
                      // successful user authentication
  'zlib'              // ZLIB (LZ77) compression
];
var SUPPORTED_COMPRESS = [];
var COMPRESS_BUF = Buffer.from(DEFAULT_COMPRESS.join(','), 'ascii');
SUPPORTED_COMPRESS = DEFAULT_COMPRESS.concat(SUPPORTED_COMPRESS);

function makeCipherInfo(blockLen, keyLen, ivLen, authLen, discardLen, stream) {
  return {
    blockLen: blockLen,
    keyLen: keyLen,
    ivLen: ivLen === 0 ? blockLen : ivLen,
    authLen: authLen,
    discardLen: discardLen,
    stream: stream,
  };
}
exports.CIPHER_INFO = {
  'aes128-gcm': makeCipherInfo(16, 16, 12, 16, 0, false),
  'aes256-gcm': makeCipherInfo(16, 32, 12, 16, 0, false),
  'aes128-gcm@openssh.com': makeCipherInfo(16, 16, 12, 16, 0, false),
  'aes256-gcm@openssh.com': makeCipherInfo(16, 32, 12, 16, 0, false),

  'aes128-cbc': makeCipherInfo(16, 16, 0, 0, 0, false),
  'aes192-cbc': makeCipherInfo(16, 24, 0, 0, 0, false),
  'aes256-cbc': makeCipherInfo(16, 32, 0, 0, 0, false),
  'rijndael-cbc@lysator.liu.se': makeCipherInfo(16, 32, 0, 0, 0, false),
  '3des-cbc': makeCipherInfo(8, 24, 0, 0, 0, false),
  'blowfish-cbc': makeCipherInfo(8, 16, 0, 0, 0, false),
  'idea-cbc': makeCipherInfo(8, 16, 0, 0, 0, false),
  'cast128-cbc': makeCipherInfo(8, 16, 0, 0, 0, false),
  'camellia128-cbc': makeCipherInfo(16, 16, 0, 0, 0, false),
  'camellia192-cbc': makeCipherInfo(16, 24, 0, 0, 0, false),
  'camellia256-cbc': makeCipherInfo(16, 32, 0, 0, 0, false),
  'camellia128-cbc@openssh.com': makeCipherInfo(16, 16, 0, 0, 0, false),
  'camellia192-cbc@openssh.com': makeCipherInfo(16, 24, 0, 0, 0, false),
  'camellia256-cbc@openssh.com': makeCipherInfo(16, 32, 0, 0, 0, false),

  'aes128-ctr': makeCipherInfo(16, 16, 0, 0, 0, false),
  'aes192-ctr': makeCipherInfo(16, 24, 0, 0, 0, false),
  'aes256-ctr': makeCipherInfo(16, 32, 0, 0, 0, false),
  '3des-ctr': makeCipherInfo(8, 24, 0, 0, 0, false),
  'blowfish-ctr': makeCipherInfo(8, 16, 0, 0, 0, false),
  'cast128-ctr': makeCipherInfo(8, 16, 0, 0, 0, false),
  'camellia128-ctr': makeCipherInfo(16, 16, 0, 0, 0, false),
  'camellia192-ctr': makeCipherInfo(16, 24, 0, 0, 0, false),
  'camellia256-ctr': makeCipherInfo(16, 32, 0, 0, 0, false),
  'camellia128-ctr@openssh.com': makeCipherInfo(16, 16, 0, 0, 0, false),
  'camellia192-ctr@openssh.com': makeCipherInfo(16, 24, 0, 0, 0, false),
  'camellia256-ctr@openssh.com': makeCipherInfo(16, 32, 0, 0, 0, false),

  /* The "arcfour128" algorithm is the RC4 cipher, as described in
     [SCHNEIER], using a 128-bit key.  The first 1536 bytes of keystream
     generated by the cipher MUST be discarded, and the first byte of the
     first encrypted packet MUST be encrypted using the 1537th byte of
     keystream.

     -- http://tools.ietf.org/html/rfc4345#section-4 */
  'arcfour': makeCipherInfo(8, 16, 0, 0, 1536, true),
  'arcfour128': makeCipherInfo(8, 16, 0, 0, 1536, true),
  'arcfour256': makeCipherInfo(8, 32, 0, 0, 1536, true),
  'arcfour512': makeCipherInfo(8, 64, 0, 0, 1536, true),
};

function makeHMACInfo(len, actualLen) {
  return { len: len, actualLen: actualLen };
}
exports.HMAC_INFO = {
  'hmac-md5': makeHMACInfo(16, 16),
  'hmac-md5-96': makeHMACInfo(16, 12),
  'hmac-ripemd160': makeHMACInfo(20, 20),
  'hmac-sha1': makeHMACInfo(20, 20),
  'hmac-sha1-96': makeHMACInfo(20, 12),
  'hmac-sha2-256': makeHMACInfo(32, 32),
  'hmac-sha2-256-96': makeHMACInfo(32, 12),
  'hmac-sha2-512': makeHMACInfo(64, 64),
  'hmac-sha2-512-96': makeHMACInfo(64, 12),
};

exports.ALGORITHMS = {
  KEX: DEFAULT_KEX,
  KEX_BUF: KEX_BUF,
  SUPPORTED_KEX: SUPPORTED_KEX,

  SERVER_HOST_KEY: DEFAULT_SERVER_HOST_KEY,
  SERVER_HOST_KEY_BUF: SERVER_HOST_KEY_BUF,
  SUPPORTED_SERVER_HOST_KEY: SUPPORTED_SERVER_HOST_KEY,

  CIPHER: DEFAULT_CIPHER,
  CIPHER_BUF: CIPHER_BUF,
  SUPPORTED_CIPHER: SUPPORTED_CIPHER,

  HMAC: DEFAULT_HMAC,
  HMAC_BUF: HMAC_BUF,
  SUPPORTED_HMAC: SUPPORTED_HMAC,

  COMPRESS: DEFAULT_COMPRESS,
  COMPRESS_BUF: COMPRESS_BUF,
  SUPPORTED_COMPRESS: SUPPORTED_COMPRESS
};
exports.SSH_TO_OPENSSL = {
  // ECDH key exchange
  'ecdh-sha2-nistp256': 'prime256v1', // OpenSSL's name for 'secp256r1'
  'ecdh-sha2-nistp384': 'secp384r1',
  'ecdh-sha2-nistp521': 'secp521r1',
  // Ciphers
  'aes128-gcm': 'aes-128-gcm',
  'aes256-gcm': 'aes-256-gcm',
  'aes128-gcm@openssh.com': 'aes-128-gcm',
  'aes256-gcm@openssh.com': 'aes-256-gcm',
  '3des-cbc': 'des-ede3-cbc',
  'blowfish-cbc': 'bf-cbc',
  'aes256-cbc': 'aes-256-cbc',
  'aes192-cbc': 'aes-192-cbc',
  'aes128-cbc': 'aes-128-cbc',
  'idea-cbc': 'idea-cbc',
  'cast128-cbc': 'cast-cbc',
  'rijndael-cbc@lysator.liu.se': 'aes-256-cbc',
  'arcfour128': 'rc4',
  'arcfour256': 'rc4',
  'arcfour512': 'rc4',
  'arcfour': 'rc4',
  'camellia128-cbc': 'camellia-128-cbc',
  'camellia192-cbc': 'camellia-192-cbc',
  'camellia256-cbc': 'camellia-256-cbc',
  'camellia128-cbc@openssh.com': 'camellia-128-cbc',
  'camellia192-cbc@openssh.com': 'camellia-192-cbc',
  'camellia256-cbc@openssh.com': 'camellia-256-cbc',
  '3des-ctr': 'des-ede3',
  'blowfish-ctr': 'bf-ecb',
  'aes256-ctr': 'aes-256-ctr',
  'aes192-ctr': 'aes-192-ctr',
  'aes128-ctr': 'aes-128-ctr',
  'cast128-ctr': 'cast5-ecb',
  'camellia128-ctr': 'camellia-128-ecb',
  'camellia192-ctr': 'camellia-192-ecb',
  'camellia256-ctr': 'camellia-256-ecb',
  'camellia128-ctr@openssh.com': 'camellia-128-ecb',
  'camellia192-ctr@openssh.com': 'camellia-192-ecb',
  'camellia256-ctr@openssh.com': 'camellia-256-ecb',
  // HMAC
  'hmac-sha1-96': 'sha1',
  'hmac-sha1': 'sha1',
  'hmac-sha2-256': 'sha256',
  'hmac-sha2-256-96': 'sha256',
  'hmac-sha2-512': 'sha512',
  'hmac-sha2-512-96': 'sha512',
  'hmac-md5-96': 'md5',
  'hmac-md5': 'md5',
  'hmac-ripemd160': 'ripemd160'
};

var BUGS = exports.BUGS = {
  BAD_DHGEX: 1,
  OLD_EXIT: 2,
  DYN_RPORT_BUG: 4
};

exports.BUGGY_IMPLS = [
  [ 'Cisco-1.25', BUGS.BAD_DHGEX ],
  [ /^[0-9.]+$/, BUGS.OLD_EXIT ], // old SSH.com implementations
  [ /^OpenSSH_5\.\d+/, BUGS.DYN_RPORT_BUG ]
];

exports.EDDSA_SUPPORTED = eddsaSupported;
exports.CURVE25519_SUPPORTED = curve25519Supported;
