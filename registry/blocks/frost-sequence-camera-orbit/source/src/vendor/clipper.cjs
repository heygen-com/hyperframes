/*******************************************************************************
 *                                                                              *
 * Author    :  Angus Johnson                                                   *
 * Version   :  6.4.2                                                           *
 * Date      :  27 February 2017                                                *
 * Website   :  http://www.angusj.com                                           *
 * Copyright :  Angus Johnson 2010-2017                                         *
 *                                                                              *
 * License:                                                                     *
 * Use, modification & distribution is subject to Boost Software License Ver 1. *
 * http://www.boost.org/LICENSE_1_0.txt                                         *
 *                                                                              *
 * Attributions:                                                                *
 * The code in this library is an extension of Bala Vatti's clipping algorithm: *
 * "A generic solution to polygon clipping"                                     *
 * Communications of the ACM, Vol 35, Issue 7 (July 1992) pp 56-63.             *
 * http://portal.acm.org/citation.cfm?id=129906                                 *
 *                                                                              *
 * Computer graphics and geometric modeling: implementation and algorithms      *
 * By Max K. Agoston                                                            *
 * Springer; 1 edition (January 4, 2005)                                        *
 * http://books.google.com/books?q=vatti+clipping+agoston                       *
 *                                                                              *
 * See also:                                                                    *
 * "Polygon Offsetting by Computing Winding Numbers"                            *
 * Paper no. DETC2005-85513 pp. 565-575                                         *
 * ASME 2005 International Design Engineering Technical Conferences             *
 * and Computers and Information in Engineering Conference (IDETC/CIE2005)      *
 * September 24-28, 2005 , Long Beach, California, USA                          *
 * http://www.me.berkeley.edu/~mcmains/pubs/DAC05OffsetPolygon.pdf              *
 *                                                                              *
 *******************************************************************************/
/*******************************************************************************
 *                                                                              *
 * Author    :  Timo                                                            *
 * Version   :  6.4.2.2                                                         *
 * Date      :  8 September 2017                                                 *
 *                                                                              *
 * This is a translation of the C# Clipper library to Javascript.               *
 * Int128 struct of C# is implemented using JSBN of Tom Wu.                     *
 * Because Javascript lacks support for 64-bit integers, the space              *
 * is a little more restricted than in C# version.                              *
 *                                                                              *
 * C# version has support for coordinate space:                                 *
 * +-4611686018427387903 ( sqrt(2^127 -1)/2 )                                   *
 * while Javascript version has support for space:                              *
 * +-4503599627370495 ( sqrt(2^106 -1)/2 )                                      *
 *                                                                              *
 * Tom Wu's JSBN proved to be the fastest big integer library:                  *
 * http://jsperf.com/big-integer-library-test                                   *
 *                                                                              *
 * This class can be made simpler when (if ever) 64-bit integer support comes   *
 * or floating point Clipper is released.                                       *
 *                                                                              *
 *******************************************************************************/
/*******************************************************************************
 *                                                                              *
 * Basic JavaScript BN library - subset useful for RSA encryption.              *
 * http://www-cs-students.stanford.edu/~tjw/jsbn/                               *
 * Copyright (c) 2005  Tom Wu                                                   *
 * All Rights Reserved.                                                         *
 * See "LICENSE" for details:                                                   *
 * http://www-cs-students.stanford.edu/~tjw/jsbn/LICENSE                        *
 *                                                                              *
 *******************************************************************************/
