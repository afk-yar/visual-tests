/* 3D градиентный шум (improved Perlin) + fbm/ridged + детерминированный ГПСЧ */
var Noise = (function () {
  var perm = new Uint8Array(512);
  var G = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1, 1,1,0, 0,-1,1, -1,1,0, 0,-1,-1 ]);

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seed(sd) {
    var r = rng(sd), p = [], i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = (r() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  seed(1337);

  function n3(x, y, z) {
    var X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    var u = x * x * x * (x * (x * 6 - 15) + 10);
    var v = y * y * y * (y * (y * 6 - 15) + 10);
    var w = z * z * z * (z * (z * 6 - 15) + 10);
    var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    var x1 = x - 1, y1 = y - 1, z1 = z - 1, g;
    g = (perm[AA] & 15) * 3;     var n000 = G[g] * x  + G[g + 1] * y  + G[g + 2] * z;
    g = (perm[BA] & 15) * 3;     var n100 = G[g] * x1 + G[g + 1] * y  + G[g + 2] * z;
    g = (perm[AB] & 15) * 3;     var n010 = G[g] * x  + G[g + 1] * y1 + G[g + 2] * z;
    g = (perm[BB] & 15) * 3;     var n110 = G[g] * x1 + G[g + 1] * y1 + G[g + 2] * z;
    g = (perm[AA + 1] & 15) * 3; var n001 = G[g] * x  + G[g + 1] * y  + G[g + 2] * z1;
    g = (perm[BA + 1] & 15) * 3; var n101 = G[g] * x1 + G[g + 1] * y  + G[g + 2] * z1;
    g = (perm[AB + 1] & 15) * 3; var n011 = G[g] * x  + G[g + 1] * y1 + G[g + 2] * z1;
    g = (perm[BB + 1] & 15) * 3; var n111 = G[g] * x1 + G[g + 1] * y1 + G[g + 2] * z1;
    var a = n000 + u * (n100 - n000), b = n010 + u * (n110 - n010);
    var c = n001 + u * (n101 - n001), d = n011 + u * (n111 - n011);
    var e = a + v * (b - a), f = c + v * (d - c);
    return e + w * (f - e);
  }

  /* fbm: сумма октав, результат примерно в [-1,1] */
  function fbm(x, y, z, oct, lac, gain) {
    var s = 0, a = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += a * n3(x, y, z); norm += a;
      x = x * lac + 17.3; y = y * lac - 9.1; z = z * lac + 4.7; a *= gain;
    }
    return s / norm * 1.6;
  }

  /* ridged: острые гребни, [0,1] */
  function ridged(x, y, z, oct) {
    var s = 0, a = 0.5, prev = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      var n = 1 - Math.abs(n3(x, y, z) * 1.4);
      n *= n; s += n * a * prev; norm += a; prev = n;
      x = x * 2.03 + 11.1; y = y * 2.03 - 3.7; z = z * 2.03 + 7.9; a *= 0.5;
    }
    return s / norm;
  }

  return { n3: n3, fbm: fbm, ridged: ridged, rng: rng, seed: seed };
})();
if (typeof module !== 'undefined') module.exports = Noise;
