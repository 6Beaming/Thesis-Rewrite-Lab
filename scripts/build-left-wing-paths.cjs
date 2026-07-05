const fs = require('fs');

const svg = fs.readFileSync('src/assets/test_left_wing_anim.svg', 'utf8');

const dx = 364.529;
const dy = 188.000;

function shiftPath(d) {
  return d.replace(/([MCLZz])([^MCLZz]*)/g, (match, cmd, args) => {
    if (cmd.toUpperCase() === 'Z') return match;
    const nums = args.trim().split(/[\s,]+/).map(parseFloat);
    for (let i = 0; i < nums.length; i += 2) {
      if (!isNaN(nums[i])) nums[i] = +(nums[i] + dx).toFixed(3);
      if (!isNaN(nums[i+1])) nums[i+1] = +(nums[i+1] + dy).toFixed(3);
    }
    return cmd + nums.join(' ');
  });
}

function extractPaths(groupStr) {
  const paths = {};
  const regex = /<path id="([^"]+)" d="([^"]+)"/g;
  let match;
  while ((match = regex.exec(groupStr)) !== null) {
    paths[match[1]] = shiftPath(match[2]);
  }
  return paths;
}

const afterStr = svg.split('<g id="after">')[1].split('<g id="intermediate">')[0];
const interStr = svg.split('<g id="intermediate">')[1].split('<g id="before">')[0];
const beforeStr = svg.split('<g id="before">')[1].split('</svg>')[0];

const beforePathsRaw = extractPaths(beforeStr);
const interPathsRaw = extractPaths(interStr);
const afterPathsRaw = extractPaths(afterStr);

const keys = [
  'left_wing',
  'left_wing_2_and_3_and_4',
  'left_wing_separator_34',
  'left_wing_1_and_2',
  'left_wing_separator_23',
  'left_wing_1',
  'left_wing_separator_12'
];

const beforePaths = {};
const interPaths = {};
const afterPaths = {};

keys.forEach(k => {
  beforePaths[k] = beforePathsRaw[k + '_3'];
  interPaths[k] = interPathsRaw[k + '_2'];
  afterPaths[k] = afterPathsRaw[k];
});

const wandKeys = [
  'wand_frame',
  'right_filler',
  'left_filler',
  'middle_filler',
  'wand_filler'
];

const interWand = {};
const afterWand = {};

wandKeys.forEach(k => {
  interWand[k] = interPathsRaw[k + '_2'];
  afterWand[k] = afterPathsRaw[k];
});

fs.writeFileSync('scripts/left_wing_data.json', JSON.stringify({
  beforePaths, interPaths, afterPaths, interWand, afterWand
}, null, 2));

console.log("Wrote left_wing_data.json");
