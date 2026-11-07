// Record the real local player with the original sample library only.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {connectBrowser} from './browser-cdp.mjs';

const work=path.resolve(process.argv[2] || 'dist/demo-work');
const c=await connectBrowser(Number(process.env.PACESHELF_DEMO_CDP_PORT || 9231));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const frames=[];
const cues=[];
let recording=false, capture, start;
await mkdir(path.join(work,'frames'),{recursive:true});

async function safe() {
  const ok=await c.evaluate(`(async()=>{
    const s=await(await fetch('./api/status')).json();
    const courses=await(await fetch('./api/courses')).json();
    return s.root===${JSON.stringify(path.join(work,'Demo Library'))}
      && courses.length===3
      && courses.every(x=>['Everyday Astronomy','Photography Foundations','Sketching Essentials'].includes(x.name))
      && !document.body.innerText.includes('/home/') && !document.body.innerText.includes('/Users/');
  })()`);
  if(!ok)throw Error('The recording target is not the isolated, synthetic demonstration library.');
}
async function click(selector) {
  const point=await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing demonstration control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await c.evaluate(`(()=>{const p=document.querySelector('#demo-pointer');if(p){p.style.left=${point.x}+'px';p.style.top=${point.y}+'px';p.style.opacity='1'}})()`);
  await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await sleep(220);
  await c.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await sleep(350);
}
async function screenshot(name,fullPage=false) {
  await safe();
  const params={format:'png'};
  if(fullPage){const m=await c.call('Page.getLayoutMetrics');params.captureBeyondViewport=true;params.clip={x:0,y:0,width:m.cssContentSize.width,height:m.cssContentSize.height,scale:1};}
  const r=await c.call('Page.captureScreenshot',params);
  await writeFile(path.join(work,name),Buffer.from(r.data,'base64'));
}
function cue(title,detail) {
  const t=(performance.now()-start)/1000;
  if(cues.length)cues.at(-1).end=t;
  cues.push({start:t,title,detail});
}

try {
  await c.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await c.until('document.querySelectorAll(".course-card").length===3');
  await safe();
  // Prepare an example saved position through the application's own controls.
  await c.evaluate(`Array.from(document.querySelectorAll('.course-card')).find(x=>x.innerText.includes('Photography Foundations')).click()`);
  await c.until('document.querySelector("#video").readyState>=2');
  await c.evaluate('document.querySelector("#video").currentTime=14;window.coursePlayerPause()');
  await click('#complete-btn');
  await c.until('document.querySelector("#complete-btn").getAttribute("aria-pressed")==="true"');
  await click('#edit-collection-btn');
  await c.evaluate('document.querySelector("#collection-favorite").checked=true;document.querySelector("#collection-form").requestSubmit()');
  await c.until('!document.querySelector("#collection-sheet").open');
  await click('#next-btn');
  await c.until('document.querySelector("#video").readyState>=2');
  await c.evaluate('document.querySelector("#video").currentTime=18;window.coursePlayerPause()');
  await click('#back-btn');
  await c.until('!document.querySelector("#continue-section").classList.contains("hidden")');
  await sleep(800);
  await screenshot('library-desktop.png',true);
  await c.evaluate(`(()=>{const p=document.createElement('div');p.id='demo-pointer';p.style.cssText='position:fixed;width:20px;height:20px;border:2px solid #536b82;background:#d8e2ec88;border-radius:50%;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);opacity:0';document.body.append(p)})()`);
  start=performance.now();recording=true;
  capture=(async()=>{
    while(recording){
      const before=performance.now();
      const r=await c.call('Page.captureScreenshot',{format:'jpeg',quality:92});
      const name=String(frames.length).padStart(5,'0')+'.jpg';
      await writeFile(path.join(work,'frames',name),Buffer.from(r.data,'base64'));
      frames.push({file:name,time:(before-start)/1000});
      await sleep(Math.max(0,100-(performance.now()-before)));
    }
  })();
  cue('Your own videos. Your learning library.','Browse collections, favorites and saved progress. No account required.');
  await sleep(4500);
  cue('Pick up where you left off.','Continue learning opens the lesson at its saved position.');
  await click('.continue-card');
  await c.until('document.querySelector("#video").readyState>=2 && document.querySelector("#video").currentTime>=18');
  await sleep(4000);
  cue('Set a comfortable playback speed.','Choose 1.5×, or another speed that suits your pace.');
  await click('#speed-btn');await sleep(1800);
  await click('[data-speed="1.5"]');await sleep(2800);
  cue('Bookmark a moment worth revisiting.','Each bookmark keeps its lesson and timestamp.');
  await click('#bookmark-btn');
  await c.until('document.querySelectorAll(".bookmark-row").length===1');
  await c.evaluate('document.querySelector(".bookmark-panel").open=true');
  await sleep(4000);
  await click('#dismiss-notice');
  cue('Track completion separately from playback.','Mark a lesson complete, with undo if you change your mind.');
  await click('#complete-btn');await sleep(2200);
  await click('#undo-completion');await sleep(2000);
  cue('Pause now. Come back later.','Your collection keeps its completion count and a Continue learning shortcut.');
  await c.evaluate('window.coursePlayerPause()');
  await click('#back-btn');await sleep(4500);
  cue('Choose where progress is saved.','On this device keeps history local to this installation.');
  await click('#menu-btn');
  await c.evaluate('document.querySelector("#storage-mode").value="device";document.querySelector("#storage-mode").dispatchEvent(new Event("change"))');
  await c.until('(async()=>{const s=await(await fetch("./api/status")).json();return s.mode==="device"})()');
  await safe();await sleep(4500);
  cue('Take progress with the same drive.','Portable library writes beside your videos. Verify saves, then unmount before unplugging.');
  await c.evaluate('document.querySelector("#storage-mode").value="portable";document.querySelector("#storage-mode").dispatchEvent(new Event("change"))');
  await c.until('(async()=>{const s=await(await fetch("./api/status")).json();return s.mode==="portable"&&s.shared})()');
  await safe();await sleep(5500);
  await click('#options [data-close-sheet]');
  await click('#dismiss-notice');
  cue('Start with a folder of your own videos.','PaceShelf · Android and Ubuntu · Free, open source development preview.');
  await sleep(4200);
  recording=false;await capture;
  cues.at(-1).end=(performance.now()-start)/1000;
  await c.evaluate('document.querySelector("#demo-pointer").remove()');
  await screenshot('library-desktop.png',true);
  await click('.continue-card');await c.until('document.querySelector("#video").readyState>=2');
  await c.evaluate('window.coursePlayerPause()');await sleep(500);
  await screenshot('player-desktop.png');
  await c.evaluate('document.querySelector(".bookmark-panel").open=false');
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(700);await screenshot('player-phone.png');
  await c.call('Emulation.setDeviceMetricsOverride',{width:800,height:1100,deviceScaleFactor:1,mobile:true});
  await sleep(700);await screenshot('player-tablet.png');
  await writeFile(path.join(work,'timeline.json'),JSON.stringify({
    format:1,source:'Real PaceShelf 0.1.0 Ubuntu browser UI; original fictional lessons',
    width:1280,height:800,frames,cues,audio:'Intentionally silent; explanatory text is authored, not a speech transcript.'
  },null,2)+'\n');
  console.log('Recorded '+cues.at(-1).end.toFixed(1)+' seconds of the synthetic library, plus desktop and responsive screenshots.');
} finally {
  recording=false;
  if(capture)await capture;
  c.close();
}
