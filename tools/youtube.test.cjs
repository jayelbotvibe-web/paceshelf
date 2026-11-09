const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const refs=require('../desktop/static/youtube.js');
const P=require('../desktop/static/library.js');
const A='AAAAAAAAAAA',B='BBBBBBBBBBB',C='CCCCCCCCCCC',LIST='PL_SYNTHETIC_0123456789';
const make=()=>new P.Library(P.empty('test-library'),'test-device');

test('YouTube URLs become IDs without account, timestamp or tracking parameters',()=>{
  for(const link of ['https://www.youtube.com/watch?v='+A+'&t=90&tracking=discard','https://youtu.be/'+A+'?si=discard','https://m.youtube.com/shorts/'+A,'https://www.youtube-nocookie.com/embed/'+A])assert.equal(refs.parse(link).videoId,A);
  assert.deepEqual(refs.input('https://www.youtube.com/playlist?list='+LIST),{playlistId:LIST,videoIds:[]});
  assert.equal(refs.input('https://www.youtube.com/watch?v='+A+'&list='+LIST).playlistId,LIST);
});
test('lookalike hosts, credentials, ports, unsafe schemes and non-video pages are rejected',()=>{
  for(const link of ['https://youtube.com.example.org/watch?v='+A,'https://youtube.com'+'@'+'evil.invalid/watch?v='+A,'https://www.youtube.com:8443/watch?v='+A,'javascript:alert(1)','file:///sample.mp4','http://www.youtube.com/watch?v='+A,'https://www.youtube.com/channel/example','https://www.youtube.com/feed/library','https://www.youtube.com/watch?v=invalid'])assert.throws(()=>refs.parse(link));
});
test('video lists preserve order, deduplicate and bound import size',()=>{
  assert.deepEqual(refs.input('https://youtu.be/'+B+'\nhttps://youtu.be/'+A+'\nhttps://youtu.be/'+B).videoIds,[B,A]);
  assert.throws(()=>refs.input(('https://youtu.be/'+A+'\n').repeat(501)));
  assert.throws(()=>refs.input('https://www.youtube.com/playlist?list='+LIST+'\nhttps://youtu.be/'+A));
});
test('online media keep stable identity across collections and imports',()=>{
  const l=make(),first=l.addYouTube({title:'Sample path',videoIds:[A,B],playlistId:LIST});
  let course=l.courses([])[0],one=course.sections[0].videos[0];
  l.put('resume/'+one.mediaId,{position:24,duration:120,updatedAt:'2000-01-01T00:00:00Z',entryId:one.entryId,collectionId:first.id});
  l.put('completion/'+one.entryId,{done:true});
  const second=l.addYouTube({title:'Second path',videoIds:[A]});
  const two=l.courses([]).find(c=>c.id===second.id).sections[0].videos[0];
  assert.equal(two.mediaId,one.mediaId);assert.equal(two.position,24);assert.notEqual(two.entryId,one.entryId);assert.equal(two.done,false);
  assert.equal(l.addYouTube({title:'ignored',target:first.id,videoIds:[B,A,C],playlistId:LIST}).added,1);
  course=l.courses([]).find(c=>c.id===first.id);
  assert.deepEqual(course.sections[0].videos.map(v=>v.videoId),[A,B,C]);
  assert.equal(course.references.length,1);assert.equal(course.sections[0].videos[0].entryId,one.entryId);
});
test('local refresh and mixed collections do not remove or confuse YouTube references',()=>{
  const l=make(),catalog=[{id:'Local',name:'Sample local folder',sections:[{name:'Lessons',videos:[{id:'Local/one.mp4',size:10,title:'Sample lesson'}]}]}];
  l.reconcile(catalog);const local=l.courses(catalog)[0];
  l.addYouTube({title:'ignored',target:local.id,videoIds:[A],playlistId:LIST});l.reconcile(catalog);
  const videos=l.courses(catalog)[0].sections.flatMap(s=>s.videos);
  assert.equal(videos.length,2);assert(videos.every(v=>v.available));assert.equal(videos[0].provider,undefined);assert.equal(videos[1].provider,'youtube');
  l.reconcile([]);assert(l.courses([])[0].sections.flatMap(s=>s.videos).find(v=>v.videoId===A).available);
});
test('YouTube media cannot smuggle file paths, URLs or credentials into metadata',()=>{
  const l=make();l.addYouTube({title:'Sample path',videoIds:[A]});const key=l.all('media')[0].key;
  for(const value of [{provider:'youtube',videoId:A,path:'sample.mp4',size:0},{provider:'unknown',videoId:A},{provider:'youtube',videoId:'https://youtu.be/'+A},{provider:'youtube',videoId:A,credential:'not-allowed'}])assert.throws(()=>l.put(key,value));
});
test('rejected batch does not leave orphan records or partially mutate a live library',()=>{
  const l=make();const before=JSON.stringify(l.state);
  assert.throws(()=>l.addYouTube({title:'Sample',videoIds:[A,'invalid']}));assert.equal(JSON.stringify(l.state),before);
  const first=l.addYouTube({title:'Sample',videoIds:[A]});const c=l.get('collection/'+first.id);
  c.references=Array.from({length:100},(_,i)=>({provider:'youtube',playlistId:'PL_SYNTHETIC_'+i}));l.put('collection/'+first.id,c);
  const full=JSON.stringify(l.state);assert.throws(()=>l.addYouTube({title:'Sample',target:first.id,videoIds:[B],playlistId:LIST}));assert.equal(JSON.stringify(l.state),full);
});
test('export, handoff and deliberate YouTube rewinds use the same causal history',()=>{
  const l=make();l.addYouTube({title:'Sample',videoIds:[A]});const v=l.courses([])[0].sections[0].videos[0];
  l.put('resume/'+v.mediaId,{position:40,duration:120,updatedAt:'2030-01-01T00:00:00Z'});
  const phone=new P.Library(JSON.parse(JSON.stringify(l.state)),'phone');phone.put('resume/'+v.mediaId,{position:8,duration:120,updatedAt:'1999-01-01T00:00:00Z'});
  const merged=new P.Library(P.merge(l.state,phone.state),'tablet');assert.equal(merged.courses([])[0].sections[0].videos[0].position,8);
});
const context={window:{PaceShelfYouTube:refs,addEventListener(){}},EventTarget,Event,URL,Date};
vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/static/online.js'),'utf8'),context);
test('provider snapshots reject wrong sessions, invalid IDs, unbounded lists and invalid clocks',()=>{
  const validate=context.window.PaceShelfOnline.validateState;
  const valid={kind:'state',session:'sample-session',ready:true,videoId:A,position:12,duration:120,state:1,rates:[1,1.5,2]};
  assert.equal(validate(valid,'sample-session').position,12);
  for(const patch of [{session:'other'},{videoId:'invalid'},{position:NaN},{duration:Infinity},{position:-1},{position:999},{state:99},{playlistIds:Array(501).fill(A)}])assert.equal(validate({...valid,...patch},'sample-session'),null);
});
const nodes=new Map();
context.document={querySelector(key){if(!nodes.has(key))nodes.set(key,{classList:{add(){},remove(){}},replaceChildren(){}});return nodes.get(key);}};
class LocalVideo extends EventTarget {pause(){}removeAttribute(){}load(){}}
const sample=(id,position=0,state=5)=>({ready:true,videoId:id,position,duration:120,state,speed:1,rates:[1,1.5,2]});
test('switching YouTube lessons reuses only a ready player and rejects old-video clocks',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());
  m.useYouTube({videoId:A},18);
  const pending={closed:false,config:{},command(){},close(){this.closed=true;}};m.session=pending;
  m.useYouTube({videoId:B},0);assert(pending.closed);assert.equal(m.session,null);
  let calls=[];const ready={closed:false,config:{},command(...args){calls.push(args);},close(){this.closed=true;}};m.session=ready;
  m.update(sample(B,24));m.useYouTube({videoId:C},0);
  assert.equal(m.session,ready);assert.equal(ready.config.videoId,C);assert.equal(calls[0][0],'load');
  m.update(sample(B,100,2));assert.equal(m.currentTime,0);assert(Number.isNaN(m.duration));assert.equal(m.foreign,false);
  m.update(sample(C,2,1));assert.equal(m.currentTime,2);assert.equal(m.duration,120);
});
test('buffering before an end emits one completion event, and closing permits a fresh resume',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());m.useYouTube({videoId:A},0);
  let ended=0,metadata=0;m.addEventListener('ended',()=>ended++);m.addEventListener('loadedmetadata',()=>metadata++);
  m.update(sample(A,118,1));m.update(sample(A,119,3));m.update(sample(A,120,0));m.update(sample(A,120,0));assert.equal(ended,1);
  m.update({closed:true});m.update(sample(A,30,5));assert.equal(metadata,2);assert.equal(m.currentTime,30);
});
test('a quick provider rewind before closing supersedes an unacknowledged app seek',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());m.useYouTube({videoId:A},31);m.update(sample(A,31));
  m.currentTime=31;m.update(sample(A,9,1));assert.equal(m.currentTime,31);
  m.update({closed:true});assert.equal(m.currentTime,9);
  m.currentTime=31;m.update(sample(A,8,2));m.update({closed:true});assert.equal(m.currentTime,8);
});
test('a stale paused snapshot does not cancel a seek before the provider confirms it',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());m.useYouTube({videoId:A},20);m.update(sample(A,20,2));
  let confirmed=0;m.addEventListener('seeked',()=>confirmed++);
  m.currentTime=60;m.update(sample(A,20,2));assert.equal(m.currentTime,60);assert.equal(confirmed,0);
  m.update(sample(A,60,2));assert.equal(m.currentTime,60);assert.equal(confirmed,1);
});
test('returning from a related video restores tracking controls without replaying the initial resume',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());m.useYouTube({videoId:A},20);
  const transitions=[];let metadata=0;
  m.addEventListener('sourcechange',()=>transitions.push({foreign:m.foreign,duration:m.duration,position:m.currentTime}));
  m.addEventListener('loadedmetadata',()=>metadata++);
  m.update(sample(A,20,1));m.update(sample(B,90,1));m.update(sample(B,91,1));
  assert.equal(m.currentTime,20);assert(m.foreign);assert(Number.isNaN(m.duration));
  m.update(sample(A,25,2));
  assert.equal(transitions.length,2);assert.equal(transitions[0].foreign,true);
  assert.deepEqual(transitions[1],{foreign:false,duration:120,position:25});
  assert.equal(metadata,1);assert.equal(m.foreign,false);
});
test('ordinary clock updates preserve study controls by emitting ratechange only when rates change',()=>{
  const m=new context.window.PaceShelfOnline.Media(new LocalVideo());m.useYouTube({videoId:A},0);
  let rates=0,times=0;m.addEventListener('ratechange',()=>rates++);m.addEventListener('timeupdate',()=>times++);
  m.update(sample(A,1,1));m.update(sample(A,2,1));m.update(sample(A,3,1));
  assert.equal(rates,1);assert.equal(times,3);
  m.update({...sample(A,4,1),speed:1.5});assert.equal(rates,2);
  m.update({...sample(A,5,1),speed:1.5,rates:[1,1.5]});assert.equal(rates,3);
  m.update({...sample(A,6,1),speed:1.5,rates:[1,1.5]});assert.equal(rates,3);
});
test('the provider samples an asynchronous paused seek until it settles, then stops polling',()=>{
  let now=1000,nextTimer=0,position=20,events,videoURL='https://youtu.be/'+A;const timers=new Map(),messages=[];
  const parent={postMessage(value){messages.push({...value});}};
  const player={getVideoUrl:()=>videoURL,getPlaylist:()=>[],getPlayerState:()=>2,
    getCurrentTime:()=>position,getDuration:()=>120,getPlaybackRate:()=>1,getAvailablePlaybackRates:()=>[1],
    cueVideoById(){},seekTo(value){assert.equal(value,60);}};
  const w={PaceShelfYouTube:refs,parent,addEventListener(){}};
  const providerContext={window:w,URLSearchParams,location:{origin:'http://127.0.0.1:9000',search:'?parent=http://127.0.0.1:8000'},Date:{now:()=>now},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},
    document:{querySelector:()=>({replaceWith(){},textContent:''}),createElement:()=>({}),head:{append(){}},addEventListener(){}},
    YT:{Player:class {constructor(frame,options){events=options.events;return player;}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/static/provider.js'),'utf8'),providerContext);
  const provider=w.PaceShelfProvider,session='synthetic-session-0123456789';
  provider.start({session,mode:'play',videoId:A,start:20});w.onYouTubeIframeAPIReady();events.onReady();
  assert.equal(timers.size,0);
  provider.command({session,action:'seek',value:60});assert.equal(messages.at(-1).position,20);assert.equal(timers.size,1);
  position=60;
  for(let i=0;i<3;i++){
    const [id,timer]=[...timers][0];timers.delete(id);now=timer.at;timer.fn();
  }
  assert.equal(messages.at(-1).position,60);assert.equal(timers.size,0);
  // Native snapshots during a temporary missing clock must not multiply retries.
  videoURL='';provider.snapshot();provider.snapshot();provider.snapshot();assert.equal(timers.size,1);
});
