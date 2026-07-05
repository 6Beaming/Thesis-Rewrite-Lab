const fs = require('fs');
const svg = fs.readFileSync('src/assets/test_right_wing_anim.svg', 'utf8');

const dx = 103.133;
const dy = 168.9427; 

const translate = (d, tx, ty) => {
  return d.replace(/([MCLZ])([^MCLZ]*)/gi, (match, cmd, args) => {
    if (cmd.toUpperCase() === 'Z') return 'Z';
    const tokens = args.trim().split(/[\s,]+(?=-?\d)/);
    const nums = tokens.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      nums[i] = Number((nums[i] + tx).toFixed(3));
      nums[i+1] = Number((nums[i+1] + ty).toFixed(3));
    }
    return cmd + nums.join(' ');
  });
};

const getPaths = (groupMatch) => {
  const paths = [...groupMatch.matchAll(/id="([^"]+)" d="([^"]+)"/g)];
  const map = {};
  paths.forEach(m => {
    // Strip trailing "_2" from before ids if necessary, wait, let's just map by index or known name
    let id = m[1].replace('_2', '');
    map[id] = translate(m[2], dx, dy);
  });
  return map;
};

const afterMatches = svg.split('<g id="after">')[1].split('</g>')[0];
const beforeMatches = svg.split('<g id="before">')[1].split('</g>')[0];

const afterPaths = getPaths(afterMatches);
const beforePaths = getPaths(beforeMatches);

console.log("const rightWingBeforePaths = " + JSON.stringify(beforePaths, null, 2) + ";");
console.log("const rightWingAfterPaths = " + JSON.stringify(afterPaths, null, 2) + ";");
