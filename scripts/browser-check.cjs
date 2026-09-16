const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

// Test the built application with real browser audio, canvases and recording.
async function main() {
  const renderingSocialCard = process.argv.includes('--render-social');
  const root = path.resolve(__dirname, renderingSocialCard ? '..' : '../dist');
  const browserPath = process.env.STUDIO_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert(fs.existsSync(path.join(root, 'index.html')), 'Run npm run build first.');
  assert(fs.existsSync(browserPath), 'Set STUDIO_BROWSER to a Chromium browser executable.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notesketch-check-'));
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try { res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) && i < 150; i++) await new Promise(r => setTimeout(r, 100));
    assert(fs.existsSync(portFile), 'Browser did not start.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let seq = 0;
    const pending = new Map(), errors = [], missing = [];
    ws.addEventListener('message', ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) {
        const cb = pending.get(m.id); if (!cb) return;
        pending.delete(m.id); clearTimeout(cb.timer);
        m.error ? cb.reject(m.error) : cb.resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.description || a.value));
      if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith(origin) && m.params.response.status >= 400) missing.push(m.params.response.url);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const click = async id => { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); await settle(); };
    const waitForDownloads = async count => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`__downloadTasks.length >= ${count}`)) { await evaluate('Promise.all(__downloadTasks)'); return; }
        await wait(100);
      }
      throw new Error('Expected ' + count + ' generated downloads');
    };
    let checks = 0;
    const check = async (name, expression) => { assert(await evaluate(expression), name); checks++; console.log('PASS ' + name); };
    await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
    if (renderingSocialCard) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: origin + '/social-card.svg' });
      for (let i = 0; i < 100; i++) {
        if (await evaluate('document.documentElement.tagName === "svg" && document.readyState === "complete"')) break;
        await wait(100);
      }
      await evaluate('document.fonts.ready'); await settle();
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(root, 'social-card.png'), Buffer.from(screenshot.data, 'base64'));
      console.log('Rendered social-card.png (1200 × 630).');
      await send('Browser.close'); return;
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 864, deviceScaleFactor: 1.25, mobile: false });
    await send('Page.navigate', { url: origin + '/' });
    for (let i = 0; i < 100; i++) { if (await evaluate('!!document.getElementById("palette")?.children.length && typeof loadSharedPiece === "function"')) break; await wait(100); }
    await evaluate(`window.__clicked = new Set(); window.__downloads = []; window.__downloadTasks = [];
      document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) __clicked.add(b.id || b.getAttribute('aria-label') || b.textContent.trim()); }, true);
      HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return;
        const name = this.download, url = this.href;
        __downloadTasks.push(fetch(url).then(r => r.blob()).then(async blob => {
          const bytes = [...new Uint8Array(await blob.arrayBuffer())]; __downloads.push({ name, blob, bytes });
        }));
      };`);
    await check('Notesketch branding and semantic homepage', 'document.title.startsWith("Notesketch") && document.querySelectorAll("h1").length === 1 && document.querySelector("h1").textContent === "Notesketch" && document.querySelector("main.app") !== null');
    await check('Homepage metadata and absolute canonical URL', 'document.querySelector("meta[name=description]").content.length > 80 && document.querySelector("meta[name=robots]").content.includes("index, follow") && document.querySelectorAll("link[rel=canonical]").length === 1 && /^https?:/.test(document.querySelector("link[rel=canonical]").href)');
    await check('Social previews include a real PNG and alt text', `document.querySelector('meta[property="og:site_name"]').content === 'Notesketch' && document.querySelector('meta[property="og:image"]').content.endsWith('social-card.png') && document.querySelector('meta[property="og:image:alt"]').content.length > 20 && document.querySelector('meta[name="twitter:card"]').content === 'summary_large_image'`);
    await check('Structured data describes the real app without invented ratings', `(() => {const data=JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);const app=data['@graph'].find(e=>e['@type']==='WebApplication');const site=data['@graph'].find(e=>e['@type']==='WebSite');return app.name==='Notesketch'&&app.isAccessibleForFree&&site.name==='Notesketch'&&!app.aggregateRating&&!app.review})()`);
    await check('Canvas and interactive piano have accessible descriptions', 'cv.getAttribute("aria-label").includes("pitch") && keysCv.getAttribute("aria-label").includes("piano")');
    await check('Guide is crawlable without JavaScript and has descriptive image alt text', `(async () => {const html=await (await fetch('about.html')).text();const doc=new DOMParser().parseFromString(html,'text/html');return doc.querySelector('h1').textContent.includes('Draw music')&&doc.querySelectorAll('h2').length>=3&&doc.querySelector('img').alt.length>30&&doc.querySelector('img').hasAttribute('width')&&doc.querySelector('link[rel=canonical]').getAttribute('href').endsWith('about.html')&&doc.querySelectorAll('script:not([type="application/ld+json"])').length===0})()`);
    await check('Sitemap and robots allow both public pages', `(async () => {const text=await(await fetch('sitemap.xml')).text();const doc=new DOMParser().parseFromString(text,'application/xml');const urls=[...doc.getElementsByTagName('loc')].map(n=>n.textContent);const canonical=document.querySelector('link[rel=canonical]').href;const robots=await(await fetch('robots.txt')).text();return !doc.querySelector('parsererror')&&urls.includes(canonical)&&urls.includes(new URL('about.html',canonical).href)&&robots.includes('Allow: /')&&robots.includes('Sitemap: '+new URL('sitemap.xml',canonical).href)})()`);
    await check('PNG social artwork has correct dimensions', `(async () => {const image=await createImageBitmap(await(await fetch('social-card.png')).blob());return image.width===1200&&image.height===630})()`);
    await check('Install manifest uses Notesketch and valid icon paths', `(async () => {const url=document.querySelector('link[rel=manifest]').href;const manifest=await(await fetch(url)).json();return manifest.short_name==='Notesketch'&&(await Promise.all(manifest.icons.map(icon=>fetch(new URL(icon.src,url)).then(r=>r.ok)))).every(Boolean)})()`);
    await evaluate(`localStorage.setItem('untitled_saved_sketches',JSON.stringify([{name:'Legacy sketch',date:'test',bpm:120,data:{strokes:[]}}]))`);
    await check('Rename preserves older locally saved sketches', 'getSavedSketches()[0].name === "Legacy sketch"');
    await evaluate(`localStorage.removeItem('untitled_saved_sketches')`);
    await check('All static buttons have handlers', `Array.from(document.querySelectorAll('button[id]')).every(b => !!b.onclick)`);
    await check('Initial piano and Export Take are hidden', 'piano.hidden && !proswitch.classList.contains("on") && getComputedStyle(sharepill).display === "none"');
    await evaluate('playBtn.click(); playBtn.click(); ensureAudio()'); await settle();
    await check('Rapid Play/Pause clicks preserve the final request', '!playing && !requestedPlaying');
    await evaluate('$("keyBtn").dispatchEvent(new KeyboardEvent("keydown",{code:"Space",bubbles:true}))');
    await check('Space on a focused control does not toggle playback', '!playing');
    await click('fxBtn'); await check('FX rack opens', '!fxCard.hidden');
    await evaluate('fxVol.value = .6; fxVol.dispatchEvent(new Event("input")); fxTone.value = 4500; fxTone.dispatchEvent(new Event("input"))');
    await check('Volume and tone sliders update values', 'masterVolume === .6 && masterFilterFreq === 4500 && $("fxVolVal").textContent === "60%"');
    await click('muteBtn'); await check('Mute toggles on', 'isMuted'); await click('muteBtn');
    await click('waveSwitch'); await check('Waveform toggles off', '!showWaveform'); await click('waveSwitch'); await click('fxClose');
    await click('helpbtn'); await check('Guide opens', '!guideModal.hidden'); await click('guideClose');
    await click('helpbtn'); await click('guideOk'); await check('Guide buttons close modal', 'guideModal.hidden');
    await click('erase'); await check('Eraser activates', 'tool === "erase"'); await click('pen');
    await click('brushBtn'); await check('Brush changes stroke size', 'brushMode === "bold"'); await click('brushBtn'); await click('brushBtn');
    await click('snapBtn'); await check('Snap quantizes pointer coordinates', 'gridSnap && quantizeCoord(17, 20).x !== 17'); await click('snapBtn');
    for (let i = 0; i < 9; i++) { await evaluate(`pal.children[${i}].click()`); await check('Instrument ' + i, `selected === ${i} && pal.children[${i}].classList.contains('on')`); }
    await click('modeMin'); await check('Minor scale applies', 'scaleName === "minor"'); await click('modeMaj');
    for (let i = 0; i < 6; i++) {
      await click('scaleMenuBtn'); await evaluate(`scaleGrid.children[${i}].click()`);
      await check('Scale menu option ' + i, `scaleName === Object.keys(SCALES)[${i}] && scaleCard.hidden`);
    }
    await click('scaleMenuBtn'); await click('scaleClose');
    await click('ticks'); await check('Note subdivision updates', 'perBeat === 4 && STEPS === 64'); await click('ticks'); await click('ticks');
    for (let i = 1; i <= 3; i++) { await click('p' + i); await check('Program ' + i, `program === ${i} && wrap.classList.contains('stage-on') === ${i === 3}`); }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false }); await settle();
    await check('Stage survives window resize', 'program === 3');
    await check('All production Stage images load', 'Array.from(stageEl.querySelectorAll("img")).every(i => i.complete && i.naturalWidth > 0)'); await click('p1');
    await click('p3'); await click('pngBtn'); await waitForDownloads(1);
    await check('Stage PNG includes visualizer artwork', `(() => {const p=ctx.getImageData(Math.floor(W*dpr*.2),Math.floor(H*dpr*.2),1,1).data;return __downloads.some(d=>d.name.endsWith('.png')) && (p[0]!==255 || p[1]!==254 || p[2]!==251)})()`); await click('p1');
    for (let i = 1; i <= 3; i++) { await click('b' + i); await check('Beat ' + i, `!!(beats & ${1 << (i - 1)})`); await click('b' + i); }
    await evaluate('bpmIn.value = 999; commitBpm()'); await check('BPM upper limit', 'bpmIn.value === "200" && +$("speed").value === 200');
    await evaluate('bpmIn.value = 1; commitBpm()'); await check('BPM lower limit', 'bpmIn.value === "60"');
    await evaluate('bpmIn.value = 120; commitBpm()');
    await click('sky'); await check('Background menu opens', '!bgcard.hidden'); await click('tileAurora');
    await check('Aurora preserves recording controls', 'document.body.classList.contains("aurora") && document.body.classList.contains("can-record")');
    await click('sky'); await click('tilePaper'); await check('Paper preserves recording controls', '!document.body.classList.contains("aurora") && document.body.classList.contains("can-record")');
    await evaluate(`window.__fileOpened = false; $('bgfile').click = () => { __fileOpened = true; }`); await click('sky'); await click('tilePlus');
    await check('Upload button opens file picker', '__fileOpened');
    await evaluate(`(async () => {const image = new File([await (await fetch('icon-192.png')).blob()], 'background.png', {type:'image/png'}); const transfer = new DataTransfer(); transfer.items.add(image); $('bgfile').files = transfer.files; $('bgfile').onchange()})()`);
    await check('Photo upload applies background without removing controls', 'document.body.classList.contains("photo") && document.body.classList.contains("can-record") && !!photoURL');
    await click('sky'); await click('tilePaper');
    await evaluate(`loadPieceData({ bpm: 120, beats: 0, scaleName: 'pentatonic', keyOffset: 0, program: 1, bars: 2, strokes: [] }, false)`);
    const rect = await evaluate('(() => {const r=cv.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + rect.w * .15, y: rect.y + rect.h * .5, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.w * .85, y: rect.y + rect.h * .5, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + rect.w * .85, y: rect.y + rect.h * .5, button: 'left', clickCount: 1 });
    await check('Drawing creates a sound trace', 'strokes.length === 1 && strokes[0].pts.length > 1');
    await evaluate('ensureAudio()'); await click('play'); await wait(1600);
    await check('Real audio initializes and produces finite sound', '(() => {const b=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(b);return kernelReady && AC.state === "running" && playing && b.every(Number.isFinite) && b.some(x=>Math.abs(x)>1e-6)})()');
    await click('play'); await check('Playback pauses', '!playing');
    await click('proswitch'); await click('lockBtn'); await check('Freestyle button allows every note', 'freestyle && lockBtn.getAttribute("aria-pressed") === "true"');
    await check('Piano displays saturated instrument markers', `(() => {const r=keysCv.getBoundingClientRect(), d=Math.min(devicePixelRatio,2);const p=kctx.getImageData(Math.floor(r.width/visibleWhites()/2*d),Math.floor((r.height-4)*d),1,1).data;const c=COLORS[selected].hex;return p[0]===parseInt(c.slice(1,3),16)&&p[1]===parseInt(c.slice(3,5),16)&&p[2]===parseInt(c.slice(5,7),16)&&p[3]===255})()`);
    await evaluate('noteDown(99, 49)'); await wait(60);
    await check('Piano key produces real sound and selected color', 'held.has(99) && held.get(99).color === selected');
    await evaluate('pushGrid()'); await wait(60);
    await check('Drawing updates preserve held piano notes', 'buildGrid().inUse[held.get(99).slot] === 1');
    await evaluate('noteUp(99)'); await wait(300); await check('Piano releases notes', 'held.size === 0 && pendingPianoNotes.size === 0');
    await check('Quick key release cancels pending audio initialization', `(async () => {const original=ensureAudio, count=freeSlots.length;let finish;try{ensureAudio=()=>new Promise(r=>finish=r);const pending=noteDown(101,48);noteUp(101);finish();await pending;return !held.has(101)&&freeSlots.length===count}finally{ensureAudio=original}})()`);
    await click('lockBtn'); await click('keyBtn'); await evaluate('noteDown(88, 49)');
    await check('Key Filter adds custom pitches', 'keyMode && customSet.includes(1)'); await evaluate('noteDown(88, 49)');
    await check('Key Filter removes custom pitches', '!customSet.includes(1)'); await click('keyBtn');
    await click('freeBtn'); await check('Continuous pitch button changes mapping', 'freehand && STEPS === 128'); await click('freeBtn');
    await click('modeMaj'); await click('proswitch');
    await click('projectBtn'); await check('Project menu opens', '!projectCard.hidden'); await click('projectClose');
    for (let i = 0; i < PRESET_COUNT; i++) {
      await click('projectBtn'); await evaluate(`presetList.children[${i}].querySelector('button').click()`);
      await check('Preset load ' + i, `strokes.length === PRESETS[${i}].strokes.length && scaleName === PRESETS[${i}].scaleName`);
    }
    await evaluate('(async () => {await setPlaying(false); customSet = [0,1,7]; freehand = true; perBeat = 4; STEPS = 128; strokes[0].pts[20].brk=true; rebuildScale(); pushGrid(); window.__saved = pieceData()})()');
    await click('projectBtn'); await evaluate('$("saveName").value = "<b>Test sketch</b>"'); await click('saveBtn');
    await check('Save retains all musical settings and safe names', 'getSavedSketches()[0].data.freehand && getSavedSketches()[0].data.perBeat === 4 && getSavedSketches()[0].data.customSet.length === 3 && !savedList.querySelector("b")');
    await click('clear'); await evaluate('savedList.querySelector(".load-btn").click()');
    await check('Saved sketch loads every setting', 'JSON.stringify(pieceData()) === JSON.stringify(__saved)');
    await click('projectBtn'); await evaluate('savedList.querySelector(".del-btn").click()'); await check('Delete removes saved sketch', 'getSavedSketches().length === 0'); await click('projectClose');
    await evaluate('(async () => {window.__shareHash = await packPiece(); clearStrokes(); location.hash = "p=" + __shareHash})()'); await settle();
    await check('Shared link restores full composition', 'JSON.stringify(pieceData()) === JSON.stringify(__saved)');
    await evaluate('window.__copied = ""; Object.defineProperty(navigator, "clipboard", { configurable:true, value:{writeText:async text=>{__copied=text}} })'); await click('sharelink');
    await check('Share button copies a usable link', '__copied.includes("#p=u")');
    await evaluate('location.hash = "p=broken"'); await settle(); await check('Malformed link shows feedback and preserves composition', '$("appStatus").textContent.includes("invalid") && strokes.length > 0');
    await evaluate('history.replaceState(null,"",location.pathname); setPlaying(false)');
    await click('wavBtn'); await click('midiBtn'); await click('pngBtn'); await waitForDownloads(4);
    await check('WAV export contains non-silent audio', `(() => { const a=__downloads.find(d=>d.name.endsWith('.wav')); if(!a || String.fromCharCode(...a.bytes.slice(0,4))!=='RIFF')return false; const v=new DataView(new Uint8Array(a.bytes).buffer); for(let i=44;i<v.byteLength;i+=2)if(v.getInt16(i,true)!==0)return true;return false })()`);
    await check('MIDI export has a valid file header', `(() => {const a=__downloads.find(d=>d.name.endsWith('.mid'));return !!a && String.fromCharCode(...a.bytes.slice(0,4))==='MThd'})()`);
    await check('PNG export decodes as an image', `(async () => {const a=__downloads.filter(d=>d.name.endsWith('.png')).at(-1);const image=await createImageBitmap(a.blob);return image.width===cv.width && image.height===cv.height})()`);
    await evaluate('recpill.click(); recpill.click()'); await wait(700); await check('Record Take starts once on rapid clicks, with video and audio', 'isRecording && mediaRecorder.state === "recording" && mediaRecorder.stream.getVideoTracks().length === 1 && mediaRecorder.stream.getAudioTracks().length === 1');
    await click('recpill');
    for (let i = 0; i < 100; i++) { if (await evaluate('!!lastTakeBlob && !recpill.disabled')) break; await wait(100); }
    await check('Recording stops and offers a nonempty take', '!!lastTakeBlob && lastTakeBlob.size > 100 && !isRecording && !sharepill.hidden && mediaRecorder.stream.getVideoTracks().every(t=>t.readyState === "ended")');
    await check('Recorded video decodes with valid dimensions', `new Promise((resolve,reject)=>{const video=document.createElement('video'),url=URL.createObjectURL(lastTakeBlob);const timeout=setTimeout(()=>{URL.revokeObjectURL(url);reject(new Error('Video decode timeout'))},10000);video.onloadedmetadata=()=>{clearTimeout(timeout);URL.revokeObjectURL(url);resolve(video.videoWidth>0&&video.videoHeight>0)};video.onerror=()=>{clearTimeout(timeout);URL.revokeObjectURL(url);reject(new Error('Video decode failed'))};video.src=url})`);
    await click('sharepill'); await evaluate('Promise.all(__downloadTasks)');
    await check('Export Take downloads recorded video', '__downloads.filter(d=>d.name.endsWith(".mp4") || d.name.endsWith(".webm")).length >= 2');
    await click('play');
    await evaluate('pointerDown(W*.1,H*.2);pointerMove(W*.4,H*.2);pointerUp()'); const count = await evaluate('strokes.length');
    await click('undo'); await check('Undo removes last stroke', `strokes.length === ${count - 1}`);
    await click('erase'); await evaluate('erase(strokes[0].pts[0].x,strokes[0].pts[0].y)'); await click('pen');
    await click('clear'); await check('Clear removes strokes and frees slots', 'strokes.length === 0 && new Set(freeSlots).size === freeSlots.length');
    await click('wavBtn'); await click('midiBtn'); await click('sharelink'); await check('Empty actions explain what is needed', '!$("appStatus").hidden');
    await click('shuffle'); await evaluate('new Promise(r=>setTimeout(r,100))'); await check('Shuffle composes and plays', 'strokes.length > 0 && playing'); await click('play');
    for (const [width, height, scale] of [[1920,1080,1], [1280,720,1.25], [768,600,2], [375,812,2], [320,568,1]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }); await settle();
      for (const pianoOpen of [true, false]) {
        await evaluate(`if (piano.hidden === ${pianoOpen}) proswitch.click()`); await settle();
        await check(`Responsive layout ${width}x${height}, piano ${pianoOpen}`, `document.documentElement.scrollWidth <= innerWidth && cv.width === Math.round(W*dpr) && ${width < 760 ? 'H >= 298' : 'H > 100 && document.querySelector(".bar").getBoundingClientRect().bottom <= innerHeight'}`);
        await click('fxBtn'); await check('Popover stays inside viewport', '(()=>{const r=fxCard.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()'); await click('fxClose');
      }
    }
    await click('helpbtn'); await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))'); await check('Escape closes dialogs', 'guideModal.hidden');
    const unclicked = await evaluate('Array.from(document.querySelectorAll("button[id]")).filter(b=>!__clicked.has(b.id)).map(b=>b.id)');
    assert.deepEqual(unclicked, [], 'Buttons not exercised'); assert.deepEqual(missing, [], 'Missing production assets'); assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log(`PASS ${checks} checks; every static button exercised; no missing assets or runtime errors.`);
    await send('Browser.close');
    await new Promise(r => { if (browser.exitCode !== null) r(); else browser.once('exit', r); });
  } finally { if(ws)ws.close(); browser.kill(); server.close(); }
}
const PRESET_COUNT = 5;
main().catch(error => { console.error(error); process.exitCode = 1; });
