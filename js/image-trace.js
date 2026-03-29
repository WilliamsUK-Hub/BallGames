/**
 * Trace non-transparent pixels of an image into a simplified polygon, then scale
 * so the silhouette fits a target "radius" (half-extent) for Matter.js.
 */
(function (global) {
  'use strict';

  var ALPHA_CUT = 20;

  function getMaskFromImage(image, maxDim) {
    var nw = image.naturalWidth || image.width;
    var nh = image.naturalHeight || image.height;
    if (!nw || !nh) return null;

    var scale = Math.min(maxDim / nw, maxDim / nh, 1);
    var w = Math.max(8, Math.round(nw * scale));
    var h = Math.max(8, Math.round(nh * scale));

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;

    var mask = new Uint8Array(w * h);
    var i;
    for (i = 0; i < w * h; i++) {
      mask[i] = data[i * 4 + 3] > ALPHA_CUT ? 1 : 0;
    }
    return { mask: mask, w: w, h: h };
  }

  /** Moore–neighbor boundary tracing on a binary mask (opaque = 1). */
  function traceBoundaryPoints(mask, w, h) {
    var x;
    var y;
    var found = false;
    for (y = 0; y < h && !found; y++) {
      for (x = 0; x < w && !found; x++) {
        if (mask[y * w + x] && (y === 0 || !mask[(y - 1) * w + x])) {
          found = true;
        }
      }
    }
    if (!found) return [];

    var sx = x;
    var sy = y;
    var dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1]
    ];

    var path = [];
    var cx = sx;
    var cy = sy;
    var dir = 6;
    var maxSteps = w * h * 8;
    var step = 0;

    while (step++ < maxSteps) {
      path.push({ x: cx, y: cy });
      var moved = false;
      var b;
      for (b = 0; b < 8; b++) {
        var d = (dir + b + 1) % 8;
        var nx = cx + dirs[d][0];
        var ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (mask[ny * w + nx]) {
          cx = nx;
          cy = ny;
          dir = (d + 4 + 8) % 8;
          moved = true;
          break;
        }
      }
      if (!moved) break;
      if (cx === sx && cy === sy && path.length > 2) break;
    }

    return path;
  }

  function isOpaque(mask, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return mask[y * w + x] === 1;
  }

  /** Collect boundary pixels (opaque with a transparent 4-neighbour). */
  function collectEdgePixels(mask, w, h) {
    var out = [];
    var x;
    var y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (
          !isOpaque(mask, w, h, x - 1, y) ||
          !isOpaque(mask, w, h, x + 1, y) ||
          !isOpaque(mask, w, h, x, y - 1) ||
          !isOpaque(mask, w, h, x, y + 1)
        ) {
          out.push({ x: x, y: y });
        }
      }
    }
    return out;
  }

  function convexHullMonotone(points) {
    if (points.length < 3) return points.slice();
    var pts = points.slice().sort(function (a, b) {
      return a.x === b.x ? a.y - b.y : a.x - b.x;
    });
    var cross = function (o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    };
    var lower = [];
    var i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
        lower.pop();
      }
      lower.push(pts[i]);
    }
    var upper = [];
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
        upper.pop();
      }
      upper.push(pts[i]);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function subsamplePoints(points, maxPts) {
    if (points.length <= maxPts) return points;
    var step = Math.ceil(points.length / maxPts);
    var out = [];
    var i;
    for (i = 0; i < points.length; i += step) {
      out.push(points[i]);
    }
    return out;
  }

  function traceBoundaryOrFallback(mask, w, h) {
    var moore = traceBoundaryPoints(mask, w, h);
    if (moore.length >= 8) return moore;
    var edges = collectEdgePixels(mask, w, h);
    if (edges.length < 3) return [];
    edges = subsamplePoints(edges, 400);
    return convexHullMonotone(edges);
  }

  function perpendicularDistance(point, lineStart, lineEnd) {
    var dx = lineEnd.x - lineStart.x;
    var dy = lineEnd.y - lineStart.y;
    if (dx === 0 && dy === 0) {
      dx = point.x - lineStart.x;
      dy = point.y - lineStart.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    var t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    var projX = lineStart.x + t * dx;
    var projY = lineStart.y + t * dy;
    var ox = point.x - projX;
    var oy = point.y - projY;
    return Math.sqrt(ox * ox + oy * oy);
  }

  function simplifyRDP(points, epsilon) {
    if (points.length < 3) return points.slice();
    var first = points[0];
    var last = points[points.length - 1];
    var index = -1;
    var dist = 0;
    var i;
    for (i = 1; i < points.length - 1; i++) {
      var d = perpendicularDistance(points[i], first, last);
      if (d > dist) {
        index = i;
        dist = d;
      }
    }
    if (dist > epsilon && index > 0) {
      var left = simplifyRDP(points.slice(0, index + 1), epsilon);
      var right = simplifyRDP(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function boundsOfPoints(points) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var i;
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function maxDistFromCenter(points, cx, cy) {
    var m = 0;
    var i;
    for (i = 0; i < points.length; i++) {
      var dx = points[i].x - cx;
      var dy = points[i].y - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > m) m = d;
    }
    return m;
  }

  /**
   * @param {HTMLImageElement} image
   * @param {number} targetRadius - physics units: max distance from body centre to silhouette
   * @param {{ maxTraceDim?: number, rdpEpsilon?: number }} [options]
   * @returns {{
   *   vertices: Array<{x:number,y:number}>,
   *   spriteDrawW: number,
   *   spriteDrawH: number,
   *   traceW: number,
   *   traceH: number
   * } | null}
   */
  function traceImageToVertices(image, targetRadius, options) {
    options = options || {};
    var maxTraceDim = options.maxTraceDim != null ? options.maxTraceDim : 128;
    var rdpEpsilon = options.rdpEpsilon != null ? options.rdpEpsilon : 1.2;

    var pack = getMaskFromImage(image, maxTraceDim);
    if (!pack) return null;

    var raw = traceBoundaryOrFallback(pack.mask, pack.w, pack.h);
    if (raw.length < 3) return null;

    if (raw.length > 2) {
      var fst = raw[0];
      var lst = raw[raw.length - 1];
      if (fst.x === lst.x && fst.y === lst.y) raw = raw.slice(0, -1);
    }

    var simp = simplifyRDP(raw, rdpEpsilon);
    if (simp.length < 3) return null;

    var b = boundsOfPoints(simp);
    var cx = (b.minX + b.maxX) * 0.5;
    var cy = (b.minY + b.maxY) * 0.5;

    var i;
    var centered = [];
    for (i = 0; i < simp.length; i++) {
      centered.push({ x: simp[i].x - cx, y: simp[i].y - cy });
    }

    var maxD = maxDistFromCenter(centered, 0, 0);
    if (maxD < 1e-6) return null;

    var scale = targetRadius / maxD;
    var vertices = [];
    for (i = 0; i < centered.length; i++) {
      vertices.push({
        x: centered[i].x * scale,
        y: centered[i].y * scale
      });
    }

    var spriteDrawW = pack.w * scale;
    var spriteDrawH = pack.h * scale;

    return {
      vertices: vertices,
      spriteDrawW: spriteDrawW,
      spriteDrawH: spriteDrawH,
      traceW: pack.w,
      traceH: pack.h
    };
  }

  global.ImageTrace = {
    traceImageToVertices: traceImageToVertices
  };
})(typeof window !== 'undefined' ? window : globalThis);
