/* Narrow provider transport and a media adapter shared by Android and Ubuntu. */
(()=>{
  'use strict';
  const refs=window.PaceShelfYouTube;
  const sessions=new Map();
  function state(value,session){
    if(!value||value.session!==session||value.kind!=='state')return null;
    if(value.closed===true)return {closed:true};
    if(typeof value.error==='string'&&value.error)return {error:value.error.slice(0,400)};
    const ids=value.playlistIds;
    if(ids!==undefined&&(!Array.isArray(ids)||ids.length>500||ids.some(id=>!refs.videoId(id))))return null;
    const clean={ready:value.ready===true,playlistIds:ids?[...new Set(ids)]:[]};
    if(!value.ready)return clean;
    if(!refs.videoId(value.videoId)||!Number.isFinite(value.position)||!Number.isFinite(value.duration)||value.duration<0||value.duration>1e8||value.position<0||value.position>value.duration+2||![-1,0,1,2,3,5].includes(value.state))return null;
    return {...clean,videoId:value.videoId,position:Math.min(value.position,value.duration),duration:value.duration,state:value.state,
      speed:Number.isFinite(value.speed)&&value.speed>0&&value.speed<=4?value.speed:1,
      rates:Array.isArray(value.rates)?value.rates.filter(r=>[.5,.75,1,1.25,1.5,1.7,1.75,2].includes(r)):[]};
  }
  class Session {
    constructor(config,container,receive){
      this.id=crypto.randomUUID();this.config={...config,session:this.id};this.receive=receive;this.container=container;this.closed=false;
      sessions.set(this.id,this);
    }
    async open(){
      if(window.Android){
        const result=JSON.parse(Android.openOnline(JSON.stringify(this.config)));
        if(result.error)throw Error(result.error);
        return;
      }
      const response=await fetch('./api/online');if(!response.ok)throw Error('The YouTube player is unavailable. Restart PaceShelf.');
      const endpoint=await response.json();
      let origin;try{origin=new URL(endpoint.origin);}catch(_){throw Error('The isolated YouTube player could not start. Restart PaceShelf.');}
      if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||!origin.port)throw Error('Invalid provider origin');
      if(this.closed)return;
      this.origin=origin.origin;
      const frame=document.createElement('iframe');this.frame=frame;
      frame.title=this.config.mode==='inspect'?'YouTube playlist preview':'YouTube video player';
      frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
      frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
      frame.referrerPolicy='strict-origin-when-cross-origin';
      frame.src=this.origin+'/player?parent='+encodeURIComponent(location.origin);
      frame.onload=()=>{if(!this.closed)frame.contentWindow.postMessage({...this.config,action:'init'},this.origin);};
      this.container.replaceChildren(frame);
    }
    update(value){const clean=state(value,this.id);if(clean&&!this.closed)this.receive(clean);}
    command(action,value){
      if(this.closed)return;
      const message={session:this.id,action,value};
      if(window.Android)Android.commandOnline(JSON.stringify(message));
      else this.frame?.contentWindow.postMessage(message,this.origin);
    }
    close(){
      if(this.closed)return;this.command('dispose');this.closed=true;sessions.delete(this.id);
      if(window.Android)Android.closeOnline(this.id);
      this.frame?.remove();
    }
  }
  window.addEventListener('message',event=>{
    for(const s of sessions.values())if(s.frame?.contentWindow===event.source&&s.origin===event.origin)s.update(event.data);
  });
  window.paceShelfOnlineUpdate=message=>{const s=sessions.get(message?.session);if(s)s.update(message);};
  class Media extends EventTarget {
    constructor(local){
      super();this.local=local;this.online=false;this._position=0;this._duration=NaN;this._state=-1;this._speed=1;this.rates=[];this._volume=1;this._muted=false;
      for(const type of ['loadedmetadata','seeked','timeupdate','play','playing','pause','waiting','canplay','ended','error','click'])
        local.addEventListener(type,()=>{if(!this.online)this.dispatchEvent(new Event(type));});
    }
    emit(type){this.dispatchEvent(new Event(type));}
    useYouTube(video,start=0){
      const reuse=this.online&&this.session&&!this.session.closed&&this._loaded;
      if(!reuse)this.release();
      this.online=true;this.video=video;this._position=start;this._observedPosition=NaN;this._duration=NaN;this._state=2;this._loaded=false;this.foreign=false;this.errorMessage='';this.rates=[];this._wasPlaying=false;this._seek=undefined;this._switching=!!reuse;
      this.local.pause();this.local.removeAttribute('src');this.local.load();
      document.querySelector('#video-stage').classList.add('online-stage');
      if(reuse){this.session.config.videoId=video.videoId;this.session.config.start=start;this.session.command('load',{videoId:video.videoId,start});}
      else{document.querySelector('#online-frame').replaceChildren();document.querySelector('#online-open').classList.remove('hidden');}
    }
    async open(){
      if(this.session)return;
      const session=new Session({mode:'play',videoId:this.video.videoId,start:this._position},document.querySelector('#online-frame'),value=>this.update(value));
      this.session=session;
      try{await session.open();if(this.session===session)document.querySelector('#online-open').classList.add('hidden');}
      catch(e){session.close();if(this.session===session)this.session=null;throw e;}
    }
    update(value){
      if(value.closed){this.release(false);this.emit('pause');return;}
      if(value.error){this.errorMessage=value.error;this._state=2;this.emit('error');return;}
      if(!value.ready)return;
      if(value.videoId!==this.video.videoId){
        if(this._switching)return;
        const changed=!this.foreign;this.foreign=true;this._duration=NaN;
        if(changed)this.emit('sourcechange');
        return;
      }
      this._switching=false;
      const sourceChanged=this.foreign;
      const rateChanged=this._speed!==value.speed||this.rates.length!==value.rates.length||this.rates.some((rate,index)=>rate!==value.rates[index]);
      this.foreign=false;const before=this._state;
      this._state=value.state;this._duration=value.duration;this._speed=value.speed;this.rates=value.rates;
      this._observedPosition=value.position;
      if(this._seek!==undefined){
        if(Math.abs(value.position-this._seek)<2||Date.now()>=this._seekUntil){this._seek=undefined;this._position=value.position;this.emit('seeked');}
      }else this._position=value.position;
      if(!this._loaded&&value.duration>0){this._loaded=true;this.emit('loadedmetadata');this.emit('canplay');}
      if(sourceChanged)this.emit('sourcechange');
      this.emit('timeupdate');
      if(rateChanged)this.emit('ratechange');
      if(value.state===1)this._wasPlaying=true;
      if(value.state===1&&before!==1){this.emit('play');this.emit('playing');}
      else if(value.state===2&&before!==2)this.emit('pause');
      else if(value.state===3&&before!==3)this.emit('waiting');
      else if(value.state===0&&before!==0&&this._wasPlaying){this._wasPlaying=false;this.emit('ended');}
    }
    release(reset=true){
      // A final provider snapshot wins over an unacknowledged app seek, including
      // a quick rewind in YouTube's own controls immediately before leaving.
      if(this.online&&this._seek!==undefined&&Number.isFinite(this._observedPosition)){
        this._position=this._observedPosition;this._seek=undefined;this.emit('pause');
      }
      this.session?.close();this.session=null;this._state=2;this._seek=undefined;this._loaded=false;this._wasPlaying=false;
      const button=document.querySelector('#online-open');if(button)button.classList.remove('hidden');
      if(reset){this.online=false;this.foreign=false;this.errorMessage='';document.querySelector('#video-stage')?.classList.remove('online-stage');}
    }
    get currentTime(){return this.online?this._position:this.local.currentTime;}
    set currentTime(v){if(this.online){if(!Number.isFinite(v))return;this._position=Math.max(0,v);this._seek=this._position;this._seekUntil=Date.now()+3000;this.session?.command('seek',this._position);}else this.local.currentTime=v;}
    get duration(){return this.online?this._duration:this.local.duration;}
    get paused(){return this.online?this._state!==1:this.local.paused;}
    get ended(){return this.online?this._state===0:this.local.ended;}
    get playbackRate(){return this.online?this._speed:this.local.playbackRate;}
    set playbackRate(v){if(this.online){this._speed=v;this.session?.command('speed',v);}else this.local.playbackRate=v;}
    get volume(){return this.online?this._volume:this.local.volume;}
    set volume(v){if(this.online){this._volume=v;this.session?.command('volume',v*100);}else this.local.volume=v;}
    get muted(){return this.online?this._muted:this.local.muted;}
    set muted(v){if(this.online){this._muted=v;this.session?.command('mute',v);}else this.local.muted=v;}
    set src(v){this.release();this.local.src=v;}
    get src(){return this.online?'':this.local.src;}
    play(){if(this.online){return this.open().then(()=>this.session?.command('play'));}return this.local.play();}
    pause(){if(this.online){this.session?.command('pause');this._state=2;this.emit('pause');}else this.local.pause();}
    load(){if(this.online)this.release();else this.local.load();}
    removeAttribute(name){if(this.online&&name==='src')this.release();else this.local.removeAttribute(name);}
    getAttribute(name){return this.online?null:this.local.getAttribute(name);}
  }
  window.PaceShelfOnline={Session,Media,validateState:state};
})();
