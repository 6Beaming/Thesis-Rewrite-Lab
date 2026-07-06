#!/usr/bin/env node
"use strict";

/**
 * Split a JSONL file into two parts at the middle line (streaming; low memory).
 *
 * Usage:
 *   node scripts/split-jsonl.cjs "docs/session transcripts/frontend-with-codex.jsonl"
 *   node scripts/split-jsonl.cjs input.jsonl --out1 a.jsonl --out2 b.jsonl
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out1") {
      flags.out1 = argv[++i];
    } else if (arg === "--out2") {
      flags.out2 = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error("Usage: node scripts/split-jsonl.cjs <input.jsonl> [--out1 part1.jsonl] [--out2 part2.jsonl]");
  }
  return { input: positional[0], ...flags };
}

function createLineReader(filePath) {
  return readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });
}

async function countLines(filePath) {
  let count = 0;
  const rl = createLineReader(filePath);
  for await (const _line of rl) {
    count += 1;
  }
  return count;
}

async function splitJsonl(inputPath, out1Path, out2Path) {
  const total = await countLines(inputPath);
  if (total === 0) {
    throw new Error("Input file has no lines.");
  }
  if (total === 1) {
    throw new Error("Input file has only one line; nothing to split.");
  }

  const splitAt = Math.ceil(total / 2);
  let index = 0;
  let part1Lines = 0;
  let part2Lines = 0;

  const ws1 = fs.createWriteStream(out1Path, { flags: "w" });
  const ws2 = fs.createWriteStream(out2Path, { flags: "w" });
  const rl = createLineReader(inputPath);

  for await (const line of rl) {
    index += 1;
    const target = index <= splitAt ? ws1 : ws2;
    target.write(line);
    target.write("\n");
    if (index <= splitAt) {
      part1Lines += 1;
    } else {
      part2Lines += 1;
    }
  }

  await Promise.all([
    new Promise((resolve, reject) => {
      ws1.end(resolve);
      ws1.on("error", reject);
    }),
    new Promise((resolve, reject) => {
      ws2.end(resolve);
      ws2.on("error", reject);
    })
  ]);

  const statIn = fs.statSync(inputPath);
  const stat1 = fs.statSync(out1Path);
  const stat2 = fs.statSync(out2Path);

  return {
    totalLines: total,
    splitAt,
    part1Lines,
    part2Lines,
    inputBytes: statIn.size,
    out1Bytes: stat1.size,
    out2Bytes: stat2.size
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const { input, out1, out2 } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(repoRoot, input);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input not found: ${inputPath}`);
  }

  const base = inputPath.replace(/\.jsonl$/i, "");
  const out1Path = path.resolve(repoRoot, out1 ?? `${base}-part1.jsonl`);
  const out2Path = path.resolve(repoRoot, out2 ?? `${base}-part2.jsonl`);

  if (path.resolve(out1Path) === inputPath || path.resolve(out2Path) === inputPath) {
    throw new Error("Output paths must differ from input path.");
  }

  const result = await splitJsonl(inputPath, out1Path, out2Path);

  console.log(`Input:  ${path.relative(repoRoot, inputPath)}`);
  console.log(`Lines:  ${result.totalLines} (split after line ${result.splitAt})`);
  console.log(`Part 1: ${path.relative(repoRoot, out1Path)} — ${result.part1Lines} lines, ${result.out1Bytes} bytes`);
  console.log(`Part 2: ${path.relative(repoRoot, out2Path)} — ${result.part2Lines} lines, ${result.out2Bytes} bytes`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
