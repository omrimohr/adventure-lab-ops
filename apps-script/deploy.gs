/**
 * Self-update from GitHub (no clasp, no secrets).
 * Reads every file listed in apps-script/files.json from the public repo, and if anything changed since the
 * last deploy: replaces this project's code (Apps Script API), creates a new version and points the existing
 * web-app deployment at it (same URL, so the FareHarbor webhook and the app keep working).
 * Runs: after each push (GitHub Action calls  <exec URL>?deploy=1), every 10 min by trigger, or by hand.
 * Requires: "Google Apps Script API" ON in script.google.com/home/usersettings + the scopes in appsscript.json.
 */
const SELF = {
  raw: 'https://raw.githubusercontent.com/omrimohr/adventure-lab-ops/main/apps-script/',
  scriptId: '11zOKs3bVRAffBfRRq0htgFNd1a9kZM2FEGUM1stlqAdQAfNXh2Xt9fyV',
  deploymentId: 'AKfycbzUi-BEXRiNNShtlVSSc8tTMb9JZloofTHCJPougpu6h_f1HzQDF63wbjNXxf0nJI6ncQ'
};

function deployFromGitHub() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'ocupado';
  try {
    const bust = '?t=' + Date.now();
    const list = JSON.parse(fetchText_(SELF.raw + 'files.json' + bust));
    const files = list.map(name => {
      const src = fetchText_(SELF.raw + encodeURIComponent(name) + bust);
      const ext = name.split('.').pop().toLowerCase();
      const base = name.replace(/\.[^.]+$/, '');
      return { name: base, type: ext === 'json' ? 'JSON' : ext === 'html' ? 'HTML' : 'SERVER_JS', source: src };
    });
    // Safety: never publish something that would break the FareHarbor webhook
    const all = files.map(f => f.source).join('\n');
    if (!/function doPost\(/.test(all) || !/function deployFromGitHub\(/.test(all) || !files.some(f => f.type === 'JSON')) {
      throw new Error('Paquete incompleto en GitHub: no se publica');
    }
    const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(files)));
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('DEPLOYED_HASH') === hash) return 'al día';

    const api = 'https://script.googleapis.com/v1/projects/' + SELF.scriptId;
    call_('put', api + '/content', { files: files });
    const v = call_('post', api + '/versions', { description: 'GitHub ' + new Date().toISOString() });
    call_('put', api + '/deployments/' + SELF.deploymentId, {
      deploymentConfig: { scriptId: SELF.scriptId, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'GitHub v' + v.versionNumber }
    });
    props.setProperty('DEPLOYED_HASH', hash);
    logDeploy_('Publicada versión ' + v.versionNumber + ' (' + files.length + ' archivos)');
    return 'publicada v' + v.versionNumber;
  } catch (e) {
    logDeploy_('ERROR: ' + (e.message || e));
    return 'error: ' + (e.message || e);
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/** Run once by hand: adds the 10-minute check (safety net if the GitHub Action ping fails). */
function setupDeployTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'deployFromGitHub').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('deployFromGitHub').timeBased().everyMinutes(10).create();
  return deployFromGitHub();
}

function fetchText_(url) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
  if (r.getResponseCode() !== 200) throw new Error('GitHub ' + r.getResponseCode() + ' ' + url);
  return r.getContentText('UTF-8');
}
function call_(method, url, body) {
  const r = UrlFetchApp.fetch(url, {
    method: method, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  if (r.getResponseCode() >= 300) throw new Error('Apps Script API ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}
function logDeploy_(msg) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Despliegues');
    if (!sh) { sh = ss.insertSheet('Despliegues'); sh.appendRow(['Fecha', 'Resultado']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), msg]);
  } catch (e) {}
}
