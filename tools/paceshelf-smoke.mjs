import assert from 'node:assert/strict';
import {connectBrowser} from './browser-cdp.mjs';
import {connect,adb,sleep} from './cdp.mjs';
const android=process.env.PACESHELF_TEST_PLATFORM==='android';
const c=android?await connect():await connectBrowser(Number(process.env.PACESHELF_TEST_CDP_PORT || 9224));
let count=0;
function check(ok,label){assert(ok,label);count++;console.log('PASS: '+label);}
try{
 await c.until('document.querySelectorAll(".course-card").length>=2');
 check(await c.evaluate('(async()=>{const courses=await(await fetch("./api/courses")).json();return courses.length===2 && courses.every(c=>c.id.startsWith("TEST"))})()'),'synthetic fixture safety check');
 await c.evaluate('document.querySelector("#home-btn").click();document.querySelector("#clear-filters").click()');
 check(await c.evaluate('document.title==="PaceShelf"'),'PaceShelf branding');
 check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'library fits viewport');
 await c.evaluate('document.querySelector(".course-card").click()');
 await c.until('document.querySelector("#video").readyState>=2');
 check(await c.evaluate('document.querySelector("#video").videoWidth>0'),'local video decodes');
 await c.evaluate('document.querySelectorAll(".watch-item")[0].click()');
 await c.until('document.querySelector("#video").readyState>=2');
 await c.evaluate('document.querySelector("#video").currentTime=19;window.coursePlayerPause()');
 await c.until('(async()=>{const s=await(await fetch("./api/library")).json();return s.states.some(s=>Object.entries(s.records).some(([k,v])=>k.startsWith("resume/")&&v.some(v=>v.value?.position>=19&&v.value?.position<21)))})()');
 check(true,'pause durably checkpoints actual position');
 if(await c.evaluate('document.querySelector("#complete-btn").textContent==="Mark incomplete"')){
  await c.evaluate('document.querySelector("#complete-btn").click()');await c.until('document.querySelector("#complete-btn").textContent==="Mark complete"');
 }
 await c.evaluate('document.querySelector("#complete-btn").click()');await c.until('document.querySelector("#complete-btn").textContent==="Mark incomplete"');
 await c.evaluate('document.querySelector("#video").currentTime=5;window.coursePlayerPause()');
 check(await c.evaluate('document.querySelector("#complete-btn").getAttribute("aria-pressed")==="true"'),'rewind does not erase explicit completion');
 await c.evaluate('document.querySelector("#undo-completion").click()');await c.until('document.querySelector("#complete-btn").textContent==="Mark complete"');
 check(true,'completion can be undone');
 const marks=await c.evaluate('document.querySelectorAll(".bookmark-row").length');
 await c.evaluate('document.querySelector("#bookmark-btn").click()');await c.until(`document.querySelectorAll(".bookmark-row").length===${marks+1}`);
 check(true,'timestamp bookmark persists');
 await c.evaluate('document.querySelector("#video").currentTime=25;document.querySelector(".bookmark-row:last-child [data-jump]").click()');
 await c.until('document.querySelector("#video").currentTime>=4&&document.querySelector("#video").currentTime<7');check(true,'bookmark jumps to its saved timestamp');
 await c.evaluate('document.querySelector(".bookmark-row:last-child [data-delete]").click()');await c.until(`document.querySelectorAll(".bookmark-row").length===${marks}`);check(true,'bookmark deletion persists as a tombstone');
 await c.evaluate('document.querySelector("#edit-collection-btn").click()');await c.until('document.querySelector("#collection-sheet").open');
 await c.evaluate('document.querySelector("#collection-title").value="Sample Learning Path";document.querySelector("#collection-favorite").checked=true;document.querySelector("#collection-form").requestSubmit()');
 await c.until('!document.querySelector("#collection-sheet").open');check(await c.evaluate('document.querySelector("#watch-title").textContent==="Sample Learning Path"'),'collection title saved');
 await c.evaluate('document.querySelector("#back-btn").click();document.querySelector("[data-filter=favorites]").click()');
 check(await c.evaluate('document.querySelectorAll(".course-card").length===1'),'favorite filter');
 await c.evaluate('document.querySelector("#clear-filters").click()');
 await c.evaluate('(async()=>{const r=await(await fetch("./api/library")).json();await window.paceShelfImport(JSON.stringify(r.states.at(-1)))})()');
 check(await c.evaluate('document.querySelector("#import-sheet").open&&document.querySelector("#import-preview").textContent.includes("Original videos are not included")'),'backup restore requires a metadata-only preview');
 await c.evaluate('document.querySelector("#import-sheet [data-close-sheet]").click()');
 check(await c.evaluate('document.querySelectorAll("dialog[open]").length===0'),'restore can be cancelled');
 await c.evaluate('document.querySelector("#menu-btn").click();document.querySelector("#storage-mode").value="device";document.querySelector("#storage-mode").dispatchEvent(new Event("change"))');
 await c.until('(async()=>{const s=await(await fetch("./api/status")).json();return s.mode==="device"&&!s.shared})()');check(true,'device-only storage status is accurate');
 await c.evaluate('document.querySelector("#storage-mode").value="portable";document.querySelector("#storage-mode").dispatchEvent(new Event("change"))');
 await c.until('(async()=>{const s=await(await fetch("./api/status")).json();return s.mode==="portable"&&s.shared})()');check(true,'portable mode verifies a complete save');
 await c.evaluate('document.querySelector("#options [data-close-sheet]").click()');
 const guarded=await c.evaluate(`(async()=>{
  window.coursePlayerPause();
  const original=window.fetch;
  const before=await(await original("./api/library")).json();
  window.fetch=async(path,options)=>{
   const response=await original(path,options);
   if(String(path).endsWith("api/library")&&(!options||!options.method||options.method==="GET")){
    const body=await response.json();body.states=body.states.map(s=>({...s,futureField:true}));
    return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
   }
   return response;
  };
  let rejected=false;
  try{await window.coursePlayerRefresh();}catch(_){rejected=true;}
  finally{window.fetch=original;}
  document.querySelector(".course-card").click();
  await new Promise(done=>setTimeout(done,100));
  const after=await(await original("./api/library")).json();
  return rejected&&before.revision===after.revision&&document.querySelector("#video").paused;
 })()`);
 check(guarded,'unknown format keeps the cached editor read-only without overwriting progress');
 await c.evaluate('window.coursePlayerRefresh()');await c.until('!document.querySelector("#courses-view").classList.contains("hidden")');
 if(android){
  await c.evaluate('document.querySelector(".course-card").click()');await c.until('document.querySelector("#video").readyState>=2');
  adb('shell','input','keyevent','3');await sleep(1200);
  check(await c.evaluate('document.querySelector("#video").paused&&!document.querySelector("#video").getAttribute("src")'),'Android backgrounding releases the stream');
  adb('shell','am','start','-n','org.paceshelf.player/.MainActivity');await sleep(1000);await c.until('!document.querySelector("#courses-view").classList.contains("hidden")');
  check(true,'Android resumes to the saved library');
 }else{
  for(const [width,height] of [[390,844],[800,1100],[1440,980]]){
   await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
   check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive library width '+width);
  }
 }
 console.log(`PASS: ${count} ${android?'Android':'desktop'} UI checks`);
}finally{c.close();}
