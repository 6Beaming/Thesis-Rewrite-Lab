const fs = require('fs');

let html = fs.readFileSync('local/animations/test.html', 'utf8');

// The HTML currently has:
// <g id="left_wing_group">
// <g id="magic_wand" class="wand-hidden">
// ... wand paths ...
// </g>
// <path id="left_wing" ...>
// ... other left wing paths ...
// </g>
// 
// <path id="left_wing" ... (the old ones)
// <path id="left_wing_2_and_3_and_4" ... (the old ones)
// ...
// </g> // wait, is there an extra </g>?

// Let's just find the <g id="right_wing_group"> and delete everything between <g id="body_group">...</g> and <g id="right_wing_group">.
// Actually, let's use a robust approach to rebuild test.html from a clean slate or just remove the duplicate paths.

const duplicateStart = html.indexOf('<path id="left_wing" d="M381.436');
if (duplicateStart !== -1) {
  const rightWingGroupStart = html.indexOf('<g id="right_wing_group">');
  // We want to delete from duplicateStart to rightWingGroupStart
  // But wait, there might be a </g> before right_wing_group.
  let substring = html.substring(duplicateStart, rightWingGroupStart);
  html = html.slice(0, duplicateStart) + '\n' + html.slice(rightWingGroupStart);
}

fs.writeFileSync('local/animations/test.html', html);
console.log('fixed test.html duplicate left wings');
