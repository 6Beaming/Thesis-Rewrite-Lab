const fs = require('fs');
const svg = fs.readFileSync('src/assets/test_right_wing_anim.svg', 'utf8');

const dx = 106.5598; // Let's recalculate accurately
const dy = 168.2671; 
// Let's use the exact diff from the first point of right_wing_bg
// owl.svg: M140.289 189.514
// before: M37.156 20.5713
// dx = 140.289 - 37.156 = 103.133
// dy = 189.514 - 20.5713 = 168.9427

const afterMatches = svg.split('<g id="after">')[1].split('<g id="before">')[0];
const paths = [...afterMatches.matchAll(/id="([^"]+)" d="([^"]+)"/g)];

const translate = (d, tx, ty) => {
  return d.replace(/([MCLZ])([^MCLZ]*)/gi, (match, cmd, args) => {
    if (cmd.toUpperCase() === 'Z') return 'Z';
    // split by space or comma, taking care of negative numbers
    const tokens = args.trim().split(/[\s,]+(?=-?\d)/);
    const nums = tokens.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      nums[i] = Number((nums[i] + tx).toFixed(3));
      nums[i+1] = Number((nums[i+1] + ty).toFixed(3));
    }
    return cmd + nums.join(' ');
  });
};

paths.forEach(m => {
  console.log(`"${m[1]}": "${translate(m[2], 103.133, 168.9427)}",`);
});
