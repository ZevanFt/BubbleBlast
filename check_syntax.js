const fs = require('fs');
const c = fs.readFileSync('G:/code/paopaotang/game.js', 'utf8');
try {
  new Function(c);
  console.log('game.js: SYNTAX OK');
} catch(e) {
  console.log('game.js: SYNTAX ERROR:', e.message);
  // Print line number if available
  const match = e.message.match(/line (\d+)/);
  if (match) console.log('Error at line:', match[1]);
}
