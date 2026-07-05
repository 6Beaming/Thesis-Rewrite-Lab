#!/usr/bin/env node
"use strict";

/**
 * Extract proportional layout from desktop/mobile owl container reference SVGs.
 * Layers use overlapped absolute positioning (matching reference SVG stacking).
 * Output: scripts/generated/owl-container-layout.json
 *
 * Usage: node scripts/extract-container-layout.cjs
 */

const fs = require("fs");
const path = require("path");
const { extractPathsFromSvg, extractGroup } = require("./lib/svg-path-transform.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OWL_SVG_SIZE = 512;

function readSvg(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseRect(svgText, id) {
  const match = svgText.match(new RegExp(`<rect[^>]*id="${id}"[^>]*>`));
  if (!match) {
    return null;
  }
  const tag = match[0];
  const pick = (name) => {
    const m = tag.match(new RegExp(`${name}="([^"]+)"`));
    return m ? Number(m[1]) : null;
  };
  return {
    x: pick("x") ?? 0,
    y: pick("y") ?? 0,
    width: pick("width"),
    height: pick("height")
  };
}

function pathBounds(svgText, groupId) {
  const group = extractGroup(svgText, groupId);
  const paths = extractPathsFromSvg(group);
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  Object.values(paths).forEach((d) => {
    const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    for (let i = 0; i < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (!Number.isNaN(x)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      if (!Number.isNaN(y)) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  });
  if (!Number.isFinite(minY)) {
    return null;
  }
  return { minX, maxX, minY, maxY };
}

function toPct(value, total) {
  return `${((value / total) * 100).toFixed(4)}%`;
}

function buildLayout({ id, svgText, viewBox, bottomGroupId, owlGroupId, bottomFallback }) {
  const indicator = parseRect(svgText, "indicator_container");
  const owlBounds = pathBounds(svgText, owlGroupId);
  const bottomBounds = pathBounds(svgText, bottomGroupId) ?? bottomFallback;

  const contentBottom = Math.max(
    indicator.y + indicator.height,
    owlBounds ? owlBounds.minY + OWL_SVG_SIZE : 0,
    bottomBounds ? bottomBounds.maxY : viewBox.height
  );
  const containerHeight = Math.min(viewBox.height, contentBottom);

  const layers = {
    indicator: {
      top: toPct(indicator.y, containerHeight),
      width: toPct(indicator.width, viewBox.width),
      height: toPct(indicator.height, containerHeight),
      centerX: toPct(indicator.x + indicator.width / 2, viewBox.width)
    },
    owl: {
      top: toPct(owlBounds?.minY ?? indicator.height, containerHeight),
      width: "100%",
      height: toPct(OWL_SVG_SIZE, containerHeight)
    },
    bottom: {
      top: toPct(bottomBounds.minY, containerHeight),
      height: toPct(bottomBounds.maxY - bottomBounds.minY, containerHeight),
      width: "100%"
    }
  };

  return {
    id,
    referenceViewBox: viewBox,
    containerHeight,
    aspectRatio: viewBox.width / containerHeight,
    layers,
    regions: {
      indicator: {
        heightRatio: indicator.height / containerHeight,
        widthRatio: indicator.width / viewBox.width,
        centerXRatio: (indicator.x + indicator.width / 2) / viewBox.width
      },
      owl: {
        topRatio: (owlBounds?.minY ?? 0) / containerHeight,
        heightRatio: OWL_SVG_SIZE / containerHeight,
        viewBox: { width: OWL_SVG_SIZE, height: OWL_SVG_SIZE }
      },
      bottom: {
        topRatio: bottomBounds.minY / containerHeight,
        heightRatio: (bottomBounds.maxY - bottomBounds.minY) / containerHeight,
        assetId: bottomGroupId
      }
    }
  };
}

const desktopSvg = readSvg("src/assets/desktop_owl_container_reference.svg");
const mobileSvg = readSvg("src/assets/mobile_owl_container_reference.svg");

const twigSvg = readSvg("src/assets/twig.svg");
const twigViewBox = twigSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
const twigWidth = Number(twigViewBox[1]);
const twigHeight = Number(twigViewBox[2]);

const mobileBottomFallback = {
  minY: 748 * 0.7603,
  maxY: 748 * 0.7603 + (twigHeight / twigWidth) * 748 * 0.85,
  minX: 0,
  maxX: 748
};

const layout = {
  generatedAt: new Date().toISOString(),
  blackboard: {
    naturalWidth: 768,
    naturalHeight: 1376,
    maxWidth: "33dvw"
  },
  desktop: buildLayout({
    id: "desktop",
    svgText: desktopSvg,
    viewBox: { width: 512, height: 709 },
    bottomGroupId: "books",
    owlGroupId: "owl"
  }),
  mobile: buildLayout({
    id: "mobile",
    svgText: mobileSvg,
    viewBox: { width: 748, height: 748 },
    bottomGroupId: "twig",
    owlGroupId: "owl",
    bottomFallback: mobileBottomFallback
  }),
  mobileFloating: {
    visibleWidth: "min(128px, 33.33dvw)",
    hiddenOverflowRatio: 0.25,
    visibleWidthRatio: 0.75,
    minTop: "0dvh",
    snapSide: "left"
  }
};

const outPath = path.join(repoRoot, "scripts/generated/owl-container-layout.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(layout, null, 2) + "\n", "utf8");
console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
