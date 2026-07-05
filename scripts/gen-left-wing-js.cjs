const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scripts/left_wing_data.json', 'utf8'));

let js = `(function () {
  "use strict";

  const O = window.OwlAnim;
  const leftWingIds = O.leftWingIds;
  const wandIds = [
    "wand_frame",
    "right_filler",
    "left_filler",
    "middle_filler",
    "wand_filler"
  ];

  const beforePaths = ${JSON.stringify(data.beforePaths, null, 2)};
  const interPaths = ${JSON.stringify(data.interPaths, null, 2)};
  const afterPaths = ${JSON.stringify(data.afterPaths, null, 2)};
  
  const interWand = ${JSON.stringify(data.interWand, null, 2)};
  const afterWand = ${JSON.stringify(data.afterWand, null, 2)};

  O.morphLeftWingPaths = function morphLeftWingPaths(state, durationBg = 150, durationFg = 150) {
    let targetWings;
    let targetWand;
    if (state === 'before') {
      targetWings = beforePaths;
      targetWand = interWand;
    } else if (state === 'intermediate') {
      targetWings = interPaths;
      targetWand = interWand;
    } else if (state === 'after') {
      targetWings = afterPaths;
      targetWand = afterWand;
    }

    leftWingIds.forEach((id) => {
      const el = O.$("#" + id);
      if (!el) return;
      const duration = id === "left_wing" ? durationBg : durationFg;
      el.style.transition = \`d \${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)\`;
      el.getBoundingClientRect(); // Force layout reflow
      if (targetWings[id]) {
        el.setAttribute("d", targetWings[id]);
      }
    });

    wandIds.forEach((id) => {
      const el = O.$("#" + id);
      if (!el) return;
      el.style.transition = \`d \${durationFg}ms cubic-bezier(0.2, 0.7, 0.2, 1)\`;
      el.getBoundingClientRect(); // Force layout reflow
      if (targetWand[id]) {
        el.setAttribute("d", targetWand[id]);
      }
    });
  };
})();
`;

fs.writeFileSync('local/animations/js/left-wing.js', js);
console.log('wrote js');
