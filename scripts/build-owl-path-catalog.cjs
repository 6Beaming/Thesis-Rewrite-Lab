#!/usr/bin/env node
"use strict";

/**
 * Build-time script: read src/assets SVGs and emit a default-position path catalog.
 *
 * Usage:
 *   node scripts/build-owl-path-catalog.cjs
 *   node scripts/build-owl-path-catalog.cjs --config scripts/owl-path-config.json
 */

const fs = require("fs");
const path = require("path");
const {
  extractPathsFromSvg,
  extractGroup,
  getFirstPoint,
  translatePath,
  remapPaths
} = require("./lib/svg-path-transform.cjs");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const configArgIdx = args.indexOf("--config");
const configPath = path.resolve(
  repoRoot,
  configArgIdx >= 0 ? args[configArgIdx + 1] : "scripts/owl-path-config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function readAsset(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.readFileSync(fullPath, "utf8");
}

function pickOwlPaths(svgText, ids) {
  const all = extractPathsFromSvg(svgText);
  const out = {};
  ids.forEach((id) => {
    if (all[id]) {
      out[id] = all[id];
    }
  });
  return out;
}

function calibrateGroupPaths(groupSvg, idMap, owlAnchorD, refAnchorId) {
  const raw = extractPathsFromSvg(groupSvg);
  const anchorD = raw[refAnchorId];
  if (!anchorD) {
    throw new Error(`Reference anchor "${refAnchorId}" not found in group`);
  }
  const refPoint = getFirstPoint(anchorD);
  const owlPoint = getFirstPoint(owlAnchorD);
  const dx = owlPoint.x - refPoint.x;
  const dy = owlPoint.y - refPoint.y;
  const shifted = {};
  for (const [id, d] of Object.entries(raw)) {
    shifted[id] = translatePath(d, dx, dy);
  }
  return remapPaths(shifted, idMap);
}

function getGroupTranslation(groupSvg, owlAnchorD, refAnchorId) {
  const raw = extractPathsFromSvg(groupSvg);
  const anchorD = raw[refAnchorId];
  if (!anchorD) {
    throw new Error(`Reference anchor "${refAnchorId}" not found in group`);
  }
  const refPoint = getFirstPoint(anchorD);
  const owlPoint = getFirstPoint(owlAnchorD);
  return {
    dx: owlPoint.x - refPoint.x,
    dy: owlPoint.y - refPoint.y
  };
}

function translateGroupPaths(groupSvg, translation) {
  const raw = extractPathsFromSvg(groupSvg);
  const shifted = {};
  for (const [id, d] of Object.entries(raw)) {
    shifted[id] = translatePath(d, translation.dx, translation.dy);
  }
  return shifted;
}

const owlSvg = readAsset(config.assets.owlSvg);
const rightRefSvg = readAsset(config.assets.rightWingRefSvg);
const leftRefSvg = readAsset(config.assets.leftWingRefSvg);
const magicWandSvg = readAsset(config.assets.magicWandSvg);

const rightWingIds = Object.values(config.rightWing.idMap.before);
const leftWingIds = Object.values(config.leftWing.idMap.before);
const wandIds = ["wand_frame", "right_filler", "left_filler", "middle_filler", "wand_filler"];

const owlRightBefore = pickOwlPaths(owlSvg, rightWingIds);
const owlLeftBefore = pickOwlPaths(owlSvg, leftWingIds);
const owlWandInter = pickOwlPaths(magicWandSvg, wandIds);

const owlRightAnchor = owlRightBefore[config.rightWing.owlAnchorId];
const owlLeftAnchor = owlLeftBefore[config.leftWing.owlAnchorId];

const rightBeforeGroup = extractGroup(rightRefSvg, config.rightWing.referenceGroups.before);
const rightAfterGroup = extractGroup(rightRefSvg, config.rightWing.referenceGroups.after);
const rightTranslation = getGroupTranslation(
  rightBeforeGroup,
  owlRightAnchor,
  config.rightWing.referenceAnchor.before
);
const rightAfterShifted = translateGroupPaths(rightAfterGroup, rightTranslation);
const rightWingAfter = remapPaths(rightAfterShifted, config.rightWing.idMap.after);

const leftBeforeGroup = extractGroup(leftRefSvg, config.leftWing.referenceGroups.before);
const leftInterGroup = extractGroup(leftRefSvg, config.leftWing.referenceGroups.intermediate);
const leftAfterGroup = extractGroup(leftRefSvg, config.leftWing.referenceGroups.after);

const leftTranslation = getGroupTranslation(
  leftBeforeGroup,
  owlLeftAnchor,
  config.leftWing.referenceAnchor.before
);
const leftInterShifted = translateGroupPaths(leftInterGroup, leftTranslation);
const leftAfterShifted = translateGroupPaths(leftAfterGroup, leftTranslation);

const leftWingIntermediate = remapPaths(leftInterShifted, config.leftWing.idMap.intermediate);
const leftWingAfter = remapPaths(leftAfterShifted, config.leftWing.idMap.after);
const wandIntermediate = remapPaths(leftInterShifted, config.leftWing.wandIdMap.intermediate);
const wandAfter = remapPaths(leftAfterShifted, config.leftWing.wandIdMap.after);

const catalog = {
  generatedAt: new Date().toISOString(),
  configVersion: config.version,
  defaultViewBox: config.defaultViewBox,
  wandPresentation: config.wandPresentation,
  transformOrigins: {
    headGroup: { x: "50%", y: "68%" },
    rightWingGroup: { x: "62%", y: "20%" },
    leftWingGroup: { x: "38%", y: "22%" }
  },
  rightWing: {
    ids: rightWingIds,
    before: owlRightBefore,
    after: rightWingAfter,
    afterState: config.rightWing.afterState
  },
  leftWing: {
    ids: leftWingIds,
    before: owlLeftBefore,
    intermediate: leftWingIntermediate,
    after: leftWingAfter
  },
  wand: {
    ids: wandIds,
    sourceAsset: owlWandInter,
    intermediate: wandIntermediate,
    after: wandAfter,
  }
};

const outPath = path.join(repoRoot, config.output.catalogJson);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");

console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
console.log(`  right wing paths: before ${Object.keys(owlRightBefore).length}, after ${Object.keys(rightWingAfter).length}`);
console.log(`  left wing paths: before ${Object.keys(owlLeftBefore).length}, intermediate ${Object.keys(leftWingIntermediate).length}, after ${Object.keys(leftWingAfter).length}`);
console.log(`  wand paths: intermediate ${Object.keys(owlWandInter).length}, after ${Object.keys(wandAfter).length}`);