(function () {
  "use strict";
  var ClipperLib = {};
  ClipperLib.version = "6.4.2.2";

  //UseLines: Enables open path clipping. Adds a very minor cost to performance.
  ClipperLib.use_lines = true;

  //ClipperLib.use_xyz: adds a Z member to IntPoint. Adds a minor cost to performance.
  ClipperLib.use_xyz = false;

  var isNode = false;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ClipperLib;
    isNode = true;
  } else {
    if (typeof define === "function" && define.amd) {
      define(ClipperLib);
    }
    if (typeof document !== "undefined") window.ClipperLib = ClipperLib;
    else self["ClipperLib"] = ClipperLib;
  }
  var navigator_appName;
  if (!isNode) {
    var nav = navigator.userAgent.toString().toLowerCase();
    navigator_appName = navigator.appName;
  } else {
    var nav = "chrome"; // Node.js uses Chrome's V8 engine
    navigator_appName = "Netscape"; // Firefox, Chrome and Safari returns "Netscape", so Node.js should also
  }
  // Browser test to speedup performance critical functions
  var browser = {};

  if (nav.indexOf("chrome") != -1 && nav.indexOf("chromium") == -1) browser.chrome = 1;
  else browser.chrome = 0;
  if (nav.indexOf("chromium") != -1) browser.chromium = 1;
  else browser.chromium = 0;
  if (nav.indexOf("safari") != -1 && nav.indexOf("chrome") == -1 && nav.indexOf("chromium") == -1)
    browser.safari = 1;
  else browser.safari = 0;
  if (nav.indexOf("firefox") != -1) browser.firefox = 1;
  else browser.firefox = 0;
  if (nav.indexOf("firefox/17") != -1) browser.firefox17 = 1;
  else browser.firefox17 = 0;
  if (nav.indexOf("firefox/15") != -1) browser.firefox15 = 1;
  else browser.firefox15 = 0;
  if (nav.indexOf("firefox/3") != -1) browser.firefox3 = 1;
  else browser.firefox3 = 0;
  if (nav.indexOf("opera") != -1) browser.opera = 1;
  else browser.opera = 0;
  if (nav.indexOf("msie 10") != -1) browser.msie10 = 1;
  else browser.msie10 = 0;
  if (nav.indexOf("msie 9") != -1) browser.msie9 = 1;
  else browser.msie9 = 0;
  if (nav.indexOf("msie 8") != -1) browser.msie8 = 1;
  else browser.msie8 = 0;
  if (nav.indexOf("msie 7") != -1) browser.msie7 = 1;
  else browser.msie7 = 0;
  if (nav.indexOf("msie ") != -1) browser.msie = 1;
  else browser.msie = 0;
  ClipperLib.biginteger_used = null;

  // Copyright (c) 2005  Tom Wu
  // All Rights Reserved.
  // See "LICENSE" for details.
  // Basic JavaScript BN library - subset useful for RSA encryption.
  // Bits per digit
  var dbits;
  // JavaScript engine analysis
  var canary = 0xdeadbeefcafe;
  var j_lm = (canary & 0xffffff) == 0xefcafe;
  // (public) Constructor
  /**
   * @constructor
   */
  function BigInteger(a, b, c) {
    // This test variable can be removed,
    // but at least for performance tests it is useful piece of knowledge
    // This is the only ClipperLib related variable in BigInteger library
    ClipperLib.biginteger_used = 1;
    if (a != null)
      if ("number" == typeof a && "undefined" == typeof b)
        this.fromInt(a); // faster conversion
      else if ("number" == typeof a) this.fromNumber(a, b, c);
      else if (b == null && "string" != typeof a) this.fromString(a, 256);
      else this.fromString(a, b);
  }
  // return new, unset BigInteger
  function nbi() {
    return new BigInteger(null, undefined, undefined);
  }
  // am: Compute w_j += (x*this_i), propagate carries,
  // c is initial carry, returns final carry.
  // c < 3*dvalue, x < 2*dvalue, this_i < dvalue
  // We need to select the fastest one that works in this environment.
  // am1: use a single mult and divide to get the high bits,
  // max digit bits should be 26 because
  // max internal value = 2*dvalue^2-2*dvalue (< 2^53)
  function am1(i, x, w, j, c, n) {
    while (--n >= 0) {
      var v = x * this[i++] + w[j] + c;
      c = Math.floor(v / 0x4000000);
      w[j++] = v & 0x3ffffff;
    }
    return c;
  }
  // am2 avoids a big mult-and-extract completely.
  // Max digit bits should be <= 30 because we do bitwise ops
  // on values up to 2*hdvalue^2-hdvalue-1 (< 2^31)
  function am2(i, x, w, j, c, n) {
    var xl = x & 0x7fff,
      xh = x >> 15;
    while (--n >= 0) {
      var l = this[i] & 0x7fff;
      var h = this[i++] >> 15;
      var m = xh * l + h * xl;
      l = xl * l + ((m & 0x7fff) << 15) + w[j] + (c & 0x3fffffff);
      c = (l >>> 30) + (m >>> 15) + xh * h + (c >>> 30);
      w[j++] = l & 0x3fffffff;
    }
    return c;
  }
  // Alternately, set max digit bits to 28 since some
  // browsers slow down when dealing with 32-bit numbers.
  function am3(i, x, w, j, c, n) {
    var xl = x & 0x3fff,
      xh = x >> 14;
    while (--n >= 0) {
      var l = this[i] & 0x3fff;
      var h = this[i++] >> 14;
      var m = xh * l + h * xl;
      l = xl * l + ((m & 0x3fff) << 14) + w[j] + c;
      c = (l >> 28) + (m >> 14) + xh * h;
      w[j++] = l & 0xfffffff;
    }
    return c;
  }
  if (j_lm && navigator_appName == "Microsoft Internet Explorer") {
    BigInteger.prototype.am = am2;
    dbits = 30;
  } else if (j_lm && navigator_appName != "Netscape") {
    BigInteger.prototype.am = am1;
    dbits = 26;
  } else {
    // Mozilla/Netscape seems to prefer am3
    BigInteger.prototype.am = am3;
    dbits = 28;
  }
  BigInteger.prototype.DB = dbits;
  BigInteger.prototype.DM = (1 << dbits) - 1;
  BigInteger.prototype.DV = 1 << dbits;
  var BI_FP = 52;
  BigInteger.prototype.FV = Math.pow(2, BI_FP);
  BigInteger.prototype.F1 = BI_FP - dbits;
  BigInteger.prototype.F2 = 2 * dbits - BI_FP;
  // Digit conversions
  var BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
  var BI_RC = new Array();
  var rr, vv;
  rr = "0".charCodeAt(0);
  for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
  rr = "a".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
  rr = "A".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;

  function int2char(n) {
    return BI_RM.charAt(n);
  }

  function intAt(s, i) {
    var c = BI_RC[s.charCodeAt(i)];
    return c == null ? -1 : c;
  }
  // (protected) copy this to r
  function bnpCopyTo(r) {
    for (var i = this.t - 1; i >= 0; --i) r[i] = this[i];
    r.t = this.t;
    r.s = this.s;
  }
  // (protected) set from integer value x, -DV <= x < DV
  function bnpFromInt(x) {
    this.t = 1;
    this.s = x < 0 ? -1 : 0;
    if (x > 0) this[0] = x;
    else if (x < -1) this[0] = x + this.DV;
    else this.t = 0;
  }
  // return bigint initialized to value
  function nbv(i) {
    var r = nbi();
    r.fromInt(i);
    return r;
  }
  // (protected) set from string and radix
  function bnpFromString(s, b) {
    var k;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 256)
      k = 8; // byte array
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else {
      this.fromRadix(s, b);
      return;
    }
    this.t = 0;
    this.s = 0;
    var i = s.length,
      mi = false,
      sh = 0;
    while (--i >= 0) {
      var x = k == 8 ? s[i] & 0xff : intAt(s, i);
      if (x < 0) {
        if (s.charAt(i) == "-") mi = true;
        continue;
      }
      mi = false;
      if (sh == 0) this[this.t++] = x;
      else if (sh + k > this.DB) {
        this[this.t - 1] |= (x & ((1 << (this.DB - sh)) - 1)) << sh;
        this[this.t++] = x >> (this.DB - sh);
      } else this[this.t - 1] |= x << sh;
      sh += k;
      if (sh >= this.DB) sh -= this.DB;
    }
    if (k == 8 && (s[0] & 0x80) != 0) {
      this.s = -1;
      if (sh > 0) this[this.t - 1] |= ((1 << (this.DB - sh)) - 1) << sh;
    }
    this.clamp();
    if (mi) BigInteger.ZERO.subTo(this, this);
  }
  // (protected) clamp off excess high words
  function bnpClamp() {
    var c = this.s & this.DM;
    while (this.t > 0 && this[this.t - 1] == c) --this.t;
  }
  // (public) return string representation in given radix
  function bnToString(b) {
    if (this.s < 0) return "-" + this.negate().toString(b);
    var k;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else return this.toRadix(b);
    var km = (1 << k) - 1,
      d,
      m = false,
      r = "",
      i = this.t;
    var p = this.DB - ((i * this.DB) % k);
    if (i-- > 0) {
      if (p < this.DB && (d = this[i] >> p) > 0) {
        m = true;
        r = int2char(d);
      }
      while (i >= 0) {
        if (p < k) {
          d = (this[i] & ((1 << p) - 1)) << (k - p);
          d |= this[--i] >> (p += this.DB - k);
        } else {
          d = (this[i] >> (p -= k)) & km;
          if (p <= 0) {
            p += this.DB;
            --i;
          }
        }
        if (d > 0) m = true;
        if (m) r += int2char(d);
      }
    }
    return m ? r : "0";
  }
  // (public) -this
  function bnNegate() {
    var r = nbi();
    BigInteger.ZERO.subTo(this, r);
    return r;
  }
  // (public) |this|
  function bnAbs() {
    return this.s < 0 ? this.negate() : this;
  }
  // (public) return + if this > a, - if this < a, 0 if equal
  function bnCompareTo(a) {
    var r = this.s - a.s;
    if (r != 0) return r;
    var i = this.t;
    r = i - a.t;
    if (r != 0) return this.s < 0 ? -r : r;
    while (--i >= 0) if ((r = this[i] - a[i]) != 0) return r;
    return 0;
  }
  // returns bit length of the integer x
  function nbits(x) {
    var r = 1,
      t;
    if ((t = x >>> 16) != 0) {
      x = t;
      r += 16;
    }
    if ((t = x >> 8) != 0) {
      x = t;
      r += 8;
    }
    if ((t = x >> 4) != 0) {
      x = t;
      r += 4;
    }
    if ((t = x >> 2) != 0) {
      x = t;
      r += 2;
    }
    if ((t = x >> 1) != 0) {
      x = t;
      r += 1;
    }
    return r;
  }
  // (public) return the number of bits in "this"
  function bnBitLength() {
    if (this.t <= 0) return 0;
    return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ (this.s & this.DM));
  }
  // (protected) r = this << n*DB
  function bnpDLShiftTo(n, r) {
    var i;
    for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i];
    for (i = n - 1; i >= 0; --i) r[i] = 0;
    r.t = this.t + n;
    r.s = this.s;
  }
  // (protected) r = this >> n*DB
  function bnpDRShiftTo(n, r) {
    for (var i = n; i < this.t; ++i) r[i - n] = this[i];
    r.t = Math.max(this.t - n, 0);
    r.s = this.s;
  }
  // (protected) r = this << n
  function bnpLShiftTo(n, r) {
    var bs = n % this.DB;
    var cbs = this.DB - bs;
    var bm = (1 << cbs) - 1;
    var ds = Math.floor(n / this.DB),
      c = (this.s << bs) & this.DM,
      i;
    for (i = this.t - 1; i >= 0; --i) {
      r[i + ds + 1] = (this[i] >> cbs) | c;
      c = (this[i] & bm) << bs;
    }
    for (i = ds - 1; i >= 0; --i) r[i] = 0;
    r[ds] = c;
    r.t = this.t + ds + 1;
    r.s = this.s;
    r.clamp();
  }
  // (protected) r = this >> n
  function bnpRShiftTo(n, r) {
    r.s = this.s;
    var ds = Math.floor(n / this.DB);
    if (ds >= this.t) {
      r.t = 0;
      return;
    }
    var bs = n % this.DB;
    var cbs = this.DB - bs;
    var bm = (1 << bs) - 1;
    r[0] = this[ds] >> bs;
    for (var i = ds + 1; i < this.t; ++i) {
      r[i - ds - 1] |= (this[i] & bm) << cbs;
      r[i - ds] = this[i] >> bs;
    }
    if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs;
    r.t = this.t - ds;
    r.clamp();
  }
  // (protected) r = this - a
  function bnpSubTo(a, r) {
    var i = 0,
      c = 0,
      m = Math.min(a.t, this.t);
    while (i < m) {
      c += this[i] - a[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }
    if (a.t < this.t) {
      c -= a.s;
      while (i < this.t) {
        c += this[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c += this.s;
    } else {
      c += this.s;
      while (i < a.t) {
        c -= a[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c -= a.s;
    }
    r.s = c < 0 ? -1 : 0;
    if (c < -1) r[i++] = this.DV + c;
    else if (c > 0) r[i++] = c;
    r.t = i;
    r.clamp();
  }
  // (protected) r = this * a, r != this,a (HAC 14.12)
  // "this" should be the larger one if appropriate.
  function bnpMultiplyTo(a, r) {
    var x = this.abs(),
      y = a.abs();
    var i = x.t;
    r.t = i + y.t;
    while (--i >= 0) r[i] = 0;
    for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t);
    r.s = 0;
    r.clamp();
    if (this.s != a.s) BigInteger.ZERO.subTo(r, r);
  }
  // (protected) r = this^2, r != this (HAC 14.16)
  function bnpSquareTo(r) {
    var x = this.abs();
    var i = (r.t = 2 * x.t);
    while (--i >= 0) r[i] = 0;
    for (i = 0; i < x.t - 1; ++i) {
      var c = x.am(i, x[i], r, 2 * i, 0, 1);
      if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) {
        r[i + x.t] -= x.DV;
        r[i + x.t + 1] = 1;
      }
    }
    if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1);
    r.s = 0;
    r.clamp();
  }
  // (protected) divide this by m, quotient and remainder to q, r (HAC 14.20)
  // r != q, this != m.  q or r may be null.
  function bnpDivRemTo(m, q, r) {
    var pm = m.abs();
    if (pm.t <= 0) return;
    var pt = this.abs();
    if (pt.t < pm.t) {
      if (q != null) q.fromInt(0);
      if (r != null) this.copyTo(r);
      return;
    }
    if (r == null) r = nbi();
    var y = nbi(),
      ts = this.s,
      ms = m.s;
    var nsh = this.DB - nbits(pm[pm.t - 1]); // normalize modulus
    if (nsh > 0) {
      pm.lShiftTo(nsh, y);
      pt.lShiftTo(nsh, r);
    } else {
      pm.copyTo(y);
      pt.copyTo(r);
    }
    var ys = y.t;
    var y0 = y[ys - 1];
    if (y0 == 0) return;
    var yt = y0 * (1 << this.F1) + (ys > 1 ? y[ys - 2] >> this.F2 : 0);
    var d1 = this.FV / yt,
      d2 = (1 << this.F1) / yt,
      e = 1 << this.F2;
    var i = r.t,
      j = i - ys,
      t = q == null ? nbi() : q;
    y.dlShiftTo(j, t);
    if (r.compareTo(t) >= 0) {
      r[r.t++] = 1;
      r.subTo(t, r);
    }
    BigInteger.ONE.dlShiftTo(ys, t);
    t.subTo(y, y); // "negative" y so we can replace sub with am later
    while (y.t < ys) y[y.t++] = 0;
    while (--j >= 0) {
      // Estimate quotient digit
      var qd = r[--i] == y0 ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
      if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) {
        // Try it out
        y.dlShiftTo(j, t);
        r.subTo(t, r);
        while (r[i] < --qd) r.subTo(t, r);
      }
    }
    if (q != null) {
      r.drShiftTo(ys, q);
      if (ts != ms) BigInteger.ZERO.subTo(q, q);
    }
    r.t = ys;
    r.clamp();
    if (nsh > 0) r.rShiftTo(nsh, r); // Denormalize remainder
    if (ts < 0) BigInteger.ZERO.subTo(r, r);
  }
  // (public) this mod a
  function bnMod(a) {
    var r = nbi();
    this.abs().divRemTo(a, null, r);
    if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r);
    return r;
  }
  // Modular reduction using "classic" algorithm
  /**
   * @constructor
   */
  function Classic(m) {
    this.m = m;
  }

  function cConvert(x) {
    if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m);
    else return x;
  }

  function cRevert(x) {
    return x;
  }

  function cReduce(x) {
    x.divRemTo(this.m, null, x);
  }

  function cMulTo(x, y, r) {
    x.multiplyTo(y, r);
    this.reduce(r);
  }

  function cSqrTo(x, r) {
    x.squareTo(r);
    this.reduce(r);
  }
  Classic.prototype.convert = cConvert;
  Classic.prototype.revert = cRevert;
  Classic.prototype.reduce = cReduce;
  Classic.prototype.mulTo = cMulTo;
  Classic.prototype.sqrTo = cSqrTo;
  // (protected) return "-1/this % 2^DB"; useful for Mont. reduction
  // justification:
  //         xy == 1 (mod m)
  //         xy =  1+km
  //   xy(2-xy) = (1+km)(1-km)
  // x[y(2-xy)] = 1-k^2m^2
  // x[y(2-xy)] == 1 (mod m^2)
  // if y is 1/x mod m, then y(2-xy) is 1/x mod m^2
  // should reduce x and y(2-xy) by m^2 at each step to keep size bounded.
  // JS multiply "overflows" differently from C/C++, so care is needed here.
  function bnpInvDigit() {
    if (this.t < 1) return 0;
    var x = this[0];
    if ((x & 1) == 0) return 0;
    var y = x & 3; // y == 1/x mod 2^2
    y = (y * (2 - (x & 0xf) * y)) & 0xf; // y == 1/x mod 2^4
    y = (y * (2 - (x & 0xff) * y)) & 0xff; // y == 1/x mod 2^8
    y = (y * (2 - (((x & 0xffff) * y) & 0xffff))) & 0xffff; // y == 1/x mod 2^16
    // last step - calculate inverse mod DV directly;
    // assumes 16 < DB <= 32 and assumes ability to handle 48-bit ints
    y = (y * (2 - ((x * y) % this.DV))) % this.DV; // y == 1/x mod 2^dbits
    // we really want the negative inverse, and -DV < y < DV
    return y > 0 ? this.DV - y : -y;
  }
  // Montgomery reduction
  /**
   * @constructor
   */
  function Montgomery(m) {
    this.m = m;
    this.mp = m.invDigit();
    this.mpl = this.mp & 0x7fff;
    this.mph = this.mp >> 15;
    this.um = (1 << (m.DB - 15)) - 1;
    this.mt2 = 2 * m.t;
  }
  // xR mod m
  function montConvert(x) {
    var r = nbi();
    x.abs().dlShiftTo(this.m.t, r);
    r.divRemTo(this.m, null, r);
    if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r);
    return r;
  }
  // x/R mod m
  function montRevert(x) {
    var r = nbi();
    x.copyTo(r);
    this.reduce(r);
    return r;
  }
  // x = x/R mod m (HAC 14.32)
  function montReduce(x) {
    while (x.t <= this.mt2)
      // pad x so am has enough room later
      x[x.t++] = 0;
    for (var i = 0; i < this.m.t; ++i) {
      // faster way of calculating u0 = x[i]*mp mod DV
      var j = x[i] & 0x7fff;
      var u0 = (j * this.mpl + (((j * this.mph + (x[i] >> 15) * this.mpl) & this.um) << 15)) & x.DM;
      // use am to combine the multiply-shift-add into one call
      j = i + this.m.t;
      x[j] += this.m.am(0, u0, x, i, 0, this.m.t);
      // propagate carry
      while (x[j] >= x.DV) {
        x[j] -= x.DV;
        x[++j]++;
      }
    }
    x.clamp();
    x.drShiftTo(this.m.t, x);
    if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
  }
  // r = "x^2/R mod m"; x != r
  function montSqrTo(x, r) {
    x.squareTo(r);
    this.reduce(r);
  }
  // r = "xy/R mod m"; x,y != r
  function montMulTo(x, y, r) {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  Montgomery.prototype.convert = montConvert;
  Montgomery.prototype.revert = montRevert;
  Montgomery.prototype.reduce = montReduce;
  Montgomery.prototype.mulTo = montMulTo;
  Montgomery.prototype.sqrTo = montSqrTo;
  // (protected) true iff this is even
  function bnpIsEven() {
    return (this.t > 0 ? this[0] & 1 : this.s) == 0;
  }
  // (protected) this^e, e < 2^32, doing sqr and mul with "r" (HAC 14.79)
  function bnpExp(e, z) {
    if (e > 0xffffffff || e < 1) return BigInteger.ONE;
    var r = nbi(),
      r2 = nbi(),
      g = z.convert(this),
      i = nbits(e) - 1;
    g.copyTo(r);
    while (--i >= 0) {
      z.sqrTo(r, r2);
      if ((e & (1 << i)) > 0) z.mulTo(r2, g, r);
      else {
        var t = r;
        r = r2;
        r2 = t;
      }
    }
    return z.revert(r);
  }
  // (public) this^e % m, 0 <= e < 2^32
  function bnModPowInt(e, m) {
    var z;
    if (e < 256 || m.isEven()) z = new Classic(m);
    else z = new Montgomery(m);
    return this.exp(e, z);
  }
  // protected
  BigInteger.prototype.copyTo = bnpCopyTo;
  BigInteger.prototype.fromInt = bnpFromInt;
  BigInteger.prototype.fromString = bnpFromString;
  BigInteger.prototype.clamp = bnpClamp;
  BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
  BigInteger.prototype.drShiftTo = bnpDRShiftTo;
  BigInteger.prototype.lShiftTo = bnpLShiftTo;
  BigInteger.prototype.rShiftTo = bnpRShiftTo;
  BigInteger.prototype.subTo = bnpSubTo;
  BigInteger.prototype.multiplyTo = bnpMultiplyTo;
  BigInteger.prototype.squareTo = bnpSquareTo;
  BigInteger.prototype.divRemTo = bnpDivRemTo;
  BigInteger.prototype.invDigit = bnpInvDigit;
  BigInteger.prototype.isEven = bnpIsEven;
  BigInteger.prototype.exp = bnpExp;
  // public
  BigInteger.prototype.toString = bnToString;
  BigInteger.prototype.negate = bnNegate;
  BigInteger.prototype.abs = bnAbs;
  BigInteger.prototype.compareTo = bnCompareTo;
  BigInteger.prototype.bitLength = bnBitLength;
  BigInteger.prototype.mod = bnMod;
  BigInteger.prototype.modPowInt = bnModPowInt;
  // "constants"
  BigInteger.ZERO = nbv(0);
  BigInteger.ONE = nbv(1);
  // Copyright (c) 2005-2009  Tom Wu
  // All Rights Reserved.
  // See "LICENSE" for details.
  // Extended JavaScript BN functions, required for RSA private ops.
  // Version 1.1: new BigInteger("0", 10) returns "proper" zero
  // Version 1.2: square() API, isProbablePrime fix
  // (public)
  function bnClone() {
    var r = nbi();
    this.copyTo(r);
    return r;
  }
  // (public) return value as integer
  function bnIntValue() {
    if (this.s < 0) {
      if (this.t == 1) return this[0] - this.DV;
      else if (this.t == 0) return -1;
    } else if (this.t == 1) return this[0];
    else if (this.t == 0) return 0;
    // assumes 16 < DB < 32
    return ((this[1] & ((1 << (32 - this.DB)) - 1)) << this.DB) | this[0];
  }
  // (public) return value as byte
  function bnByteValue() {
    return this.t == 0 ? this.s : (this[0] << 24) >> 24;
  }
  // (public) return value as short (assumes DB>=16)
  function bnShortValue() {
    return this.t == 0 ? this.s : (this[0] << 16) >> 16;
  }
  // (protected) return x s.t. r^x < DV
  function bnpChunkSize(r) {
    return Math.floor((Math.LN2 * this.DB) / Math.log(r));
  }
  // (public) 0 if this == 0, 1 if this > 0
  function bnSigNum() {
    if (this.s < 0) return -1;
    else if (this.t <= 0 || (this.t == 1 && this[0] <= 0)) return 0;
    else return 1;
  }
  // (protected) convert to radix string
  function bnpToRadix(b) {
    if (b == null) b = 10;
    if (this.signum() == 0 || b < 2 || b > 36) return "0";
    var cs = this.chunkSize(b);
    var a = Math.pow(b, cs);
    var d = nbv(a),
      y = nbi(),
      z = nbi(),
      r = "";
    this.divRemTo(d, y, z);
    while (y.signum() > 0) {
      r = (a + z.intValue()).toString(b).substr(1) + r;
      y.divRemTo(d, y, z);
    }
    return z.intValue().toString(b) + r;
  }
  // (protected) convert from radix string
  function bnpFromRadix(s, b) {
    this.fromInt(0);
    if (b == null) b = 10;
    var cs = this.chunkSize(b);
    var d = Math.pow(b, cs),
      mi = false,
      j = 0,
      w = 0;
    for (var i = 0; i < s.length; ++i) {
      var x = intAt(s, i);
      if (x < 0) {
        if (s.charAt(i) == "-" && this.signum() == 0) mi = true;
        continue;
      }
      w = b * w + x;
      if (++j >= cs) {
        this.dMultiply(d);
        this.dAddOffset(w, 0);
        j = 0;
        w = 0;
      }
    }
    if (j > 0) {
      this.dMultiply(Math.pow(b, j));
      this.dAddOffset(w, 0);
    }
    if (mi) BigInteger.ZERO.subTo(this, this);
  }
  // (protected) alternate constructor
  function bnpFromNumber(a, b, c) {
    if ("number" == typeof b) {
      // new BigInteger(int,int,RNG)
      if (a < 2) this.fromInt(1);
      else {
        this.fromNumber(a, c);
        if (!this.testBit(a - 1))
          // force MSB set
          this.bitwiseTo(BigInteger.ONE.shiftLeft(a - 1), op_or, this);
        if (this.isEven()) this.dAddOffset(1, 0); // force odd
        while (!this.isProbablePrime(b)) {
          this.dAddOffset(2, 0);
          if (this.bitLength() > a) this.subTo(BigInteger.ONE.shiftLeft(a - 1), this);
        }
      }
    } else {
      // new BigInteger(int,RNG)
      var x = new Array(),
        t = a & 7;
      x.length = (a >> 3) + 1;
      b.nextBytes(x);
      if (t > 0) x[0] &= (1 << t) - 1;
      else x[0] = 0;
      this.fromString(x, 256);
    }
  }
  // (public) convert to bigendian byte array
  function bnToByteArray() {
    var i = this.t,
      r = new Array();
    r[0] = this.s;
    var p = this.DB - ((i * this.DB) % 8),
      d,
      k = 0;
    if (i-- > 0) {
      if (p < this.DB && (d = this[i] >> p) != (this.s & this.DM) >> p)
        r[k++] = d | (this.s << (this.DB - p));
      while (i >= 0) {
        if (p < 8) {
          d = (this[i] & ((1 << p) - 1)) << (8 - p);
          d |= this[--i] >> (p += this.DB - 8);
        } else {
          d = (this[i] >> (p -= 8)) & 0xff;
          if (p <= 0) {
            p += this.DB;
            --i;
          }
        }
        if ((d & 0x80) != 0) d |= -256;
        if (k == 0 && (this.s & 0x80) != (d & 0x80)) ++k;
        if (k > 0 || d != this.s) r[k++] = d;
      }
    }
    return r;
  }

  function bnEquals(a) {
    return this.compareTo(a) == 0;
  }

  function bnMin(a) {
    return this.compareTo(a) < 0 ? this : a;
  }

  function bnMax(a) {
    return this.compareTo(a) > 0 ? this : a;
  }
  // (protected) r = this op a (bitwise)
  function bnpBitwiseTo(a, op, r) {
    var i,
      f,
      m = Math.min(a.t, this.t);
    for (i = 0; i < m; ++i) r[i] = op(this[i], a[i]);
    if (a.t < this.t) {
      f = a.s & this.DM;
      for (i = m; i < this.t; ++i) r[i] = op(this[i], f);
      r.t = this.t;
    } else {
      f = this.s & this.DM;
      for (i = m; i < a.t; ++i) r[i] = op(f, a[i]);
      r.t = a.t;
    }
    r.s = op(this.s, a.s);
    r.clamp();
  }
  // (public) this & a
  function op_and(x, y) {
    return x & y;
  }

  function bnAnd(a) {
    var r = nbi();
    this.bitwiseTo(a, op_and, r);
    return r;
  }
  // (public) this | a
  function op_or(x, y) {
    return x | y;
  }

  function bnOr(a) {
    var r = nbi();
    this.bitwiseTo(a, op_or, r);
    return r;
  }
  // (public) this ^ a
  function op_xor(x, y) {
    return x ^ y;
  }

  function bnXor(a) {
    var r = nbi();
    this.bitwiseTo(a, op_xor, r);
    return r;
  }
  // (public) this & ~a
  function op_andnot(x, y) {
    return x & ~y;
  }

  function bnAndNot(a) {
    var r = nbi();
    this.bitwiseTo(a, op_andnot, r);
    return r;
  }
  // (public) ~this
  function bnNot() {
    var r = nbi();
    for (var i = 0; i < this.t; ++i) r[i] = this.DM & ~this[i];
    r.t = this.t;
    r.s = ~this.s;
    return r;
  }
  // (public) this << n
  function bnShiftLeft(n) {
    var r = nbi();
    if (n < 0) this.rShiftTo(-n, r);
    else this.lShiftTo(n, r);
    return r;
  }
  // (public) this >> n
  function bnShiftRight(n) {
    var r = nbi();
    if (n < 0) this.lShiftTo(-n, r);
    else this.rShiftTo(n, r);
    return r;
  }
  // return index of lowest 1-bit in x, x < 2^31
  function lbit(x) {
    if (x == 0) return -1;
    var r = 0;
    if ((x & 0xffff) == 0) {
      x >>= 16;
      r += 16;
    }
    if ((x & 0xff) == 0) {
      x >>= 8;
      r += 8;
    }
    if ((x & 0xf) == 0) {
      x >>= 4;
      r += 4;
    }
    if ((x & 3) == 0) {
      x >>= 2;
      r += 2;
    }
    if ((x & 1) == 0) ++r;
    return r;
  }
  // (public) returns index of lowest 1-bit (or -1 if none)
  function bnGetLowestSetBit() {
    for (var i = 0; i < this.t; ++i) if (this[i] != 0) return i * this.DB + lbit(this[i]);
    if (this.s < 0) return this.t * this.DB;
    return -1;
  }
  // return number of 1 bits in x
  function cbit(x) {
    var r = 0;
    while (x != 0) {
      x &= x - 1;
      ++r;
    }
    return r;
  }
  // (public) return number of set bits
  function bnBitCount() {
    var r = 0,
      x = this.s & this.DM;
    for (var i = 0; i < this.t; ++i) r += cbit(this[i] ^ x);
    return r;
  }
  // (public) true iff nth bit is set
  function bnTestBit(n) {
    var j = Math.floor(n / this.DB);
    if (j >= this.t) return this.s != 0;
    return (this[j] & (1 << (n % this.DB))) != 0;
  }
  // (protected) this op (1<<n)
  function bnpChangeBit(n, op) {
    var r = BigInteger.ONE.shiftLeft(n);
    this.bitwiseTo(r, op, r);
    return r;
  }
  // (public) this | (1<<n)
  function bnSetBit(n) {
    return this.changeBit(n, op_or);
  }
  // (public) this & ~(1<<n)
  function bnClearBit(n) {
    return this.changeBit(n, op_andnot);
  }
  // (public) this ^ (1<<n)
  function bnFlipBit(n) {
    return this.changeBit(n, op_xor);
  }
  // (protected) r = this + a
  function bnpAddTo(a, r) {
    var i = 0,
      c = 0,
      m = Math.min(a.t, this.t);
    while (i < m) {
      c += this[i] + a[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }
    if (a.t < this.t) {
      c += a.s;
      while (i < this.t) {
        c += this[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c += this.s;
    } else {
      c += this.s;
      while (i < a.t) {
        c += a[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c += a.s;
    }
    r.s = c < 0 ? -1 : 0;
    if (c > 0) r[i++] = c;
    else if (c < -1) r[i++] = this.DV + c;
    r.t = i;
    r.clamp();
  }
  // (public) this + a
  function bnAdd(a) {
    var r = nbi();
    this.addTo(a, r);
    return r;
  }
  // (public) this - a
  function bnSubtract(a) {
    var r = nbi();
    this.subTo(a, r);
    return r;
  }
  // (public) this * a
  function bnMultiply(a) {
    var r = nbi();
    this.multiplyTo(a, r);
    return r;
  }
  // (public) this^2
  function bnSquare() {
    var r = nbi();
    this.squareTo(r);
    return r;
  }
  // (public) this / a
  function bnDivide(a) {
    var r = nbi();
    this.divRemTo(a, r, null);
    return r;
  }
  // (public) this % a
  function bnRemainder(a) {
    var r = nbi();
    this.divRemTo(a, null, r);
    return r;
  }
  // (public) [this/a,this%a]
  function bnDivideAndRemainder(a) {
    var q = nbi(),
      r = nbi();
    this.divRemTo(a, q, r);
    return new Array(q, r);
  }
  // (protected) this *= n, this >= 0, 1 < n < DV
  function bnpDMultiply(n) {
    this[this.t] = this.am(0, n - 1, this, 0, 0, this.t);
    ++this.t;
    this.clamp();
  }
  // (protected) this += n << w words, this >= 0
  function bnpDAddOffset(n, w) {
    if (n == 0) return;
    while (this.t <= w) this[this.t++] = 0;
    this[w] += n;
    while (this[w] >= this.DV) {
      this[w] -= this.DV;
      if (++w >= this.t) this[this.t++] = 0;
      ++this[w];
    }
  }
  // A "null" reducer
  /**
   * @constructor
   */
  function NullExp() {}

  function nNop(x) {
    return x;
  }

  function nMulTo(x, y, r) {
    x.multiplyTo(y, r);
  }

  function nSqrTo(x, r) {
    x.squareTo(r);
  }
  NullExp.prototype.convert = nNop;
  NullExp.prototype.revert = nNop;
  NullExp.prototype.mulTo = nMulTo;
  NullExp.prototype.sqrTo = nSqrTo;
  // (public) this^e
  function bnPow(e) {
    return this.exp(e, new NullExp());
  }
  // (protected) r = lower n words of "this * a", a.t <= n
  // "this" should be the larger one if appropriate.
  function bnpMultiplyLowerTo(a, n, r) {
    var i = Math.min(this.t + a.t, n);
    r.s = 0; // assumes a,this >= 0
    r.t = i;
    while (i > 0) r[--i] = 0;
    var j;
    for (j = r.t - this.t; i < j; ++i) r[i + this.t] = this.am(0, a[i], r, i, 0, this.t);
    for (j = Math.min(a.t, n); i < j; ++i) this.am(0, a[i], r, i, 0, n - i);
    r.clamp();
  }
  // (protected) r = "this * a" without lower n words, n > 0
  // "this" should be the larger one if appropriate.
  function bnpMultiplyUpperTo(a, n, r) {
    --n;
    var i = (r.t = this.t + a.t - n);
    r.s = 0; // assumes a,this >= 0
    while (--i >= 0) r[i] = 0;
    for (i = Math.max(n - this.t, 0); i < a.t; ++i)
      r[this.t + i - n] = this.am(n - i, a[i], r, 0, 0, this.t + i - n);
    r.clamp();
    r.drShiftTo(1, r);
  }
  // Barrett modular reduction
  /**
   * @constructor
   */
  function Barrett(m) {
    // setup Barrett
    this.r2 = nbi();
    this.q3 = nbi();
    BigInteger.ONE.dlShiftTo(2 * m.t, this.r2);
    this.mu = this.r2.divide(m);
    this.m = m;
  }

  function barrettConvert(x) {
    if (x.s < 0 || x.t > 2 * this.m.t) return x.mod(this.m);
    else if (x.compareTo(this.m) < 0) return x;
    else {
      var r = nbi();
      x.copyTo(r);
      this.reduce(r);
      return r;
    }
  }

  function barrettRevert(x) {
    return x;
  }
  // x = x mod m (HAC 14.42)
  function barrettReduce(x) {
    x.drShiftTo(this.m.t - 1, this.r2);
    if (x.t > this.m.t + 1) {
      x.t = this.m.t + 1;
      x.clamp();
    }
    this.mu.multiplyUpperTo(this.r2, this.m.t + 1, this.q3);
    this.m.multiplyLowerTo(this.q3, this.m.t + 1, this.r2);
    while (x.compareTo(this.r2) < 0) x.dAddOffset(1, this.m.t + 1);
    x.subTo(this.r2, x);
    while (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
  }
  // r = x^2 mod m; x != r
  function barrettSqrTo(x, r) {
    x.squareTo(r);
    this.reduce(r);
  }
  // r = x*y mod m; x,y != r
  function barrettMulTo(x, y, r) {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  Barrett.prototype.convert = barrettConvert;
  Barrett.prototype.revert = barrettRevert;
  Barrett.prototype.reduce = barrettReduce;
  Barrett.prototype.mulTo = barrettMulTo;
  Barrett.prototype.sqrTo = barrettSqrTo;
  // (public) this^e % m (HAC 14.85)
  function bnModPow(e, m) {
    var i = e.bitLength(),
      k,
      r = nbv(1),
      z;
    if (i <= 0) return r;
    else if (i < 18) k = 1;
    else if (i < 48) k = 3;
    else if (i < 144) k = 4;
    else if (i < 768) k = 5;
    else k = 6;
    if (i < 8) z = new Classic(m);
    else if (m.isEven()) z = new Barrett(m);
    else z = new Montgomery(m);
    // precomputation
    var g = new Array(),
      n = 3,
      k1 = k - 1,
      km = (1 << k) - 1;
    g[1] = z.convert(this);
    if (k > 1) {
      var g2 = nbi();
      z.sqrTo(g[1], g2);
      while (n <= km) {
        g[n] = nbi();
        z.mulTo(g2, g[n - 2], g[n]);
        n += 2;
      }
    }
    var j = e.t - 1,
      w,
      is1 = true,
      r2 = nbi(),
      t;
    i = nbits(e[j]) - 1;
    while (j >= 0) {
      if (i >= k1) w = (e[j] >> (i - k1)) & km;
      else {
        w = (e[j] & ((1 << (i + 1)) - 1)) << (k1 - i);
        if (j > 0) w |= e[j - 1] >> (this.DB + i - k1);
      }
      n = k;
      while ((w & 1) == 0) {
        w >>= 1;
        --n;
      }
      if ((i -= n) < 0) {
        i += this.DB;
        --j;
      }
      if (is1) {
        // ret == 1, don't bother squaring or multiplying it
        g[w].copyTo(r);
        is1 = false;
      } else {
        while (n > 1) {
          z.sqrTo(r, r2);
          z.sqrTo(r2, r);
          n -= 2;
        }
        if (n > 0) z.sqrTo(r, r2);
        else {
          t = r;
          r = r2;
          r2 = t;
        }
        z.mulTo(r2, g[w], r);
      }
      while (j >= 0 && (e[j] & (1 << i)) == 0) {
        z.sqrTo(r, r2);
        t = r;
        r = r2;
        r2 = t;
        if (--i < 0) {
          i = this.DB - 1;
          --j;
        }
      }
    }
    return z.revert(r);
  }
  // (public) gcd(this,a) (HAC 14.54)
  function bnGCD(a) {
    var x = this.s < 0 ? this.negate() : this.clone();
    var y = a.s < 0 ? a.negate() : a.clone();
    if (x.compareTo(y) < 0) {
      var t = x;
      x = y;
      y = t;
    }
    var i = x.getLowestSetBit(),
      g = y.getLowestSetBit();
    if (g < 0) return x;
    if (i < g) g = i;
    if (g > 0) {
      x.rShiftTo(g, x);
      y.rShiftTo(g, y);
    }
    while (x.signum() > 0) {
      if ((i = x.getLowestSetBit()) > 0) x.rShiftTo(i, x);
      if ((i = y.getLowestSetBit()) > 0) y.rShiftTo(i, y);
      if (x.compareTo(y) >= 0) {
        x.subTo(y, x);
        x.rShiftTo(1, x);
      } else {
        y.subTo(x, y);
        y.rShiftTo(1, y);
      }
    }
    if (g > 0) y.lShiftTo(g, y);
    return y;
  }
  // (protected) this % n, n < 2^26
  function bnpModInt(n) {
    if (n <= 0) return 0;
    var d = this.DV % n,
      r = this.s < 0 ? n - 1 : 0;
    if (this.t > 0)
      if (d == 0) r = this[0] % n;
      else for (var i = this.t - 1; i >= 0; --i) r = (d * r + this[i]) % n;
    return r;
  }
  // (public) 1/this % m (HAC 14.61)
  function bnModInverse(m) {
    var ac = m.isEven();
    if ((this.isEven() && ac) || m.signum() == 0) return BigInteger.ZERO;
    var u = m.clone(),
      v = this.clone();
    var a = nbv(1),
      b = nbv(0),
      c = nbv(0),
      d = nbv(1);
    while (u.signum() != 0) {
      while (u.isEven()) {
        u.rShiftTo(1, u);
        if (ac) {
          if (!a.isEven() || !b.isEven()) {
            a.addTo(this, a);
            b.subTo(m, b);
          }
          a.rShiftTo(1, a);
        } else if (!b.isEven()) b.subTo(m, b);
        b.rShiftTo(1, b);
      }
      while (v.isEven()) {
        v.rShiftTo(1, v);
        if (ac) {
          if (!c.isEven() || !d.isEven()) {
            c.addTo(this, c);
            d.subTo(m, d);
          }
          c.rShiftTo(1, c);
        } else if (!d.isEven()) d.subTo(m, d);
        d.rShiftTo(1, d);
      }
      if (u.compareTo(v) >= 0) {
        u.subTo(v, u);
        if (ac) a.subTo(c, a);
        b.subTo(d, b);
      } else {
        v.subTo(u, v);
        if (ac) c.subTo(a, c);
        d.subTo(b, d);
      }
    }
    if (v.compareTo(BigInteger.ONE) != 0) return BigInteger.ZERO;
    if (d.compareTo(m) >= 0) return d.subtract(m);
    if (d.signum() < 0) d.addTo(m, d);
    else return d;
    if (d.signum() < 0) return d.add(m);
    else return d;
  }
  var lowprimes = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
    101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193,
    197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307,
    311, 313, 317, 331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419, 421,
    431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509, 521, 523, 541, 547,
    557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613, 617, 619, 631, 641, 643, 647, 653, 659,
    661, 673, 677, 683, 691, 701, 709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797,
    809, 811, 821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919, 929,
    937, 941, 947, 953, 967, 971, 977, 983, 991, 997,
  ];
  var lplim = (1 << 26) / lowprimes[lowprimes.length - 1];
  // (public) test primality with certainty >= 1-.5^t
  function bnIsProbablePrime(t) {
    var i,
      x = this.abs();
    if (x.t == 1 && x[0] <= lowprimes[lowprimes.length - 1]) {
      for (i = 0; i < lowprimes.length; ++i) if (x[0] == lowprimes[i]) return true;
      return false;
    }
    if (x.isEven()) return false;
    i = 1;
    while (i < lowprimes.length) {
      var m = lowprimes[i],
        j = i + 1;
      while (j < lowprimes.length && m < lplim) m *= lowprimes[j++];
      m = x.modInt(m);
      while (i < j) if (m % lowprimes[i++] == 0) return false;
    }
    return x.millerRabin(t);
  }
  // (protected) true if probably prime (HAC 4.24, Miller-Rabin)
  function bnpMillerRabin(t) {
    var n1 = this.subtract(BigInteger.ONE);
    var k = n1.getLowestSetBit();
    if (k <= 0) return false;
    var r = n1.shiftRight(k);
    t = (t + 1) >> 1;
    if (t > lowprimes.length) t = lowprimes.length;
    var a = nbi();
    for (var i = 0; i < t; ++i) {
      //Pick bases at random, instead of starting at 2
      a.fromInt(lowprimes[Math.floor(Math.random() * lowprimes.length)]);
      var y = a.modPow(r, this);
      if (y.compareTo(BigInteger.ONE) != 0 && y.compareTo(n1) != 0) {
        var j = 1;
        while (j++ < k && y.compareTo(n1) != 0) {
          y = y.modPowInt(2, this);
          if (y.compareTo(BigInteger.ONE) == 0) return false;
        }
        if (y.compareTo(n1) != 0) return false;
      }
    }
    return true;
  }
  // protected
  BigInteger.prototype.chunkSize = bnpChunkSize;
  BigInteger.prototype.toRadix = bnpToRadix;
  BigInteger.prototype.fromRadix = bnpFromRadix;
  BigInteger.prototype.fromNumber = bnpFromNumber;
  BigInteger.prototype.bitwiseTo = bnpBitwiseTo;
  BigInteger.prototype.changeBit = bnpChangeBit;
  BigInteger.prototype.addTo = bnpAddTo;
  BigInteger.prototype.dMultiply = bnpDMultiply;
  BigInteger.prototype.dAddOffset = bnpDAddOffset;
  BigInteger.prototype.multiplyLowerTo = bnpMultiplyLowerTo;
  BigInteger.prototype.multiplyUpperTo = bnpMultiplyUpperTo;
  BigInteger.prototype.modInt = bnpModInt;
  BigInteger.prototype.millerRabin = bnpMillerRabin;
  // public
  BigInteger.prototype.clone = bnClone;
  BigInteger.prototype.intValue = bnIntValue;
  BigInteger.prototype.byteValue = bnByteValue;
  BigInteger.prototype.shortValue = bnShortValue;
  BigInteger.prototype.signum = bnSigNum;
  BigInteger.prototype.toByteArray = bnToByteArray;
  BigInteger.prototype.equals = bnEquals;
  BigInteger.prototype.min = bnMin;
  BigInteger.prototype.max = bnMax;
  BigInteger.prototype.and = bnAnd;
  BigInteger.prototype.or = bnOr;
  BigInteger.prototype.xor = bnXor;
  BigInteger.prototype.andNot = bnAndNot;
  BigInteger.prototype.not = bnNot;
  BigInteger.prototype.shiftLeft = bnShiftLeft;
  BigInteger.prototype.shiftRight = bnShiftRight;
  BigInteger.prototype.getLowestSetBit = bnGetLowestSetBit;
  BigInteger.prototype.bitCount = bnBitCount;
  BigInteger.prototype.testBit = bnTestBit;
  BigInteger.prototype.setBit = bnSetBit;
  BigInteger.prototype.clearBit = bnClearBit;
  BigInteger.prototype.flipBit = bnFlipBit;
  BigInteger.prototype.add = bnAdd;
  BigInteger.prototype.subtract = bnSubtract;
  BigInteger.prototype.multiply = bnMultiply;
  BigInteger.prototype.divide = bnDivide;
  BigInteger.prototype.remainder = bnRemainder;
  BigInteger.prototype.divideAndRemainder = bnDivideAndRemainder;
  BigInteger.prototype.modPow = bnModPow;
  BigInteger.prototype.modInverse = bnModInverse;
  BigInteger.prototype.pow = bnPow;
  BigInteger.prototype.gcd = bnGCD;
  BigInteger.prototype.isProbablePrime = bnIsProbablePrime;
  // JSBN-specific extension
  BigInteger.prototype.square = bnSquare;
  var Int128 = BigInteger;
  // BigInteger interfaces not implemented in jsbn:
  // BigInteger(int signum, byte[] magnitude)
  // double doubleValue()
  // float floatValue()
  // int hashCode()
  // long longValue()
  // static BigInteger valueOf(long val)
  // Helper functions to make BigInteger functions callable with two parameters
  // as in original C# Clipper
  Int128.prototype.IsNegative = function () {
    if (this.compareTo(Int128.ZERO) == -1) return true;
    else return false;
  };

  Int128.op_Equality = function (val1, val2) {
    if (val1.compareTo(val2) == 0) return true;
    else return false;
  };

  Int128.op_Inequality = function (val1, val2) {
    if (val1.compareTo(val2) != 0) return true;
    else return false;
  };

  Int128.op_GreaterThan = function (val1, val2) {
    if (val1.compareTo(val2) > 0) return true;
    else return false;
  };

  Int128.op_LessThan = function (val1, val2) {
    if (val1.compareTo(val2) < 0) return true;
    else return false;
  };

  Int128.op_Addition = function (lhs, rhs) {
    return new Int128(lhs, undefined, undefined).add(new Int128(rhs, undefined, undefined));
  };

  Int128.op_Subtraction = function (lhs, rhs) {
    return new Int128(lhs, undefined, undefined).subtract(new Int128(rhs, undefined, undefined));
  };

  Int128.Int128Mul = function (lhs, rhs) {
    return new Int128(lhs, undefined, undefined).multiply(new Int128(rhs, undefined, undefined));
  };

  Int128.op_Division = function (lhs, rhs) {
    return lhs.divide(rhs);
  };

  Int128.prototype.ToDouble = function () {
    return parseFloat(this.toString()); // This could be something faster
  };

  // end of Int128 section
  /*
	// Uncomment the following two lines if you want to use Int128 outside ClipperLib
	if (typeof(document) !== "undefined") window.Int128 = Int128;
	else self.Int128 = Int128;
	*/

  // ---------------------------------------------

  // Here starts the actual Clipper library:
  // Helper function to support Inheritance in Javascript
  var Inherit = function (ce, ce2) {
    var p;
    if (typeof Object.getOwnPropertyNames === "undefined") {
      for (p in ce2.prototype)
        if (typeof ce.prototype[p] === "undefined" || ce.prototype[p] === Object.prototype[p])
          ce.prototype[p] = ce2.prototype[p];
      for (p in ce2) if (typeof ce[p] === "undefined") ce[p] = ce2[p];
      ce.$baseCtor = ce2;
    } else {
      var props = Object.getOwnPropertyNames(ce2.prototype);
      for (var i = 0; i < props.length; i++)
        if (typeof Object.getOwnPropertyDescriptor(ce.prototype, props[i]) === "undefined")
          Object.defineProperty(
            ce.prototype,
            props[i],
            Object.getOwnPropertyDescriptor(ce2.prototype, props[i]),
          );
      for (p in ce2) if (typeof ce[p] === "undefined") ce[p] = ce2[p];
      ce.$baseCtor = ce2;
    }
  };

  /**
   * @constructor
   */
  ClipperLib.Path = function () {
    return [];
  };

  ClipperLib.Path.prototype.push = Array.prototype.push;

  /**
   * @constructor
   */
  ClipperLib.Paths = function () {
    return []; // Was previously [[]], but caused problems when pushed
  };

  ClipperLib.Paths.prototype.push = Array.prototype.push;

  // Preserves the calling way of original C# Clipper
  // Is essential due to compatibility, because DoublePoint is public class in original C# version
  /**
   * @constructor
   */
  ClipperLib.DoublePoint = function () {
    var a = arguments;
    this.X = 0;
    this.Y = 0;
    // public DoublePoint(DoublePoint dp)
    // public DoublePoint(IntPoint ip)
    if (a.length === 1) {
      this.X = a[0].X;
      this.Y = a[0].Y;
    } else if (a.length === 2) {
      this.X = a[0];
      this.Y = a[1];
    }
  }; // This is internal faster function when called without arguments
  /**
   * @constructor
   */
  ClipperLib.DoublePoint0 = function () {
    this.X = 0;
    this.Y = 0;
  };

  ClipperLib.DoublePoint0.prototype = ClipperLib.DoublePoint.prototype;

  // This is internal faster function when called with 1 argument (dp or ip)
  /**
   * @constructor
   */
  ClipperLib.DoublePoint1 = function (dp) {
    this.X = dp.X;
    this.Y = dp.Y;
  };

  ClipperLib.DoublePoint1.prototype = ClipperLib.DoublePoint.prototype;

  // This is internal faster function when called with 2 arguments (x and y)
  /**
   * @constructor
   */
  ClipperLib.DoublePoint2 = function (x, y) {
    this.X = x;
    this.Y = y;
  };

  ClipperLib.DoublePoint2.prototype = ClipperLib.DoublePoint.prototype;

  // PolyTree & PolyNode start
  /**
   * @suppress {missingProperties}
   */
  ClipperLib.PolyNode = function () {
    this.m_Parent = null;
    this.m_polygon = new ClipperLib.Path();
    this.m_Index = 0;
    this.m_jointype = 0;
    this.m_endtype = 0;
    this.m_Childs = [];
    this.IsOpen = false;
  };

  ClipperLib.PolyNode.prototype.IsHoleNode = function () {
    var result = true;
    var node = this.m_Parent;
    while (node !== null) {
      result = !result;
      node = node.m_Parent;
    }
    return result;
  };

  ClipperLib.PolyNode.prototype.ChildCount = function () {
    return this.m_Childs.length;
  };

  ClipperLib.PolyNode.prototype.Contour = function () {
    return this.m_polygon;
  };

  ClipperLib.PolyNode.prototype.AddChild = function (Child) {
    var cnt = this.m_Childs.length;
    this.m_Childs.push(Child);
    Child.m_Parent = this;
    Child.m_Index = cnt;
  };

  ClipperLib.PolyNode.prototype.GetNext = function () {
    if (this.m_Childs.length > 0) return this.m_Childs[0];
    else return this.GetNextSiblingUp();
  };

  ClipperLib.PolyNode.prototype.GetNextSiblingUp = function () {
    if (this.m_Parent === null) return null;
    else if (this.m_Index === this.m_Parent.m_Childs.length - 1)
      return this.m_Parent.GetNextSiblingUp();
    else return this.m_Parent.m_Childs[this.m_Index + 1];
  };

  ClipperLib.PolyNode.prototype.Childs = function () {
    return this.m_Childs;
  };

  ClipperLib.PolyNode.prototype.Parent = function () {
    return this.m_Parent;
  };

  ClipperLib.PolyNode.prototype.IsHole = function () {
    return this.IsHoleNode();
  };

  // PolyTree : PolyNode
  /**
   * @suppress {missingProperties}
   * @constructor
   */
  ClipperLib.PolyTree = function () {
    this.m_AllPolys = [];
    ClipperLib.PolyNode.call(this);
  };

  ClipperLib.PolyTree.prototype.Clear = function () {
    for (var i = 0, ilen = this.m_AllPolys.length; i < ilen; i++) this.m_AllPolys[i] = null;
    this.m_AllPolys.length = 0;
    this.m_Childs.length = 0;
  };

  ClipperLib.PolyTree.prototype.GetFirst = function () {
    if (this.m_Childs.length > 0) return this.m_Childs[0];
    else return null;
  };

  ClipperLib.PolyTree.prototype.Total = function () {
    var result = this.m_AllPolys.length;
    //with negative offsets, ignore the hidden outer polygon ...
    if (result > 0 && this.m_Childs[0] !== this.m_AllPolys[0]) result--;
    return result;
  };

  Inherit(ClipperLib.PolyTree, ClipperLib.PolyNode);

  // PolyTree & PolyNode end

  ClipperLib.Math_Abs_Int64 =
    ClipperLib.Math_Abs_Int32 =
    ClipperLib.Math_Abs_Double =
      function (a) {
        return Math.abs(a);
      };

  ClipperLib.Math_Max_Int32_Int32 = function (a, b) {
    return Math.max(a, b);
  };

  /*
	-----------------------------------
	cast_32 speedtest: http://jsperf.com/truncate-float-to-integer/2
	-----------------------------------
	*/
  if (browser.msie || browser.opera || browser.safari)
    ClipperLib.Cast_Int32 = function (a) {
      return a | 0;
    };
  else
    ClipperLib.Cast_Int32 = function (a) {
      // eg. browser.chrome || browser.chromium || browser.firefox
      return ~~a;
    };

  /*
	--------------------------
	cast_64 speedtests: http://jsperf.com/truncate-float-to-integer
	Chrome: bitwise_not_floor
	Firefox17: toInteger (typeof test)
	IE9: bitwise_or_floor
	IE7 and IE8: to_parseint
	Chromium: to_floor_or_ceil
	Firefox3: to_floor_or_ceil
	Firefox15: to_floor_or_ceil
	Opera: to_floor_or_ceil
	Safari: to_floor_or_ceil
	--------------------------
	*/
  if (typeof Number.toInteger === "undefined") Number.toInteger = null;

  if (browser.chrome)
    ClipperLib.Cast_Int64 = function (a) {
      if (a < -2147483648 || a > 2147483647) return a < 0 ? Math.ceil(a) : Math.floor(a);
      else return ~~a;
    };
  else if (browser.firefox && typeof Number.toInteger === "function")
    ClipperLib.Cast_Int64 = function (a) {
      return Number.toInteger(a);
    };
  else if (browser.msie7 || browser.msie8)
    ClipperLib.Cast_Int64 = function (a) {
      return parseInt(a, 10);
    };
  else if (browser.msie)
    ClipperLib.Cast_Int64 = function (a) {
      if (a < -2147483648 || a > 2147483647) return a < 0 ? Math.ceil(a) : Math.floor(a);
      return a | 0;
    };

  // eg. browser.chromium || browser.firefox || browser.opera || browser.safari
  else
    ClipperLib.Cast_Int64 = function (a) {
      return a < 0 ? Math.ceil(a) : Math.floor(a);
    };

  ClipperLib.Clear = function (a) {
    a.length = 0;
  };

  //ClipperLib.MaxSteps = 64; // How many steps at maximum in arc in BuildArc() function
  ClipperLib.PI = 3.141592653589793;
  ClipperLib.PI2 = 2 * 3.141592653589793;
  /**
   * @constructor
   */
  ClipperLib.IntPoint = function () {
    var a = arguments,
      alen = a.length;
    this.X = 0;
    this.Y = 0;
    if (ClipperLib.use_xyz) {
      this.Z = 0;
      if (alen === 3) // public IntPoint(cInt x, cInt y, cInt z = 0)
      {
        this.X = a[0];
        this.Y = a[1];
        this.Z = a[2];
      } else if (alen === 2) // public IntPoint(cInt x, cInt y)
      {
        this.X = a[0];
        this.Y = a[1];
        this.Z = 0;
      } else if (alen === 1) {
        if (a[0] instanceof ClipperLib.DoublePoint) // public IntPoint(DoublePoint dp)
        {
          var dp = a[0];
          this.X = ClipperLib.Clipper.Round(dp.X);
          this.Y = ClipperLib.Clipper.Round(dp.Y);
          this.Z = 0;
        } else // public IntPoint(IntPoint pt)
        {
          var pt = a[0];
          if (typeof pt.Z === "undefined") pt.Z = 0;
          this.X = pt.X;
          this.Y = pt.Y;
          this.Z = pt.Z;
        }
      } else // public IntPoint()
      {
        this.X = 0;
        this.Y = 0;
        this.Z = 0;
      }
    } else // if (!ClipperLib.use_xyz)
    {
      if (alen === 2) // public IntPoint(cInt X, cInt Y)
      {
        this.X = a[0];
        this.Y = a[1];
      } else if (alen === 1) {
        if (a[0] instanceof ClipperLib.DoublePoint) // public IntPoint(DoublePoint dp)
        {
          var dp = a[0];
          this.X = ClipperLib.Clipper.Round(dp.X);
          this.Y = ClipperLib.Clipper.Round(dp.Y);
        } else // public IntPoint(IntPoint pt)
        {
          var pt = a[0];
          this.X = pt.X;
          this.Y = pt.Y;
        }
      } else // public IntPoint(IntPoint pt)
      {
        this.X = 0;
        this.Y = 0;
      }
    }
  };

  ClipperLib.IntPoint.op_Equality = function (a, b) {
    //return a == b;
    return a.X === b.X && a.Y === b.Y;
  };

  ClipperLib.IntPoint.op_Inequality = function (a, b) {
    //return a !== b;
    return a.X !== b.X || a.Y !== b.Y;
  };

  /*
  ClipperLib.IntPoint.prototype.Equals = function (obj)
  {
	if (obj === null)
		return false;
	if (obj instanceof ClipperLib.IntPoint)
	{
		var a = Cast(obj, ClipperLib.IntPoint);
		return (this.X == a.X) && (this.Y == a.Y);
	}
	else
		return false;
  };

	*/

  /**
   * @constructor
   */
  ClipperLib.IntPoint0 = function () {
    this.X = 0;
    this.Y = 0;
    if (ClipperLib.use_xyz) this.Z = 0;
  };

  ClipperLib.IntPoint0.prototype = ClipperLib.IntPoint.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntPoint1 = function (pt) {
    this.X = pt.X;
    this.Y = pt.Y;
    if (ClipperLib.use_xyz) {
      if (typeof pt.Z === "undefined") this.Z = 0;
      else this.Z = pt.Z;
    }
  };

  ClipperLib.IntPoint1.prototype = ClipperLib.IntPoint.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntPoint1dp = function (dp) {
    this.X = ClipperLib.Clipper.Round(dp.X);
    this.Y = ClipperLib.Clipper.Round(dp.Y);
    if (ClipperLib.use_xyz) this.Z = 0;
  };

  ClipperLib.IntPoint1dp.prototype = ClipperLib.IntPoint.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntPoint2 = function (x, y, z) {
    this.X = x;
    this.Y = y;
    if (ClipperLib.use_xyz) {
      if (typeof z === "undefined") this.Z = 0;
      else this.Z = z;
    }
  };

  ClipperLib.IntPoint2.prototype = ClipperLib.IntPoint.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntRect = function () {
    var a = arguments,
      alen = a.length;
    if (alen === 4) // function (l, t, r, b)
    {
      this.left = a[0];
      this.top = a[1];
      this.right = a[2];
      this.bottom = a[3];
    } else if (alen === 1) // function (ir)
    {
      var ir = a[0];
      this.left = ir.left;
      this.top = ir.top;
      this.right = ir.right;
      this.bottom = ir.bottom;
    } else // function ()
    {
      this.left = 0;
      this.top = 0;
      this.right = 0;
      this.bottom = 0;
    }
  };

  /**
   * @constructor
   */
  ClipperLib.IntRect0 = function () {
    this.left = 0;
    this.top = 0;
    this.right = 0;
    this.bottom = 0;
  };

  ClipperLib.IntRect0.prototype = ClipperLib.IntRect.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntRect1 = function (ir) {
    this.left = ir.left;
    this.top = ir.top;
    this.right = ir.right;
    this.bottom = ir.bottom;
  };

  ClipperLib.IntRect1.prototype = ClipperLib.IntRect.prototype;

  /**
   * @constructor
   */
  ClipperLib.IntRect4 = function (l, t, r, b) {
    this.left = l;
    this.top = t;
    this.right = r;
    this.bottom = b;
  };

  ClipperLib.IntRect4.prototype = ClipperLib.IntRect.prototype;

  ClipperLib.ClipType = {
    ctIntersection: 0,
    ctUnion: 1,
    ctDifference: 2,
    ctXor: 3,
  };

  ClipperLib.PolyType = {
    ptSubject: 0,
    ptClip: 1,
  };

  ClipperLib.PolyFillType = {
    pftEvenOdd: 0,
    pftNonZero: 1,
    pftPositive: 2,
    pftNegative: 3,
  };

  ClipperLib.JoinType = {
    jtSquare: 0,
    jtRound: 1,
    jtMiter: 2,
  };

  ClipperLib.EndType = {
    etOpenSquare: 0,
    etOpenRound: 1,
    etOpenButt: 2,
    etClosedLine: 3,
    etClosedPolygon: 4,
  };

  ClipperLib.EdgeSide = {
    esLeft: 0,
    esRight: 1,
  };

  ClipperLib.Direction = {
    dRightToLeft: 0,
    dLeftToRight: 1,
  };

  /**
   * @constructor
   */
  ClipperLib.TEdge = function () {
    this.Bot = new ClipperLib.IntPoint0();
    this.Curr = new ClipperLib.IntPoint0(); //current (updated for every new scanbeam)
    this.Top = new ClipperLib.IntPoint0();
    this.Delta = new ClipperLib.IntPoint0();
    this.Dx = 0;
    this.PolyTyp = ClipperLib.PolyType.ptSubject;
    this.Side = ClipperLib.EdgeSide.esLeft; //side only refers to current side of solution poly
    this.WindDelta = 0; //1 or -1 depending on winding direction
    this.WindCnt = 0;
    this.WindCnt2 = 0; //winding count of the opposite polytype
    this.OutIdx = 0;
    this.Next = null;
    this.Prev = null;
    this.NextInLML = null;
    this.NextInAEL = null;
    this.PrevInAEL = null;
    this.NextInSEL = null;
    this.PrevInSEL = null;
  };

  /**
   * @constructor
   */
  ClipperLib.IntersectNode = function () {
    this.Edge1 = null;
    this.Edge2 = null;
    this.Pt = new ClipperLib.IntPoint0();
  };

  ClipperLib.MyIntersectNodeSort = function () {};

  ClipperLib.MyIntersectNodeSort.Compare = function (node1, node2) {
    var i = node2.Pt.Y - node1.Pt.Y;
    if (i > 0) return 1;
    else if (i < 0) return -1;
    else return 0;
  };

  /**
   * @constructor
   */
  ClipperLib.LocalMinima = function () {
    this.Y = 0;
    this.LeftBound = null;
    this.RightBound = null;
    this.Next = null;
  };

  /**
   * @constructor
   */
  ClipperLib.Scanbeam = function () {
    this.Y = 0;
    this.Next = null;
  };

  /**
   * @constructor
   */
  ClipperLib.Maxima = function () {
    this.X = 0;
    this.Next = null;
    this.Prev = null;
  };

  //OutRec: contains a path in the clipping solution. Edges in the AEL will
  //carry a pointer to an OutRec when they are part of the clipping solution.
  /**
   * @constructor
   */
  ClipperLib.OutRec = function () {
    this.Idx = 0;
    this.IsHole = false;
    this.IsOpen = false;
    this.FirstLeft = null; //see comments in clipper.pas
    this.Pts = null;
    this.BottomPt = null;
    this.PolyNode = null;
  };

  /**
   * @constructor
   */
  ClipperLib.OutPt = function () {
    this.Idx = 0;
    this.Pt = new ClipperLib.IntPoint0();
    this.Next = null;
    this.Prev = null;
  };

  /**
   * @constructor
   */
  ClipperLib.Join = function () {
    this.OutPt1 = null;
    this.OutPt2 = null;
    this.OffPt = new ClipperLib.IntPoint0();
  };

  ClipperLib.ClipperBase = function () {
    this.m_MinimaList = null;
    this.m_CurrentLM = null;
    this.m_edges = new Array();
    this.m_UseFullRange = false;
    this.m_HasOpenPaths = false;
    this.PreserveCollinear = false;
    this.m_Scanbeam = null;
    this.m_PolyOuts = null;
    this.m_ActiveEdges = null;
  };

  // Ranges are in original C# too high for Javascript (in current state 2013 september):
  // protected const double horizontal = -3.4E+38;
  // internal const cInt loRange = 0x3FFFFFFF; // = 1073741823 = sqrt(2^63 -1)/2
  // internal const cInt hiRange = 0x3FFFFFFFFFFFFFFFL; // = 4611686018427387903 = sqrt(2^127 -1)/2
  // So had to adjust them to more suitable for Javascript.
  // If JS some day supports truly 64-bit integers, then these ranges can be as in C#
  // and biginteger library can be more simpler (as then 128bit can be represented as two 64bit numbers)
  ClipperLib.ClipperBase.horizontal = -9007199254740992; //-2^53
  ClipperLib.ClipperBase.Skip = -2;
  ClipperLib.ClipperBase.Unassigned = -1;
  ClipperLib.ClipperBase.tolerance = 1e-20;
  ClipperLib.ClipperBase.loRange = 47453132; // sqrt(2^53 -1)/2
  ClipperLib.ClipperBase.hiRange = 4503599627370495; // sqrt(2^106 -1)/2

  ClipperLib.ClipperBase.near_zero = function (val) {
    return val > -ClipperLib.ClipperBase.tolerance && val < ClipperLib.ClipperBase.tolerance;
  };

  ClipperLib.ClipperBase.IsHorizontal = function (e) {
    return e.Delta.Y === 0;
  };

  ClipperLib.ClipperBase.prototype.PointIsVertex = function (pt, pp) {
    var pp2 = pp;
    do {
      if (ClipperLib.IntPoint.op_Equality(pp2.Pt, pt)) return true;
      pp2 = pp2.Next;
    } while (pp2 !== pp);
    return false;
  };

  ClipperLib.ClipperBase.prototype.PointOnLineSegment = function (
    pt,
    linePt1,
    linePt2,
    UseFullRange,
  ) {
    if (UseFullRange)
      return (
        (pt.X === linePt1.X && pt.Y === linePt1.Y) ||
        (pt.X === linePt2.X && pt.Y === linePt2.Y) ||
        (pt.X > linePt1.X === pt.X < linePt2.X &&
          pt.Y > linePt1.Y === pt.Y < linePt2.Y &&
          Int128.op_Equality(
            Int128.Int128Mul(pt.X - linePt1.X, linePt2.Y - linePt1.Y),
            Int128.Int128Mul(linePt2.X - linePt1.X, pt.Y - linePt1.Y),
          ))
      );
    else
      return (
        (pt.X === linePt1.X && pt.Y === linePt1.Y) ||
        (pt.X === linePt2.X && pt.Y === linePt2.Y) ||
        (pt.X > linePt1.X === pt.X < linePt2.X &&
          pt.Y > linePt1.Y === pt.Y < linePt2.Y &&
          (pt.X - linePt1.X) * (linePt2.Y - linePt1.Y) ===
            (linePt2.X - linePt1.X) * (pt.Y - linePt1.Y))
      );
  };

  ClipperLib.ClipperBase.prototype.PointOnPolygon = function (pt, pp, UseFullRange) {
    var pp2 = pp;
    while (true) {
      if (this.PointOnLineSegment(pt, pp2.Pt, pp2.Next.Pt, UseFullRange)) return true;
      pp2 = pp2.Next;
      if (pp2 === pp) break;
    }
    return false;
  };

  ClipperLib.ClipperBase.prototype.SlopesEqual = ClipperLib.ClipperBase.SlopesEqual = function () {
    var a = arguments,
      alen = a.length;
    var e1, e2, pt1, pt2, pt3, pt4, UseFullRange;
    if (alen === 3) // function (e1, e2, UseFullRange)
    {
      e1 = a[0];
      e2 = a[1];
      UseFullRange = a[2];
      if (UseFullRange)
        return Int128.op_Equality(
          Int128.Int128Mul(e1.Delta.Y, e2.Delta.X),
          Int128.Int128Mul(e1.Delta.X, e2.Delta.Y),
        );
      else
        return (
          ClipperLib.Cast_Int64(e1.Delta.Y * e2.Delta.X) ===
          ClipperLib.Cast_Int64(e1.Delta.X * e2.Delta.Y)
        );
    } else if (alen === 4) // function (pt1, pt2, pt3, UseFullRange)
    {
      pt1 = a[0];
      pt2 = a[1];
      pt3 = a[2];
      UseFullRange = a[3];
      if (UseFullRange)
        return Int128.op_Equality(
          Int128.Int128Mul(pt1.Y - pt2.Y, pt2.X - pt3.X),
          Int128.Int128Mul(pt1.X - pt2.X, pt2.Y - pt3.Y),
        );
      else
        return (
          ClipperLib.Cast_Int64((pt1.Y - pt2.Y) * (pt2.X - pt3.X)) -
            ClipperLib.Cast_Int64((pt1.X - pt2.X) * (pt2.Y - pt3.Y)) ===
          0
        );
    } else // function (pt1, pt2, pt3, pt4, UseFullRange)
    {
      pt1 = a[0];
      pt2 = a[1];
      pt3 = a[2];
      pt4 = a[3];
      UseFullRange = a[4];
      if (UseFullRange)
        return Int128.op_Equality(
          Int128.Int128Mul(pt1.Y - pt2.Y, pt3.X - pt4.X),
          Int128.Int128Mul(pt1.X - pt2.X, pt3.Y - pt4.Y),
        );
      else
        return (
          ClipperLib.Cast_Int64((pt1.Y - pt2.Y) * (pt3.X - pt4.X)) -
            ClipperLib.Cast_Int64((pt1.X - pt2.X) * (pt3.Y - pt4.Y)) ===
          0
        );
    }
  };

  ClipperLib.ClipperBase.SlopesEqual3 = function (e1, e2, UseFullRange) {
    if (UseFullRange)
      return Int128.op_Equality(
        Int128.Int128Mul(e1.Delta.Y, e2.Delta.X),
        Int128.Int128Mul(e1.Delta.X, e2.Delta.Y),
      );
    else
      return (
        ClipperLib.Cast_Int64(e1.Delta.Y * e2.Delta.X) ===
        ClipperLib.Cast_Int64(e1.Delta.X * e2.Delta.Y)
      );
  };

  ClipperLib.ClipperBase.SlopesEqual4 = function (pt1, pt2, pt3, UseFullRange) {
    if (UseFullRange)
      return Int128.op_Equality(
        Int128.Int128Mul(pt1.Y - pt2.Y, pt2.X - pt3.X),
        Int128.Int128Mul(pt1.X - pt2.X, pt2.Y - pt3.Y),
      );
    else
      return (
        ClipperLib.Cast_Int64((pt1.Y - pt2.Y) * (pt2.X - pt3.X)) -
          ClipperLib.Cast_Int64((pt1.X - pt2.X) * (pt2.Y - pt3.Y)) ===
        0
      );
  };

  ClipperLib.ClipperBase.SlopesEqual5 = function (pt1, pt2, pt3, pt4, UseFullRange) {
    if (UseFullRange)
      return Int128.op_Equality(
        Int128.Int128Mul(pt1.Y - pt2.Y, pt3.X - pt4.X),
        Int128.Int128Mul(pt1.X - pt2.X, pt3.Y - pt4.Y),
      );
    else
      return (
        ClipperLib.Cast_Int64((pt1.Y - pt2.Y) * (pt3.X - pt4.X)) -
          ClipperLib.Cast_Int64((pt1.X - pt2.X) * (pt3.Y - pt4.Y)) ===
        0
      );
  };

  ClipperLib.ClipperBase.prototype.Clear = function () {
    this.DisposeLocalMinimaList();
    for (var i = 0, ilen = this.m_edges.length; i < ilen; ++i) {
      for (var j = 0, jlen = this.m_edges[i].length; j < jlen; ++j) this.m_edges[i][j] = null;
      ClipperLib.Clear(this.m_edges[i]);
    }
    ClipperLib.Clear(this.m_edges);
    this.m_UseFullRange = false;
    this.m_HasOpenPaths = false;
  };

  ClipperLib.ClipperBase.prototype.DisposeLocalMinimaList = function () {
    while (this.m_MinimaList !== null) {
      var tmpLm = this.m_MinimaList.Next;
      this.m_MinimaList = null;
      this.m_MinimaList = tmpLm;
    }
    this.m_CurrentLM = null;
  };

  ClipperLib.ClipperBase.prototype.RangeTest = function (Pt, useFullRange) {
    if (useFullRange.Value) {
      if (
        Pt.X > ClipperLib.ClipperBase.hiRange ||
        Pt.Y > ClipperLib.ClipperBase.hiRange ||
        -Pt.X > ClipperLib.ClipperBase.hiRange ||
        -Pt.Y > ClipperLib.ClipperBase.hiRange
      )
        ClipperLib.Error("Coordinate outside allowed range in RangeTest().");
    } else if (
      Pt.X > ClipperLib.ClipperBase.loRange ||
      Pt.Y > ClipperLib.ClipperBase.loRange ||
      -Pt.X > ClipperLib.ClipperBase.loRange ||
      -Pt.Y > ClipperLib.ClipperBase.loRange
    ) {
      useFullRange.Value = true;
      this.RangeTest(Pt, useFullRange);
    }
  };

  ClipperLib.ClipperBase.prototype.InitEdge = function (e, eNext, ePrev, pt) {
    e.Next = eNext;
    e.Prev = ePrev;
    //e.Curr = pt;
    e.Curr.X = pt.X;
    e.Curr.Y = pt.Y;
    if (ClipperLib.use_xyz) e.Curr.Z = pt.Z;
    e.OutIdx = -1;
  };

  ClipperLib.ClipperBase.prototype.InitEdge2 = function (e, polyType) {
    if (e.Curr.Y >= e.Next.Curr.Y) {
      //e.Bot = e.Curr;
      e.Bot.X = e.Curr.X;
      e.Bot.Y = e.Curr.Y;
      if (ClipperLib.use_xyz) e.Bot.Z = e.Curr.Z;
      //e.Top = e.Next.Curr;
      e.Top.X = e.Next.Curr.X;
      e.Top.Y = e.Next.Curr.Y;
      if (ClipperLib.use_xyz) e.Top.Z = e.Next.Curr.Z;
    } else {
      //e.Top = e.Curr;
      e.Top.X = e.Curr.X;
      e.Top.Y = e.Curr.Y;
      if (ClipperLib.use_xyz) e.Top.Z = e.Curr.Z;
      //e.Bot = e.Next.Curr;
      e.Bot.X = e.Next.Curr.X;
      e.Bot.Y = e.Next.Curr.Y;
      if (ClipperLib.use_xyz) e.Bot.Z = e.Next.Curr.Z;
    }
    this.SetDx(e);
    e.PolyTyp = polyType;
  };

  ClipperLib.ClipperBase.prototype.FindNextLocMin = function (E) {
    var E2;
    for (;;) {
      while (
        ClipperLib.IntPoint.op_Inequality(E.Bot, E.Prev.Bot) ||
        ClipperLib.IntPoint.op_Equality(E.Curr, E.Top)
      )
        E = E.Next;
      if (
        E.Dx !== ClipperLib.ClipperBase.horizontal &&
        E.Prev.Dx !== ClipperLib.ClipperBase.horizontal
      )
        break;
      while (E.Prev.Dx === ClipperLib.ClipperBase.horizontal) E = E.Prev;
      E2 = E;
      while (E.Dx === ClipperLib.ClipperBase.horizontal) E = E.Next;
      if (E.Top.Y === E.Prev.Bot.Y) continue;
      //ie just an intermediate horz.
      if (E2.Prev.Bot.X < E.Bot.X) E = E2;
      break;
    }
    return E;
  };

  ClipperLib.ClipperBase.prototype.ProcessBound = function (E, LeftBoundIsForward) {
    var EStart;
    var Result = E;
    var Horz;

    if (Result.OutIdx === ClipperLib.ClipperBase.Skip) {
      //check if there are edges beyond the skip edge in the bound and if so
      //create another LocMin and calling ProcessBound once more ...
      E = Result;
      if (LeftBoundIsForward) {
        while (E.Top.Y === E.Next.Bot.Y) E = E.Next;
        while (E !== Result && E.Dx === ClipperLib.ClipperBase.horizontal) E = E.Prev;
      } else {
        while (E.Top.Y === E.Prev.Bot.Y) E = E.Prev;
        while (E !== Result && E.Dx === ClipperLib.ClipperBase.horizontal) E = E.Next;
      }
      if (E === Result) {
        if (LeftBoundIsForward) Result = E.Next;
        else Result = E.Prev;
      } else {
        //there are more edges in the bound beyond result starting with E
        if (LeftBoundIsForward) E = Result.Next;
        else E = Result.Prev;
        var locMin = new ClipperLib.LocalMinima();
        locMin.Next = null;
        locMin.Y = E.Bot.Y;
        locMin.LeftBound = null;
        locMin.RightBound = E;
        E.WindDelta = 0;
        Result = this.ProcessBound(E, LeftBoundIsForward);
        this.InsertLocalMinima(locMin);
      }
      return Result;
    }

    if (E.Dx === ClipperLib.ClipperBase.horizontal) {
      //We need to be careful with open paths because this may not be a
      //true local minima (ie E may be following a skip edge).
      //Also, consecutive horz. edges may start heading left before going right.
      if (LeftBoundIsForward) EStart = E.Prev;
      else EStart = E.Next;

      if (EStart.Dx === ClipperLib.ClipperBase.horizontal) //ie an adjoining horizontal skip edge
      {
        if (EStart.Bot.X !== E.Bot.X && EStart.Top.X !== E.Bot.X) this.ReverseHorizontal(E);
      } else if (EStart.Bot.X !== E.Bot.X) this.ReverseHorizontal(E);
    }

    EStart = E;
    if (LeftBoundIsForward) {
      while (
        Result.Top.Y === Result.Next.Bot.Y &&
        Result.Next.OutIdx !== ClipperLib.ClipperBase.Skip
      )
        Result = Result.Next;
      if (
        Result.Dx === ClipperLib.ClipperBase.horizontal &&
        Result.Next.OutIdx !== ClipperLib.ClipperBase.Skip
      ) {
        //nb: at the top of a bound, horizontals are added to the bound
        //only when the preceding edge attaches to the horizontal's left vertex
        //unless a Skip edge is encountered when that becomes the top divide
        Horz = Result;
        while (Horz.Prev.Dx === ClipperLib.ClipperBase.horizontal) Horz = Horz.Prev;
        if (Horz.Prev.Top.X > Result.Next.Top.X) Result = Horz.Prev;
      }
      while (E !== Result) {
        E.NextInLML = E.Next;
        if (E.Dx === ClipperLib.ClipperBase.horizontal && E !== EStart && E.Bot.X !== E.Prev.Top.X)
          this.ReverseHorizontal(E);
        E = E.Next;
      }
      if (E.Dx === ClipperLib.ClipperBase.horizontal && E !== EStart && E.Bot.X !== E.Prev.Top.X)
        this.ReverseHorizontal(E);
      Result = Result.Next;
      //move to the edge just beyond current bound
    } else {
      while (
        Result.Top.Y === Result.Prev.Bot.Y &&
        Result.Prev.OutIdx !== ClipperLib.ClipperBase.Skip
      )
        Result = Result.Prev;
      if (
        Result.Dx === ClipperLib.ClipperBase.horizontal &&
        Result.Prev.OutIdx !== ClipperLib.ClipperBase.Skip
      ) {
        Horz = Result;
        while (Horz.Next.Dx === ClipperLib.ClipperBase.horizontal) Horz = Horz.Next;
        if (Horz.Next.Top.X === Result.Prev.Top.X || Horz.Next.Top.X > Result.Prev.Top.X) {
          Result = Horz.Next;
        }
      }
      while (E !== Result) {
        E.NextInLML = E.Prev;
        if (E.Dx === ClipperLib.ClipperBase.horizontal && E !== EStart && E.Bot.X !== E.Next.Top.X)
          this.ReverseHorizontal(E);
        E = E.Prev;
      }
      if (E.Dx === ClipperLib.ClipperBase.horizontal && E !== EStart && E.Bot.X !== E.Next.Top.X)
        this.ReverseHorizontal(E);
      Result = Result.Prev;
      //move to the edge just beyond current bound
    }

    return Result;
  };

  ClipperLib.ClipperBase.prototype.AddPath = function (pg, polyType, Closed) {
    if (ClipperLib.use_lines) {
      if (!Closed && polyType === ClipperLib.PolyType.ptClip)
        ClipperLib.Error("AddPath: Open paths must be subject.");
    } else {
      if (!Closed) ClipperLib.Error("AddPath: Open paths have been disabled.");
    }
    var highI = pg.length - 1;
    if (Closed) while (highI > 0 && ClipperLib.IntPoint.op_Equality(pg[highI], pg[0])) --highI;
    while (highI > 0 && ClipperLib.IntPoint.op_Equality(pg[highI], pg[highI - 1])) --highI;
    if ((Closed && highI < 2) || (!Closed && highI < 1)) return false;
    //create a new edge array ...
    var edges = new Array();
    for (var i = 0; i <= highI; i++) edges.push(new ClipperLib.TEdge());
    var IsFlat = true;
    //1. Basic (first) edge initialization ...

    //edges[1].Curr = pg[1];
    edges[1].Curr.X = pg[1].X;
    edges[1].Curr.Y = pg[1].Y;
    if (ClipperLib.use_xyz) edges[1].Curr.Z = pg[1].Z;

    var $1 = {
      Value: this.m_UseFullRange,
    };

    this.RangeTest(pg[0], $1);
    this.m_UseFullRange = $1.Value;

    $1.Value = this.m_UseFullRange;
    this.RangeTest(pg[highI], $1);
    this.m_UseFullRange = $1.Value;

    this.InitEdge(edges[0], edges[1], edges[highI], pg[0]);
    this.InitEdge(edges[highI], edges[0], edges[highI - 1], pg[highI]);
    for (var i = highI - 1; i >= 1; --i) {
      $1.Value = this.m_UseFullRange;
      this.RangeTest(pg[i], $1);
      this.m_UseFullRange = $1.Value;

      this.InitEdge(edges[i], edges[i + 1], edges[i - 1], pg[i]);
    }

    var eStart = edges[0];
    //2. Remove duplicate vertices, and (when closed) collinear edges ...
    var E = eStart,
      eLoopStop = eStart;
    for (;;) {
      //console.log(E.Next, eStart);
      //nb: allows matching start and end points when not Closed ...
      if (E.Curr === E.Next.Curr && (Closed || E.Next !== eStart)) {
        if (E === E.Next) break;
        if (E === eStart) eStart = E.Next;
        E = this.RemoveEdge(E);
        eLoopStop = E;
        continue;
      }
      if (E.Prev === E.Next) break;
      else if (
        Closed &&
        ClipperLib.ClipperBase.SlopesEqual4(
          E.Prev.Curr,
          E.Curr,
          E.Next.Curr,
          this.m_UseFullRange,
        ) &&
        (!this.PreserveCollinear || !this.Pt2IsBetweenPt1AndPt3(E.Prev.Curr, E.Curr, E.Next.Curr))
      ) {
        //Collinear edges are allowed for open paths but in closed paths
        //the default is to merge adjacent collinear edges into a single edge.
        //However, if the PreserveCollinear property is enabled, only overlapping
        //collinear edges (ie spikes) will be removed from closed paths.
        if (E === eStart) eStart = E.Next;
        E = this.RemoveEdge(E);
        E = E.Prev;
        eLoopStop = E;
        continue;
      }
      E = E.Next;
      if (E === eLoopStop || (!Closed && E.Next === eStart)) break;
    }
    if ((!Closed && E === E.Next) || (Closed && E.Prev === E.Next)) return false;
    if (!Closed) {
      this.m_HasOpenPaths = true;
      eStart.Prev.OutIdx = ClipperLib.ClipperBase.Skip;
    }
    //3. Do second stage of edge initialization ...
    E = eStart;
    do {
      this.InitEdge2(E, polyType);
      E = E.Next;
      if (IsFlat && E.Curr.Y !== eStart.Curr.Y) IsFlat = false;
    } while (E !== eStart);
    //4. Finally, add edge bounds to LocalMinima list ...
    //Totally flat paths must be handled differently when adding them
    //to LocalMinima list to avoid endless loops etc ...
    if (IsFlat) {
      if (Closed) return false;

      E.Prev.OutIdx = ClipperLib.ClipperBase.Skip;

      var locMin = new ClipperLib.LocalMinima();
      locMin.Next = null;
      locMin.Y = E.Bot.Y;
      locMin.LeftBound = null;
      locMin.RightBound = E;
      locMin.RightBound.Side = ClipperLib.EdgeSide.esRight;
      locMin.RightBound.WindDelta = 0;

      for (;;) {
        if (E.Bot.X !== E.Prev.Top.X) this.ReverseHorizontal(E);
        if (E.Next.OutIdx === ClipperLib.ClipperBase.Skip) break;
        E.NextInLML = E.Next;
        E = E.Next;
      }
      this.InsertLocalMinima(locMin);
      this.m_edges.push(edges);
      return true;
    }
    this.m_edges.push(edges);
    var leftBoundIsForward;
    var EMin = null;

    //workaround to avoid an endless loop in the while loop below when
    //open paths have matching start and end points ...
    if (ClipperLib.IntPoint.op_Equality(E.Prev.Bot, E.Prev.Top)) E = E.Next;

    for (;;) {
      E = this.FindNextLocMin(E);
      if (E === EMin) break;
      else if (EMin === null) EMin = E;
      //E and E.Prev now share a local minima (left aligned if horizontal).
      //Compare their slopes to find which starts which bound ...
      var locMin = new ClipperLib.LocalMinima();
      locMin.Next = null;
      locMin.Y = E.Bot.Y;
      if (E.Dx < E.Prev.Dx) {
        locMin.LeftBound = E.Prev;
        locMin.RightBound = E;
        leftBoundIsForward = false;
        //Q.nextInLML = Q.prev
      } else {
        locMin.LeftBound = E;
        locMin.RightBound = E.Prev;
        leftBoundIsForward = true;
        //Q.nextInLML = Q.next
      }
      locMin.LeftBound.Side = ClipperLib.EdgeSide.esLeft;
      locMin.RightBound.Side = ClipperLib.EdgeSide.esRight;
      if (!Closed) locMin.LeftBound.WindDelta = 0;
      else if (locMin.LeftBound.Next === locMin.RightBound) locMin.LeftBound.WindDelta = -1;
      else locMin.LeftBound.WindDelta = 1;
      locMin.RightBound.WindDelta = -locMin.LeftBound.WindDelta;
      E = this.ProcessBound(locMin.LeftBound, leftBoundIsForward);
      if (E.OutIdx === ClipperLib.ClipperBase.Skip) E = this.ProcessBound(E, leftBoundIsForward);
      var E2 = this.ProcessBound(locMin.RightBound, !leftBoundIsForward);
      if (E2.OutIdx === ClipperLib.ClipperBase.Skip)
        E2 = this.ProcessBound(E2, !leftBoundIsForward);
      if (locMin.LeftBound.OutIdx === ClipperLib.ClipperBase.Skip) locMin.LeftBound = null;
      else if (locMin.RightBound.OutIdx === ClipperLib.ClipperBase.Skip) locMin.RightBound = null;
      this.InsertLocalMinima(locMin);
      if (!leftBoundIsForward) E = E2;
    }
    return true;
  };

  ClipperLib.ClipperBase.prototype.AddPaths = function (ppg, polyType, closed) {
    //  console.log("-------------------------------------------");
    //  console.log(JSON.stringify(ppg));
    var result = false;
    for (var i = 0, ilen = ppg.length; i < ilen; ++i)
      if (this.AddPath(ppg[i], polyType, closed)) result = true;
    return result;
  };

  ClipperLib.ClipperBase.prototype.Pt2IsBetweenPt1AndPt3 = function (pt1, pt2, pt3) {
    if (
      ClipperLib.IntPoint.op_Equality(pt1, pt3) ||
      ClipperLib.IntPoint.op_Equality(pt1, pt2) ||
      ClipperLib.IntPoint.op_Equality(pt3, pt2)
    )
      //if ((pt1 == pt3) || (pt1 == pt2) || (pt3 == pt2))
      return false;
    else if (pt1.X !== pt3.X) return pt2.X > pt1.X === pt2.X < pt3.X;
    else return pt2.Y > pt1.Y === pt2.Y < pt3.Y;
  };

  ClipperLib.ClipperBase.prototype.RemoveEdge = function (e) {
    //removes e from double_linked_list (but without removing from memory)
    e.Prev.Next = e.Next;
    e.Next.Prev = e.Prev;
    var result = e.Next;
    e.Prev = null; //flag as removed (see ClipperBase.Clear)
    return result;
  };

  ClipperLib.ClipperBase.prototype.SetDx = function (e) {
    e.Delta.X = e.Top.X - e.Bot.X;
    e.Delta.Y = e.Top.Y - e.Bot.Y;
    if (e.Delta.Y === 0) e.Dx = ClipperLib.ClipperBase.horizontal;
    else e.Dx = e.Delta.X / e.Delta.Y;
  };

  ClipperLib.ClipperBase.prototype.InsertLocalMinima = function (newLm) {
    if (this.m_MinimaList === null) {
      this.m_MinimaList = newLm;
    } else if (newLm.Y >= this.m_MinimaList.Y) {
      newLm.Next = this.m_MinimaList;
      this.m_MinimaList = newLm;
    } else {
      var tmpLm = this.m_MinimaList;
      while (tmpLm.Next !== null && newLm.Y < tmpLm.Next.Y) tmpLm = tmpLm.Next;
      newLm.Next = tmpLm.Next;
      tmpLm.Next = newLm;
    }
  };

  ClipperLib.ClipperBase.prototype.PopLocalMinima = function (Y, current) {
    current.v = this.m_CurrentLM;
    if (this.m_CurrentLM !== null && this.m_CurrentLM.Y === Y) {
      this.m_CurrentLM = this.m_CurrentLM.Next;
      return true;
    }
    return false;
  };

  ClipperLib.ClipperBase.prototype.ReverseHorizontal = function (e) {
    //swap horizontal edges' top and bottom x's so they follow the natural
    //progression of the bounds - ie so their xbots will align with the
    //adjoining lower edge. [Helpful in the ProcessHorizontal() method.]
    var tmp = e.Top.X;
    e.Top.X = e.Bot.X;
    e.Bot.X = tmp;
    if (ClipperLib.use_xyz) {
      tmp = e.Top.Z;
      e.Top.Z = e.Bot.Z;
      e.Bot.Z = tmp;
    }
  };

  ClipperLib.ClipperBase.prototype.Reset = function () {
    this.m_CurrentLM = this.m_MinimaList;
    if (this.m_CurrentLM === null)
      //ie nothing to process
      return;
    //reset all edges ...
    this.m_Scanbeam = null;
    var lm = this.m_MinimaList;
    while (lm !== null) {
      this.InsertScanbeam(lm.Y);
      var e = lm.LeftBound;
      if (e !== null) {
        //e.Curr = e.Bot;
        e.Curr.X = e.Bot.X;
        e.Curr.Y = e.Bot.Y;
        if (ClipperLib.use_xyz) e.Curr.Z = e.Bot.Z;
        e.OutIdx = ClipperLib.ClipperBase.Unassigned;
      }
      e = lm.RightBound;
      if (e !== null) {
        //e.Curr = e.Bot;
        e.Curr.X = e.Bot.X;
        e.Curr.Y = e.Bot.Y;
        if (ClipperLib.use_xyz) e.Curr.Z = e.Bot.Z;
        e.OutIdx = ClipperLib.ClipperBase.Unassigned;
      }
      lm = lm.Next;
    }
    this.m_ActiveEdges = null;
  };

  ClipperLib.ClipperBase.prototype.InsertScanbeam = function (Y) {
    //single-linked list: sorted descending, ignoring dups.
    if (this.m_Scanbeam === null) {
      this.m_Scanbeam = new ClipperLib.Scanbeam();
      this.m_Scanbeam.Next = null;
      this.m_Scanbeam.Y = Y;
    } else if (Y > this.m_Scanbeam.Y) {
      var newSb = new ClipperLib.Scanbeam();
      newSb.Y = Y;
      newSb.Next = this.m_Scanbeam;
      this.m_Scanbeam = newSb;
    } else {
      var sb2 = this.m_Scanbeam;
      while (sb2.Next !== null && Y <= sb2.Next.Y) {
        sb2 = sb2.Next;
      }
      if (Y === sb2.Y) {
        return;
      } //ie ignores duplicates
      var newSb1 = new ClipperLib.Scanbeam();
      newSb1.Y = Y;
      newSb1.Next = sb2.Next;
      sb2.Next = newSb1;
    }
  };

  ClipperLib.ClipperBase.prototype.PopScanbeam = function (Y) {
    if (this.m_Scanbeam === null) {
      Y.v = 0;
      return false;
    }
    Y.v = this.m_Scanbeam.Y;
    this.m_Scanbeam = this.m_Scanbeam.Next;
    return true;
  };

  ClipperLib.ClipperBase.prototype.LocalMinimaPending = function () {
    return this.m_CurrentLM !== null;
  };

  ClipperLib.ClipperBase.prototype.CreateOutRec = function () {
    var result = new ClipperLib.OutRec();
    result.Idx = ClipperLib.ClipperBase.Unassigned;
    result.IsHole = false;
    result.IsOpen = false;
    result.FirstLeft = null;
    result.Pts = null;
    result.BottomPt = null;
    result.PolyNode = null;
    this.m_PolyOuts.push(result);
    result.Idx = this.m_PolyOuts.length - 1;
    return result;
  };

  ClipperLib.ClipperBase.prototype.DisposeOutRec = function (index) {
    var outRec = this.m_PolyOuts[index];
    outRec.Pts = null;
    outRec = null;
    this.m_PolyOuts[index] = null;
  };

  ClipperLib.ClipperBase.prototype.UpdateEdgeIntoAEL = function (e) {
    if (e.NextInLML === null) {
      ClipperLib.Error("UpdateEdgeIntoAEL: invalid call");
    }
    var AelPrev = e.PrevInAEL;
    var AelNext = e.NextInAEL;
    e.NextInLML.OutIdx = e.OutIdx;
    if (AelPrev !== null) {
      AelPrev.NextInAEL = e.NextInLML;
    } else {
      this.m_ActiveEdges = e.NextInLML;
    }
    if (AelNext !== null) {
      AelNext.PrevInAEL = e.NextInLML;
    }
    e.NextInLML.Side = e.Side;
    e.NextInLML.WindDelta = e.WindDelta;
    e.NextInLML.WindCnt = e.WindCnt;
    e.NextInLML.WindCnt2 = e.WindCnt2;
    e = e.NextInLML;
    e.Curr.X = e.Bot.X;
    e.Curr.Y = e.Bot.Y;
    e.PrevInAEL = AelPrev;
    e.NextInAEL = AelNext;
    if (!ClipperLib.ClipperBase.IsHorizontal(e)) {
      this.InsertScanbeam(e.Top.Y);
    }
    return e;
  };

  ClipperLib.ClipperBase.prototype.SwapPositionsInAEL = function (edge1, edge2) {
    //check that one or other edge hasn't already been removed from AEL ...
    if (edge1.NextInAEL === edge1.PrevInAEL || edge2.NextInAEL === edge2.PrevInAEL) {
      return;
    }

    if (edge1.NextInAEL === edge2) {
      var next = edge2.NextInAEL;
      if (next !== null) {
        next.PrevInAEL = edge1;
      }
      var prev = edge1.PrevInAEL;
      if (prev !== null) {
        prev.NextInAEL = edge2;
      }
      edge2.PrevInAEL = prev;
      edge2.NextInAEL = edge1;
      edge1.PrevInAEL = edge2;
      edge1.NextInAEL = next;
    } else if (edge2.NextInAEL === edge1) {
      var next1 = edge1.NextInAEL;
      if (next1 !== null) {
        next1.PrevInAEL = edge2;
      }
      var prev1 = edge2.PrevInAEL;
      if (prev1 !== null) {
        prev1.NextInAEL = edge1;
      }
      edge1.PrevInAEL = prev1;
      edge1.NextInAEL = edge2;
      edge2.PrevInAEL = edge1;
      edge2.NextInAEL = next1;
    } else {
      var next2 = edge1.NextInAEL;
      var prev2 = edge1.PrevInAEL;
      edge1.NextInAEL = edge2.NextInAEL;
      if (edge1.NextInAEL !== null) {
        edge1.NextInAEL.PrevInAEL = edge1;
      }
      edge1.PrevInAEL = edge2.PrevInAEL;
      if (edge1.PrevInAEL !== null) {
        edge1.PrevInAEL.NextInAEL = edge1;
      }
      edge2.NextInAEL = next2;
      if (edge2.NextInAEL !== null) {
        edge2.NextInAEL.PrevInAEL = edge2;
      }
      edge2.PrevInAEL = prev2;
      if (edge2.PrevInAEL !== null) {
        edge2.PrevInAEL.NextInAEL = edge2;
      }
    }

    if (edge1.PrevInAEL === null) {
      this.m_ActiveEdges = edge1;
    } else {
      if (edge2.PrevInAEL === null) {
        this.m_ActiveEdges = edge2;
      }
    }
  };

  ClipperLib.ClipperBase.prototype.DeleteFromAEL = function (e) {
    var AelPrev = e.PrevInAEL;
    var AelNext = e.NextInAEL;
    if (AelPrev === null && AelNext === null && e !== this.m_ActiveEdges) {
      return;
    } //already deleted
    if (AelPrev !== null) {
      AelPrev.NextInAEL = AelNext;
    } else {
      this.m_ActiveEdges = AelNext;
    }
    if (AelNext !== null) {
      AelNext.PrevInAEL = AelPrev;
    }
    e.NextInAEL = null;
    e.PrevInAEL = null;
  };

  // public Clipper(int InitOptions = 0)
  /**
   * @suppress {missingProperties}
   */
  ClipperLib.Clipper = function (InitOptions) {
    if (typeof InitOptions === "undefined") InitOptions = 0;
    this.m_PolyOuts = null;
    this.m_ClipType = ClipperLib.ClipType.ctIntersection;
    this.m_Scanbeam = null;
    this.m_Maxima = null;
    this.m_ActiveEdges = null;
    this.m_SortedEdges = null;
    this.m_IntersectList = null;
    this.m_IntersectNodeComparer = null;
    this.m_ExecuteLocked = false;
    this.m_ClipFillType = ClipperLib.PolyFillType.pftEvenOdd;
    this.m_SubjFillType = ClipperLib.PolyFillType.pftEvenOdd;
    this.m_Joins = null;
    this.m_GhostJoins = null;
    this.m_UsingPolyTree = false;
    this.ReverseSolution = false;
    this.StrictlySimple = false;

    ClipperLib.ClipperBase.call(this);

    this.m_Scanbeam = null;
    this.m_Maxima = null;
    this.m_ActiveEdges = null;
    this.m_SortedEdges = null;
    this.m_IntersectList = new Array();
    this.m_IntersectNodeComparer = ClipperLib.MyIntersectNodeSort.Compare;
    this.m_ExecuteLocked = false;
    this.m_UsingPolyTree = false;
    this.m_PolyOuts = new Array();
    this.m_Joins = new Array();
    this.m_GhostJoins = new Array();
    this.ReverseSolution = (1 & InitOptions) !== 0;
    this.StrictlySimple = (2 & InitOptions) !== 0;
    this.PreserveCollinear = (4 & InitOptions) !== 0;
    if (ClipperLib.use_xyz) {
      this.ZFillFunction = null; // function (IntPoint vert1, IntPoint vert2, ref IntPoint intersectPt);
    }
  };

  ClipperLib.Clipper.ioReverseSolution = 1;
  ClipperLib.Clipper.ioStrictlySimple = 2;
  ClipperLib.Clipper.ioPreserveCollinear = 4;

  ClipperLib.Clipper.prototype.Clear = function () {
    if (this.m_edges.length === 0) return;
    //avoids problems with ClipperBase destructor
    this.DisposeAllPolyPts();
    ClipperLib.ClipperBase.prototype.Clear.call(this);
  };

  ClipperLib.Clipper.prototype.InsertMaxima = function (X) {
    //double-linked list: sorted ascending, ignoring dups.
    var newMax = new ClipperLib.Maxima();
    newMax.X = X;
    if (this.m_Maxima === null) {
      this.m_Maxima = newMax;
      this.m_Maxima.Next = null;
      this.m_Maxima.Prev = null;
    } else if (X < this.m_Maxima.X) {
      newMax.Next = this.m_Maxima;
      newMax.Prev = null;
      this.m_Maxima = newMax;
    } else {
      var m = this.m_Maxima;
      while (m.Next !== null && X >= m.Next.X) {
        m = m.Next;
      }
      if (X === m.X) {
        return;
      } //ie ignores duplicates (& CG to clean up newMax)
      //insert newMax between m and m.Next ...
      newMax.Next = m.Next;
      newMax.Prev = m;
      if (m.Next !== null) {
        m.Next.Prev = newMax;
      }
      m.Next = newMax;
    }
  };

  // ************************************
  ClipperLib.Clipper.prototype.Execute = function () {
    var a = arguments,
      alen = a.length,
      ispolytree = a[1] instanceof ClipperLib.PolyTree;
    if (alen === 4 && !ispolytree) // function (clipType, solution, subjFillType, clipFillType)
    {
      var clipType = a[0],
        solution = a[1],
        subjFillType = a[2],
        clipFillType = a[3];
      if (this.m_ExecuteLocked) return false;
      if (this.m_HasOpenPaths)
        ClipperLib.Error("Error: PolyTree struct is needed for open path clipping.");
      this.m_ExecuteLocked = true;
      ClipperLib.Clear(solution);
      this.m_SubjFillType = subjFillType;
      this.m_ClipFillType = clipFillType;
      this.m_ClipType = clipType;
      this.m_UsingPolyTree = false;
      try {
        var succeeded = this.ExecuteInternal();
        //build the return polygons ...
        if (succeeded) this.BuildResult(solution);
      } finally {
        this.DisposeAllPolyPts();
        this.m_ExecuteLocked = false;
      }
      return succeeded;
    } else if (
      alen === 4 &&
      ispolytree
    ) // function (clipType, polytree, subjFillType, clipFillType)
    {
      var clipType = a[0],
        polytree = a[1],
        subjFillType = a[2],
        clipFillType = a[3];
      if (this.m_ExecuteLocked) return false;
      this.m_ExecuteLocked = true;
      this.m_SubjFillType = subjFillType;
      this.m_ClipFillType = clipFillType;
      this.m_ClipType = clipType;
      this.m_UsingPolyTree = true;
      try {
        var succeeded = this.ExecuteInternal();
        //build the return polygons ...
        if (succeeded) this.BuildResult2(polytree);
      } finally {
        this.DisposeAllPolyPts();
        this.m_ExecuteLocked = false;
      }
      return succeeded;
    } else if (alen === 2 && !ispolytree) // function (clipType, solution)
    {
      var clipType = a[0],
        solution = a[1];
      return this.Execute(
        clipType,
        solution,
        ClipperLib.PolyFillType.pftEvenOdd,
        ClipperLib.PolyFillType.pftEvenOdd,
      );
    } else if (alen === 2 && ispolytree) // function (clipType, polytree)
    {
      var clipType = a[0],
        polytree = a[1];
      return this.Execute(
        clipType,
        polytree,
        ClipperLib.PolyFillType.pftEvenOdd,
        ClipperLib.PolyFillType.pftEvenOdd,
      );
    }
  };

  ClipperLib.Clipper.prototype.FixHoleLinkage = function (outRec) {
    //skip if an outermost polygon or
    //already already points to the correct FirstLeft ...
    if (
      outRec.FirstLeft === null ||
      (outRec.IsHole !== outRec.FirstLeft.IsHole && outRec.FirstLeft.Pts !== null)
    )
      return;
    var orfl = outRec.FirstLeft;
    while (orfl !== null && (orfl.IsHole === outRec.IsHole || orfl.Pts === null))
      orfl = orfl.FirstLeft;
    outRec.FirstLeft = orfl;
  };

  ClipperLib.Clipper.prototype.ExecuteInternal = function () {
    try {
      this.Reset();
      this.m_SortedEdges = null;
      this.m_Maxima = null;

      var botY = {},
        topY = {};

      if (!this.PopScanbeam(botY)) {
        return false;
      }
      this.InsertLocalMinimaIntoAEL(botY.v);
      while (this.PopScanbeam(topY) || this.LocalMinimaPending()) {
        this.ProcessHorizontals();
        this.m_GhostJoins.length = 0;
        if (!this.ProcessIntersections(topY.v)) {
          return false;
        }
        this.ProcessEdgesAtTopOfScanbeam(topY.v);
        botY.v = topY.v;
        this.InsertLocalMinimaIntoAEL(botY.v);
      }

      //fix orientations ...
      var outRec, i, ilen;
      //fix orientations ...
      for (i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
        outRec = this.m_PolyOuts[i];
        if (outRec.Pts === null || outRec.IsOpen) continue;
        if ((outRec.IsHole ^ this.ReverseSolution) == this.Area$1(outRec) > 0)
          this.ReversePolyPtLinks(outRec.Pts);
      }

      this.JoinCommonEdges();

      for (i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
        outRec = this.m_PolyOuts[i];
        if (outRec.Pts === null) continue;
        else if (outRec.IsOpen) this.FixupOutPolyline(outRec);
        else this.FixupOutPolygon(outRec);
      }

      if (this.StrictlySimple) this.DoSimplePolygons();
      return true;
    } finally {
      //catch { return false; }
      this.m_Joins.length = 0;
      this.m_GhostJoins.length = 0;
    }
  };

  ClipperLib.Clipper.prototype.DisposeAllPolyPts = function () {
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; ++i) this.DisposeOutRec(i);
    ClipperLib.Clear(this.m_PolyOuts);
  };

  ClipperLib.Clipper.prototype.AddJoin = function (Op1, Op2, OffPt) {
    var j = new ClipperLib.Join();
    j.OutPt1 = Op1;
    j.OutPt2 = Op2;
    //j.OffPt = OffPt;
    j.OffPt.X = OffPt.X;
    j.OffPt.Y = OffPt.Y;
    if (ClipperLib.use_xyz) j.OffPt.Z = OffPt.Z;
    this.m_Joins.push(j);
  };

  ClipperLib.Clipper.prototype.AddGhostJoin = function (Op, OffPt) {
    var j = new ClipperLib.Join();
    j.OutPt1 = Op;
    //j.OffPt = OffPt;
    j.OffPt.X = OffPt.X;
    j.OffPt.Y = OffPt.Y;
    if (ClipperLib.use_xyz) j.OffPt.Z = OffPt.Z;
    this.m_GhostJoins.push(j);
  };

  //if (ClipperLib.use_xyz)
  //{
  ClipperLib.Clipper.prototype.SetZ = function (pt, e1, e2) {
    if (this.ZFillFunction !== null) {
      if (pt.Z !== 0 || this.ZFillFunction === null) return;
      else if (ClipperLib.IntPoint.op_Equality(pt, e1.Bot)) pt.Z = e1.Bot.Z;
      else if (ClipperLib.IntPoint.op_Equality(pt, e1.Top)) pt.Z = e1.Top.Z;
      else if (ClipperLib.IntPoint.op_Equality(pt, e2.Bot)) pt.Z = e2.Bot.Z;
      else if (ClipperLib.IntPoint.op_Equality(pt, e2.Top)) pt.Z = e2.Top.Z;
      else this.ZFillFunction(e1.Bot, e1.Top, e2.Bot, e2.Top, pt);
    }
  };
  //}

  ClipperLib.Clipper.prototype.InsertLocalMinimaIntoAEL = function (botY) {
    var lm = {};

    var lb;
    var rb;
    while (this.PopLocalMinima(botY, lm)) {
      lb = lm.v.LeftBound;
      rb = lm.v.RightBound;

      var Op1 = null;
      if (lb === null) {
        this.InsertEdgeIntoAEL(rb, null);
        this.SetWindingCount(rb);
        if (this.IsContributing(rb)) Op1 = this.AddOutPt(rb, rb.Bot);
      } else if (rb === null) {
        this.InsertEdgeIntoAEL(lb, null);
        this.SetWindingCount(lb);
        if (this.IsContributing(lb)) Op1 = this.AddOutPt(lb, lb.Bot);
        this.InsertScanbeam(lb.Top.Y);
      } else {
        this.InsertEdgeIntoAEL(lb, null);
        this.InsertEdgeIntoAEL(rb, lb);
        this.SetWindingCount(lb);
        rb.WindCnt = lb.WindCnt;
        rb.WindCnt2 = lb.WindCnt2;
        if (this.IsContributing(lb)) Op1 = this.AddLocalMinPoly(lb, rb, lb.Bot);
        this.InsertScanbeam(lb.Top.Y);
      }
      if (rb !== null) {
        if (ClipperLib.ClipperBase.IsHorizontal(rb)) {
          if (rb.NextInLML !== null) {
            this.InsertScanbeam(rb.NextInLML.Top.Y);
          }
          this.AddEdgeToSEL(rb);
        } else {
          this.InsertScanbeam(rb.Top.Y);
        }
      }
      if (lb === null || rb === null) continue;
      //if output polygons share an Edge with a horizontal rb, they'll need joining later ...
      if (
        Op1 !== null &&
        ClipperLib.ClipperBase.IsHorizontal(rb) &&
        this.m_GhostJoins.length > 0 &&
        rb.WindDelta !== 0
      ) {
        for (var i = 0, ilen = this.m_GhostJoins.length; i < ilen; i++) {
          //if the horizontal Rb and a 'ghost' horizontal overlap, then convert
          //the 'ghost' join to a real join ready for later ...
          var j = this.m_GhostJoins[i];

          if (this.HorzSegmentsOverlap(j.OutPt1.Pt.X, j.OffPt.X, rb.Bot.X, rb.Top.X))
            this.AddJoin(j.OutPt1, Op1, j.OffPt);
        }
      }

      if (
        lb.OutIdx >= 0 &&
        lb.PrevInAEL !== null &&
        lb.PrevInAEL.Curr.X === lb.Bot.X &&
        lb.PrevInAEL.OutIdx >= 0 &&
        ClipperLib.ClipperBase.SlopesEqual5(
          lb.PrevInAEL.Curr,
          lb.PrevInAEL.Top,
          lb.Curr,
          lb.Top,
          this.m_UseFullRange,
        ) &&
        lb.WindDelta !== 0 &&
        lb.PrevInAEL.WindDelta !== 0
      ) {
        var Op2 = this.AddOutPt(lb.PrevInAEL, lb.Bot);
        this.AddJoin(Op1, Op2, lb.Top);
      }
      if (lb.NextInAEL !== rb) {
        if (
          rb.OutIdx >= 0 &&
          rb.PrevInAEL.OutIdx >= 0 &&
          ClipperLib.ClipperBase.SlopesEqual5(
            rb.PrevInAEL.Curr,
            rb.PrevInAEL.Top,
            rb.Curr,
            rb.Top,
            this.m_UseFullRange,
          ) &&
          rb.WindDelta !== 0 &&
          rb.PrevInAEL.WindDelta !== 0
        ) {
          var Op2 = this.AddOutPt(rb.PrevInAEL, rb.Bot);
          this.AddJoin(Op1, Op2, rb.Top);
        }
        var e = lb.NextInAEL;
        if (e !== null)
          while (e !== rb) {
            //nb: For calculating winding counts etc, IntersectEdges() assumes
            //that param1 will be to the right of param2 ABOVE the intersection ...
            this.IntersectEdges(rb, e, lb.Curr);
            //order important here
            e = e.NextInAEL;
          }
      }
    }
  };

  ClipperLib.Clipper.prototype.InsertEdgeIntoAEL = function (edge, startEdge) {
    if (this.m_ActiveEdges === null) {
      edge.PrevInAEL = null;
      edge.NextInAEL = null;
      this.m_ActiveEdges = edge;
    } else if (startEdge === null && this.E2InsertsBeforeE1(this.m_ActiveEdges, edge)) {
      edge.PrevInAEL = null;
      edge.NextInAEL = this.m_ActiveEdges;
      this.m_ActiveEdges.PrevInAEL = edge;
      this.m_ActiveEdges = edge;
    } else {
      if (startEdge === null) startEdge = this.m_ActiveEdges;
      while (startEdge.NextInAEL !== null && !this.E2InsertsBeforeE1(startEdge.NextInAEL, edge))
        startEdge = startEdge.NextInAEL;
      edge.NextInAEL = startEdge.NextInAEL;
      if (startEdge.NextInAEL !== null) startEdge.NextInAEL.PrevInAEL = edge;
      edge.PrevInAEL = startEdge;
      startEdge.NextInAEL = edge;
    }
  };

  ClipperLib.Clipper.prototype.E2InsertsBeforeE1 = function (e1, e2) {
    if (e2.Curr.X === e1.Curr.X) {
      if (e2.Top.Y > e1.Top.Y) return e2.Top.X < ClipperLib.Clipper.TopX(e1, e2.Top.Y);
      else return e1.Top.X > ClipperLib.Clipper.TopX(e2, e1.Top.Y);
    } else return e2.Curr.X < e1.Curr.X;
  };

  ClipperLib.Clipper.prototype.IsEvenOddFillType = function (edge) {
    if (edge.PolyTyp === ClipperLib.PolyType.ptSubject)
      return this.m_SubjFillType === ClipperLib.PolyFillType.pftEvenOdd;
    else return this.m_ClipFillType === ClipperLib.PolyFillType.pftEvenOdd;
  };

  ClipperLib.Clipper.prototype.IsEvenOddAltFillType = function (edge) {
    if (edge.PolyTyp === ClipperLib.PolyType.ptSubject)
      return this.m_ClipFillType === ClipperLib.PolyFillType.pftEvenOdd;
    else return this.m_SubjFillType === ClipperLib.PolyFillType.pftEvenOdd;
  };

  ClipperLib.Clipper.prototype.IsContributing = function (edge) {
    var pft, pft2;
    if (edge.PolyTyp === ClipperLib.PolyType.ptSubject) {
      pft = this.m_SubjFillType;
      pft2 = this.m_ClipFillType;
    } else {
      pft = this.m_ClipFillType;
      pft2 = this.m_SubjFillType;
    }
    switch (pft) {
      case ClipperLib.PolyFillType.pftEvenOdd:
        if (edge.WindDelta === 0 && edge.WindCnt !== 1) return false;
        break;
      case ClipperLib.PolyFillType.pftNonZero:
        if (Math.abs(edge.WindCnt) !== 1) return false;
        break;
      case ClipperLib.PolyFillType.pftPositive:
        if (edge.WindCnt !== 1) return false;
        break;
      default:
        if (edge.WindCnt !== -1) return false;
        break;
    }
    switch (this.m_ClipType) {
      case ClipperLib.ClipType.ctIntersection:
        switch (pft2) {
          case ClipperLib.PolyFillType.pftEvenOdd:
          case ClipperLib.PolyFillType.pftNonZero:
            return edge.WindCnt2 !== 0;
          case ClipperLib.PolyFillType.pftPositive:
            return edge.WindCnt2 > 0;
          default:
            return edge.WindCnt2 < 0;
        }
      case ClipperLib.ClipType.ctUnion:
        switch (pft2) {
          case ClipperLib.PolyFillType.pftEvenOdd:
          case ClipperLib.PolyFillType.pftNonZero:
            return edge.WindCnt2 === 0;
          case ClipperLib.PolyFillType.pftPositive:
            return edge.WindCnt2 <= 0;
          default:
            return edge.WindCnt2 >= 0;
        }
      case ClipperLib.ClipType.ctDifference:
        if (edge.PolyTyp === ClipperLib.PolyType.ptSubject)
          switch (pft2) {
            case ClipperLib.PolyFillType.pftEvenOdd:
            case ClipperLib.PolyFillType.pftNonZero:
              return edge.WindCnt2 === 0;
            case ClipperLib.PolyFillType.pftPositive:
              return edge.WindCnt2 <= 0;
            default:
              return edge.WindCnt2 >= 0;
          }
        else
          switch (pft2) {
            case ClipperLib.PolyFillType.pftEvenOdd:
            case ClipperLib.PolyFillType.pftNonZero:
              return edge.WindCnt2 !== 0;
            case ClipperLib.PolyFillType.pftPositive:
              return edge.WindCnt2 > 0;
            default:
              return edge.WindCnt2 < 0;
          }
      case ClipperLib.ClipType.ctXor:
        if (edge.WindDelta === 0)
          switch (pft2) {
            case ClipperLib.PolyFillType.pftEvenOdd:
            case ClipperLib.PolyFillType.pftNonZero:
              return edge.WindCnt2 === 0;
            case ClipperLib.PolyFillType.pftPositive:
              return edge.WindCnt2 <= 0;
            default:
              return edge.WindCnt2 >= 0;
          }
        else return true;
    }
    return true;
  };

  ClipperLib.Clipper.prototype.SetWindingCount = function (edge) {
    var e = edge.PrevInAEL;
    //find the edge of the same polytype that immediately preceeds 'edge' in AEL
    while (e !== null && (e.PolyTyp !== edge.PolyTyp || e.WindDelta === 0)) e = e.PrevInAEL;
    if (e === null) {
      var pft =
        edge.PolyTyp === ClipperLib.PolyType.ptSubject ? this.m_SubjFillType : this.m_ClipFillType;
      if (edge.WindDelta === 0) {
        edge.WindCnt = pft === ClipperLib.PolyFillType.pftNegative ? -1 : 1;
      } else {
        edge.WindCnt = edge.WindDelta;
      }
      edge.WindCnt2 = 0;
      e = this.m_ActiveEdges;
      //ie get ready to calc WindCnt2
    } else if (edge.WindDelta === 0 && this.m_ClipType !== ClipperLib.ClipType.ctUnion) {
      edge.WindCnt = 1;
      edge.WindCnt2 = e.WindCnt2;
      e = e.NextInAEL;
      //ie get ready to calc WindCnt2
    } else if (this.IsEvenOddFillType(edge)) {
      //EvenOdd filling ...
      if (edge.WindDelta === 0) {
        //are we inside a subj polygon ...
        var Inside = true;
        var e2 = e.PrevInAEL;
        while (e2 !== null) {
          if (e2.PolyTyp === e.PolyTyp && e2.WindDelta !== 0) Inside = !Inside;
          e2 = e2.PrevInAEL;
        }
        edge.WindCnt = Inside ? 0 : 1;
      } else {
        edge.WindCnt = edge.WindDelta;
      }
      edge.WindCnt2 = e.WindCnt2;
      e = e.NextInAEL;
      //ie get ready to calc WindCnt2
    } else {
      //nonZero, Positive or Negative filling ...
      if (e.WindCnt * e.WindDelta < 0) {
        //prev edge is 'decreasing' WindCount (WC) toward zero
        //so we're outside the previous polygon ...
        if (Math.abs(e.WindCnt) > 1) {
          //outside prev poly but still inside another.
          //when reversing direction of prev poly use the same WC
          if (e.WindDelta * edge.WindDelta < 0) edge.WindCnt = e.WindCnt;
          else edge.WindCnt = e.WindCnt + edge.WindDelta;
        } else edge.WindCnt = edge.WindDelta === 0 ? 1 : edge.WindDelta;
      } else {
        //prev edge is 'increasing' WindCount (WC) away from zero
        //so we're inside the previous polygon ...
        if (edge.WindDelta === 0) edge.WindCnt = e.WindCnt < 0 ? e.WindCnt - 1 : e.WindCnt + 1;
        else if (e.WindDelta * edge.WindDelta < 0) edge.WindCnt = e.WindCnt;
        else edge.WindCnt = e.WindCnt + edge.WindDelta;
      }
      edge.WindCnt2 = e.WindCnt2;
      e = e.NextInAEL;
      //ie get ready to calc WindCnt2
    }
    //update WindCnt2 ...
    if (this.IsEvenOddAltFillType(edge)) {
      //EvenOdd filling ...
      while (e !== edge) {
        if (e.WindDelta !== 0) edge.WindCnt2 = edge.WindCnt2 === 0 ? 1 : 0;
        e = e.NextInAEL;
      }
    } else {
      //nonZero, Positive or Negative filling ...
      while (e !== edge) {
        edge.WindCnt2 += e.WindDelta;
        e = e.NextInAEL;
      }
    }
  };

  ClipperLib.Clipper.prototype.AddEdgeToSEL = function (edge) {
    //SEL pointers in PEdge are use to build transient lists of horizontal edges.
    //However, since we don't need to worry about processing order, all additions
    //are made to the front of the list ...
    if (this.m_SortedEdges === null) {
      this.m_SortedEdges = edge;
      edge.PrevInSEL = null;
      edge.NextInSEL = null;
    } else {
      edge.NextInSEL = this.m_SortedEdges;
      edge.PrevInSEL = null;
      this.m_SortedEdges.PrevInSEL = edge;
      this.m_SortedEdges = edge;
    }
  };

  ClipperLib.Clipper.prototype.PopEdgeFromSEL = function (e) {
    //Pop edge from front of SEL (ie SEL is a FILO list)
    e.v = this.m_SortedEdges;
    if (e.v === null) {
      return false;
    }
    var oldE = e.v;
    this.m_SortedEdges = e.v.NextInSEL;
    if (this.m_SortedEdges !== null) {
      this.m_SortedEdges.PrevInSEL = null;
    }
    oldE.NextInSEL = null;
    oldE.PrevInSEL = null;
    return true;
  };

  ClipperLib.Clipper.prototype.CopyAELToSEL = function () {
    var e = this.m_ActiveEdges;
    this.m_SortedEdges = e;
    while (e !== null) {
      e.PrevInSEL = e.PrevInAEL;
      e.NextInSEL = e.NextInAEL;
      e = e.NextInAEL;
    }
  };

  ClipperLib.Clipper.prototype.SwapPositionsInSEL = function (edge1, edge2) {
    if (edge1.NextInSEL === null && edge1.PrevInSEL === null) return;
    if (edge2.NextInSEL === null && edge2.PrevInSEL === null) return;
    if (edge1.NextInSEL === edge2) {
      var next = edge2.NextInSEL;
      if (next !== null) next.PrevInSEL = edge1;
      var prev = edge1.PrevInSEL;
      if (prev !== null) prev.NextInSEL = edge2;
      edge2.PrevInSEL = prev;
      edge2.NextInSEL = edge1;
      edge1.PrevInSEL = edge2;
      edge1.NextInSEL = next;
    } else if (edge2.NextInSEL === edge1) {
      var next = edge1.NextInSEL;
      if (next !== null) next.PrevInSEL = edge2;
      var prev = edge2.PrevInSEL;
      if (prev !== null) prev.NextInSEL = edge1;
      edge1.PrevInSEL = prev;
      edge1.NextInSEL = edge2;
      edge2.PrevInSEL = edge1;
      edge2.NextInSEL = next;
    } else {
      var next = edge1.NextInSEL;
      var prev = edge1.PrevInSEL;
      edge1.NextInSEL = edge2.NextInSEL;
      if (edge1.NextInSEL !== null) edge1.NextInSEL.PrevInSEL = edge1;
      edge1.PrevInSEL = edge2.PrevInSEL;
      if (edge1.PrevInSEL !== null) edge1.PrevInSEL.NextInSEL = edge1;
      edge2.NextInSEL = next;
      if (edge2.NextInSEL !== null) edge2.NextInSEL.PrevInSEL = edge2;
      edge2.PrevInSEL = prev;
      if (edge2.PrevInSEL !== null) edge2.PrevInSEL.NextInSEL = edge2;
    }
    if (edge1.PrevInSEL === null) this.m_SortedEdges = edge1;
    else if (edge2.PrevInSEL === null) this.m_SortedEdges = edge2;
  };

  ClipperLib.Clipper.prototype.AddLocalMaxPoly = function (e1, e2, pt) {
    this.AddOutPt(e1, pt);
    if (e2.WindDelta === 0) this.AddOutPt(e2, pt);
    if (e1.OutIdx === e2.OutIdx) {
      e1.OutIdx = -1;
      e2.OutIdx = -1;
    } else if (e1.OutIdx < e2.OutIdx) this.AppendPolygon(e1, e2);
    else this.AppendPolygon(e2, e1);
  };

  ClipperLib.Clipper.prototype.AddLocalMinPoly = function (e1, e2, pt) {
    var result;
    var e, prevE;
    if (ClipperLib.ClipperBase.IsHorizontal(e2) || e1.Dx > e2.Dx) {
      result = this.AddOutPt(e1, pt);
      e2.OutIdx = e1.OutIdx;
      e1.Side = ClipperLib.EdgeSide.esLeft;
      e2.Side = ClipperLib.EdgeSide.esRight;
      e = e1;
      if (e.PrevInAEL === e2) prevE = e2.PrevInAEL;
      else prevE = e.PrevInAEL;
    } else {
      result = this.AddOutPt(e2, pt);
      e1.OutIdx = e2.OutIdx;
      e1.Side = ClipperLib.EdgeSide.esRight;
      e2.Side = ClipperLib.EdgeSide.esLeft;
      e = e2;
      if (e.PrevInAEL === e1) prevE = e1.PrevInAEL;
      else prevE = e.PrevInAEL;
    }

    if (prevE !== null && prevE.OutIdx >= 0 && prevE.Top.Y < pt.Y && e.Top.Y < pt.Y) {
      var xPrev = ClipperLib.Clipper.TopX(prevE, pt.Y);
      var xE = ClipperLib.Clipper.TopX(e, pt.Y);
      if (
        xPrev === xE &&
        e.WindDelta !== 0 &&
        prevE.WindDelta !== 0 &&
        ClipperLib.ClipperBase.SlopesEqual5(
          new ClipperLib.IntPoint2(xPrev, pt.Y),
          prevE.Top,
          new ClipperLib.IntPoint2(xE, pt.Y),
          e.Top,
          this.m_UseFullRange,
        )
      ) {
        var outPt = this.AddOutPt(prevE, pt);
        this.AddJoin(result, outPt, e.Top);
      }
    }
    return result;
  };

  ClipperLib.Clipper.prototype.AddOutPt = function (e, pt) {
    if (e.OutIdx < 0) {
      var outRec = this.CreateOutRec();
      outRec.IsOpen = e.WindDelta === 0;
      var newOp = new ClipperLib.OutPt();
      outRec.Pts = newOp;
      newOp.Idx = outRec.Idx;
      //newOp.Pt = pt;
      newOp.Pt.X = pt.X;
      newOp.Pt.Y = pt.Y;
      if (ClipperLib.use_xyz) newOp.Pt.Z = pt.Z;
      newOp.Next = newOp;
      newOp.Prev = newOp;
      if (!outRec.IsOpen) this.SetHoleState(e, outRec);
      e.OutIdx = outRec.Idx;
      //nb: do this after SetZ !
      return newOp;
    } else {
      var outRec = this.m_PolyOuts[e.OutIdx];
      //OutRec.Pts is the 'Left-most' point & OutRec.Pts.Prev is the 'Right-most'
      var op = outRec.Pts;
      var ToFront = e.Side === ClipperLib.EdgeSide.esLeft;
      if (ToFront && ClipperLib.IntPoint.op_Equality(pt, op.Pt)) return op;
      else if (!ToFront && ClipperLib.IntPoint.op_Equality(pt, op.Prev.Pt)) return op.Prev;
      var newOp = new ClipperLib.OutPt();
      newOp.Idx = outRec.Idx;
      //newOp.Pt = pt;
      newOp.Pt.X = pt.X;
      newOp.Pt.Y = pt.Y;
      if (ClipperLib.use_xyz) newOp.Pt.Z = pt.Z;
      newOp.Next = op;
      newOp.Prev = op.Prev;
      newOp.Prev.Next = newOp;
      op.Prev = newOp;
      if (ToFront) outRec.Pts = newOp;
      return newOp;
    }
  };

  ClipperLib.Clipper.prototype.GetLastOutPt = function (e) {
    var outRec = this.m_PolyOuts[e.OutIdx];
    if (e.Side === ClipperLib.EdgeSide.esLeft) {
      return outRec.Pts;
    } else {
      return outRec.Pts.Prev;
    }
  };

  ClipperLib.Clipper.prototype.SwapPoints = function (pt1, pt2) {
    var tmp = new ClipperLib.IntPoint1(pt1.Value);
    //pt1.Value = pt2.Value;
    pt1.Value.X = pt2.Value.X;
    pt1.Value.Y = pt2.Value.Y;
    if (ClipperLib.use_xyz) pt1.Value.Z = pt2.Value.Z;
    //pt2.Value = tmp;
    pt2.Value.X = tmp.X;
    pt2.Value.Y = tmp.Y;
    if (ClipperLib.use_xyz) pt2.Value.Z = tmp.Z;
  };

  ClipperLib.Clipper.prototype.HorzSegmentsOverlap = function (seg1a, seg1b, seg2a, seg2b) {
    var tmp;
    if (seg1a > seg1b) {
      tmp = seg1a;
      seg1a = seg1b;
      seg1b = tmp;
    }
    if (seg2a > seg2b) {
      tmp = seg2a;
      seg2a = seg2b;
      seg2b = tmp;
    }
    return seg1a < seg2b && seg2a < seg1b;
  };

  ClipperLib.Clipper.prototype.SetHoleState = function (e, outRec) {
    var e2 = e.PrevInAEL;
    var eTmp = null;
    while (e2 !== null) {
      if (e2.OutIdx >= 0 && e2.WindDelta !== 0) {
        if (eTmp === null) eTmp = e2;
        else if (eTmp.OutIdx === e2.OutIdx) eTmp = null; //paired
      }
      e2 = e2.PrevInAEL;
    }

    if (eTmp === null) {
      outRec.FirstLeft = null;
      outRec.IsHole = false;
    } else {
      outRec.FirstLeft = this.m_PolyOuts[eTmp.OutIdx];
      outRec.IsHole = !outRec.FirstLeft.IsHole;
    }
  };

  ClipperLib.Clipper.prototype.GetDx = function (pt1, pt2) {
    if (pt1.Y === pt2.Y) return ClipperLib.ClipperBase.horizontal;
    else return (pt2.X - pt1.X) / (pt2.Y - pt1.Y);
  };

  ClipperLib.Clipper.prototype.FirstIsBottomPt = function (btmPt1, btmPt2) {
    var p = btmPt1.Prev;
    while (ClipperLib.IntPoint.op_Equality(p.Pt, btmPt1.Pt) && p !== btmPt1) p = p.Prev;
    var dx1p = Math.abs(this.GetDx(btmPt1.Pt, p.Pt));
    p = btmPt1.Next;
    while (ClipperLib.IntPoint.op_Equality(p.Pt, btmPt1.Pt) && p !== btmPt1) p = p.Next;
    var dx1n = Math.abs(this.GetDx(btmPt1.Pt, p.Pt));
    p = btmPt2.Prev;
    while (ClipperLib.IntPoint.op_Equality(p.Pt, btmPt2.Pt) && p !== btmPt2) p = p.Prev;
    var dx2p = Math.abs(this.GetDx(btmPt2.Pt, p.Pt));
    p = btmPt2.Next;
    while (ClipperLib.IntPoint.op_Equality(p.Pt, btmPt2.Pt) && p !== btmPt2) p = p.Next;
    var dx2n = Math.abs(this.GetDx(btmPt2.Pt, p.Pt));

    if (
      Math.max(dx1p, dx1n) === Math.max(dx2p, dx2n) &&
      Math.min(dx1p, dx1n) === Math.min(dx2p, dx2n)
    ) {
      return this.Area(btmPt1) > 0; //if otherwise identical use orientation
    } else {
      return (dx1p >= dx2p && dx1p >= dx2n) || (dx1n >= dx2p && dx1n >= dx2n);
    }
  };

  ClipperLib.Clipper.prototype.GetBottomPt = function (pp) {
    var dups = null;
    var p = pp.Next;
    while (p !== pp) {
      if (p.Pt.Y > pp.Pt.Y) {
        pp = p;
        dups = null;
      } else if (p.Pt.Y === pp.Pt.Y && p.Pt.X <= pp.Pt.X) {
        if (p.Pt.X < pp.Pt.X) {
          dups = null;
          pp = p;
        } else {
          if (p.Next !== pp && p.Prev !== pp) dups = p;
        }
      }
      p = p.Next;
    }
    if (dups !== null) {
      //there appears to be at least 2 vertices at bottomPt so ...
      while (dups !== p) {
        if (!this.FirstIsBottomPt(p, dups)) pp = dups;
        dups = dups.Next;
        while (ClipperLib.IntPoint.op_Inequality(dups.Pt, pp.Pt)) dups = dups.Next;
      }
    }
    return pp;
  };

  ClipperLib.Clipper.prototype.GetLowermostRec = function (outRec1, outRec2) {
    //work out which polygon fragment has the correct hole state ...
    if (outRec1.BottomPt === null) outRec1.BottomPt = this.GetBottomPt(outRec1.Pts);
    if (outRec2.BottomPt === null) outRec2.BottomPt = this.GetBottomPt(outRec2.Pts);
    var bPt1 = outRec1.BottomPt;
    var bPt2 = outRec2.BottomPt;
    if (bPt1.Pt.Y > bPt2.Pt.Y) return outRec1;
    else if (bPt1.Pt.Y < bPt2.Pt.Y) return outRec2;
    else if (bPt1.Pt.X < bPt2.Pt.X) return outRec1;
    else if (bPt1.Pt.X > bPt2.Pt.X) return outRec2;
    else if (bPt1.Next === bPt1) return outRec2;
    else if (bPt2.Next === bPt2) return outRec1;
    else if (this.FirstIsBottomPt(bPt1, bPt2)) return outRec1;
    else return outRec2;
  };

  ClipperLib.Clipper.prototype.OutRec1RightOfOutRec2 = function (outRec1, outRec2) {
    do {
      outRec1 = outRec1.FirstLeft;
      if (outRec1 === outRec2) return true;
    } while (outRec1 !== null);
    return false;
  };

  ClipperLib.Clipper.prototype.GetOutRec = function (idx) {
    var outrec = this.m_PolyOuts[idx];
    while (outrec !== this.m_PolyOuts[outrec.Idx]) outrec = this.m_PolyOuts[outrec.Idx];
    return outrec;
  };

  ClipperLib.Clipper.prototype.AppendPolygon = function (e1, e2) {
    //get the start and ends of both output polygons ...
    var outRec1 = this.m_PolyOuts[e1.OutIdx];
    var outRec2 = this.m_PolyOuts[e2.OutIdx];
    var holeStateRec;
    if (this.OutRec1RightOfOutRec2(outRec1, outRec2)) holeStateRec = outRec2;
    else if (this.OutRec1RightOfOutRec2(outRec2, outRec1)) holeStateRec = outRec1;
    else holeStateRec = this.GetLowermostRec(outRec1, outRec2);

    //get the start and ends of both output polygons and
    //join E2 poly onto E1 poly and delete pointers to E2 ...

    var p1_lft = outRec1.Pts;
    var p1_rt = p1_lft.Prev;
    var p2_lft = outRec2.Pts;
    var p2_rt = p2_lft.Prev;
    //join e2 poly onto e1 poly and delete pointers to e2 ...
    if (e1.Side === ClipperLib.EdgeSide.esLeft) {
      if (e2.Side === ClipperLib.EdgeSide.esLeft) {
        //z y x a b c
        this.ReversePolyPtLinks(p2_lft);
        p2_lft.Next = p1_lft;
        p1_lft.Prev = p2_lft;
        p1_rt.Next = p2_rt;
        p2_rt.Prev = p1_rt;
        outRec1.Pts = p2_rt;
      } else {
        //x y z a b c
        p2_rt.Next = p1_lft;
        p1_lft.Prev = p2_rt;
        p2_lft.Prev = p1_rt;
        p1_rt.Next = p2_lft;
        outRec1.Pts = p2_lft;
      }
    } else {
      if (e2.Side === ClipperLib.EdgeSide.esRight) {
        //a b c z y x
        this.ReversePolyPtLinks(p2_lft);
        p1_rt.Next = p2_rt;
        p2_rt.Prev = p1_rt;
        p2_lft.Next = p1_lft;
        p1_lft.Prev = p2_lft;
      } else {
        //a b c x y z
        p1_rt.Next = p2_lft;
        p2_lft.Prev = p1_rt;
        p1_lft.Prev = p2_rt;
        p2_rt.Next = p1_lft;
      }
    }
    outRec1.BottomPt = null;
    if (holeStateRec === outRec2) {
      if (outRec2.FirstLeft !== outRec1) outRec1.FirstLeft = outRec2.FirstLeft;
      outRec1.IsHole = outRec2.IsHole;
    }
    outRec2.Pts = null;
    outRec2.BottomPt = null;
    outRec2.FirstLeft = outRec1;
    var OKIdx = e1.OutIdx;
    var ObsoleteIdx = e2.OutIdx;
    e1.OutIdx = -1;
    //nb: safe because we only get here via AddLocalMaxPoly
    e2.OutIdx = -1;
    var e = this.m_ActiveEdges;
    while (e !== null) {
      if (e.OutIdx === ObsoleteIdx) {
        e.OutIdx = OKIdx;
        e.Side = e1.Side;
        break;
      }
      e = e.NextInAEL;
    }
    outRec2.Idx = outRec1.Idx;
  };

  ClipperLib.Clipper.prototype.ReversePolyPtLinks = function (pp) {
    if (pp === null) return;
    var pp1;
    var pp2;
    pp1 = pp;
    do {
      pp2 = pp1.Next;
      pp1.Next = pp1.Prev;
      pp1.Prev = pp2;
      pp1 = pp2;
    } while (pp1 !== pp);
  };

  ClipperLib.Clipper.SwapSides = function (edge1, edge2) {
    var side = edge1.Side;
    edge1.Side = edge2.Side;
    edge2.Side = side;
  };

  ClipperLib.Clipper.SwapPolyIndexes = function (edge1, edge2) {
    var outIdx = edge1.OutIdx;
    edge1.OutIdx = edge2.OutIdx;
    edge2.OutIdx = outIdx;
  };

  ClipperLib.Clipper.prototype.IntersectEdges = function (e1, e2, pt) {
    //e1 will be to the left of e2 BELOW the intersection. Therefore e1 is before
    //e2 in AEL except when e1 is being inserted at the intersection point ...
    var e1Contributing = e1.OutIdx >= 0;
    var e2Contributing = e2.OutIdx >= 0;

    if (ClipperLib.use_xyz) this.SetZ(pt, e1, e2);

    if (ClipperLib.use_lines) {
      //if either edge is on an OPEN path ...
      if (e1.WindDelta === 0 || e2.WindDelta === 0) {
        //ignore subject-subject open path intersections UNLESS they
        //are both open paths, AND they are both 'contributing maximas' ...
        if (e1.WindDelta === 0 && e2.WindDelta === 0) return;
        //if intersecting a subj line with a subj poly ...
        else if (
          e1.PolyTyp === e2.PolyTyp &&
          e1.WindDelta !== e2.WindDelta &&
          this.m_ClipType === ClipperLib.ClipType.ctUnion
        ) {
          if (e1.WindDelta === 0) {
            if (e2Contributing) {
              this.AddOutPt(e1, pt);
              if (e1Contributing) e1.OutIdx = -1;
            }
          } else {
            if (e1Contributing) {
              this.AddOutPt(e2, pt);
              if (e2Contributing) e2.OutIdx = -1;
            }
          }
        } else if (e1.PolyTyp !== e2.PolyTyp) {
          if (
            e1.WindDelta === 0 &&
            Math.abs(e2.WindCnt) === 1 &&
            (this.m_ClipType !== ClipperLib.ClipType.ctUnion || e2.WindCnt2 === 0)
          ) {
            this.AddOutPt(e1, pt);
            if (e1Contributing) e1.OutIdx = -1;
          } else if (
            e2.WindDelta === 0 &&
            Math.abs(e1.WindCnt) === 1 &&
            (this.m_ClipType !== ClipperLib.ClipType.ctUnion || e1.WindCnt2 === 0)
          ) {
            this.AddOutPt(e2, pt);
            if (e2Contributing) e2.OutIdx = -1;
          }
        }
        return;
      }
    }
    //update winding counts...
    //assumes that e1 will be to the Right of e2 ABOVE the intersection
    if (e1.PolyTyp === e2.PolyTyp) {
      if (this.IsEvenOddFillType(e1)) {
        var oldE1WindCnt = e1.WindCnt;
        e1.WindCnt = e2.WindCnt;
        e2.WindCnt = oldE1WindCnt;
      } else {
        if (e1.WindCnt + e2.WindDelta === 0) e1.WindCnt = -e1.WindCnt;
        else e1.WindCnt += e2.WindDelta;
        if (e2.WindCnt - e1.WindDelta === 0) e2.WindCnt = -e2.WindCnt;
        else e2.WindCnt -= e1.WindDelta;
      }
    } else {
      if (!this.IsEvenOddFillType(e2)) e1.WindCnt2 += e2.WindDelta;
      else e1.WindCnt2 = e1.WindCnt2 === 0 ? 1 : 0;
      if (!this.IsEvenOddFillType(e1)) e2.WindCnt2 -= e1.WindDelta;
      else e2.WindCnt2 = e2.WindCnt2 === 0 ? 1 : 0;
    }
    var e1FillType, e2FillType, e1FillType2, e2FillType2;
    if (e1.PolyTyp === ClipperLib.PolyType.ptSubject) {
      e1FillType = this.m_SubjFillType;
      e1FillType2 = this.m_ClipFillType;
    } else {
      e1FillType = this.m_ClipFillType;
      e1FillType2 = this.m_SubjFillType;
    }
    if (e2.PolyTyp === ClipperLib.PolyType.ptSubject) {
      e2FillType = this.m_SubjFillType;
      e2FillType2 = this.m_ClipFillType;
    } else {
      e2FillType = this.m_ClipFillType;
      e2FillType2 = this.m_SubjFillType;
    }
    var e1Wc, e2Wc;
    switch (e1FillType) {
      case ClipperLib.PolyFillType.pftPositive:
        e1Wc = e1.WindCnt;
        break;
      case ClipperLib.PolyFillType.pftNegative:
        e1Wc = -e1.WindCnt;
        break;
      default:
        e1Wc = Math.abs(e1.WindCnt);
        break;
    }
    switch (e2FillType) {
      case ClipperLib.PolyFillType.pftPositive:
        e2Wc = e2.WindCnt;
        break;
      case ClipperLib.PolyFillType.pftNegative:
        e2Wc = -e2.WindCnt;
        break;
      default:
        e2Wc = Math.abs(e2.WindCnt);
        break;
    }
    if (e1Contributing && e2Contributing) {
      if (
        (e1Wc !== 0 && e1Wc !== 1) ||
        (e2Wc !== 0 && e2Wc !== 1) ||
        (e1.PolyTyp !== e2.PolyTyp && this.m_ClipType !== ClipperLib.ClipType.ctXor)
      ) {
        this.AddLocalMaxPoly(e1, e2, pt);
      } else {
        this.AddOutPt(e1, pt);
        this.AddOutPt(e2, pt);
        ClipperLib.Clipper.SwapSides(e1, e2);
        ClipperLib.Clipper.SwapPolyIndexes(e1, e2);
      }
    } else if (e1Contributing) {
      if (e2Wc === 0 || e2Wc === 1) {
        this.AddOutPt(e1, pt);
        ClipperLib.Clipper.SwapSides(e1, e2);
        ClipperLib.Clipper.SwapPolyIndexes(e1, e2);
      }
    } else if (e2Contributing) {
      if (e1Wc === 0 || e1Wc === 1) {
        this.AddOutPt(e2, pt);
        ClipperLib.Clipper.SwapSides(e1, e2);
        ClipperLib.Clipper.SwapPolyIndexes(e1, e2);
      }
    } else if ((e1Wc === 0 || e1Wc === 1) && (e2Wc === 0 || e2Wc === 1)) {
      //neither edge is currently contributing ...
      var e1Wc2, e2Wc2;
      switch (e1FillType2) {
        case ClipperLib.PolyFillType.pftPositive:
          e1Wc2 = e1.WindCnt2;
          break;
        case ClipperLib.PolyFillType.pftNegative:
          e1Wc2 = -e1.WindCnt2;
          break;
        default:
          e1Wc2 = Math.abs(e1.WindCnt2);
          break;
      }
      switch (e2FillType2) {
        case ClipperLib.PolyFillType.pftPositive:
          e2Wc2 = e2.WindCnt2;
          break;
        case ClipperLib.PolyFillType.pftNegative:
          e2Wc2 = -e2.WindCnt2;
          break;
        default:
          e2Wc2 = Math.abs(e2.WindCnt2);
          break;
      }
      if (e1.PolyTyp !== e2.PolyTyp) {
        this.AddLocalMinPoly(e1, e2, pt);
      } else if (e1Wc === 1 && e2Wc === 1)
        switch (this.m_ClipType) {
          case ClipperLib.ClipType.ctIntersection:
            if (e1Wc2 > 0 && e2Wc2 > 0) this.AddLocalMinPoly(e1, e2, pt);
            break;
          case ClipperLib.ClipType.ctUnion:
            if (e1Wc2 <= 0 && e2Wc2 <= 0) this.AddLocalMinPoly(e1, e2, pt);
            break;
          case ClipperLib.ClipType.ctDifference:
            if (
              (e1.PolyTyp === ClipperLib.PolyType.ptClip && e1Wc2 > 0 && e2Wc2 > 0) ||
              (e1.PolyTyp === ClipperLib.PolyType.ptSubject && e1Wc2 <= 0 && e2Wc2 <= 0)
            )
              this.AddLocalMinPoly(e1, e2, pt);
            break;
          case ClipperLib.ClipType.ctXor:
            this.AddLocalMinPoly(e1, e2, pt);
            break;
        }
      else ClipperLib.Clipper.SwapSides(e1, e2);
    }
  };

  ClipperLib.Clipper.prototype.DeleteFromSEL = function (e) {
    var SelPrev = e.PrevInSEL;
    var SelNext = e.NextInSEL;
    if (SelPrev === null && SelNext === null && e !== this.m_SortedEdges) return;
    //already deleted
    if (SelPrev !== null) SelPrev.NextInSEL = SelNext;
    else this.m_SortedEdges = SelNext;
    if (SelNext !== null) SelNext.PrevInSEL = SelPrev;
    e.NextInSEL = null;
    e.PrevInSEL = null;
  };

  ClipperLib.Clipper.prototype.ProcessHorizontals = function () {
    var horzEdge = {}; //m_SortedEdges;
    while (this.PopEdgeFromSEL(horzEdge)) {
      this.ProcessHorizontal(horzEdge.v);
    }
  };

  ClipperLib.Clipper.prototype.GetHorzDirection = function (HorzEdge, $var) {
    if (HorzEdge.Bot.X < HorzEdge.Top.X) {
      $var.Left = HorzEdge.Bot.X;
      $var.Right = HorzEdge.Top.X;
      $var.Dir = ClipperLib.Direction.dLeftToRight;
    } else {
      $var.Left = HorzEdge.Top.X;
      $var.Right = HorzEdge.Bot.X;
      $var.Dir = ClipperLib.Direction.dRightToLeft;
    }
  };

  ClipperLib.Clipper.prototype.ProcessHorizontal = function (horzEdge) {
    var $var = {
      Dir: null,
      Left: null,
      Right: null,
    };

    this.GetHorzDirection(horzEdge, $var);
    var dir = $var.Dir;
    var horzLeft = $var.Left;
    var horzRight = $var.Right;

    var IsOpen = horzEdge.WindDelta === 0;

    var eLastHorz = horzEdge,
      eMaxPair = null;
    while (eLastHorz.NextInLML !== null && ClipperLib.ClipperBase.IsHorizontal(eLastHorz.NextInLML))
      eLastHorz = eLastHorz.NextInLML;
    if (eLastHorz.NextInLML === null) eMaxPair = this.GetMaximaPair(eLastHorz);

    var currMax = this.m_Maxima;
    if (currMax !== null) {
      //get the first maxima in range (X) ...
      if (dir === ClipperLib.Direction.dLeftToRight) {
        while (currMax !== null && currMax.X <= horzEdge.Bot.X) {
          currMax = currMax.Next;
        }
        if (currMax !== null && currMax.X >= eLastHorz.Top.X) {
          currMax = null;
        }
      } else {
        while (currMax.Next !== null && currMax.Next.X < horzEdge.Bot.X) {
          currMax = currMax.Next;
        }
        if (currMax.X <= eLastHorz.Top.X) {
          currMax = null;
        }
      }
    }
    var op1 = null;
    for (;;) {
      //loop through consec. horizontal edges
      var IsLastHorz = horzEdge === eLastHorz;
      var e = this.GetNextInAEL(horzEdge, dir);
      while (e !== null) {
        //this code block inserts extra coords into horizontal edges (in output
        //polygons) whereever maxima touch these horizontal edges. This helps
        //'simplifying' polygons (ie if the Simplify property is set).
        if (currMax !== null) {
          if (dir === ClipperLib.Direction.dLeftToRight) {
            while (currMax !== null && currMax.X < e.Curr.X) {
              if (horzEdge.OutIdx >= 0 && !IsOpen) {
                this.AddOutPt(horzEdge, new ClipperLib.IntPoint2(currMax.X, horzEdge.Bot.Y));
              }
              currMax = currMax.Next;
            }
          } else {
            while (currMax !== null && currMax.X > e.Curr.X) {
              if (horzEdge.OutIdx >= 0 && !IsOpen) {
                this.AddOutPt(horzEdge, new ClipperLib.IntPoint2(currMax.X, horzEdge.Bot.Y));
              }
              currMax = currMax.Prev;
            }
          }
        }

        if (
          (dir === ClipperLib.Direction.dLeftToRight && e.Curr.X > horzRight) ||
          (dir === ClipperLib.Direction.dRightToLeft && e.Curr.X < horzLeft)
        ) {
          break;
        }

        //Also break if we've got to the end of an intermediate horizontal edge ...
        //nb: Smaller Dx's are to the right of larger Dx's ABOVE the horizontal.
        if (
          e.Curr.X === horzEdge.Top.X &&
          horzEdge.NextInLML !== null &&
          e.Dx < horzEdge.NextInLML.Dx
        )
          break;

        if (horzEdge.OutIdx >= 0 && !IsOpen) //note: may be done multiple times
        {
          if (ClipperLib.use_xyz) {
            if (dir === ClipperLib.Direction.dLeftToRight) this.SetZ(e.Curr, horzEdge, e);
            else this.SetZ(e.Curr, e, horzEdge);
          }

          op1 = this.AddOutPt(horzEdge, e.Curr);
          var eNextHorz = this.m_SortedEdges;
          while (eNextHorz !== null) {
            if (
              eNextHorz.OutIdx >= 0 &&
              this.HorzSegmentsOverlap(
                horzEdge.Bot.X,
                horzEdge.Top.X,
                eNextHorz.Bot.X,
                eNextHorz.Top.X,
              )
            ) {
              var op2 = this.GetLastOutPt(eNextHorz);
              this.AddJoin(op2, op1, eNextHorz.Top);
            }
            eNextHorz = eNextHorz.NextInSEL;
          }
          this.AddGhostJoin(op1, horzEdge.Bot);
        }

        //OK, so far we're still in range of the horizontal Edge  but make sure
        //we're at the last of consec. horizontals when matching with eMaxPair
        if (e === eMaxPair && IsLastHorz) {
          if (horzEdge.OutIdx >= 0) {
            this.AddLocalMaxPoly(horzEdge, eMaxPair, horzEdge.Top);
          }
          this.DeleteFromAEL(horzEdge);
          this.DeleteFromAEL(eMaxPair);
          return;
        }

        if (dir === ClipperLib.Direction.dLeftToRight) {
          var Pt = new ClipperLib.IntPoint2(e.Curr.X, horzEdge.Curr.Y);
          this.IntersectEdges(horzEdge, e, Pt);
        } else {
          var Pt = new ClipperLib.IntPoint2(e.Curr.X, horzEdge.Curr.Y);
          this.IntersectEdges(e, horzEdge, Pt);
        }
        var eNext = this.GetNextInAEL(e, dir);
        this.SwapPositionsInAEL(horzEdge, e);
        e = eNext;
      } //end while(e !== null)

      //Break out of loop if HorzEdge.NextInLML is not also horizontal ...
      if (horzEdge.NextInLML === null || !ClipperLib.ClipperBase.IsHorizontal(horzEdge.NextInLML)) {
        break;
      }

      horzEdge = this.UpdateEdgeIntoAEL(horzEdge);
      if (horzEdge.OutIdx >= 0) {
        this.AddOutPt(horzEdge, horzEdge.Bot);
      }

      $var = {
        Dir: dir,
        Left: horzLeft,
        Right: horzRight,
      };

      this.GetHorzDirection(horzEdge, $var);
      dir = $var.Dir;
      horzLeft = $var.Left;
      horzRight = $var.Right;
    } //end for (;;)

    if (horzEdge.OutIdx >= 0 && op1 === null) {
      op1 = this.GetLastOutPt(horzEdge);
      var eNextHorz = this.m_SortedEdges;
      while (eNextHorz !== null) {
        if (
          eNextHorz.OutIdx >= 0 &&
          this.HorzSegmentsOverlap(horzEdge.Bot.X, horzEdge.Top.X, eNextHorz.Bot.X, eNextHorz.Top.X)
        ) {
          var op2 = this.GetLastOutPt(eNextHorz);
          this.AddJoin(op2, op1, eNextHorz.Top);
        }
        eNextHorz = eNextHorz.NextInSEL;
      }
      this.AddGhostJoin(op1, horzEdge.Top);
    }

    if (horzEdge.NextInLML !== null) {
      if (horzEdge.OutIdx >= 0) {
        op1 = this.AddOutPt(horzEdge, horzEdge.Top);

        horzEdge = this.UpdateEdgeIntoAEL(horzEdge);
        if (horzEdge.WindDelta === 0) {
          return;
        }
        //nb: HorzEdge is no longer horizontal here
        var ePrev = horzEdge.PrevInAEL;
        var eNext = horzEdge.NextInAEL;
        if (
          ePrev !== null &&
          ePrev.Curr.X === horzEdge.Bot.X &&
          ePrev.Curr.Y === horzEdge.Bot.Y &&
          ePrev.WindDelta === 0 &&
          ePrev.OutIdx >= 0 &&
          ePrev.Curr.Y > ePrev.Top.Y &&
          ClipperLib.ClipperBase.SlopesEqual3(horzEdge, ePrev, this.m_UseFullRange)
        ) {
          var op2 = this.AddOutPt(ePrev, horzEdge.Bot);
          this.AddJoin(op1, op2, horzEdge.Top);
        } else if (
          eNext !== null &&
          eNext.Curr.X === horzEdge.Bot.X &&
          eNext.Curr.Y === horzEdge.Bot.Y &&
          eNext.WindDelta !== 0 &&
          eNext.OutIdx >= 0 &&
          eNext.Curr.Y > eNext.Top.Y &&
          ClipperLib.ClipperBase.SlopesEqual3(horzEdge, eNext, this.m_UseFullRange)
        ) {
          var op2 = this.AddOutPt(eNext, horzEdge.Bot);
          this.AddJoin(op1, op2, horzEdge.Top);
        }
      } else {
        horzEdge = this.UpdateEdgeIntoAEL(horzEdge);
      }
    } else {
      if (horzEdge.OutIdx >= 0) {
        this.AddOutPt(horzEdge, horzEdge.Top);
      }
      this.DeleteFromAEL(horzEdge);
    }
  };

  ClipperLib.Clipper.prototype.GetNextInAEL = function (e, Direction) {
    return Direction === ClipperLib.Direction.dLeftToRight ? e.NextInAEL : e.PrevInAEL;
  };

  ClipperLib.Clipper.prototype.IsMinima = function (e) {
    return e !== null && e.Prev.NextInLML !== e && e.Next.NextInLML !== e;
  };

  ClipperLib.Clipper.prototype.IsMaxima = function (e, Y) {
    return e !== null && e.Top.Y === Y && e.NextInLML === null;
  };

  ClipperLib.Clipper.prototype.IsIntermediate = function (e, Y) {
    return e.Top.Y === Y && e.NextInLML !== null;
  };

  ClipperLib.Clipper.prototype.GetMaximaPair = function (e) {
    if (ClipperLib.IntPoint.op_Equality(e.Next.Top, e.Top) && e.Next.NextInLML === null) {
      return e.Next;
    } else {
      if (ClipperLib.IntPoint.op_Equality(e.Prev.Top, e.Top) && e.Prev.NextInLML === null) {
        return e.Prev;
      } else {
        return null;
      }
    }
  };

  ClipperLib.Clipper.prototype.GetMaximaPairEx = function (e) {
    //as above but returns null if MaxPair isn't in AEL (unless it's horizontal)
    var result = this.GetMaximaPair(e);
    if (
      result === null ||
      result.OutIdx === ClipperLib.ClipperBase.Skip ||
      (result.NextInAEL === result.PrevInAEL && !ClipperLib.ClipperBase.IsHorizontal(result))
    ) {
      return null;
    }
    return result;
  };

  ClipperLib.Clipper.prototype.ProcessIntersections = function (topY) {
    if (this.m_ActiveEdges === null) return true;
    try {
      this.BuildIntersectList(topY);
      if (this.m_IntersectList.length === 0) return true;
      if (this.m_IntersectList.length === 1 || this.FixupIntersectionOrder())
        this.ProcessIntersectList();
      else return false;
    } catch ($$e2) {
      this.m_SortedEdges = null;
      this.m_IntersectList.length = 0;
      ClipperLib.Error("ProcessIntersections error");
    }
    this.m_SortedEdges = null;
    return true;
  };

  ClipperLib.Clipper.prototype.BuildIntersectList = function (topY) {
    if (this.m_ActiveEdges === null) return;
    //prepare for sorting ...
    var e = this.m_ActiveEdges;
    //console.log(JSON.stringify(JSON.decycle( e )));
    this.m_SortedEdges = e;
    while (e !== null) {
      e.PrevInSEL = e.PrevInAEL;
      e.NextInSEL = e.NextInAEL;
      e.Curr.X = ClipperLib.Clipper.TopX(e, topY);
      e = e.NextInAEL;
    }
    //bubblesort ...
    var isModified = true;
    while (isModified && this.m_SortedEdges !== null) {
      isModified = false;
      e = this.m_SortedEdges;
      while (e.NextInSEL !== null) {
        var eNext = e.NextInSEL;
        var pt = new ClipperLib.IntPoint0();
        //console.log("e.Curr.X: " + e.Curr.X + " eNext.Curr.X" + eNext.Curr.X);
        if (e.Curr.X > eNext.Curr.X) {
          this.IntersectPoint(e, eNext, pt);
          if (pt.Y < topY) {
            pt = new ClipperLib.IntPoint2(ClipperLib.Clipper.TopX(e, topY), topY);
          }
          var newNode = new ClipperLib.IntersectNode();
          newNode.Edge1 = e;
          newNode.Edge2 = eNext;
          //newNode.Pt = pt;
          newNode.Pt.X = pt.X;
          newNode.Pt.Y = pt.Y;
          if (ClipperLib.use_xyz) newNode.Pt.Z = pt.Z;
          this.m_IntersectList.push(newNode);
          this.SwapPositionsInSEL(e, eNext);
          isModified = true;
        } else e = eNext;
      }
      if (e.PrevInSEL !== null) e.PrevInSEL.NextInSEL = null;
      else break;
    }
    this.m_SortedEdges = null;
  };

  ClipperLib.Clipper.prototype.EdgesAdjacent = function (inode) {
    return inode.Edge1.NextInSEL === inode.Edge2 || inode.Edge1.PrevInSEL === inode.Edge2;
  };

  ClipperLib.Clipper.IntersectNodeSort = function (node1, node2) {
    //the following typecast is safe because the differences in Pt.Y will
    //be limited to the height of the scanbeam.
    return node2.Pt.Y - node1.Pt.Y;
  };

  ClipperLib.Clipper.prototype.FixupIntersectionOrder = function () {
    //pre-condition: intersections are sorted bottom-most first.
    //Now it's crucial that intersections are made only between adjacent edges,
    //so to ensure this the order of intersections may need adjusting ...
    this.m_IntersectList.sort(this.m_IntersectNodeComparer);
    this.CopyAELToSEL();
    var cnt = this.m_IntersectList.length;
    for (var i = 0; i < cnt; i++) {
      if (!this.EdgesAdjacent(this.m_IntersectList[i])) {
        var j = i + 1;
        while (j < cnt && !this.EdgesAdjacent(this.m_IntersectList[j])) j++;
        if (j === cnt) return false;
        var tmp = this.m_IntersectList[i];
        this.m_IntersectList[i] = this.m_IntersectList[j];
        this.m_IntersectList[j] = tmp;
      }
      this.SwapPositionsInSEL(this.m_IntersectList[i].Edge1, this.m_IntersectList[i].Edge2);
    }
    return true;
  };

  ClipperLib.Clipper.prototype.ProcessIntersectList = function () {
    for (var i = 0, ilen = this.m_IntersectList.length; i < ilen; i++) {
      var iNode = this.m_IntersectList[i];
      this.IntersectEdges(iNode.Edge1, iNode.Edge2, iNode.Pt);
      this.SwapPositionsInAEL(iNode.Edge1, iNode.Edge2);
    }
    this.m_IntersectList.length = 0;
  };

  /*
	--------------------------------
	Round speedtest: http://jsperf.com/fastest-round
	--------------------------------
	*/
  var R1 = function (a) {
    return a < 0 ? Math.ceil(a - 0.5) : Math.round(a);
  };

  var R2 = function (a) {
    return a < 0 ? Math.ceil(a - 0.5) : Math.floor(a + 0.5);
  };

  var R3 = function (a) {
    return a < 0 ? -Math.round(Math.abs(a)) : Math.round(a);
  };

  var R4 = function (a) {
    if (a < 0) {
      a -= 0.5;
      return a < -2147483648 ? Math.ceil(a) : a | 0;
    } else {
      a += 0.5;
      return a > 2147483647 ? Math.floor(a) : a | 0;
    }
  };

  if (browser.msie) ClipperLib.Clipper.Round = R1;
  else if (browser.chromium) ClipperLib.Clipper.Round = R3;
  else if (browser.safari) ClipperLib.Clipper.Round = R4;
  else ClipperLib.Clipper.Round = R2; // eg. browser.chrome || browser.firefox || browser.opera
  ClipperLib.Clipper.TopX = function (edge, currentY) {
    //if (edge.Bot == edge.Curr) alert ("edge.Bot = edge.Curr");
    //if (edge.Bot == edge.Top) alert ("edge.Bot = edge.Top");
    if (currentY === edge.Top.Y) return edge.Top.X;
    return edge.Bot.X + ClipperLib.Clipper.Round(edge.Dx * (currentY - edge.Bot.Y));
  };

  ClipperLib.Clipper.prototype.IntersectPoint = function (edge1, edge2, ip) {
    ip.X = 0;
    ip.Y = 0;
    var b1, b2;
    //nb: with very large coordinate values, it's possible for SlopesEqual() to
    //return false but for the edge.Dx value be equal due to double precision rounding.
    if (edge1.Dx === edge2.Dx) {
      ip.Y = edge1.Curr.Y;
      ip.X = ClipperLib.Clipper.TopX(edge1, ip.Y);
      return;
    }
    if (edge1.Delta.X === 0) {
      ip.X = edge1.Bot.X;
      if (ClipperLib.ClipperBase.IsHorizontal(edge2)) {
        ip.Y = edge2.Bot.Y;
      } else {
        b2 = edge2.Bot.Y - edge2.Bot.X / edge2.Dx;
        ip.Y = ClipperLib.Clipper.Round(ip.X / edge2.Dx + b2);
      }
    } else if (edge2.Delta.X === 0) {
      ip.X = edge2.Bot.X;
      if (ClipperLib.ClipperBase.IsHorizontal(edge1)) {
        ip.Y = edge1.Bot.Y;
      } else {
        b1 = edge1.Bot.Y - edge1.Bot.X / edge1.Dx;
        ip.Y = ClipperLib.Clipper.Round(ip.X / edge1.Dx + b1);
      }
    } else {
      b1 = edge1.Bot.X - edge1.Bot.Y * edge1.Dx;
      b2 = edge2.Bot.X - edge2.Bot.Y * edge2.Dx;
      var q = (b2 - b1) / (edge1.Dx - edge2.Dx);
      ip.Y = ClipperLib.Clipper.Round(q);
      if (Math.abs(edge1.Dx) < Math.abs(edge2.Dx))
        ip.X = ClipperLib.Clipper.Round(edge1.Dx * q + b1);
      else ip.X = ClipperLib.Clipper.Round(edge2.Dx * q + b2);
    }
    if (ip.Y < edge1.Top.Y || ip.Y < edge2.Top.Y) {
      if (edge1.Top.Y > edge2.Top.Y) {
        ip.Y = edge1.Top.Y;
        ip.X = ClipperLib.Clipper.TopX(edge2, edge1.Top.Y);
        return ip.X < edge1.Top.X;
      } else ip.Y = edge2.Top.Y;
      if (Math.abs(edge1.Dx) < Math.abs(edge2.Dx)) ip.X = ClipperLib.Clipper.TopX(edge1, ip.Y);
      else ip.X = ClipperLib.Clipper.TopX(edge2, ip.Y);
    }
    //finally, don't allow 'ip' to be BELOW curr.Y (ie bottom of scanbeam) ...
    if (ip.Y > edge1.Curr.Y) {
      ip.Y = edge1.Curr.Y;
      //better to use the more vertical edge to derive X ...
      if (Math.abs(edge1.Dx) > Math.abs(edge2.Dx)) ip.X = ClipperLib.Clipper.TopX(edge2, ip.Y);
      else ip.X = ClipperLib.Clipper.TopX(edge1, ip.Y);
    }
  };

  ClipperLib.Clipper.prototype.ProcessEdgesAtTopOfScanbeam = function (topY) {
    var e = this.m_ActiveEdges;

    while (e !== null) {
      //1. process maxima, treating them as if they're 'bent' horizontal edges,
      //   but exclude maxima with horizontal edges. nb: e can't be a horizontal.
      var IsMaximaEdge = this.IsMaxima(e, topY);
      if (IsMaximaEdge) {
        var eMaxPair = this.GetMaximaPairEx(e);
        IsMaximaEdge = eMaxPair === null || !ClipperLib.ClipperBase.IsHorizontal(eMaxPair);
      }
      if (IsMaximaEdge) {
        if (this.StrictlySimple) {
          this.InsertMaxima(e.Top.X);
        }
        var ePrev = e.PrevInAEL;
        this.DoMaxima(e);
        if (ePrev === null) e = this.m_ActiveEdges;
        else e = ePrev.NextInAEL;
      } else {
        //2. promote horizontal edges, otherwise update Curr.X and Curr.Y ...
        if (this.IsIntermediate(e, topY) && ClipperLib.ClipperBase.IsHorizontal(e.NextInLML)) {
          e = this.UpdateEdgeIntoAEL(e);
          if (e.OutIdx >= 0) this.AddOutPt(e, e.Bot);
          this.AddEdgeToSEL(e);
        } else {
          e.Curr.X = ClipperLib.Clipper.TopX(e, topY);
          e.Curr.Y = topY;
        }

        if (ClipperLib.use_xyz) {
          if (e.Top.Y === topY) e.Curr.Z = e.Top.Z;
          else if (e.Bot.Y === topY) e.Curr.Z = e.Bot.Z;
          else e.Curr.Z = 0;
        }

        //When StrictlySimple and 'e' is being touched by another edge, then
        //make sure both edges have a vertex here ...
        if (this.StrictlySimple) {
          var ePrev = e.PrevInAEL;
          if (
            e.OutIdx >= 0 &&
            e.WindDelta !== 0 &&
            ePrev !== null &&
            ePrev.OutIdx >= 0 &&
            ePrev.Curr.X === e.Curr.X &&
            ePrev.WindDelta !== 0
          ) {
            var ip = new ClipperLib.IntPoint1(e.Curr);

            if (ClipperLib.use_xyz) {
              this.SetZ(ip, ePrev, e);
            }

            var op = this.AddOutPt(ePrev, ip);
            var op2 = this.AddOutPt(e, ip);
            this.AddJoin(op, op2, ip); //StrictlySimple (type-3) join
          }
        }
        e = e.NextInAEL;
      }
    }
    //3. Process horizontals at the Top of the scanbeam ...
    this.ProcessHorizontals();
    this.m_Maxima = null;
    //4. Promote intermediate vertices ...
    e = this.m_ActiveEdges;
    while (e !== null) {
      if (this.IsIntermediate(e, topY)) {
        var op = null;
        if (e.OutIdx >= 0) op = this.AddOutPt(e, e.Top);
        e = this.UpdateEdgeIntoAEL(e);
        //if output polygons share an edge, they'll need joining later ...
        var ePrev = e.PrevInAEL;
        var eNext = e.NextInAEL;

        if (
          ePrev !== null &&
          ePrev.Curr.X === e.Bot.X &&
          ePrev.Curr.Y === e.Bot.Y &&
          op !== null &&
          ePrev.OutIdx >= 0 &&
          ePrev.Curr.Y === ePrev.Top.Y &&
          ClipperLib.ClipperBase.SlopesEqual5(
            e.Curr,
            e.Top,
            ePrev.Curr,
            ePrev.Top,
            this.m_UseFullRange,
          ) &&
          e.WindDelta !== 0 &&
          ePrev.WindDelta !== 0
        ) {
          var op2 = this.AddOutPt(ePrev2, e.Bot);
          this.AddJoin(op, op2, e.Top);
        } else if (
          eNext !== null &&
          eNext.Curr.X === e.Bot.X &&
          eNext.Curr.Y === e.Bot.Y &&
          op !== null &&
          eNext.OutIdx >= 0 &&
          eNext.Curr.Y === eNext.Top.Y &&
          ClipperLib.ClipperBase.SlopesEqual5(
            e.Curr,
            e.Top,
            eNext.Curr,
            eNext.Top,
            this.m_UseFullRange,
          ) &&
          e.WindDelta !== 0 &&
          eNext.WindDelta !== 0
        ) {
          var op2 = this.AddOutPt(eNext, e.Bot);
          this.AddJoin(op, op2, e.Top);
        }
      }
      e = e.NextInAEL;
    }
  };

  ClipperLib.Clipper.prototype.DoMaxima = function (e) {
    var eMaxPair = this.GetMaximaPairEx(e);
    if (eMaxPair === null) {
      if (e.OutIdx >= 0) this.AddOutPt(e, e.Top);
      this.DeleteFromAEL(e);
      return;
    }
    var eNext = e.NextInAEL;
    while (eNext !== null && eNext !== eMaxPair) {
      this.IntersectEdges(e, eNext, e.Top);
      this.SwapPositionsInAEL(e, eNext);
      eNext = e.NextInAEL;
    }
    if (e.OutIdx === -1 && eMaxPair.OutIdx === -1) {
      this.DeleteFromAEL(e);
      this.DeleteFromAEL(eMaxPair);
    } else if (e.OutIdx >= 0 && eMaxPair.OutIdx >= 0) {
      if (e.OutIdx >= 0) this.AddLocalMaxPoly(e, eMaxPair, e.Top);
      this.DeleteFromAEL(e);
      this.DeleteFromAEL(eMaxPair);
    } else if (ClipperLib.use_lines && e.WindDelta === 0) {
      if (e.OutIdx >= 0) {
        this.AddOutPt(e, e.Top);
        e.OutIdx = ClipperLib.ClipperBase.Unassigned;
      }
      this.DeleteFromAEL(e);
      if (eMaxPair.OutIdx >= 0) {
        this.AddOutPt(eMaxPair, e.Top);
        eMaxPair.OutIdx = ClipperLib.ClipperBase.Unassigned;
      }
      this.DeleteFromAEL(eMaxPair);
    } else ClipperLib.Error("DoMaxima error");
  };

  ClipperLib.Clipper.ReversePaths = function (polys) {
    for (var i = 0, len = polys.length; i < len; i++) polys[i].reverse();
  };

  ClipperLib.Clipper.Orientation = function (poly) {
    return ClipperLib.Clipper.Area(poly) >= 0;
  };

  ClipperLib.Clipper.prototype.PointCount = function (pts) {
    if (pts === null) return 0;
    var result = 0;
    var p = pts;
    do {
      result++;
      p = p.Next;
    } while (p !== pts);
    return result;
  };

  ClipperLib.Clipper.prototype.BuildResult = function (polyg) {
    ClipperLib.Clear(polyg);
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      var outRec = this.m_PolyOuts[i];
      if (outRec.Pts === null) continue;
      var p = outRec.Pts.Prev;
      var cnt = this.PointCount(p);
      if (cnt < 2) continue;
      var pg = new Array(cnt);
      for (var j = 0; j < cnt; j++) {
        pg[j] = p.Pt;
        p = p.Prev;
      }
      polyg.push(pg);
    }
  };

  ClipperLib.Clipper.prototype.BuildResult2 = function (polytree) {
    polytree.Clear();
    //add each output polygon/contour to polytree ...
    //polytree.m_AllPolys.set_Capacity(this.m_PolyOuts.length);
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      var outRec = this.m_PolyOuts[i];
      var cnt = this.PointCount(outRec.Pts);
      if ((outRec.IsOpen && cnt < 2) || (!outRec.IsOpen && cnt < 3)) continue;
      this.FixHoleLinkage(outRec);
      var pn = new ClipperLib.PolyNode();
      polytree.m_AllPolys.push(pn);
      outRec.PolyNode = pn;
      pn.m_polygon.length = cnt;
      var op = outRec.Pts.Prev;
      for (var j = 0; j < cnt; j++) {
        pn.m_polygon[j] = op.Pt;
        op = op.Prev;
      }
    }
    //fixup PolyNode links etc ...
    //polytree.m_Childs.set_Capacity(this.m_PolyOuts.length);
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      var outRec = this.m_PolyOuts[i];
      if (outRec.PolyNode === null) continue;
      else if (outRec.IsOpen) {
        outRec.PolyNode.IsOpen = true;
        polytree.AddChild(outRec.PolyNode);
      } else if (outRec.FirstLeft !== null && outRec.FirstLeft.PolyNode !== null)
        outRec.FirstLeft.PolyNode.AddChild(outRec.PolyNode);
      else polytree.AddChild(outRec.PolyNode);
    }
  };

  ClipperLib.Clipper.prototype.FixupOutPolyline = function (outRec) {
    var pp = outRec.Pts;
    var lastPP = pp.Prev;
    while (pp !== lastPP) {
      pp = pp.Next;
      if (ClipperLib.IntPoint.op_Equality(pp.Pt, pp.Prev.Pt)) {
        if (pp === lastPP) {
          lastPP = pp.Prev;
        }
        var tmpPP = pp.Prev;
        tmpPP.Next = pp.Next;
        pp.Next.Prev = tmpPP;
        pp = tmpPP;
      }
    }
    if (pp === pp.Prev) {
      outRec.Pts = null;
    }
  };

  ClipperLib.Clipper.prototype.FixupOutPolygon = function (outRec) {
    //FixupOutPolygon() - removes duplicate points and simplifies consecutive
    //parallel edges by removing the middle vertex.
    var lastOK = null;
    outRec.BottomPt = null;
    var pp = outRec.Pts;
    var preserveCol = this.PreserveCollinear || this.StrictlySimple;
    for (;;) {
      if (pp.Prev === pp || pp.Prev === pp.Next) {
        outRec.Pts = null;
        return;
      }

      //test for duplicate points and collinear edges ...
      if (
        ClipperLib.IntPoint.op_Equality(pp.Pt, pp.Next.Pt) ||
        ClipperLib.IntPoint.op_Equality(pp.Pt, pp.Prev.Pt) ||
        (ClipperLib.ClipperBase.SlopesEqual4(pp.Prev.Pt, pp.Pt, pp.Next.Pt, this.m_UseFullRange) &&
          (!preserveCol || !this.Pt2IsBetweenPt1AndPt3(pp.Prev.Pt, pp.Pt, pp.Next.Pt)))
      ) {
        lastOK = null;
        pp.Prev.Next = pp.Next;
        pp.Next.Prev = pp.Prev;
        pp = pp.Prev;
      } else if (pp === lastOK) break;
      else {
        if (lastOK === null) lastOK = pp;
        pp = pp.Next;
      }
    }
    outRec.Pts = pp;
  };

  ClipperLib.Clipper.prototype.DupOutPt = function (outPt, InsertAfter) {
    var result = new ClipperLib.OutPt();
    //result.Pt = outPt.Pt;
    result.Pt.X = outPt.Pt.X;
    result.Pt.Y = outPt.Pt.Y;
    if (ClipperLib.use_xyz) result.Pt.Z = outPt.Pt.Z;
    result.Idx = outPt.Idx;
    if (InsertAfter) {
      result.Next = outPt.Next;
      result.Prev = outPt;
      outPt.Next.Prev = result;
      outPt.Next = result;
    } else {
      result.Prev = outPt.Prev;
      result.Next = outPt;
      outPt.Prev.Next = result;
      outPt.Prev = result;
    }
    return result;
  };

  ClipperLib.Clipper.prototype.GetOverlap = function (a1, a2, b1, b2, $val) {
    if (a1 < a2) {
      if (b1 < b2) {
        $val.Left = Math.max(a1, b1);
        $val.Right = Math.min(a2, b2);
      } else {
        $val.Left = Math.max(a1, b2);
        $val.Right = Math.min(a2, b1);
      }
    } else {
      if (b1 < b2) {
        $val.Left = Math.max(a2, b1);
        $val.Right = Math.min(a1, b2);
      } else {
        $val.Left = Math.max(a2, b2);
        $val.Right = Math.min(a1, b1);
      }
    }
    return $val.Left < $val.Right;
  };

  ClipperLib.Clipper.prototype.JoinHorz = function (op1, op1b, op2, op2b, Pt, DiscardLeft) {
    var Dir1 =
      op1.Pt.X > op1b.Pt.X ? ClipperLib.Direction.dRightToLeft : ClipperLib.Direction.dLeftToRight;
    var Dir2 =
      op2.Pt.X > op2b.Pt.X ? ClipperLib.Direction.dRightToLeft : ClipperLib.Direction.dLeftToRight;
    if (Dir1 === Dir2) return false;
    //When DiscardLeft, we want Op1b to be on the Left of Op1, otherwise we
    //want Op1b to be on the Right. (And likewise with Op2 and Op2b.)
    //So, to facilitate this while inserting Op1b and Op2b ...
    //when DiscardLeft, make sure we're AT or RIGHT of Pt before adding Op1b,
    //otherwise make sure we're AT or LEFT of Pt. (Likewise with Op2b.)
    if (Dir1 === ClipperLib.Direction.dLeftToRight) {
      while (op1.Next.Pt.X <= Pt.X && op1.Next.Pt.X >= op1.Pt.X && op1.Next.Pt.Y === Pt.Y)
        op1 = op1.Next;
      if (DiscardLeft && op1.Pt.X !== Pt.X) op1 = op1.Next;
      op1b = this.DupOutPt(op1, !DiscardLeft);
      if (ClipperLib.IntPoint.op_Inequality(op1b.Pt, Pt)) {
        op1 = op1b;
        //op1.Pt = Pt;
        op1.Pt.X = Pt.X;
        op1.Pt.Y = Pt.Y;
        if (ClipperLib.use_xyz) op1.Pt.Z = Pt.Z;
        op1b = this.DupOutPt(op1, !DiscardLeft);
      }
    } else {
      while (op1.Next.Pt.X >= Pt.X && op1.Next.Pt.X <= op1.Pt.X && op1.Next.Pt.Y === Pt.Y)
        op1 = op1.Next;
      if (!DiscardLeft && op1.Pt.X !== Pt.X) op1 = op1.Next;
      op1b = this.DupOutPt(op1, DiscardLeft);
      if (ClipperLib.IntPoint.op_Inequality(op1b.Pt, Pt)) {
        op1 = op1b;
        //op1.Pt = Pt;
        op1.Pt.X = Pt.X;
        op1.Pt.Y = Pt.Y;
        if (ClipperLib.use_xyz) op1.Pt.Z = Pt.Z;
        op1b = this.DupOutPt(op1, DiscardLeft);
      }
    }
    if (Dir2 === ClipperLib.Direction.dLeftToRight) {
      while (op2.Next.Pt.X <= Pt.X && op2.Next.Pt.X >= op2.Pt.X && op2.Next.Pt.Y === Pt.Y)
        op2 = op2.Next;
      if (DiscardLeft && op2.Pt.X !== Pt.X) op2 = op2.Next;
      op2b = this.DupOutPt(op2, !DiscardLeft);
      if (ClipperLib.IntPoint.op_Inequality(op2b.Pt, Pt)) {
        op2 = op2b;
        //op2.Pt = Pt;
        op2.Pt.X = Pt.X;
        op2.Pt.Y = Pt.Y;
        if (ClipperLib.use_xyz) op2.Pt.Z = Pt.Z;
        op2b = this.DupOutPt(op2, !DiscardLeft);
      }
    } else {
      while (op2.Next.Pt.X >= Pt.X && op2.Next.Pt.X <= op2.Pt.X && op2.Next.Pt.Y === Pt.Y)
        op2 = op2.Next;
      if (!DiscardLeft && op2.Pt.X !== Pt.X) op2 = op2.Next;
      op2b = this.DupOutPt(op2, DiscardLeft);
      if (ClipperLib.IntPoint.op_Inequality(op2b.Pt, Pt)) {
        op2 = op2b;
        //op2.Pt = Pt;
        op2.Pt.X = Pt.X;
        op2.Pt.Y = Pt.Y;
        if (ClipperLib.use_xyz) op2.Pt.Z = Pt.Z;
        op2b = this.DupOutPt(op2, DiscardLeft);
      }
    }
    if ((Dir1 === ClipperLib.Direction.dLeftToRight) === DiscardLeft) {
      op1.Prev = op2;
      op2.Next = op1;
      op1b.Next = op2b;
      op2b.Prev = op1b;
    } else {
      op1.Next = op2;
      op2.Prev = op1;
      op1b.Prev = op2b;
      op2b.Next = op1b;
    }
    return true;
  };

  ClipperLib.Clipper.prototype.JoinPoints = function (j, outRec1, outRec2) {
    var op1 = j.OutPt1,
      op1b = new ClipperLib.OutPt();
    var op2 = j.OutPt2,
      op2b = new ClipperLib.OutPt();
    //There are 3 kinds of joins for output polygons ...
    //1. Horizontal joins where Join.OutPt1 & Join.OutPt2 are vertices anywhere
    //along (horizontal) collinear edges (& Join.OffPt is on the same horizontal).
    //2. Non-horizontal joins where Join.OutPt1 & Join.OutPt2 are at the same
    //location at the Bottom of the overlapping segment (& Join.OffPt is above).
    //3. StrictlySimple joins where edges touch but are not collinear and where
    //Join.OutPt1, Join.OutPt2 & Join.OffPt all share the same point.
    var isHorizontal = j.OutPt1.Pt.Y === j.OffPt.Y;
    if (
      isHorizontal &&
      ClipperLib.IntPoint.op_Equality(j.OffPt, j.OutPt1.Pt) &&
      ClipperLib.IntPoint.op_Equality(j.OffPt, j.OutPt2.Pt)
    ) {
      //Strictly Simple join ...
      if (outRec1 !== outRec2) return false;

      op1b = j.OutPt1.Next;
      while (op1b !== op1 && ClipperLib.IntPoint.op_Equality(op1b.Pt, j.OffPt)) op1b = op1b.Next;
      var reverse1 = op1b.Pt.Y > j.OffPt.Y;
      op2b = j.OutPt2.Next;
      while (op2b !== op2 && ClipperLib.IntPoint.op_Equality(op2b.Pt, j.OffPt)) op2b = op2b.Next;
      var reverse2 = op2b.Pt.Y > j.OffPt.Y;
      if (reverse1 === reverse2) return false;
      if (reverse1) {
        op1b = this.DupOutPt(op1, false);
        op2b = this.DupOutPt(op2, true);
        op1.Prev = op2;
        op2.Next = op1;
        op1b.Next = op2b;
        op2b.Prev = op1b;
        j.OutPt1 = op1;
        j.OutPt2 = op1b;
        return true;
      } else {
        op1b = this.DupOutPt(op1, true);
        op2b = this.DupOutPt(op2, false);
        op1.Next = op2;
        op2.Prev = op1;
        op1b.Prev = op2b;
        op2b.Next = op1b;
        j.OutPt1 = op1;
        j.OutPt2 = op1b;
        return true;
      }
    } else if (isHorizontal) {
      //treat horizontal joins differently to non-horizontal joins since with
      //them we're not yet sure where the overlapping is. OutPt1.Pt & OutPt2.Pt
      //may be anywhere along the horizontal edge.
      op1b = op1;
      while (op1.Prev.Pt.Y === op1.Pt.Y && op1.Prev !== op1b && op1.Prev !== op2) op1 = op1.Prev;
      while (op1b.Next.Pt.Y === op1b.Pt.Y && op1b.Next !== op1 && op1b.Next !== op2)
        op1b = op1b.Next;
      if (op1b.Next === op1 || op1b.Next === op2) return false;
      //a flat 'polygon'
      op2b = op2;
      while (op2.Prev.Pt.Y === op2.Pt.Y && op2.Prev !== op2b && op2.Prev !== op1b) op2 = op2.Prev;
      while (op2b.Next.Pt.Y === op2b.Pt.Y && op2b.Next !== op2 && op2b.Next !== op1)
        op2b = op2b.Next;
      if (op2b.Next === op2 || op2b.Next === op1) return false;
      //a flat 'polygon'
      //Op1 -. Op1b & Op2 -. Op2b are the extremites of the horizontal edges

      var $val = {
        Left: null,
        Right: null,
      };

      if (!this.GetOverlap(op1.Pt.X, op1b.Pt.X, op2.Pt.X, op2b.Pt.X, $val)) return false;
      var Left = $val.Left;
      var Right = $val.Right;

      //DiscardLeftSide: when overlapping edges are joined, a spike will created
      //which needs to be cleaned up. However, we don't want Op1 or Op2 caught up
      //on the discard Side as either may still be needed for other joins ...
      var Pt = new ClipperLib.IntPoint0();
      var DiscardLeftSide;
      if (op1.Pt.X >= Left && op1.Pt.X <= Right) {
        //Pt = op1.Pt;
        Pt.X = op1.Pt.X;
        Pt.Y = op1.Pt.Y;
        if (ClipperLib.use_xyz) Pt.Z = op1.Pt.Z;
        DiscardLeftSide = op1.Pt.X > op1b.Pt.X;
      } else if (op2.Pt.X >= Left && op2.Pt.X <= Right) {
        //Pt = op2.Pt;
        Pt.X = op2.Pt.X;
        Pt.Y = op2.Pt.Y;
        if (ClipperLib.use_xyz) Pt.Z = op2.Pt.Z;
        DiscardLeftSide = op2.Pt.X > op2b.Pt.X;
      } else if (op1b.Pt.X >= Left && op1b.Pt.X <= Right) {
        //Pt = op1b.Pt;
        Pt.X = op1b.Pt.X;
        Pt.Y = op1b.Pt.Y;
        if (ClipperLib.use_xyz) Pt.Z = op1b.Pt.Z;
        DiscardLeftSide = op1b.Pt.X > op1.Pt.X;
      } else {
        //Pt = op2b.Pt;
        Pt.X = op2b.Pt.X;
        Pt.Y = op2b.Pt.Y;
        if (ClipperLib.use_xyz) Pt.Z = op2b.Pt.Z;
        DiscardLeftSide = op2b.Pt.X > op2.Pt.X;
      }
      j.OutPt1 = op1;
      j.OutPt2 = op2;
      return this.JoinHorz(op1, op1b, op2, op2b, Pt, DiscardLeftSide);
    } else {
      //nb: For non-horizontal joins ...
      //    1. Jr.OutPt1.Pt.Y == Jr.OutPt2.Pt.Y
      //    2. Jr.OutPt1.Pt > Jr.OffPt.Y
      //make sure the polygons are correctly oriented ...
      op1b = op1.Next;
      while (ClipperLib.IntPoint.op_Equality(op1b.Pt, op1.Pt) && op1b !== op1) op1b = op1b.Next;
      var Reverse1 =
        op1b.Pt.Y > op1.Pt.Y ||
        !ClipperLib.ClipperBase.SlopesEqual4(op1.Pt, op1b.Pt, j.OffPt, this.m_UseFullRange);
      if (Reverse1) {
        op1b = op1.Prev;
        while (ClipperLib.IntPoint.op_Equality(op1b.Pt, op1.Pt) && op1b !== op1) op1b = op1b.Prev;

        if (
          op1b.Pt.Y > op1.Pt.Y ||
          !ClipperLib.ClipperBase.SlopesEqual4(op1.Pt, op1b.Pt, j.OffPt, this.m_UseFullRange)
        )
          return false;
      }
      op2b = op2.Next;
      while (ClipperLib.IntPoint.op_Equality(op2b.Pt, op2.Pt) && op2b !== op2) op2b = op2b.Next;

      var Reverse2 =
        op2b.Pt.Y > op2.Pt.Y ||
        !ClipperLib.ClipperBase.SlopesEqual4(op2.Pt, op2b.Pt, j.OffPt, this.m_UseFullRange);
      if (Reverse2) {
        op2b = op2.Prev;
        while (ClipperLib.IntPoint.op_Equality(op2b.Pt, op2.Pt) && op2b !== op2) op2b = op2b.Prev;

        if (
          op2b.Pt.Y > op2.Pt.Y ||
          !ClipperLib.ClipperBase.SlopesEqual4(op2.Pt, op2b.Pt, j.OffPt, this.m_UseFullRange)
        )
          return false;
      }
      if (
        op1b === op1 ||
        op2b === op2 ||
        op1b === op2b ||
        (outRec1 === outRec2 && Reverse1 === Reverse2)
      )
        return false;
      if (Reverse1) {
        op1b = this.DupOutPt(op1, false);
        op2b = this.DupOutPt(op2, true);
        op1.Prev = op2;
        op2.Next = op1;
        op1b.Next = op2b;
        op2b.Prev = op1b;
        j.OutPt1 = op1;
        j.OutPt2 = op1b;
        return true;
      } else {
        op1b = this.DupOutPt(op1, true);
        op2b = this.DupOutPt(op2, false);
        op1.Next = op2;
        op2.Prev = op1;
        op1b.Prev = op2b;
        op2b.Next = op1b;
        j.OutPt1 = op1;
        j.OutPt2 = op1b;
        return true;
      }
    }
  };

  ClipperLib.Clipper.GetBounds = function (paths) {
    var i = 0,
      cnt = paths.length;
    while (i < cnt && paths[i].length === 0) i++;
    if (i === cnt) return new ClipperLib.IntRect(0, 0, 0, 0);
    var result = new ClipperLib.IntRect();
    result.left = paths[i][0].X;
    result.right = result.left;
    result.top = paths[i][0].Y;
    result.bottom = result.top;
    for (; i < cnt; i++)
      for (var j = 0, jlen = paths[i].length; j < jlen; j++) {
        if (paths[i][j].X < result.left) result.left = paths[i][j].X;
        else if (paths[i][j].X > result.right) result.right = paths[i][j].X;
        if (paths[i][j].Y < result.top) result.top = paths[i][j].Y;
        else if (paths[i][j].Y > result.bottom) result.bottom = paths[i][j].Y;
      }
    return result;
  };
  ClipperLib.Clipper.prototype.GetBounds2 = function (ops) {
    var opStart = ops;
    var result = new ClipperLib.IntRect();
    result.left = ops.Pt.X;
    result.right = ops.Pt.X;
    result.top = ops.Pt.Y;
    result.bottom = ops.Pt.Y;
    ops = ops.Next;
    while (ops !== opStart) {
      if (ops.Pt.X < result.left) result.left = ops.Pt.X;
      if (ops.Pt.X > result.right) result.right = ops.Pt.X;
      if (ops.Pt.Y < result.top) result.top = ops.Pt.Y;
      if (ops.Pt.Y > result.bottom) result.bottom = ops.Pt.Y;
      ops = ops.Next;
    }
    return result;
  };

  ClipperLib.Clipper.PointInPolygon = function (pt, path) {
    //returns 0 if false, +1 if true, -1 if pt ON polygon boundary
    //See "The Point in Polygon Problem for Arbitrary Polygons" by Hormann & Agathos
    //http://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.88.5498&rep=rep1&type=pdf
    var result = 0,
      cnt = path.length;
    if (cnt < 3) return 0;
    var ip = path[0];
    for (var i = 1; i <= cnt; ++i) {
      var ipNext = i === cnt ? path[0] : path[i];
      if (ipNext.Y === pt.Y) {
        if (ipNext.X === pt.X || (ip.Y === pt.Y && ipNext.X > pt.X === ip.X < pt.X)) return -1;
      }
      if (ip.Y < pt.Y !== ipNext.Y < pt.Y) {
        if (ip.X >= pt.X) {
          if (ipNext.X > pt.X) result = 1 - result;
          else {
            var d = (ip.X - pt.X) * (ipNext.Y - pt.Y) - (ipNext.X - pt.X) * (ip.Y - pt.Y);
            if (d === 0) return -1;
            else if (d > 0 === ipNext.Y > ip.Y) result = 1 - result;
          }
        } else {
          if (ipNext.X > pt.X) {
            var d = (ip.X - pt.X) * (ipNext.Y - pt.Y) - (ipNext.X - pt.X) * (ip.Y - pt.Y);
            if (d === 0) return -1;
            else if (d > 0 === ipNext.Y > ip.Y) result = 1 - result;
          }
        }
      }
      ip = ipNext;
    }
    return result;
  };

  ClipperLib.Clipper.prototype.PointInPolygon = function (pt, op) {
    //returns 0 if false, +1 if true, -1 if pt ON polygon boundary
    var result = 0;
    var startOp = op;
    var ptx = pt.X,
      pty = pt.Y;
    var poly0x = op.Pt.X,
      poly0y = op.Pt.Y;
    do {
      op = op.Next;
      var poly1x = op.Pt.X,
        poly1y = op.Pt.Y;
      if (poly1y === pty) {
        if (poly1x === ptx || (poly0y === pty && poly1x > ptx === poly0x < ptx)) return -1;
      }
      if (poly0y < pty !== poly1y < pty) {
        if (poly0x >= ptx) {
          if (poly1x > ptx) result = 1 - result;
          else {
            var d = (poly0x - ptx) * (poly1y - pty) - (poly1x - ptx) * (poly0y - pty);
            if (d === 0) return -1;
            if (d > 0 === poly1y > poly0y) result = 1 - result;
          }
        } else {
          if (poly1x > ptx) {
            var d = (poly0x - ptx) * (poly1y - pty) - (poly1x - ptx) * (poly0y - pty);
            if (d === 0) return -1;
            if (d > 0 === poly1y > poly0y) result = 1 - result;
          }
        }
      }
      poly0x = poly1x;
      poly0y = poly1y;
    } while (startOp !== op);

    return result;
  };

  ClipperLib.Clipper.prototype.Poly2ContainsPoly1 = function (outPt1, outPt2) {
    var op = outPt1;
    do {
      //nb: PointInPolygon returns 0 if false, +1 if true, -1 if pt on polygon
      var res = this.PointInPolygon(op.Pt, outPt2);
      if (res >= 0) return res > 0;
      op = op.Next;
    } while (op !== outPt1);
    return true;
  };

  ClipperLib.Clipper.prototype.FixupFirstLefts1 = function (OldOutRec, NewOutRec) {
    var outRec, firstLeft;
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      outRec = this.m_PolyOuts[i];
      firstLeft = ClipperLib.Clipper.ParseFirstLeft(outRec.FirstLeft);
      if (outRec.Pts !== null && firstLeft === OldOutRec) {
        if (this.Poly2ContainsPoly1(outRec.Pts, NewOutRec.Pts)) outRec.FirstLeft = NewOutRec;
      }
    }
  };

  ClipperLib.Clipper.prototype.FixupFirstLefts2 = function (innerOutRec, outerOutRec) {
    //A polygon has split into two such that one is now the inner of the other.
    //It's possible that these polygons now wrap around other polygons, so check
    //every polygon that's also contained by OuterOutRec's FirstLeft container
    //(including nil) to see if they've become inner to the new inner polygon ...
    var orfl = outerOutRec.FirstLeft;
    var outRec, firstLeft;
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      outRec = this.m_PolyOuts[i];
      if (outRec.Pts === null || outRec === outerOutRec || outRec === innerOutRec) continue;
      firstLeft = ClipperLib.Clipper.ParseFirstLeft(outRec.FirstLeft);
      if (firstLeft !== orfl && firstLeft !== innerOutRec && firstLeft !== outerOutRec) continue;
      if (this.Poly2ContainsPoly1(outRec.Pts, innerOutRec.Pts)) outRec.FirstLeft = innerOutRec;
      else if (this.Poly2ContainsPoly1(outRec.Pts, outerOutRec.Pts)) outRec.FirstLeft = outerOutRec;
      else if (outRec.FirstLeft === innerOutRec || outRec.FirstLeft === outerOutRec)
        outRec.FirstLeft = orfl;
    }
  };

  ClipperLib.Clipper.prototype.FixupFirstLefts3 = function (OldOutRec, NewOutRec) {
    //same as FixupFirstLefts1 but doesn't call Poly2ContainsPoly1()
    var outRec;
    var firstLeft;
    for (var i = 0, ilen = this.m_PolyOuts.length; i < ilen; i++) {
      outRec = this.m_PolyOuts[i];
      firstLeft = ClipperLib.Clipper.ParseFirstLeft(outRec.FirstLeft);
      if (outRec.Pts !== null && firstLeft === OldOutRec) outRec.FirstLeft = NewOutRec;
    }
  };

  ClipperLib.Clipper.ParseFirstLeft = function (FirstLeft) {
    while (FirstLeft !== null && FirstLeft.Pts === null) FirstLeft = FirstLeft.FirstLeft;
    return FirstLeft;
  };

  ClipperLib.Clipper.prototype.JoinCommonEdges = function () {
    for (var i = 0, ilen = this.m_Joins.length; i < ilen; i++) {
      var join = this.m_Joins[i];
      var outRec1 = this.GetOutRec(join.OutPt1.Idx);
      var outRec2 = this.GetOutRec(join.OutPt2.Idx);
      if (outRec1.Pts === null || outRec2.Pts === null) continue;

      if (outRec1.IsOpen || outRec2.IsOpen) {
        continue;
      }

      //get the polygon fragment with the correct hole state (FirstLeft)
      //before calling JoinPoints() ...
      var holeStateRec;
      if (outRec1 === outRec2) holeStateRec = outRec1;
      else if (this.OutRec1RightOfOutRec2(outRec1, outRec2)) holeStateRec = outRec2;
      else if (this.OutRec1RightOfOutRec2(outRec2, outRec1)) holeStateRec = outRec1;
      else holeStateRec = this.GetLowermostRec(outRec1, outRec2);

      if (!this.JoinPoints(join, outRec1, outRec2)) continue;

      if (outRec1 === outRec2) {
        //instead of joining two polygons, we've just created a new one by
        //splitting one polygon into two.
        outRec1.Pts = join.OutPt1;
        outRec1.BottomPt = null;
        outRec2 = this.CreateOutRec();
        outRec2.Pts = join.OutPt2;
        //update all OutRec2.Pts Idx's ...
        this.UpdateOutPtIdxs(outRec2);

        if (this.Poly2ContainsPoly1(outRec2.Pts, outRec1.Pts)) {
          //outRec1 contains outRec2 ...
          outRec2.IsHole = !outRec1.IsHole;
          outRec2.FirstLeft = outRec1;
          if (this.m_UsingPolyTree) this.FixupFirstLefts2(outRec2, outRec1);
          if ((outRec2.IsHole ^ this.ReverseSolution) == this.Area$1(outRec2) > 0)
            this.ReversePolyPtLinks(outRec2.Pts);
        } else if (this.Poly2ContainsPoly1(outRec1.Pts, outRec2.Pts)) {
          //outRec2 contains outRec1 ...
          outRec2.IsHole = outRec1.IsHole;
          outRec1.IsHole = !outRec2.IsHole;
          outRec2.FirstLeft = outRec1.FirstLeft;
          outRec1.FirstLeft = outRec2;
          if (this.m_UsingPolyTree) this.FixupFirstLefts2(outRec1, outRec2);

          if ((outRec1.IsHole ^ this.ReverseSolution) == this.Area$1(outRec1) > 0)
            this.ReversePolyPtLinks(outRec1.Pts);
        } else {
          //the 2 polygons are completely separate ...
          outRec2.IsHole = outRec1.IsHole;
          outRec2.FirstLeft = outRec1.FirstLeft;
          //fixup FirstLeft pointers that may need reassigning to OutRec2
          if (this.m_UsingPolyTree) this.FixupFirstLefts1(outRec1, outRec2);
        }
      } else {
        //joined 2 polygons together ...
        outRec2.Pts = null;
        outRec2.BottomPt = null;
        outRec2.Idx = outRec1.Idx;
        outRec1.IsHole = holeStateRec.IsHole;
        if (holeStateRec === outRec2) outRec1.FirstLeft = outRec2.FirstLeft;
        outRec2.FirstLeft = outRec1;
        //fixup FirstLeft pointers that may need reassigning to OutRec1
        if (this.m_UsingPolyTree) this.FixupFirstLefts3(outRec2, outRec1);
      }
    }
  };

  ClipperLib.Clipper.prototype.UpdateOutPtIdxs = function (outrec) {
    var op = outrec.Pts;
    do {
      op.Idx = outrec.Idx;
      op = op.Prev;
    } while (op !== outrec.Pts);
  };

  ClipperLib.Clipper.prototype.DoSimplePolygons = function () {
    var i = 0;
    while (i < this.m_PolyOuts.length) {
      var outrec = this.m_PolyOuts[i++];
      var op = outrec.Pts;
      if (op === null || outrec.IsOpen) continue;
      do {
        //for each Pt in Polygon until duplicate found do ...
        var op2 = op.Next;
        while (op2 !== outrec.Pts) {
          if (
            ClipperLib.IntPoint.op_Equality(op.Pt, op2.Pt) &&
            op2.Next !== op &&
            op2.Prev !== op
          ) {
            //split the polygon into two ...
            var op3 = op.Prev;
            var op4 = op2.Prev;
            op.Prev = op4;
            op4.Next = op;
            op2.Prev = op3;
            op3.Next = op2;
            outrec.Pts = op;
            var outrec2 = this.CreateOutRec();
            outrec2.Pts = op2;
            this.UpdateOutPtIdxs(outrec2);
            if (this.Poly2ContainsPoly1(outrec2.Pts, outrec.Pts)) {
              //OutRec2 is contained by OutRec1 ...
              outrec2.IsHole = !outrec.IsHole;
              outrec2.FirstLeft = outrec;
              if (this.m_UsingPolyTree) this.FixupFirstLefts2(outrec2, outrec);
            } else if (this.Poly2ContainsPoly1(outrec.Pts, outrec2.Pts)) {
              //OutRec1 is contained by OutRec2 ...
              outrec2.IsHole = outrec.IsHole;
              outrec.IsHole = !outrec2.IsHole;
              outrec2.FirstLeft = outrec.FirstLeft;
              outrec.FirstLeft = outrec2;
              if (this.m_UsingPolyTree) this.FixupFirstLefts2(outrec, outrec2);
            } else {
              //the 2 polygons are separate ...
              outrec2.IsHole = outrec.IsHole;
              outrec2.FirstLeft = outrec.FirstLeft;
              if (this.m_UsingPolyTree) this.FixupFirstLefts1(outrec, outrec2);
            }
            op2 = op;
            //ie get ready for the next iteration
          }
          op2 = op2.Next;
        }
        op = op.Next;
      } while (op !== outrec.Pts);
    }
  };

  ClipperLib.Clipper.Area = function (poly) {
    if (!Array.isArray(poly)) return 0;
    var cnt = poly.length;
    if (cnt < 3) return 0;
    var a = 0;
    for (var i = 0, j = cnt - 1; i < cnt; ++i) {
      a += (poly[j].X + poly[i].X) * (poly[j].Y - poly[i].Y);
      j = i;
    }
    return -a * 0.5;
  };

  ClipperLib.Clipper.prototype.Area = function (op) {
    var opFirst = op;
    if (op === null) return 0;
    var a = 0;
    do {
      a = a + (op.Prev.Pt.X + op.Pt.X) * (op.Prev.Pt.Y - op.Pt.Y);
      op = op.Next;
    } while (op !== opFirst); // && typeof op !== 'undefined');
    return a * 0.5;
  };

  ClipperLib.Clipper.prototype.Area$1 = function (outRec) {
    return this.Area(outRec.Pts);
  };

  ClipperLib.Clipper.SimplifyPolygon = function (poly, fillType) {
    var result = new Array();
    var c = new ClipperLib.Clipper(0);
    c.StrictlySimple = true;
    c.AddPath(poly, ClipperLib.PolyType.ptSubject, true);
    c.Execute(ClipperLib.ClipType.ctUnion, result, fillType, fillType);
    return result;
  };

  ClipperLib.Clipper.SimplifyPolygons = function (polys, fillType) {
    if (typeof fillType === "undefined") fillType = ClipperLib.PolyFillType.pftEvenOdd;
    var result = new Array();
    var c = new ClipperLib.Clipper(0);
    c.StrictlySimple = true;
    c.AddPaths(polys, ClipperLib.PolyType.ptSubject, true);
    c.Execute(ClipperLib.ClipType.ctUnion, result, fillType, fillType);
    return result;
  };

  ClipperLib.Clipper.DistanceSqrd = function (pt1, pt2) {
    var dx = pt1.X - pt2.X;
    var dy = pt1.Y - pt2.Y;
    return dx * dx + dy * dy;
  };

  ClipperLib.Clipper.DistanceFromLineSqrd = function (pt, ln1, ln2) {
    //The equation of a line in general form (Ax + By + C = 0)
    //given 2 points (x¹,y¹) & (x²,y²) is ...
    //(y¹ - y²)x + (x² - x¹)y + (y² - y¹)x¹ - (x² - x¹)y¹ = 0
    //A = (y¹ - y²); B = (x² - x¹); C = (y² - y¹)x¹ - (x² - x¹)y¹
    //perpendicular distance of point (x³,y³) = (Ax³ + By³ + C)/Sqrt(A² + B²)
    //see http://en.wikipedia.org/wiki/Perpendicular_distance
    var A = ln1.Y - ln2.Y;
    var B = ln2.X - ln1.X;
    var C = A * ln1.X + B * ln1.Y;
    C = A * pt.X + B * pt.Y - C;
    return (C * C) / (A * A + B * B);
  };

  ClipperLib.Clipper.SlopesNearCollinear = function (pt1, pt2, pt3, distSqrd) {
    //this function is more accurate when the point that's GEOMETRICALLY
    //between the other 2 points is the one that's tested for distance.
    //nb: with 'spikes', either pt1 or pt3 is geometrically between the other pts
    if (Math.abs(pt1.X - pt2.X) > Math.abs(pt1.Y - pt2.Y)) {
      if (pt1.X > pt2.X === pt1.X < pt3.X)
        return ClipperLib.Clipper.DistanceFromLineSqrd(pt1, pt2, pt3) < distSqrd;
      else if (pt2.X > pt1.X === pt2.X < pt3.X)
        return ClipperLib.Clipper.DistanceFromLineSqrd(pt2, pt1, pt3) < distSqrd;
      else return ClipperLib.Clipper.DistanceFromLineSqrd(pt3, pt1, pt2) < distSqrd;
    } else {
      if (pt1.Y > pt2.Y === pt1.Y < pt3.Y)
        return ClipperLib.Clipper.DistanceFromLineSqrd(pt1, pt2, pt3) < distSqrd;
      else if (pt2.Y > pt1.Y === pt2.Y < pt3.Y)
        return ClipperLib.Clipper.DistanceFromLineSqrd(pt2, pt1, pt3) < distSqrd;
      else return ClipperLib.Clipper.DistanceFromLineSqrd(pt3, pt1, pt2) < distSqrd;
    }
  };

  ClipperLib.Clipper.PointsAreClose = function (pt1, pt2, distSqrd) {
    var dx = pt1.X - pt2.X;
    var dy = pt1.Y - pt2.Y;
    return dx * dx + dy * dy <= distSqrd;
  };

  ClipperLib.Clipper.ExcludeOp = function (op) {
    var result = op.Prev;
    result.Next = op.Next;
    op.Next.Prev = result;
    result.Idx = 0;
    return result;
  };

  ClipperLib.Clipper.CleanPolygon = function (path, distance) {
    if (typeof distance === "undefined") distance = 1.415;
    //distance = proximity in units/pixels below which vertices will be stripped.
    //Default ~= sqrt(2) so when adjacent vertices or semi-adjacent vertices have
    //both x & y coords within 1 unit, then the second vertex will be stripped.
    var cnt = path.length;
    if (cnt === 0) return new Array();
    var outPts = new Array(cnt);
    for (var i = 0; i < cnt; ++i) outPts[i] = new ClipperLib.OutPt();
    for (var i = 0; i < cnt; ++i) {
      outPts[i].Pt = path[i];
      outPts[i].Next = outPts[(i + 1) % cnt];
      outPts[i].Next.Prev = outPts[i];
      outPts[i].Idx = 0;
    }
    var distSqrd = distance * distance;
    var op = outPts[0];
    while (op.Idx === 0 && op.Next !== op.Prev) {
      if (ClipperLib.Clipper.PointsAreClose(op.Pt, op.Prev.Pt, distSqrd)) {
        op = ClipperLib.Clipper.ExcludeOp(op);
        cnt--;
      } else if (ClipperLib.Clipper.PointsAreClose(op.Prev.Pt, op.Next.Pt, distSqrd)) {
        ClipperLib.Clipper.ExcludeOp(op.Next);
        op = ClipperLib.Clipper.ExcludeOp(op);
        cnt -= 2;
      } else if (ClipperLib.Clipper.SlopesNearCollinear(op.Prev.Pt, op.Pt, op.Next.Pt, distSqrd)) {
        op = ClipperLib.Clipper.ExcludeOp(op);
        cnt--;
      } else {
        op.Idx = 1;
        op = op.Next;
      }
    }
    if (cnt < 3) cnt = 0;
    var result = new Array(cnt);
    for (var i = 0; i < cnt; ++i) {
      result[i] = new ClipperLib.IntPoint1(op.Pt);
      op = op.Next;
    }
    outPts = null;
    return result;
  };

  ClipperLib.Clipper.CleanPolygons = function (polys, distance) {
    var result = new Array(polys.length);
    for (var i = 0, ilen = polys.length; i < ilen; i++)
      result[i] = ClipperLib.Clipper.CleanPolygon(polys[i], distance);
    return result;
  };

  ClipperLib.Clipper.Minkowski = function (pattern, path, IsSum, IsClosed) {
    var delta = IsClosed ? 1 : 0;
    var polyCnt = pattern.length;
    var pathCnt = path.length;
    var result = new Array();
    if (IsSum)
      for (var i = 0; i < pathCnt; i++) {
        var p = new Array(polyCnt);
        for (var j = 0, jlen = pattern.length, ip = pattern[j]; j < jlen; j++, ip = pattern[j])
          p[j] = new ClipperLib.IntPoint2(path[i].X + ip.X, path[i].Y + ip.Y);
        result.push(p);
      }
    else
      for (var i = 0; i < pathCnt; i++) {
        var p = new Array(polyCnt);
        for (var j = 0, jlen = pattern.length, ip = pattern[j]; j < jlen; j++, ip = pattern[j])
          p[j] = new ClipperLib.IntPoint2(path[i].X - ip.X, path[i].Y - ip.Y);
        result.push(p);
      }
    var quads = new Array();
    for (var i = 0; i < pathCnt - 1 + delta; i++)
      for (var j = 0; j < polyCnt; j++) {
        var quad = new Array();
        quad.push(result[i % pathCnt][j % polyCnt]);
        quad.push(result[(i + 1) % pathCnt][j % polyCnt]);
        quad.push(result[(i + 1) % pathCnt][(j + 1) % polyCnt]);
        quad.push(result[i % pathCnt][(j + 1) % polyCnt]);
        if (!ClipperLib.Clipper.Orientation(quad)) quad.reverse();
        quads.push(quad);
      }
    return quads;
  };

  ClipperLib.Clipper.MinkowskiSum = function (pattern, path_or_paths, pathIsClosed) {
    if (!(path_or_paths[0] instanceof Array)) {
      var path = path_or_paths;
      var paths = ClipperLib.Clipper.Minkowski(pattern, path, true, pathIsClosed);
      var c = new ClipperLib.Clipper();
      c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
      c.Execute(
        ClipperLib.ClipType.ctUnion,
        paths,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      return paths;
    } else {
      var paths = path_or_paths;
      var solution = new ClipperLib.Paths();
      var c = new ClipperLib.Clipper();
      for (var i = 0; i < paths.length; ++i) {
        var tmp = ClipperLib.Clipper.Minkowski(pattern, paths[i], true, pathIsClosed);
        c.AddPaths(tmp, ClipperLib.PolyType.ptSubject, true);
        if (pathIsClosed) {
          var path = ClipperLib.Clipper.TranslatePath(paths[i], pattern[0]);
          c.AddPath(path, ClipperLib.PolyType.ptClip, true);
        }
      }
      c.Execute(
        ClipperLib.ClipType.ctUnion,
        solution,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      return solution;
    }
  };

  ClipperLib.Clipper.TranslatePath = function (path, delta) {
    var outPath = new ClipperLib.Path();
    for (var i = 0; i < path.length; i++)
      outPath.push(new ClipperLib.IntPoint2(path[i].X + delta.X, path[i].Y + delta.Y));
    return outPath;
  };

  ClipperLib.Clipper.MinkowskiDiff = function (poly1, poly2) {
    var paths = ClipperLib.Clipper.Minkowski(poly1, poly2, false, true);
    var c = new ClipperLib.Clipper();
    c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    c.Execute(
      ClipperLib.ClipType.ctUnion,
      paths,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    return paths;
  };

  ClipperLib.Clipper.PolyTreeToPaths = function (polytree) {
    var result = new Array();
    //result.set_Capacity(polytree.get_Total());
    ClipperLib.Clipper.AddPolyNodeToPaths(polytree, ClipperLib.Clipper.NodeType.ntAny, result);
    return result;
  };

  ClipperLib.Clipper.AddPolyNodeToPaths = function (polynode, nt, paths) {
    var match = true;
    switch (nt) {
      case ClipperLib.Clipper.NodeType.ntOpen:
        return;
      case ClipperLib.Clipper.NodeType.ntClosed:
        match = !polynode.IsOpen;
        break;
      default:
        break;
    }
    if (polynode.m_polygon.length > 0 && match) paths.push(polynode.m_polygon);
    for (
      var $i3 = 0, $t3 = polynode.Childs(), $l3 = $t3.length, pn = $t3[$i3];
      $i3 < $l3;
      $i3++, pn = $t3[$i3]
    )
      ClipperLib.Clipper.AddPolyNodeToPaths(pn, nt, paths);
  };

  ClipperLib.Clipper.OpenPathsFromPolyTree = function (polytree) {
    var result = new ClipperLib.Paths();
    //result.set_Capacity(polytree.ChildCount());
    for (var i = 0, ilen = polytree.ChildCount(); i < ilen; i++)
      if (polytree.Childs()[i].IsOpen) result.push(polytree.Childs()[i].m_polygon);
    return result;
  };

  ClipperLib.Clipper.ClosedPathsFromPolyTree = function (polytree) {
    var result = new ClipperLib.Paths();
    //result.set_Capacity(polytree.Total());
    ClipperLib.Clipper.AddPolyNodeToPaths(polytree, ClipperLib.Clipper.NodeType.ntClosed, result);
    return result;
  };

  Inherit(ClipperLib.Clipper, ClipperLib.ClipperBase);
  ClipperLib.Clipper.NodeType = {
    ntAny: 0,
    ntOpen: 1,
    ntClosed: 2,
  };

  /**
   * @constructor
   */
  ClipperLib.ClipperOffset = function (miterLimit, arcTolerance) {
    if (typeof miterLimit === "undefined") miterLimit = 2;
    if (typeof arcTolerance === "undefined")
      arcTolerance = ClipperLib.ClipperOffset.def_arc_tolerance;
    this.m_destPolys = new ClipperLib.Paths();
    this.m_srcPoly = new ClipperLib.Path();
    this.m_destPoly = new ClipperLib.Path();
    this.m_normals = new Array();
    this.m_delta = 0;
    this.m_sinA = 0;
    this.m_sin = 0;
    this.m_cos = 0;
    this.m_miterLim = 0;
    this.m_StepsPerRad = 0;
    this.m_lowest = new ClipperLib.IntPoint0();
    this.m_polyNodes = new ClipperLib.PolyNode();
    this.MiterLimit = miterLimit;
    this.ArcTolerance = arcTolerance;
    this.m_lowest.X = -1;
  };

  ClipperLib.ClipperOffset.two_pi = 6.28318530717959;
  ClipperLib.ClipperOffset.def_arc_tolerance = 0.25;
  ClipperLib.ClipperOffset.prototype.Clear = function () {
    ClipperLib.Clear(this.m_polyNodes.Childs());
    this.m_lowest.X = -1;
  };

  ClipperLib.ClipperOffset.Round = ClipperLib.Clipper.Round;
  ClipperLib.ClipperOffset.prototype.AddPath = function (path, joinType, endType) {
    var highI = path.length - 1;
    if (highI < 0) return;
    var newNode = new ClipperLib.PolyNode();
    newNode.m_jointype = joinType;
    newNode.m_endtype = endType;
    //strip duplicate points from path and also get index to the lowest point ...
    if (
      endType === ClipperLib.EndType.etClosedLine ||
      endType === ClipperLib.EndType.etClosedPolygon
    )
      while (highI > 0 && ClipperLib.IntPoint.op_Equality(path[0], path[highI])) highI--;
    //newNode.m_polygon.set_Capacity(highI + 1);
    newNode.m_polygon.push(path[0]);
    var j = 0,
      k = 0;
    for (var i = 1; i <= highI; i++)
      if (ClipperLib.IntPoint.op_Inequality(newNode.m_polygon[j], path[i])) {
        j++;
        newNode.m_polygon.push(path[i]);
        if (
          path[i].Y > newNode.m_polygon[k].Y ||
          (path[i].Y === newNode.m_polygon[k].Y && path[i].X < newNode.m_polygon[k].X)
        )
          k = j;
      }
    if (endType === ClipperLib.EndType.etClosedPolygon && j < 2) return;

    this.m_polyNodes.AddChild(newNode);
    //if this path's lowest pt is lower than all the others then update m_lowest
    if (endType !== ClipperLib.EndType.etClosedPolygon) return;
    if (this.m_lowest.X < 0)
      this.m_lowest = new ClipperLib.IntPoint2(this.m_polyNodes.ChildCount() - 1, k);
    else {
      var ip = this.m_polyNodes.Childs()[this.m_lowest.X].m_polygon[this.m_lowest.Y];
      if (
        newNode.m_polygon[k].Y > ip.Y ||
        (newNode.m_polygon[k].Y === ip.Y && newNode.m_polygon[k].X < ip.X)
      )
        this.m_lowest = new ClipperLib.IntPoint2(this.m_polyNodes.ChildCount() - 1, k);
    }
  };

  ClipperLib.ClipperOffset.prototype.AddPaths = function (paths, joinType, endType) {
    for (var i = 0, ilen = paths.length; i < ilen; i++) this.AddPath(paths[i], joinType, endType);
  };

  ClipperLib.ClipperOffset.prototype.FixOrientations = function () {
    //fixup orientations of all closed paths if the orientation of the
    //closed path with the lowermost vertex is wrong ...
    if (
      this.m_lowest.X >= 0 &&
      !ClipperLib.Clipper.Orientation(this.m_polyNodes.Childs()[this.m_lowest.X].m_polygon)
    ) {
      for (var i = 0; i < this.m_polyNodes.ChildCount(); i++) {
        var node = this.m_polyNodes.Childs()[i];
        if (
          node.m_endtype === ClipperLib.EndType.etClosedPolygon ||
          (node.m_endtype === ClipperLib.EndType.etClosedLine &&
            ClipperLib.Clipper.Orientation(node.m_polygon))
        )
          node.m_polygon.reverse();
      }
    } else {
      for (var i = 0; i < this.m_polyNodes.ChildCount(); i++) {
        var node = this.m_polyNodes.Childs()[i];
        if (
          node.m_endtype === ClipperLib.EndType.etClosedLine &&
          !ClipperLib.Clipper.Orientation(node.m_polygon)
        )
          node.m_polygon.reverse();
      }
    }
  };

  ClipperLib.ClipperOffset.GetUnitNormal = function (pt1, pt2) {
    var dx = pt2.X - pt1.X;
    var dy = pt2.Y - pt1.Y;
    if (dx === 0 && dy === 0) return new ClipperLib.DoublePoint2(0, 0);
    var f = 1 / Math.sqrt(dx * dx + dy * dy);
    dx *= f;
    dy *= f;
    return new ClipperLib.DoublePoint2(dy, -dx);
  };

  ClipperLib.ClipperOffset.prototype.DoOffset = function (delta) {
    this.m_destPolys = new Array();
    this.m_delta = delta;
    //if Zero offset, just copy any CLOSED polygons to m_p and return ...
    if (ClipperLib.ClipperBase.near_zero(delta)) {
      //this.m_destPolys.set_Capacity(this.m_polyNodes.ChildCount);
      for (var i = 0; i < this.m_polyNodes.ChildCount(); i++) {
        var node = this.m_polyNodes.Childs()[i];
        if (node.m_endtype === ClipperLib.EndType.etClosedPolygon)
          this.m_destPolys.push(node.m_polygon);
      }
      return;
    }
    //see offset_triginometry3.svg in the documentation folder ...
    if (this.MiterLimit > 2) this.m_miterLim = 2 / (this.MiterLimit * this.MiterLimit);
    else this.m_miterLim = 0.5;
    var y;
    if (this.ArcTolerance <= 0) y = ClipperLib.ClipperOffset.def_arc_tolerance;
    else if (this.ArcTolerance > Math.abs(delta) * ClipperLib.ClipperOffset.def_arc_tolerance)
      y = Math.abs(delta) * ClipperLib.ClipperOffset.def_arc_tolerance;
    else y = this.ArcTolerance;
    //see offset_triginometry2.svg in the documentation folder ...
    var steps = 3.14159265358979 / Math.acos(1 - y / Math.abs(delta));
    this.m_sin = Math.sin(ClipperLib.ClipperOffset.two_pi / steps);
    this.m_cos = Math.cos(ClipperLib.ClipperOffset.two_pi / steps);
    this.m_StepsPerRad = steps / ClipperLib.ClipperOffset.two_pi;
    if (delta < 0) this.m_sin = -this.m_sin;
    //this.m_destPolys.set_Capacity(this.m_polyNodes.ChildCount * 2);
    for (var i = 0; i < this.m_polyNodes.ChildCount(); i++) {
      var node = this.m_polyNodes.Childs()[i];
      this.m_srcPoly = node.m_polygon;
      var len = this.m_srcPoly.length;
      if (
        len === 0 ||
        (delta <= 0 && (len < 3 || node.m_endtype !== ClipperLib.EndType.etClosedPolygon))
      )
        continue;
      this.m_destPoly = new Array();
      if (len === 1) {
        if (node.m_jointype === ClipperLib.JoinType.jtRound) {
          var X = 1,
            Y = 0;
          for (var j = 1; j <= steps; j++) {
            this.m_destPoly.push(
              new ClipperLib.IntPoint2(
                ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].X + X * delta),
                ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].Y + Y * delta),
              ),
            );
            var X2 = X;
            X = X * this.m_cos - this.m_sin * Y;
            Y = X2 * this.m_sin + Y * this.m_cos;
          }
        } else {
          var X = -1,
            Y = -1;
          for (var j = 0; j < 4; ++j) {
            this.m_destPoly.push(
              new ClipperLib.IntPoint2(
                ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].X + X * delta),
                ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].Y + Y * delta),
              ),
            );
            if (X < 0) X = 1;
            else if (Y < 0) Y = 1;
            else X = -1;
          }
        }
        this.m_destPolys.push(this.m_destPoly);
        continue;
      }
      //build m_normals ...
      this.m_normals.length = 0;
      //this.m_normals.set_Capacity(len);
      for (var j = 0; j < len - 1; j++)
        this.m_normals.push(
          ClipperLib.ClipperOffset.GetUnitNormal(this.m_srcPoly[j], this.m_srcPoly[j + 1]),
        );
      if (
        node.m_endtype === ClipperLib.EndType.etClosedLine ||
        node.m_endtype === ClipperLib.EndType.etClosedPolygon
      )
        this.m_normals.push(
          ClipperLib.ClipperOffset.GetUnitNormal(this.m_srcPoly[len - 1], this.m_srcPoly[0]),
        );
      else this.m_normals.push(new ClipperLib.DoublePoint1(this.m_normals[len - 2]));
      if (node.m_endtype === ClipperLib.EndType.etClosedPolygon) {
        var k = len - 1;
        for (var j = 0; j < len; j++) k = this.OffsetPoint(j, k, node.m_jointype);
        this.m_destPolys.push(this.m_destPoly);
      } else if (node.m_endtype === ClipperLib.EndType.etClosedLine) {
        var k = len - 1;
        for (var j = 0; j < len; j++) k = this.OffsetPoint(j, k, node.m_jointype);
        this.m_destPolys.push(this.m_destPoly);
        this.m_destPoly = new Array();
        //re-build m_normals ...
        var n = this.m_normals[len - 1];
        for (var j = len - 1; j > 0; j--)
          this.m_normals[j] = new ClipperLib.DoublePoint2(
            -this.m_normals[j - 1].X,
            -this.m_normals[j - 1].Y,
          );
        this.m_normals[0] = new ClipperLib.DoublePoint2(-n.X, -n.Y);
        k = 0;
        for (var j = len - 1; j >= 0; j--) k = this.OffsetPoint(j, k, node.m_jointype);
        this.m_destPolys.push(this.m_destPoly);
      } else {
        var k = 0;
        for (var j = 1; j < len - 1; ++j) k = this.OffsetPoint(j, k, node.m_jointype);
        var pt1;
        if (node.m_endtype === ClipperLib.EndType.etOpenButt) {
          var j = len - 1;
          pt1 = new ClipperLib.IntPoint2(
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_normals[j].X * delta),
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_normals[j].Y * delta),
          );
          this.m_destPoly.push(pt1);
          pt1 = new ClipperLib.IntPoint2(
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X - this.m_normals[j].X * delta),
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y - this.m_normals[j].Y * delta),
          );
          this.m_destPoly.push(pt1);
        } else {
          var j = len - 1;
          k = len - 2;
          this.m_sinA = 0;
          this.m_normals[j] = new ClipperLib.DoublePoint2(
            -this.m_normals[j].X,
            -this.m_normals[j].Y,
          );
          if (node.m_endtype === ClipperLib.EndType.etOpenSquare) this.DoSquare(j, k);
          else this.DoRound(j, k);
        }
        //re-build m_normals ...
        for (var j = len - 1; j > 0; j--)
          this.m_normals[j] = new ClipperLib.DoublePoint2(
            -this.m_normals[j - 1].X,
            -this.m_normals[j - 1].Y,
          );
        this.m_normals[0] = new ClipperLib.DoublePoint2(-this.m_normals[1].X, -this.m_normals[1].Y);
        k = len - 1;
        for (var j = k - 1; j > 0; --j) k = this.OffsetPoint(j, k, node.m_jointype);
        if (node.m_endtype === ClipperLib.EndType.etOpenButt) {
          pt1 = new ClipperLib.IntPoint2(
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].X - this.m_normals[0].X * delta),
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].Y - this.m_normals[0].Y * delta),
          );
          this.m_destPoly.push(pt1);
          pt1 = new ClipperLib.IntPoint2(
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].X + this.m_normals[0].X * delta),
            ClipperLib.ClipperOffset.Round(this.m_srcPoly[0].Y + this.m_normals[0].Y * delta),
          );
          this.m_destPoly.push(pt1);
        } else {
          k = 1;
          this.m_sinA = 0;
          if (node.m_endtype === ClipperLib.EndType.etOpenSquare) this.DoSquare(0, 1);
          else this.DoRound(0, 1);
        }
        this.m_destPolys.push(this.m_destPoly);
      }
    }
  };

  ClipperLib.ClipperOffset.prototype.Execute = function () {
    var a = arguments,
      ispolytree = a[0] instanceof ClipperLib.PolyTree;
    if (!ispolytree) // function (solution, delta)
    {
      var solution = a[0],
        delta = a[1];
      ClipperLib.Clear(solution);
      this.FixOrientations();
      this.DoOffset(delta);
      //now clean up 'corners' ...
      var clpr = new ClipperLib.Clipper(0);
      clpr.AddPaths(this.m_destPolys, ClipperLib.PolyType.ptSubject, true);
      if (delta > 0) {
        clpr.Execute(
          ClipperLib.ClipType.ctUnion,
          solution,
          ClipperLib.PolyFillType.pftPositive,
          ClipperLib.PolyFillType.pftPositive,
        );
      } else {
        var r = ClipperLib.Clipper.GetBounds(this.m_destPolys);
        var outer = new ClipperLib.Path();
        outer.push(new ClipperLib.IntPoint2(r.left - 10, r.bottom + 10));
        outer.push(new ClipperLib.IntPoint2(r.right + 10, r.bottom + 10));
        outer.push(new ClipperLib.IntPoint2(r.right + 10, r.top - 10));
        outer.push(new ClipperLib.IntPoint2(r.left - 10, r.top - 10));
        clpr.AddPath(outer, ClipperLib.PolyType.ptSubject, true);
        clpr.ReverseSolution = true;
        clpr.Execute(
          ClipperLib.ClipType.ctUnion,
          solution,
          ClipperLib.PolyFillType.pftNegative,
          ClipperLib.PolyFillType.pftNegative,
        );
        if (solution.length > 0) solution.splice(0, 1);
      }
      //console.log(JSON.stringify(solution));
    } else // function (polytree, delta)
    {
      var solution = a[0],
        delta = a[1];
      solution.Clear();
      this.FixOrientations();
      this.DoOffset(delta);
      //now clean up 'corners' ...
      var clpr = new ClipperLib.Clipper(0);
      clpr.AddPaths(this.m_destPolys, ClipperLib.PolyType.ptSubject, true);
      if (delta > 0) {
        clpr.Execute(
          ClipperLib.ClipType.ctUnion,
          solution,
          ClipperLib.PolyFillType.pftPositive,
          ClipperLib.PolyFillType.pftPositive,
        );
      } else {
        var r = ClipperLib.Clipper.GetBounds(this.m_destPolys);
        var outer = new ClipperLib.Path();
        outer.push(new ClipperLib.IntPoint2(r.left - 10, r.bottom + 10));
        outer.push(new ClipperLib.IntPoint2(r.right + 10, r.bottom + 10));
        outer.push(new ClipperLib.IntPoint2(r.right + 10, r.top - 10));
        outer.push(new ClipperLib.IntPoint2(r.left - 10, r.top - 10));
        clpr.AddPath(outer, ClipperLib.PolyType.ptSubject, true);
        clpr.ReverseSolution = true;
        clpr.Execute(
          ClipperLib.ClipType.ctUnion,
          solution,
          ClipperLib.PolyFillType.pftNegative,
          ClipperLib.PolyFillType.pftNegative,
        );
        //remove the outer PolyNode rectangle ...
        if (solution.ChildCount() === 1 && solution.Childs()[0].ChildCount() > 0) {
          var outerNode = solution.Childs()[0];
          //solution.Childs.set_Capacity(outerNode.ChildCount);
          solution.Childs()[0] = outerNode.Childs()[0];
          solution.Childs()[0].m_Parent = solution;
          for (var i = 1; i < outerNode.ChildCount(); i++) solution.AddChild(outerNode.Childs()[i]);
        } else solution.Clear();
      }
    }
  };

  ClipperLib.ClipperOffset.prototype.OffsetPoint = function (j, k, jointype) {
    //cross product ...
    this.m_sinA =
      this.m_normals[k].X * this.m_normals[j].Y - this.m_normals[j].X * this.m_normals[k].Y;

    if (Math.abs(this.m_sinA * this.m_delta) < 1.0) {
      //dot product ...
      var cosA =
        this.m_normals[k].X * this.m_normals[j].X + this.m_normals[j].Y * this.m_normals[k].Y;
      if (cosA > 0) // angle ==> 0 degrees
      {
        this.m_destPoly.push(
          new ClipperLib.IntPoint2(
            ClipperLib.ClipperOffset.Round(
              this.m_srcPoly[j].X + this.m_normals[k].X * this.m_delta,
            ),
            ClipperLib.ClipperOffset.Round(
              this.m_srcPoly[j].Y + this.m_normals[k].Y * this.m_delta,
            ),
          ),
        );
        return k;
      }
      //else angle ==> 180 degrees
    } else if (this.m_sinA > 1) this.m_sinA = 1.0;
    else if (this.m_sinA < -1) this.m_sinA = -1.0;
    if (this.m_sinA * this.m_delta < 0) {
      this.m_destPoly.push(
        new ClipperLib.IntPoint2(
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_normals[k].X * this.m_delta),
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_normals[k].Y * this.m_delta),
        ),
      );
      this.m_destPoly.push(new ClipperLib.IntPoint1(this.m_srcPoly[j]));
      this.m_destPoly.push(
        new ClipperLib.IntPoint2(
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_normals[j].X * this.m_delta),
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_normals[j].Y * this.m_delta),
        ),
      );
    } else
      switch (jointype) {
        case ClipperLib.JoinType.jtMiter: {
          var r =
            1 +
            (this.m_normals[j].X * this.m_normals[k].X + this.m_normals[j].Y * this.m_normals[k].Y);
          if (r >= this.m_miterLim) this.DoMiter(j, k, r);
          else this.DoSquare(j, k);
          break;
        }
        case ClipperLib.JoinType.jtSquare:
          this.DoSquare(j, k);
          break;
        case ClipperLib.JoinType.jtRound:
          this.DoRound(j, k);
          break;
      }
    k = j;
    return k;
  };

  ClipperLib.ClipperOffset.prototype.DoSquare = function (j, k) {
    var dx = Math.tan(
      Math.atan2(
        this.m_sinA,
        this.m_normals[k].X * this.m_normals[j].X + this.m_normals[k].Y * this.m_normals[j].Y,
      ) / 4,
    );
    this.m_destPoly.push(
      new ClipperLib.IntPoint2(
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].X + this.m_delta * (this.m_normals[k].X - this.m_normals[k].Y * dx),
        ),
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].Y + this.m_delta * (this.m_normals[k].Y + this.m_normals[k].X * dx),
        ),
      ),
    );
    this.m_destPoly.push(
      new ClipperLib.IntPoint2(
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].X + this.m_delta * (this.m_normals[j].X + this.m_normals[j].Y * dx),
        ),
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].Y + this.m_delta * (this.m_normals[j].Y - this.m_normals[j].X * dx),
        ),
      ),
    );
  };

  ClipperLib.ClipperOffset.prototype.DoMiter = function (j, k, r) {
    var q = this.m_delta / r;
    this.m_destPoly.push(
      new ClipperLib.IntPoint2(
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].X + (this.m_normals[k].X + this.m_normals[j].X) * q,
        ),
        ClipperLib.ClipperOffset.Round(
          this.m_srcPoly[j].Y + (this.m_normals[k].Y + this.m_normals[j].Y) * q,
        ),
      ),
    );
  };

  ClipperLib.ClipperOffset.prototype.DoRound = function (j, k) {
    var a = Math.atan2(
      this.m_sinA,
      this.m_normals[k].X * this.m_normals[j].X + this.m_normals[k].Y * this.m_normals[j].Y,
    );

    var steps = Math.max(
      ClipperLib.Cast_Int32(ClipperLib.ClipperOffset.Round(this.m_StepsPerRad * Math.abs(a))),
      1,
    );

    var X = this.m_normals[k].X,
      Y = this.m_normals[k].Y,
      X2;
    for (var i = 0; i < steps; ++i) {
      this.m_destPoly.push(
        new ClipperLib.IntPoint2(
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X + X * this.m_delta),
          ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y + Y * this.m_delta),
        ),
      );
      X2 = X;
      X = X * this.m_cos - this.m_sin * Y;
      Y = X2 * this.m_sin + Y * this.m_cos;
    }
    this.m_destPoly.push(
      new ClipperLib.IntPoint2(
        ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_normals[j].X * this.m_delta),
        ClipperLib.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_normals[j].Y * this.m_delta),
      ),
    );
  };

  ClipperLib.Error = function (message) {
    try {
      throw new Error(message);
    } catch (err) {
      alert(err.message);
    }
  };

  // ---------------------------------------------

  // JS extension by Timo 2013
  ClipperLib.JS = {};

  ClipperLib.JS.AreaOfPolygon = function (poly, scale) {
    if (!scale) scale = 1;
    return ClipperLib.Clipper.Area(poly) / (scale * scale);
  };

  ClipperLib.JS.AreaOfPolygons = function (poly, scale) {
    if (!scale) scale = 1;
    var area = 0;
    for (var i = 0; i < poly.length; i++) {
      area += ClipperLib.Clipper.Area(poly[i]);
    }
    return area / (scale * scale);
  };

  ClipperLib.JS.BoundsOfPath = function (path, scale) {
    return ClipperLib.JS.BoundsOfPaths([path], scale);
  };

  ClipperLib.JS.BoundsOfPaths = function (paths, scale) {
    if (!scale) scale = 1;
    var bounds = ClipperLib.Clipper.GetBounds(paths);
    bounds.left /= scale;
    bounds.bottom /= scale;
    bounds.right /= scale;
    bounds.top /= scale;
    return bounds;
  };

  // Clean() joins vertices that are too near each other
  // and causes distortion to offsetted polygons without cleaning
  ClipperLib.JS.Clean = function (polygon, delta) {
    if (!(polygon instanceof Array)) return [];
    var isPolygons = polygon[0] instanceof Array;
    var polygon = ClipperLib.JS.Clone(polygon);
    if (typeof delta !== "number" || delta === null) {
      ClipperLib.Error("Delta is not a number in Clean().");
      return polygon;
    }
    if (polygon.length === 0 || (polygon.length === 1 && polygon[0].length === 0) || delta < 0)
      return polygon;
    if (!isPolygons) polygon = [polygon];
    var k_length = polygon.length;
    var len, poly, result, d, p, j, i;
    var results = [];
    for (var k = 0; k < k_length; k++) {
      poly = polygon[k];
      len = poly.length;
      if (len === 0) continue;
      else if (len < 3) {
        result = poly;
        results.push(result);
        continue;
      }
      result = poly;
      d = delta * delta;
      //d = Math.floor(c_delta * c_delta);
      p = poly[0];
      j = 1;
      for (i = 1; i < len; i++) {
        if ((poly[i].X - p.X) * (poly[i].X - p.X) + (poly[i].Y - p.Y) * (poly[i].Y - p.Y) <= d)
          continue;
        result[j] = poly[i];
        p = poly[i];
        j++;
      }
      p = poly[j - 1];
      if ((poly[0].X - p.X) * (poly[0].X - p.X) + (poly[0].Y - p.Y) * (poly[0].Y - p.Y) <= d) j--;
      if (j < len) result.splice(j, len - j);
      if (result.length) results.push(result);
    }
    if (!isPolygons && results.length) results = results[0];
    else if (!isPolygons && results.length === 0) results = [];
    else if (isPolygons && results.length === 0) results = [[]];
    return results;
  };
  // Make deep copy of Polygons or Polygon
  // so that also IntPoint objects are cloned and not only referenced
  // This should be the fastest way
  ClipperLib.JS.Clone = function (polygon) {
    if (!(polygon instanceof Array)) return [];
    if (polygon.length === 0) return [];
    else if (polygon.length === 1 && polygon[0].length === 0) return [[]];
    var isPolygons = polygon[0] instanceof Array;
    if (!isPolygons) polygon = [polygon];
    var len = polygon.length,
      plen,
      i,
      j,
      result;
    var results = new Array(len);
    for (i = 0; i < len; i++) {
      plen = polygon[i].length;
      result = new Array(plen);
      for (j = 0; j < plen; j++) {
        result[j] = {
          X: polygon[i][j].X,
          Y: polygon[i][j].Y,
        };
      }
      results[i] = result;
    }
    if (!isPolygons) results = results[0];
    return results;
  };

  // Removes points that doesn't affect much to the visual appearance.
  // If middle point is at or under certain distance (tolerance) of the line segment between
  // start and end point, the middle point is removed.
  ClipperLib.JS.Lighten = function (polygon, tolerance) {
    if (!(polygon instanceof Array)) return [];
    if (typeof tolerance !== "number" || tolerance === null) {
      ClipperLib.Error("Tolerance is not a number in Lighten().");
      return ClipperLib.JS.Clone(polygon);
    }
    if (
      polygon.length === 0 ||
      (polygon.length === 1 && polygon[0].length === 0) ||
      tolerance < 0
    ) {
      return ClipperLib.JS.Clone(polygon);
    }
    var isPolygons = polygon[0] instanceof Array;
    if (!isPolygons) polygon = [polygon];
    var i, j, poly, k, poly2, plen, A, B, P, d, rem, addlast;
    var bxax, byay, l, ax, ay;
    var len = polygon.length;
    var toleranceSq = tolerance * tolerance;
    var results = [];
    for (i = 0; i < len; i++) {
      poly = polygon[i];
      plen = poly.length;
      if (plen === 0) continue;
      for (
        k = 0;
        k < 1000000;
        k++ // could be forever loop, but wiser to restrict max repeat count
      ) {
        poly2 = [];
        plen = poly.length;
        // the first have to added to the end, if first and last are not the same
        // this way we ensure that also the actual last point can be removed if needed
        if (poly[plen - 1].X !== poly[0].X || poly[plen - 1].Y !== poly[0].Y) {
          addlast = 1;
          poly.push({
            X: poly[0].X,
            Y: poly[0].Y,
          });
          plen = poly.length;
        } else addlast = 0;
        rem = []; // Indexes of removed points
        for (j = 0; j < plen - 2; j++) {
          A = poly[j]; // Start point of line segment
          P = poly[j + 1]; // Middle point. This is the one to be removed.
          B = poly[j + 2]; // End point of line segment
          ax = A.X;
          ay = A.Y;
          bxax = B.X - ax;
          byay = B.Y - ay;
          if (
            bxax !== 0 ||
            byay !== 0
          ) // To avoid Nan, when A==P && P==B. And to avoid peaks (A==B && A!=P), which have lenght, but not area.
          {
            l = ((P.X - ax) * bxax + (P.Y - ay) * byay) / (bxax * bxax + byay * byay);
            if (l > 1) {
              ax = B.X;
              ay = B.Y;
            } else if (l > 0) {
              ax += bxax * l;
              ay += byay * l;
            }
          }
          bxax = P.X - ax;
          byay = P.Y - ay;
          d = bxax * bxax + byay * byay;
          if (d <= toleranceSq) {
            rem[j + 1] = 1;
            j++; // when removed, transfer the pointer to the next one
          }
        }
        // add all unremoved points to poly2
        poly2.push({
          X: poly[0].X,
          Y: poly[0].Y,
        });
        for (j = 1; j < plen - 1; j++)
          if (!rem[j])
            poly2.push({
              X: poly[j].X,
              Y: poly[j].Y,
            });
        poly2.push({
          X: poly[plen - 1].X,
          Y: poly[plen - 1].Y,
        });
        // if the first point was added to the end, remove it
        if (addlast) poly.pop();
        // break, if there was not anymore removed points
        if (!rem.length) break;
        // else continue looping using poly2, to check if there are points to remove
        else poly = poly2;
      }
      plen = poly2.length;
      // remove duplicate from end, if needed
      if (poly2[plen - 1].X === poly2[0].X && poly2[plen - 1].Y === poly2[0].Y) {
        poly2.pop();
      }
      if (poly2.length > 2)
        // to avoid two-point-polygons
        results.push(poly2);
    }
    if (!isPolygons) {
      results = results[0];
    }
    if (typeof results === "undefined") {
      results = [];
    }
    return results;
  };

  ClipperLib.JS.PerimeterOfPath = function (path, closed, scale) {
    if (typeof path === "undefined") return 0;
    var sqrt = Math.sqrt;
    var perimeter = 0.0;
    var p1,
      p2,
      p1x = 0.0,
      p1y = 0.0,
      p2x = 0.0,
      p2y = 0.0;
    var j = path.length;
    if (j < 2) return 0;
    if (closed) {
      path[j] = path[0];
      j++;
    }
    while (--j) {
      p1 = path[j];
      p1x = p1.X;
      p1y = p1.Y;
      p2 = path[j - 1];
      p2x = p2.X;
      p2y = p2.Y;
      perimeter += sqrt((p1x - p2x) * (p1x - p2x) + (p1y - p2y) * (p1y - p2y));
    }
    if (closed) path.pop();
    return perimeter / scale;
  };

  ClipperLib.JS.PerimeterOfPaths = function (paths, closed, scale) {
    if (!scale) scale = 1;
    var perimeter = 0;
    for (var i = 0; i < paths.length; i++) {
      perimeter += ClipperLib.JS.PerimeterOfPath(paths[i], closed, scale);
    }
    return perimeter;
  };

  ClipperLib.JS.ScaleDownPath = function (path, scale) {
    var i, p;
    if (!scale) scale = 1;
    i = path.length;
    while (i--) {
      p = path[i];
      p.X = p.X / scale;
      p.Y = p.Y / scale;
    }
  };

  ClipperLib.JS.ScaleDownPaths = function (paths, scale) {
    var i, j, p;
    if (!scale) scale = 1;
    i = paths.length;
    while (i--) {
      j = paths[i].length;
      while (j--) {
        p = paths[i][j];
        p.X = p.X / scale;
        p.Y = p.Y / scale;
      }
    }
  };

  ClipperLib.JS.ScaleUpPath = function (path, scale) {
    var i,
      p,
      round = Math.round;
    if (!scale) scale = 1;
    i = path.length;
    while (i--) {
      p = path[i];
      p.X = round(p.X * scale);
      p.Y = round(p.Y * scale);
    }
  };

  ClipperLib.JS.ScaleUpPaths = function (paths, scale) {
    var i,
      j,
      p,
      round = Math.round;
    if (!scale) scale = 1;
    i = paths.length;
    while (i--) {
      j = paths[i].length;
      while (j--) {
        p = paths[i][j];
        p.X = round(p.X * scale);
        p.Y = round(p.Y * scale);
      }
    }
  };

  /**
   * @constructor
   */
  ClipperLib.ExPolygons = function () {
    return [];
  };
  /**
   * @constructor
   */
  ClipperLib.ExPolygon = function () {
    this.outer = null;
    this.holes = null;
  };

  ClipperLib.JS.AddOuterPolyNodeToExPolygons = function (polynode, expolygons) {
    var ep = new ClipperLib.ExPolygon();
    ep.outer = polynode.Contour();
    var childs = polynode.Childs();
    var ilen = childs.length;
    ep.holes = new Array(ilen);
    var node, n, i, j, childs2, jlen;
    for (i = 0; i < ilen; i++) {
      node = childs[i];
      ep.holes[i] = node.Contour();
      //Add outer polygons contained by (nested within) holes ...
      for (j = 0, childs2 = node.Childs(), jlen = childs2.length; j < jlen; j++) {
        n = childs2[j];
        ClipperLib.JS.AddOuterPolyNodeToExPolygons(n, expolygons);
      }
    }
    expolygons.push(ep);
  };

  ClipperLib.JS.ExPolygonsToPaths = function (expolygons) {
    var a, i, alen, ilen;
    var paths = new ClipperLib.Paths();
    for (a = 0, alen = expolygons.length; a < alen; a++) {
      paths.push(expolygons[a].outer);
      for (i = 0, ilen = expolygons[a].holes.length; i < ilen; i++) {
        paths.push(expolygons[a].holes[i]);
      }
    }
    return paths;
  };
  ClipperLib.JS.PolyTreeToExPolygons = function (polytree) {
    var expolygons = new ClipperLib.ExPolygons();
    var node, i, childs, ilen;
    for (i = 0, childs = polytree.Childs(), ilen = childs.length; i < ilen; i++) {
      node = childs[i];
      ClipperLib.JS.AddOuterPolyNodeToExPolygons(node, expolygons);
    }
    return expolygons;
  };
})();
