const fs = require('fs');

let html = fs.readFileSync('local/animations/test.html', 'utf8');
const data = JSON.parse(fs.readFileSync('scripts/left_wing_data.json', 'utf8'));

const colors = {
  left_wing: '#737373',
  left_wing_2_and_3_and_4: '#9D8E83',
  left_wing_separator_34: '#352E2B',
  left_wing_1_and_2: '#9D8E83',
  left_wing_separator_23: '#352E2B',
  left_wing_1: '#9D8E83',
  left_wing_separator_12: '#352E2B',
  
  wand_frame: 'black',
  right_filler: '#7FDBFE',
  left_filler: '#FE7FA7',
  middle_filler: '#FEC901',
  wand_filler: '#FE8E00'
};

let pathsStr = '';

// Add magic wand paths (hidden by default via CSS)
pathsStr += '<g id="magic_wand" class="wand-hidden">\n';
Object.keys(data.interWand).forEach(k => {
  pathsStr += '<path id="' + k + '" d="' + data.interWand[k] + '" fill="' + colors[k] + '"/>\n';
});
pathsStr += '</g>\n';

// Add left wing paths
Object.keys(data.beforePaths).forEach(k => {
  pathsStr += '<path id="' + k + '" d="' + data.beforePaths[k] + '" fill="' + colors[k] + '"/>\n';
});

html = html.replace(/<g id="left_wing_group">[\s\S]*?<\/g>/, '<g id="left_wing_group">\n' + pathsStr + '</g>');

fs.writeFileSync('local/animations/test.html', html);
console.log('wrote test.html');
