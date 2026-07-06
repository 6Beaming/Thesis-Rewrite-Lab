"use strict";

/**
 * Shared SVG path utilities for build-time catalog generation and runtime scaling.
 * Supports M, L, C, H, V, Z commands (absolute and relative).
 */

function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return [];
  }
  const segments = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (!/[a-zA-Z]/.test(cmd)) {
      throw new Error(`Invalid path command near "${cmd}" in "${d.slice(0, 40)}..."`);
    }
    const upper = cmd.toUpperCase();
    const argCount =
      upper === "M" || upper === "L" ? 2 :
      upper === "H" || upper === "V" ? 1 :
      upper === "C" ? 6 :
      upper === "Z" ? 0 : null;
    if (argCount === null) {
      throw new Error(`Unsupported path command "${cmd}"`);
    }
    const args = [];
    for (let n = 0; n < argCount; n++) {
      args.push(Number(tokens[i++]));
    }
    segments.push({ cmd, args });
  }
  return segments;
}

function formatNumber(value) {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function stringifyPath(segments) {
  return segments
    .map((segment) => {
      if (segment.cmd.toUpperCase() === "Z") {
        return segment.cmd;
      }
      return segment.cmd + segment.args.map(formatNumber).join(" ");
    })
    .join("");
}

function getFirstPoint(d) {
  const segments = parsePath(d);
  let x = 0;
  let y = 0;
  for (const segment of segments) {
    const upper = segment.cmd.toUpperCase();
    if (upper === "M" || upper === "L") {
      if (segment.cmd === upper) {
        x = segment.args[0];
        y = segment.args[1];
      } else {
        x += segment.args[0];
        y += segment.args[1];
      }
      return { x, y };
    }
    if (upper === "H") {
      x = segment.cmd === "H" ? segment.args[0] : x + segment.args[0];
      return { x, y };
    }
    if (upper === "V") {
      y = segment.cmd === "V" ? segment.args[0] : y + segment.args[0];
      return { x, y };
    }
    if (upper === "C") {
      const idx = segment.cmd === "C" ? 4 : 4;
      if (segment.cmd === "C") {
        x = segment.args[idx];
        y = segment.args[idx + 1];
      } else {
        x += segment.args[idx];
        y += segment.args[idx + 1];
      }
      return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function translatePath(d, dx, dy) {
  const segments = parsePath(d);
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  const transformed = segments.map((segment) => {
    const upper = segment.cmd.toUpperCase();
    const relative = segment.cmd !== upper;
    const args = segment.args.slice();

    if (upper === "Z") {
      x = subpathStartX;
      y = subpathStartY;
      return { cmd: segment.cmd, args };
    }

    if (upper === "M" || upper === "L") {
      for (let i = 0; i < args.length; i += 2) {
        if (relative) {
          args[i] += dx;
          args[i + 1] += dy;
          x += args[i];
          y += args[i + 1];
        } else {
          args[i] += dx;
          args[i + 1] += dy;
          x = args[i];
          y = args[i + 1];
        }
        if (upper === "M" && i === 0) {
          subpathStartX = x;
          subpathStartY = y;
        }
      }
      return { cmd: segment.cmd, args };
    }

    if (upper === "H") {
      args[0] = (relative ? x + args[0] : args[0]) + dx;
      x = args[0];
      return { cmd: relative ? "H" : "H", args };
    }

    if (upper === "V") {
      args[0] = (relative ? y + args[0] : args[0]) + dy;
      y = args[0];
      return { cmd: relative ? "V" : "V", args };
    }

    if (upper === "C") {
      for (let i = 0; i < args.length; i += 2) {
        if (relative) {
          args[i] += dx;
          args[i + 1] += dy;
        } else {
          args[i] += dx;
          args[i + 1] += dy;
        }
      }
      x = relative ? x + segment.args[4] + dx : segment.args[4] + dx;
      y = relative ? y + segment.args[5] + dy : segment.args[5] + dy;
      return { cmd: segment.cmd, args };
    }

    throw new Error(`Unsupported path command "${segment.cmd}"`);
  });

  return stringifyPath(transformed);
}

function transformPath(d, options = {}) {
  const {
    scaleX = 1,
    scaleY = scaleX,
    translateX = 0,
    translateY = 0,
    originX = 0,
    originY = 0
  } = options;

  const segments = parsePath(d);
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  function mapPoint(px, py) {
    return {
      x: (px - originX) * scaleX + originX + translateX,
      y: (py - originY) * scaleY + originY + translateY
    };
  }

  const transformed = segments.map((segment) => {
    const upper = segment.cmd.toUpperCase();
    const relative = segment.cmd !== upper;
    const args = segment.args.slice();

    if (upper === "Z") {
      x = subpathStartX;
      y = subpathStartY;
      return { cmd: segment.cmd, args };
    }

    if (upper === "M" || upper === "L") {
      for (let i = 0; i < args.length; i += 2) {
        const px = relative ? x + args[i] : args[i];
        const py = relative ? y + args[i + 1] : args[i + 1];
        const mapped = mapPoint(px, py);
        if (relative) {
          args[i] = mapped.x - x;
          args[i + 1] = mapped.y - y;
          x += args[i];
          y += args[i + 1];
        } else {
          args[i] = mapped.x;
          args[i + 1] = mapped.y;
          x = mapped.x;
          y = mapped.y;
        }
        if (upper === "M" && i === 0) {
          subpathStartX = x;
          subpathStartY = y;
        }
      }
      return { cmd: segment.cmd, args };
    }

    if (upper === "H") {
      const px = relative ? x + args[0] : args[0];
      const mapped = mapPoint(px, y);
      args[0] = relative ? mapped.x - x : mapped.x;
      x = mapped.x;
      return { cmd: segment.cmd, args };
    }

    if (upper === "V") {
      const py = relative ? y + args[0] : args[0];
      const mapped = mapPoint(x, py);
      args[0] = relative ? mapped.y - y : mapped.y;
      y = mapped.y;
      return { cmd: segment.cmd, args };
    }

    if (upper === "C") {
      for (let i = 0; i < args.length; i += 2) {
        const px = relative ? x + args[i] : args[i];
        const py = relative ? y + args[i + 1] : args[i + 1];
        const mapped = mapPoint(px, py);
        if (relative) {
          args[i] = mapped.x - x;
          args[i + 1] = mapped.y - y;
        } else {
          args[i] = mapped.x;
          args[i + 1] = mapped.y;
        }
      }
      x = relative ? x + segment.args[4] * scaleX : args[4];
      y = relative ? y + segment.args[5] * scaleY : args[5];
      return { cmd: segment.cmd, args };
    }

    throw new Error(`Unsupported path command "${segment.cmd}"`);
  });

  return stringifyPath(transformed);
}

function transformPathMap(pathMap, options) {
  const out = {};
  for (const [id, d] of Object.entries(pathMap)) {
    out[id] = transformPath(d, options);
  }
  return out;
}

function extractPathsFromSvg(svgText) {
  const paths = {};
  const regex = /<path[^>]*\sid="([^"]+)"[^>]*\sd="([^"]+)"/g;
  let match;
  while ((match = regex.exec(svgText)) !== null) {
    paths[match[1]] = match[2];
  }
  return paths;
}

function extractGroup(svgText, groupId) {
  const markerMatch = svgText.match(new RegExp(`<g id="${groupId}"[^>]*>`));
  if (!markerMatch) {
    return "";
  }
  const start = svgText.indexOf(markerMatch[0]);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  let i = start;
  while (i < svgText.length) {
    if (svgText.startsWith("<g", i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (svgText.startsWith("</g>", i)) {
      depth -= 1;
      i += 4;
      if (depth === 0) {
        return svgText.slice(start, i);
      }
      continue;
    }
    i += 1;
  }
  return "";
}

function remapPaths(paths, idMap) {
  const out = {};
  for (const [fromId, toId] of Object.entries(idMap)) {
    if (paths[fromId]) {
      out[toId] = paths[fromId];
    }
  }
  return out;
}

module.exports = {
  parsePath,
  stringifyPath,
  getFirstPoint,
  translatePath,
  transformPath,
  transformPathMap,
  extractPathsFromSvg,
  extractGroup,
  remapPaths
};
