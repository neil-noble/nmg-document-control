// Builds docs/index.html: colleague's Document Control System page, claude.ai runtime stripped,
// saving re-pointed at Firebase, then gzip + AES-256-GCM encrypted behind the team password.
// Usage: node tools/build.js   (reads private/source/..., private/team-code.txt, private/firebase-config.json)
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'private', 'source', 'Document Control System_files', 'saved_resource.html');
const PW = fs.readFileSync(path.join(ROOT, 'private', 'team-code.txt'), 'utf8').trim();
const FB = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'firebase-config.json'), 'utf8'));
const EMAIL = 'doccontrol@nmg-hygiene-planner.web.app';
const FBV = '10.14.1';

let s = fs.readFileSync(SRC, 'utf8');
// 1. Author's page = everything inside <body>, minus browser-extension junk.
let body = s.slice(s.indexOf('>', s.indexOf('<body')) + 1, s.lastIndexOf('</body>'));
body = body.replace(/<link rel="stylesheet" href="\.\/css2">/, '');
if (/frame-runtime|__FRAME_PREAMBLE/.test(body)) throw new Error('runtime leaked into body');

// 2. Wording that only made sense on claude.ai.
const swaps = [
  ['Real reviews can only be saved when the page is opened on claude.ai.', 'Saved reviews could not be loaded. Reload the page and enter the team password again.'],
  ["Answers can't be saved in this view. Open the page on claude.ai to save them.", "Answers can't be saved right now. Reload the page and enter the team password again."],
  ['Not saved: open on claude.ai.', 'Not saved: reload and enter the team password.'],
  ['Saved on this page only (open the page on claude.ai to save it).', 'Saved on this page only (reload and enter the team password to save it).'],
  ['Downloads are not available in this view. Open the page on claude.ai in a browser.', 'The download could not start. Try again in Chrome or Edge.'],
];
// Wix page already shows the NMG logo above the embed (Neil 2026-11-12): drop the hero logo.
const nLogo = (body.match(/<div class="hm-logo"><img [^>]*><\/div>\s*/g) || []).length;
if (nLogo !== 1) throw new Error('expected 1 hero logo, found ' + nLogo);
body = body.replace(/<div class="hm-logo"><img [^>]*><\/div>\s*/, '');
for (const [a, b] of swaps) { if (!body.includes(a)) console.warn('wording not found:', a); body = body.split(a).join(b); }

// 3. Shim: window.claude.use(...) backed by Firebase (db, user) and a plain browser download.
const shim = `<script>
(function(){
 var PW=window.__DCK||"";try{delete window.__DCK}catch(e){window.__DCK=undefined}
 var ready=Promise.resolve(false),root=null;
 try{
  if(!window.firebase)throw new Error("Firebase SDK not loaded");
  firebase.initializeApp(${JSON.stringify(FB)});
  var fs=firebase.firestore();fs.settings({ignoreUndefinedProperties:true,merge:true});
  root=fs.doc("apps/doccontrol");
  var auth=firebase.auth();
  ready=auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
   .then(function(){return auth.signInWithEmailAndPassword(${JSON.stringify(EMAIL)},PW)})
   .then(function(){return true},function(e){console.warn("sign-in failed",e&&e.code);return false});
 }catch(e){console.warn("firebase unavailable",e)}
 function save(o){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([o.data]));a.download=o.filename;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},4000)}
 window.claude={use:function(name){
  if(name==="db")return ready.then(function(ok){return ok?root:null});
  if(name==="user")return ready.then(function(ok){return{isOwner:function(){return ok},canEdit:function(){return Promise.resolve(ok)}}});
  if(name==="downloads")return Promise.resolve({save:function(o){save(o);return Promise.resolve()}});
  return Promise.resolve(null);
 }};
})();
</script>`;

const fonts = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Sans+3:wght@400;600;700&display=swap';
const inner = `<!DOCTYPE html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>:root{box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
${shim}
</head><body>${body}</body></html>`;
fs.writeFileSync(path.join(ROOT, 'private', 'plain.html'), inner); // local preview only (gitignored)

// 4. Encrypt: gzip -> AES-256-GCM, key = PBKDF2-SHA256(password, salt, 310000).
const ITER = 310000, salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(PW, salt, ITER, 32, 'sha256');
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(inner, 'utf8'), { level: 9 })), c.final(), c.getAuthTag()]);
const payload = { v: 1, it: ITER, s: salt.toString('base64'), i: iv.toString('base64'), d: ct.toString('base64') };

const sdk = ['app', 'auth', 'firestore'].map(m => `<script src="https://www.gstatic.com/firebasejs/${FBV}/firebase-${m}-compat.js"></script>`).join('\n');
const loader = fs.readFileSync(path.join(__dirname, 'loader.html'), 'utf8')
  .replace('<!--FIREBASE-->', sdk)
  .replace('/*PAYLOAD*/null', JSON.stringify(payload));
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), loader);
console.log('plain', inner.length, 'bytes; encrypted page', loader.length, 'bytes');
