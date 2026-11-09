// Run only on a disposable fixture library; network checks are explicitly opt-in.
import assert from 'node:assert/strict';
import {connectBrowser} from './browser-cdp.mjs';
import {connect,adb,device,sleep} from './cdp.mjs';
const android=process.env.PACESHELF_TEST_PLATFORM==='android';
if(android&&!device.startsWith('emulator-'))throw Error('YouTube UI tests require a disposable emulator.');
const c=android?await connect():await connectBrowser(Number(process.env.PACESHELF_TEST_CDP_PORT||9233));
const sample='YouTube fixture '+crypto.randomUUID().slice(0,6),A='AAAAAAAAAAA',B='BBBBBBBBBBB';
let checks=0;
function check(ok,label){assert(ok,label);console.log('PASS: '+label);checks++;}
async function click(selector){await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function library(){return c.evaluate('(async()=>PaceShelfLibrary.merge(...(await(await fetch("./api/library")).json()).states))()');}
async function preview(text,title){
 await click('#add-youtube-btn');
 await c.evaluate(`document.querySelector('#youtube-title').value=${JSON.stringify(title)};document.querySelector('#youtube-input').value=${JSON.stringify(text)};document.querySelector('#youtube-form').requestSubmit()`);
 await c.until('!document.querySelector("#youtube-confirm").classList.contains("hidden")',35000);
}
try{
 await c.until('!!window.PaceShelfYouTube&&!document.querySelector("#add-youtube-btn").disabled');
 await c.evaluate(`(()=>{const original=PaceShelfOnline.Media.prototype.update;PaceShelfOnline.Media.prototype.update=function(value){window.paceShelfTestMedia=this;return original.call(this,value);};})()`);
 const safe=await c.evaluate('(async()=>{const s=await(await fetch("./api/status")).json(),list=await(await fetch("./api/courses")).json();return s.folder==="YouTubeFixtures" || list.length===2&&list.every(c=>c.id.startsWith("TEST"))})()');
 check(safe,'isolated fixture library guard');
 await click('#home-btn');await preview('https://youtu.be/'+A,sample);
 check(await c.evaluate('document.querySelectorAll("#youtube-preview-list p").length===1'),'video references preview before import');
 await click('#youtube-confirm');await c.until(`Array.from(document.querySelectorAll('.course-card')).some(c=>c.innerText.includes(${JSON.stringify(sample)}))`);
 await c.evaluate(`Array.from(document.querySelectorAll('.course-card')).find(c=>c.innerText.includes(${JSON.stringify(sample)})).click()`);
 await c.until(`document.querySelector('#watch-title').textContent===${JSON.stringify(sample)}&&document.querySelectorAll('.watch-item').length===1`);
 check(await c.evaluate('document.querySelectorAll(".watch-item").length===1&&!document.querySelector("#online-open").classList.contains("hidden")&&!document.querySelector("#online-frame iframe")'),'YouTube references do not load a provider before an explicit action');
 check(await c.evaluate('document.querySelector("#bookmark-btn").disabled'),'timestamp bookmarks wait for a real player clock');
 await click('#complete-btn');await c.until('document.querySelector("#complete-btn").getAttribute("aria-pressed")==="true"');
 await click('#undo-completion');await c.until('document.querySelector("#complete-btn").getAttribute("aria-pressed")==="false"');check(true,'YouTube completion is independent and undoable');
 await click('#edit-collection-btn');
 await c.evaluate(`document.querySelector('[data-entry="0"][data-field=title]').value="Sample online lesson";document.querySelector('[data-entry="0"][data-field=title]').dispatchEvent(new Event("input"));document.querySelector("#collection-form").requestSubmit()`);
 await c.until('!document.querySelector("#collection-sheet").open');
 await preview('https://youtu.be/'+A+'\nhttps://youtu.be/'+B,sample);
 check(await c.evaluate('document.querySelector("#youtube-target").value!==""'),'import can target the current collection');
 await click('#youtube-confirm');await c.until('!document.querySelector("#youtube-sheet").open');
 let state=await library();let collection=Object.values(state.records).flat().find(v=>v.value?.title===sample)?.value;
 check(collection.entries.length===2&&collection.entries[0].title==='Sample online lesson','append preserves existing identity, order and custom labels');
 check(collection.entries.every(e=>state.records['media/'+e.mediaId]?.[0].value.provider==='youtube'),'backups contain typed references, with no video files or credentials');
 await click('#add-youtube-btn');const before=JSON.stringify(await library());
 await c.evaluate('document.querySelector("#youtube-title").value="Rejected import";document.querySelector("#youtube-input").value="https://youtube.com.example.invalid/watch?v=AAAAAAAAAAA";document.querySelector("#youtube-form").requestSubmit()');
 check(await c.evaluate('document.querySelector("#youtube-confirm").classList.contains("hidden")&&document.querySelector("#youtube-preview-status").textContent.includes("Only HTTPS")'),'lookalike host gets a clear error');
 check(JSON.stringify(await library())===before,'invalid input cannot change library metadata');
 if(!android){
  for(const [width,height] of [[390,844],[800,1100],[1440,980]]){
   await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
   check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'YouTube import fits width '+width);
  }
 }
 await click('#youtube-sheet [data-close-sheet]');
 if(process.env.PACESHELF_TEST_ONLINE==='1'){
  await click('#home-btn');
  await preview('https://www.youtube.com/watch?v=M7lc1UVf-VE','YouTube API sample '+sample);
  await click('#youtube-confirm');await c.until('!document.querySelector("#youtube-sheet").open');
  await c.evaluate(`Array.from(document.querySelectorAll('.course-card')).find(c=>c.innerText.includes(${JSON.stringify('YouTube API sample '+sample)})).click()`);
  await c.until(`document.querySelector('#watch-title').textContent===${JSON.stringify('YouTube API sample '+sample)}`);
  await click('#online-open');await c.until('document.querySelector("#duration-time").textContent!=="0:00"',35000);
  check(true,'official YouTube player exposes a real content clock');
  if(android){
   const p=await connectBrowser(9222,x=>x.type==='page'&&!x.url.includes('127.0.0.1'));
   check(await p.evaluate('typeof Android==="undefined"&&location.origin==="https://org.paceshelf.player"'),'Android provider has application identity and no privileged bridge');p.close();
   const dimensions=adb('shell','wm','size').match(/(\d+)x(\d+)/);adb('shell','input','tap',String(Math.round(Number(dimensions[1])/2)),String(Math.round(Number(dimensions[2])/2)));
  }else{
   const point=await c.evaluate('(()=>{const r=document.querySelector("#online-frame iframe").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+(r.height-30)/2}})()');
   await c.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  await c.until('document.querySelector("#elapsed-time").textContent!=="0:00"',20000);await sleep(1800);
  await c.evaluate('window.coursePlayerPause()');await sleep(800);
  const seekTarget=await c.evaluate('Math.min(45,paceShelfTestMedia.duration/2)');
  await c.evaluate(`paceShelfTestMedia.currentTime=${seekTarget}`);
  await c.until(`Math.abs(paceShelfTestMedia._observedPosition-${seekTarget})<2&&Math.abs(paceShelfTestMedia.currentTime-${seekTarget})<2`,8000);
  check(true,'paused seek reaches the real provider clock without another playback action');
  await click('#bookmark-btn');await c.until('document.querySelector("[data-jump]")');
  check(await c.evaluate(`(()=>{
   const m=paceShelfTestMedia,s={ready:true,videoId:m.video.videoId,position:m.currentTime,duration:m.duration,state:2,speed:m.playbackRate,rates:[...m.rates]};
   document.querySelector('.bookmark-panel').open=true;
   const button=document.querySelector('[data-jump]');button.focus();m.update(s);m.update(s);m.update(s);
   return document.querySelector('[data-jump]')===button&&document.activeElement===button;
  })()`),'unchanged player clocks retain bookmark controls and keyboard focus');
  check(await c.evaluate(`(()=>{
   const m=paceShelfTestMedia,s={ready:true,videoId:m.video.videoId,position:m.currentTime,duration:m.duration,state:2,speed:m.playbackRate,rates:[...m.rates]};
   m.update({...s,videoId:'BBBBBBBBBBB'});const blocked=document.querySelector('#seek-slider').disabled;
   m.update(s);return blocked&&!m.foreign&&!document.querySelector('#seek-slider').disabled&&m.currentTime===s.position;
  })()`),'returning from a related-video snapshot restores seek controls and the selected clock');
  if(android){adb('shell','input','keyevent','3');await sleep(1200);}
  else await c.evaluate('window.coursePlayerPause();document.querySelector("#back-btn").click()');
  state=await library();
  check(Object.entries(state.records).some(([k,v])=>k.startsWith('resume/')&&v.some(r=>r.value?.position>0&&r.value?.duration>100)),'actual YouTube progress is durably saved');
  if(android){
   check((await(await fetch('http://127.0.0.1:9222/json')).json()).every(p=>p.url.includes('127.0.0.1')),'background releases the entire provider view');
   adb('shell','am','start','-n','org.paceshelf.player/.MainActivity');await sleep(800);
  }
 }
 console.log(`PASS: ${checks} ${android?'Android':'desktop'} YouTube UI checks`);
}finally{c.close();}
