/* Strict YouTube references. URLs are normalized to stable IDs, never fetched or executed here. */
(function(root){
  'use strict';
  const videoId=id=>typeof id==='string' && /^[A-Za-z0-9_-]{11}$/.test(id);
  const playlistId=id=>typeof id==='string' && /^[A-Za-z0-9_-]{10,100}$/.test(id);
  const hosts=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be','www.youtube-nocookie.com','youtube-nocookie.com']);
  function parse(value){
    if(typeof value!=='string'||value.length>2048)throw Error('Paste a YouTube video or playlist link.');
    let u;try{u=new URL(value.trim());}catch(_){throw Error('Use a complete https:// YouTube link.');}
    if(u.protocol!=='https:' || !hosts.has(u.hostname) || u.username || u.password || u.port)throw Error('Only HTTPS links on YouTube or youtu.be are accepted.');
    const parts=u.pathname.split('/').filter(Boolean);
    const short=u.hostname==='youtu.be'||u.hostname==='www.youtu.be';
    const id=short&&parts.length===1?parts[0]:parts.length===1&&parts[0]==='watch'?u.searchParams.get('v'):parts.length===2&&['embed','shorts','live','v'].includes(parts[0])?parts[1]:null;
    const list=u.searchParams.get('list');
    if(id!==null&&!videoId(id) || list!==null&&!playlistId(list))throw Error('This YouTube link has an invalid video or playlist ID.');
    if(!id && !(parts.length===1&&parts[0]==='playlist'&&list))throw Error('Use a video link or a public/unlisted playlist link. Channel and library pages cannot be imported.');
    return {videoId:id,playlistId:list};
  }
  function input(text){
    if(typeof text!=='string' || text.length>200000)throw Error('The video list is too large.');
    const lines=text.trim().split(/\s+/).filter(Boolean);
    if(!lines.length || lines.length>500)throw Error('Paste one playlist link or up to 500 video links, one per line.');
    const refs=lines.map(parse);
    if(refs.length===1 && refs[0].playlistId)return {playlistId:refs[0].playlistId,videoIds:[]};
    if(refs.some(r=>!r.videoId))throw Error('Import one playlist at a time, or paste a list containing video links only.');
    return {playlistId:null,videoIds:[...new Set(refs.map(r=>r.videoId))]};
  }
  const videoURL=id=>{if(!videoId(id))throw Error('Invalid YouTube video');return 'https://www.youtube.com/watch?v='+id;};
  const playlistURL=id=>{if(!playlistId(id))throw Error('Invalid YouTube playlist');return 'https://www.youtube.com/playlist?list='+id;};
  const api={videoId,playlistId,parse,input,videoURL,playlistURL};
  if(typeof module!=='undefined')module.exports=api;else root.PaceShelfYouTube=api;
})(globalThis);
