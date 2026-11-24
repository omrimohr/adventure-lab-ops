// node tests/run.js — no dependencies. Equivalence tests need git history (OLD_REF, default c5177f3).
const fs = require('fs'), path = require('path');
const { runAll } = require('./lib');
fs.readdirSync(__dirname).filter(f => /\.test\.js$/.test(f)).sort().forEach(f => { console.log(f); require(path.join(__dirname, f)); });
runAll().then(fail => process.exit(fail ? 1 : 0));
