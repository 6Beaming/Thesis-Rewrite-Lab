#!/usr/bin/env node
"use strict";

/**
 * Runtime/build helper: scale and reposition path data from the default 512×512 catalog
 * into coordinates for a custom viewBox or rendered size.
 *
 * Usage:
 *   node scripts/transform-owl-paths.cjs --scale 0.5
 *   node scripts/transform-owl-paths.cjs --scale 1.2 --translate-x 24 --translate-y -8
 *   node scripts/transform-owl-paths.cjs --viewbox-width 256 --viewbox-height 256
 *   node scripts/transform-owl-paths.cjs --input scripts/generated/owl-path-catalog.json --output /tmp/scaled.json
 *
 * Options:
 *   --input           Path to catalog JSON (default: scripts/generated/owl-path-catalog.json)
 *   --output          Write JSON to file instead of stdout
 *   --scale           Uniform scale (default: 1)
 *   --scale-x         Horizontal scale (overrides --scale for X)
 *   --scale-y         Vertical scale (overrides --scale for Y)
 *   --translate-x     X offset in default viewBox units (default: 0)
 *   --translate-y     Y offset in default viewBox units (default: 0)
 *   --origin-x        Transform origin X (default: 0)
 *   --origin-y        Transform origin Y (default: 0)
 *   --viewbox-width   Target viewBox width; sets scale-x relative to catalog default width
 *   --viewbox-height  Target viewBox height; sets scale-y relative to catalog default height
 *   --section         Transform only one section: rightWing | leftWing | wand
 */

const fs = require("fs");
const path = require("path");
const { transformPathMap } = require("./lib/svg-path-transform.cjs");

const repoRoot = path.resolve(__dirname, "..");

function readArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || process.argv[idx + 1] === undefined) {
    return fallback;
  }
  return process.argv[idx + 1];
}

function readNumber(name, fallback) {
  const value = readArg(name, null);
  return value === null ? fallback : Number(value);
}

const inputPath = path.resolve(repoRoot, readArg("--input", "scripts/generated/owl-path-catalog.json"));
const outputPath = readArg("--output", null);
const section = readArg("--section", null);

const catalog = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const defaultWidth = catalog.defaultViewBox?.width || 512;
const defaultHeight = catalog.defaultViewBox?.height || 512;

let scaleX = readNumber("--scale-x", readNumber("--scale", 1));
let scaleY = readNumber("--scale-y", readNumber("--scale", 1));

const viewBoxWidth = readNumber("--viewbox-width", null);
const viewBoxHeight = readNumber("--viewbox-height", null);
if (viewBoxWidth !== null) {
  scaleX = viewBoxWidth / defaultWidth;
}
if (viewBoxHeight !== null) {
  scaleY = viewBoxHeight / defaultHeight;
}

const transformOptions = {
  scaleX,
  scaleY,
  translateX: readNumber("--translate-x", 0),
  translateY: readNumber("--translate-y", 0),
  originX: readNumber("--origin-x", 0),
  originY: readNumber("--origin-y", 0)
};

function transformStateBlock(block) {
  if (!block || typeof block !== "object") {
    return block;
  }
  const out = {};
  for (const [key, value] of Object.entries(block)) {
    if (key === "ids" || key === "afterState") {
      out[key] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = transformPathMap(value, transformOptions);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const result = {
  sourceCatalog: path.relative(repoRoot, inputPath),
  transform: transformOptions,
  defaultViewBox: catalog.defaultViewBox,
  effectiveViewBox: {
    width: defaultWidth * scaleX,
    height: defaultHeight * scaleY
  },
  wandPresentation: catalog.wandPresentation
    ? {
        ...catalog.wandPresentation,
        transformOrigin: catalog.wandPresentation.transformOrigin
          ? {
              x: catalog.wandPresentation.transformOrigin.x * scaleX + transformOptions.translateX,
              y: catalog.wandPresentation.transformOrigin.y * scaleY + transformOptions.translateY
            }
          : undefined,
        readyScale: catalog.wandPresentation.readyScale * scaleX
      }
    : undefined
};

if (!section || section === "rightWing") {
  result.rightWing = transformStateBlock(catalog.rightWing);
}
if (!section || section === "leftWing") {
  result.leftWing = transformStateBlock(catalog.leftWing);
}
if (!section || section === "wand") {
  result.wand = transformStateBlock(catalog.wand);
}

const json = JSON.stringify(result, null, 2) + "\n";
if (outputPath) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, json, "utf8");
  console.error(`Wrote ${path.relative(repoRoot, resolved)}`);
} else {
  process.stdout.write(json);
}
