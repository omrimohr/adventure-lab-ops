// Test helpers: load the Apps Script .gs files in a vm (no npm deps) with stubs for Google services.
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const OLD_REF = process.env.OLD_REF || 'c5177f3'; // last commit before the pk-mapping work

function utilities() {
  const OFF = -5 * 3600000; // America/Cancun is UTC-5 all year
  const p2 = n => String(n).padStart(2, '0');
  return {
    DigestAlgorithm: { SHA_1: 'SHA_1' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha1').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    formatDate: (d, tz, pattern) => {
      const x = new Date(new Date(d).getTime() + OFF);
      const parts = { yyyy: x.getUTCFullYear(), MM: p2(x.getUTCMonth() + 1), dd: p2(x.getUTCDate()), HH: p2(x.getUTCHours()), mm: p2(x.getUTCMinutes()) };
      return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => parts[k]);
    }
  };
}

/** Runs the sources in one shared context (like the Apps Script project). Returns {ctx, ex (merged exports), get(name)} */
function loadGs(sources, extraGlobals) {
  const sandbox = Object.assign({ module: { exports: {} }, Utilities: utilities(), console: console, Date: Date, JSON: JSON, Math: Math, Number: Number, String: String, Object: Object, Array: Array }, extraGlobals || {});
  const ctx = vm.createContext(sandbox);
  const ex = {};
  sources.forEach(src => {
    sandbox.module.exports = {};
    vm.runInContext(src, ctx, { filename: 'gs' });
    Object.assign(ex, sandbox.module.exports);
  });
  return { ctx, ex, get: name => vm.runInContext(name, ctx) };
}
const read = f => fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8');
const gitShow = f => cp.execFileSync('git', ['show', OLD_REF + ':apps-script/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const loadNew = extra => loadGs([read('Code.gs'), read('app.gs')], extra);
const loadOld = () => loadGs([gitShow('Code.gs'), gitShow('app.gs')]);
// results from another realm → plain JSON (assert-friendly)
const J = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

// ---------- tiny test runner ----------
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
async function runAll() {
  let ok = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n       ')); }
  }
  console.log('\n' + ok + ' passed, ' + fail + ' failed');
  return fail;
}

// ---------- minimal in-memory Spreadsheet (just what Code.gs/app.gs use) ----------
function fakeSpreadsheet() {
  const sheets = {};
  const mk = name => {
    const d = { name, rows: [], frozen: 0 };
    const grow = (r, c) => { while (d.rows.length < r) d.rows.push([]); d.rows.forEach(x => { while (x.length < c) x.push(''); }); };
    const sh = {
      _d: d,
      getName: () => name,
      getLastRow: () => { let l = 0; d.rows.forEach((r, i) => { if (r.some(v => v !== '' && v !== null && v !== undefined)) l = i + 1; }); return l; },
      getLastColumn: () => Math.max(26, ...d.rows.map(r => r.length)),
      getMaxColumns: () => Math.max(26, ...d.rows.map(r => r.length)),
      insertColumnsAfter: () => {},
      setFrozenRows: n => { d.frozen = n; },
      appendRow: vals => { const r = sh.getLastRow() + 1; grow(r, vals.length); d.rows[r - 1] = vals.slice(); },
      insertRowBefore: () => {},
      getParent: () => ss,
      getRange: (r, c, nr, nc) => {
        nr = nr || 1; nc = nc || 1;
        const rng = {
          getValues: () => { grow(r + nr - 1, c + nc - 1); return d.rows.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }); },
          getDisplayValues: () => rng.getValues(),
          getValue: () => rng.getValues()[0][0],
          setValues: vals => { grow(r + vals.length - 1, c + (vals[0] || []).length - 1); vals.forEach((row, i) => row.forEach((v, j) => { d.rows[r - 1 + i][c - 1 + j] = v; })); return rng; },
          setValue: v => rng.setValues([[v]]),
          clearContent: () => { grow(r + nr - 1, c + nc - 1); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) d.rows[r - 1 + i][c - 1 + j] = ''; return rng; },
          setFontWeight: () => rng, setNumberFormat: () => rng,
          createTextFinder: txt => ({ matchEntireCell: () => ({ findNext: () => {
            for (let i = 0; i < nr; i++) if (String((d.rows[r - 1 + i] || [])[c - 1]) === String(txt)) return { getRow: () => r + i };
            return null; } }) })
        };
        return rng;
      },
      clear: () => { d.rows = []; }
    };
    return sh;
  };
  const ss = {
    _sheets: sheets,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => { sheets[n] = mk(n); return sheets[n]; },
    getSheets: () => Object.values(sheets)
  };
  return ss;
}
function fakeEnv(ss) {
  const props = {};
  let lockFree = true;
  return {
    props, setLockBusy: busy => { lockFree = !busy; },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => { let held = false; return {
      waitLock: () => { if (!lockFree) throw new Error('Lock timeout'); held = true; }, tryLock: () => { if (!lockFree) return false; held = true; return true; },
      hasLock: () => held, releaseLock: () => { held = false; } }; } },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'JSON' } },
    DriveApp: {}
  };
}

module.exports = { loadGs, loadNew, loadOld, J, test, runAll, fakeSpreadsheet, fakeEnv, OLD_REF };
