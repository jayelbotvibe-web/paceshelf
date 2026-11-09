/* Unprivileged provider context. No filesystem, metadata API or Android bridge. */
(()=>{
  'use strict';
  const refs=window.PaceShelfYouTube;
  let config=null,player=null,timer=null,deadline=null,dead=false,ready=false,started=0,settleUntil=0;
  let latest={kind:'state',ready:false,error:''};
  const parentOrigin=new URLSearchParams(location.search).get('parent');
  const status=text=>{document.querySelector('#provider-status').textContent=text;};
  function publish(extra={}){
    if(!config || dead)return;
    latest={...latest,...extra,kind:'state',session:config.session};
    if(parentOrigin && window.parent!==window)window.parent.postMessage(latest,parentOrigin);
  }
  function sample(){
    if(!player || !ready || dead)return latest;
    clearTimeout(timer);timer=null;
    try{
      const video=refs.parse(player.getVideoUrl()).videoId;
      const ids=(player.getPlaylist()||[]).filter(refs.videoId).slice(0,500);
      const state=player.getPlayerState();
      publish({ready:true,videoId:video,position:player.getCurrentTime(),duration:player.getDuration(),state,
        speed:player.getPlaybackRate(),rates:player.getAvailablePlaybackRates(),playlistIds:ids});
      if(ids.length && config.mode==='inspect')status(ids.length+' videos found. Review the import in PaceShelf.');
      else if(!latest.error)status(state===1?'':'Use YouTube’s play button to begin.');
      // A paused seek is asynchronous too: briefly sample until its clock settles.
      if(state===1 || state===3 || Date.now()<settleUntil || config.mode==='inspect'&&!ids.length&&Date.now()-started<25000)timer=setTimeout(sample,1000);
    }catch(_){
      if(Date.now()-started<25000)timer=setTimeout(sample,500);
    }
    return latest;
  }
  function fail(code){
    const messages={2:'YouTube rejected this video link.',5:'The browser could not play this YouTube video.',100:'This video is unavailable or private.',101:'The owner does not allow embedded playback.',150:'The owner does not allow embedded playback.',153:'YouTube could not verify the embedded player. Open the original link instead.'};
    const text=messages[code]||'YouTube could not load. Check your connection or open the original link.';
    status(text);clearTimeout(timer);publish({error:text,errorCode:code||0,state:-1});
  }
  function create(){
    if(dead||!config||player)return;
    const vars={controls:1,playsinline:1,autoplay:0,origin:location.origin,enablejsapi:1};
    if(config.mode==='inspect'){vars.listType='playlist';vars.list=config.playlistId;}
    const frame=document.createElement('iframe');frame.id='player';frame.title=config.mode==='inspect'?'YouTube playlist':'YouTube video';
    frame.src='https://www.youtube.com/embed/'+(config.mode==='inspect'?'videoseries':config.videoId)+'?'+new URLSearchParams(vars);
    frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
    document.querySelector('#player').replaceWith(frame);
    player=new YT.Player(frame,{events:{
      onReady:()=>{
        ready=true;clearTimeout(deadline);
        if(config.mode==='inspect'){
          player.cuePlaylist({listType:'playlist',list:config.playlistId,index:0});
          deadline=setTimeout(()=>{if(!(player.getPlaylist()||[]).filter(refs.videoId).length)fail(0);},25000);
        }
        else player.cueVideoById({videoId:config.videoId,startSeconds:config.start||0});
        sample();
      },
      onStateChange:()=>{settleUntil=Date.now()+3000;sample();},onPlaybackRateChange:()=>sample(),onError:e=>fail(e.data),
      onAutoplayBlocked:()=>{status('Press play in the YouTube player to continue.');publish({state:2});}
    }});
  }
  function start(value){
    if(config||dead || !value || typeof value.session!=='string'||!/^[A-Za-z0-9_-]{20,80}$/.test(value.session))return false;
    if(value.mode==='inspect'?!refs.playlistId(value.playlistId):value.mode!=='play'||!refs.videoId(value.videoId))return false;
    config={session:value.session,mode:value.mode,videoId:value.videoId,playlistId:value.playlistId,start:Number.isFinite(value.start)&&value.start>=0?Math.min(value.start,1e8):0};
    started=Date.now();latest={kind:'state',session:config.session,ready:false,error:'',state:-1,playlistIds:[]};
    window.onYouTubeIframeAPIReady=create;
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>fail(0);document.head.append(script);
    deadline=setTimeout(()=>fail(0),25000);
    return true;
  }
  function command(value){
    if(!config||!value||value.session!==config.session)return;
    if(value.action==='dispose'){dispose();return;}
    if(!ready||!player)return;
    if(value.action==='load'&&value.value&&refs.videoId(value.value.videoId)&&Number.isFinite(value.value.start)&&value.value.start>=0&&value.value.start<=1e8){config.videoId=value.value.videoId;latest.error='';latest.errorCode=0;status('Loading the next video…');player.loadVideoById({videoId:config.videoId,startSeconds:value.value.start});}
    else if(value.action==='play')player.playVideo();
    else if(value.action==='pause')player.pauseVideo();
    else if(value.action==='seek'&&Number.isFinite(value.value)){
      settleUntil=Date.now()+3000;
      player.seekTo(Math.max(0,Math.min(value.value,player.getDuration()||0)),true);
    }
    else if(value.action==='speed'&&player.getAvailablePlaybackRates().includes(value.value))player.setPlaybackRate(value.value);
    else if(value.action==='volume'&&Number.isFinite(value.value))player.setVolume(Math.min(100,Math.max(0,value.value)));
    else if(value.action==='mute')value.value?player.mute():player.unMute();
    sample();
  }
  function dispose(){clearTimeout(timer);clearTimeout(deadline);if(player){try{player.stopVideo();player.destroy();}catch(_){}}player=null;dead=true;}
  window.PaceShelfProvider={start,command,snapshot:sample,dispose};
  window.addEventListener('message',event=>{
    if(!parentOrigin||event.source!==window.parent||event.origin!==parentOrigin)return;
    if(event.data?.action==='init')start(event.data);else command(event.data);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&player&&ready)player.pauseVideo();});
  window.addEventListener('pagehide',dispose);
})();
