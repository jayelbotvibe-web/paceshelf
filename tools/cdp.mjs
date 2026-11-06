import {execFileSync} from 'node:child_process';

export const device=process.env.PACESHELF_TEST_DEVICE || 'emulator-5554';
export const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8'}).trim();
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function connect() {
  let page;
  for(let attempt=0;attempt<60;attempt++) {
    try {
      const pid=adb('shell','pidof','org.paceshelf.player');
      if(!pid)throw Error('App starting');
      adb('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
      const pages=await(await fetch('http://127.0.0.1:9222/json')).json();
      page=pages.find(item=>item.type==='page' && item.url.includes('127.0.0.1'));
      if(page)break;
    } catch(_) {}
    await sleep(200);
  }
  if(!page)throw new Error('No ready debug WebView page found');
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let sequence=0;const pending=new Map();
  socket.onmessage=({data})=>{
    const response=JSON.parse(data),request=pending.get(response.id);
    if(!request)return;
    clearTimeout(request.timer);pending.delete(response.id);
    if(response.error)request.reject(new Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
  };
  async function call(method,params={}) {
    const id=++sequence;
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP evaluation timeout'));},20000);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params}));
    });
    return result;
  }
  async function evaluate(expression) {
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression,timeout=12000) {
    const start=Date.now();
    while(Date.now()-start<timeout){if(await evaluate(expression))return;await sleep(150);}
    throw new Error('Timed out: '+expression);
  }
  async function nativeTap(selector) {
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,ratio:devicePixelRatio}})()`);
    adb('shell','uiautomator','dump','/sdcard/course-player-test-ui.xml');
    const xml=adb('shell','cat','/sdcard/course-player-test-ui.xml');
    const bounds=xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if(!bounds)throw new Error('Cannot locate native WebView bounds');
    adb('shell','input','tap',String(Math.round(Number(bounds[1])+point.x*point.ratio)),String(Math.round(Number(bounds[2])+point.y*point.ratio)));
  }
  return {call,evaluate,until,nativeTap,close:()=>socket.close()};
}
