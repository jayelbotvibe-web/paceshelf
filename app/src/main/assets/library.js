/* PaceShelf's portable metadata protocol. No browser storage or device clocks decide merges. */
(function (root) {
  "use strict";
  const FORMAT = "paceshelf.library", VERSION = 1, LIMIT = 30000;
  const uuid = () => globalThis.crypto.randomUUID();
  const copy = value => JSON.parse(JSON.stringify(value));
  const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const token = s => typeof s === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(s) && !["__proto__","constructor","prototype"].includes(s);
  function vector(v) {
    if (!object(v) || Object.keys(v).length > 256) throw Error("Invalid revision vector");
    for (const [k,n] of Object.entries(v)) if (!token(k) || !Number.isSafeInteger(n) || n < 1) throw Error("Invalid revision");
  }
  function validate(s) {
    if (!object(s) || s.format !== FORMAT || s.version !== VERSION) throw Error("Unsupported library format. Update PaceShelf before editing this library.");
    if (!token(s.id) || !object(s.records) || Object.keys(s.records).length > LIMIT) throw Error("Invalid library");
    if(Object.keys(s).some(k=>!["format","version","id","vector","records"].includes(k)))throw Error("Unknown library fields. Update PaceShelf before editing.");
    vector(s.vector);
    for (const [key,versions] of Object.entries(s.records)) {
      if (!/^(media|resume|collection|completion|bookmark|preference)\/[a-zA-Z0-9_-]{1,80}$/.test(key) || !Array.isArray(versions) || !versions.length || versions.length > 64) throw Error("Invalid library record");
      for (const v of versions) {
        if (!object(v) || !token(v.device) || !Number.isSafeInteger(v.seq) || v.seq < 1 || v.seq > (s.vector[v.device] || 0)) throw Error("Invalid record revision");
        if(Object.keys(v).some(k=>!["device","seq","context","value","sources"].includes(k)))throw Error("Unknown revision fields. Update PaceShelf before importing.");
        vector(v.context);
        for (const [k,n] of Object.entries(v.context)) if (n > (s.vector[k] || 0)) throw Error("Invalid causal history");
        if ((v.context[v.device] || 0) >= v.seq) throw Error("Self-dependent revision");
        if(v.sources!==undefined && (!key.startsWith("collection/") || !Array.isArray(v.sources) || v.sources.length>64 || v.sources.some(s=>typeof s!=="string" || s.length>4096)))throw Error("Invalid deleted collection origin");
        const p = v.value;
        if (p === null) continue; // Keep deletion records so an old device cannot resurrect an item.
        if (!object(p)) throw Error("Invalid record value");
        const kind=key.split("/")[0];
        const fields={resume:["position","duration","updatedAt","entryId","collectionId"],media:["path","size","provider","videoId"],completion:["done"],collection:["source","title","favorite","entries","references"],bookmark:["mediaId","position","title"],preference:key==="preference/playback"?["speed","autoNext"]:key==="preference/migration"?["legacyImported"]:[]}[kind];
        if(Object.keys(p).some(k=>!fields.includes(k)) || kind==="preference" && !fields.length)throw Error("Unknown metadata fields. Update PaceShelf before importing.");
        if (key.startsWith("resume/") && (!Number.isFinite(p.position) || !Number.isFinite(p.duration) || p.position < 0 || p.duration <= 0 || p.position > p.duration || typeof p.updatedAt !== "string" || p.updatedAt.length>80)) throw Error("Invalid resume position");
        if(kind==="resume" && (p.entryId!==undefined && !token(p.entryId) || p.collectionId!==undefined && !token(p.collectionId)))throw Error("Invalid resume entry");
        if (kind==="media" && (p.provider===undefined
          ? typeof p.path!=="string" || !safePath(p.path) || !Number.isSafeInteger(p.size) || p.size<0 || p.videoId!==undefined
          : p.provider!=="youtube" || typeof p.videoId!=="string" || !/^[A-Za-z0-9_-]{11}$/.test(p.videoId) || p.path!==undefined || p.size!==undefined)) throw Error("Invalid media locator");
        if (key.startsWith("completion/") && typeof p.done !== "boolean") throw Error("Invalid completion");
        if (key.startsWith("collection/") && (typeof p.title !== "string" || p.title.length > 500 || typeof p.source !== "string" || !safePath(p.source) || !Array.isArray(p.entries) || p.entries.length > LIMIT || p.entries.some(e => !object(e) || !token(e.id) || !token(e.mediaId) || typeof e.title !== "string" || e.title.length > 500 || typeof e.section !== "string" || e.section.length > 2000))) throw Error("Invalid collection");
        if (key.startsWith("bookmark/") && (!token(p.mediaId) || !Number.isFinite(p.position) || p.position < 0 || typeof p.title !== "string" || p.title.length > 500)) throw Error("Invalid bookmark");
        if(kind==="collection" && (typeof p.favorite!=="boolean" || new Set(p.entries.map(e=>e.id)).size!==p.entries.length || p.entries.some(e=>Object.keys(e).some(k=>!["id","mediaId","title","section"].includes(k)))))throw Error("Invalid collection entries");
        if(kind==="collection" && p.references!==undefined && (!Array.isArray(p.references) || p.references.length>100 || p.references.some(r=>!object(r) || r.provider!=="youtube" || typeof r.playlistId!=="string" || !/^[A-Za-z0-9_-]{10,100}$/.test(r.playlistId) || Object.keys(r).some(k=>!["provider","playlistId"].includes(k)))))throw Error("Invalid online source reference");
        if(key==="preference/playback" && (p.speed!==undefined && ![0.5,0.75,1,1.25,1.5,1.7,1.75,2].includes(p.speed) || p.autoNext!==undefined && typeof p.autoNext!=="boolean"))throw Error("Invalid playback preferences");
        if(key==="preference/migration" && typeof p.legacyImported!=="boolean")throw Error("Invalid migration marker");
      }
    }
    return s;
  }
  function safePath(path) { return path.length > 0 && path.length <= 4096 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && !path.split("/").some(p => !p || p === "." || p === ".."); }
  function empty(id = uuid()) { return {format:FORMAT,version:VERSION,id,vector:{},records:{}}; }
  function newest(items) {
    const played=items.filter(v=>v.position>0),preferred=new Set(played.filter(v=>v.active).map(v=>v.mediaId));
    const after=(a,b)=>a.resumeRevision && b.resumeRevision && (a.resumeRevision.context[b.resumeRevision.device] || 0)>=b.resumeRevision.seq;
    let candidates=[];
    for(const v of played){
      if(preferred.has(v.mediaId) && !v.active)continue;
      if(candidates.some(p=>after(p,v)))continue;
      candidates=candidates.filter(p=>!after(v,p));candidates.push(v);
    }
    // Only independently edited candidates need the display-time tie-break.
    return candidates.sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0))[0] || null;
  }
  function merge(...states) {
    const list = states.filter(Boolean).map(validate);
    if (!list.length) return empty();
    const out = empty(list[0].id);
    for (const s of list) {
      if (s.id !== out.id) throw Error("These records belong to different libraries. Select the matching folder instead of merging them.");
      for (const [d,n] of Object.entries(s.vector)) out.vector[d] = Math.max(out.vector[d] || 0,n);
      for (const [key,versions] of Object.entries(s.records)) {
        const union = new Map((out.records[key] || []).map(v => [v.device+":"+v.seq,v]));
        for (const v of versions) {
          const dot = v.device+":"+v.seq, prev = union.get(dot);
          if (prev && JSON.stringify(prev) !== JSON.stringify(v)) throw Error("Inconsistent library revision");
          union.set(dot,copy(v));
        }
        const all = [...union.values()];
        out.records[key] = all.filter(a => !all.some(b => a !== b && (b.context[a.device] || 0) >= a.seq))
          .sort((a,b) => a.device.localeCompare(b.device) || a.seq-b.seq);
        if (!out.records[key].length) throw Error("Invalid causal cycle");
      }
    }
    return validate(out);
  }
  class Library {
    constructor(state, device = uuid()) { this.state = copy(validate(state)); this.device = device; }
    variants(key) { return this.state.records[key] || []; }
    conflicted(key) { return this.variants(key).length > 1; }
    get(key) { const variants=this.variants(key); return variants.length === 1 ? variants[0].value : null; }
    all(kind) { return Object.keys(this.state.records).filter(k => k.startsWith(kind+"/")).map(key => ({key,value:this.get(key),conflict:this.conflicted(key)})); }
    put(key,value) {
      const context = {...this.state.vector}, seq = (context[this.device] || 0)+1;
      const version={device:this.device,seq,context,value:copy(value)};
      if(key.startsWith("collection/") && value===null)version.sources=[...new Set(this.variants(key).flatMap(v=>v.sources || (v.value?.source?[v.value.source]:[])))];
      const versions=[version];
      validate({...this.state,vector:{...context,[this.device]:seq},records:{[key]:versions}});
      this.state.vector[this.device]=seq; this.state.records[key]=versions;
    }
    resolve(key,index) {
      const v=this.variants(key)[index]; if (!v) throw Error("Choose an available revision"); this.put(key,v.value);
    }
    // Catalog reconciliation uses persistent media/entry IDs. Paths are locators,
    // and a changed size requires a new identity rather than inheriting progress.
    reconcile(catalog) {
      const importLegacy=!this.get("preference/migration")?.legacyImported;
      const legacyPositions=[];
      const media = new Map(this.all("media").filter(r => r.value && !r.value.provider).map(r => [r.value.path+":"+r.value.size,r.key.split("/")[1]]));
      const existing = new Map(this.all("collection").filter(r => r.value).map(r => [r.value.source,r]));
      for (const c of catalog) {
        if(this.all("collection").some(r=>r.conflict && this.variants(r.key).some(v=>v.value?.source===c.id)))continue;
        const previous=existing.get(c.id), old=previous?.value;
        // A deliberately removed collection stays removed.
        if (this.all("collection").some(r => !r.conflict && r.value === null && this.variants(r.key)[0].sources?.includes(c.id))) continue;
        const entries=[];
        for (const section of c.sections) for (const v of section.videos) {
          if (!safePath(v.id)) continue;
          const match=v.id+":"+v.size;
          let mediaId=media.get(match);
          if (!mediaId) { mediaId=uuid(); media.set(match,mediaId); this.put("media/"+mediaId,{path:v.id,size:v.size}); }
          let entry=old?.entries.find(e => e.mediaId === mediaId);
          if (!entry) entry={id:uuid(),mediaId,title:v.title,section:section.name};
          entries.push(entry);
          // Import legacy progress once, independently of all future 1.2.x writes.
          if (importLegacy && !Object.hasOwn(this.state.records,"resume/"+mediaId) && v.position > 0 && v.duration > 0)
            legacyPositions.push({mediaId,value:{position:Math.min(v.position,v.duration),duration:v.duration,updatedAt:v.updatedAt || ""}});
          if (importLegacy && !Object.hasOwn(this.state.records,"completion/"+entry.id) && v.duration > 0 && v.position > 0 && v.duration-v.position <= Math.min(15,v.duration*.05))
            this.put("completion/"+entry.id,{done:true});
        }
        if (!old) this.put("collection/"+uuid(),{source:c.id,title:c.name,favorite:false,entries});
        else {
          // Keep user ordering and missing entries; append newly discovered lessons.
          const added=entries.filter(e => !old.entries.some(p => p.id === e.id));
          if (added.length) this.put(previous.key,{...old,entries:[...old.entries,...added]});
        }
      }
      if(importLegacy){
        // Establish the initial causal sequence in the legacy history's order,
        // rather than mistaking filesystem scan order for viewing activity.
        legacyPositions.sort((a,b)=>(Date.parse(a.value.updatedAt)||0)-(Date.parse(b.value.updatedAt)||0));
        for(const item of legacyPositions)this.put("resume/"+item.mediaId,item.value);
        this.put("preference/migration",{legacyImported:true});
      }
    }
    courses(catalog) {
      const available=new Map(catalog.flatMap(c => c.sections.flatMap(s => s.videos)).map(v => [v.id+":"+v.size,v]));
      return this.all("collection").filter(r => r.value).map(r => {
        const c=r.value, sections=[];
        for (const entry of c.entries) {
          const media=this.get("media/"+entry.mediaId); if (!media) continue;
          const online=media.provider==="youtube";
          const v=online?null:available.get(media.path+":"+media.size), resume=this.get("resume/"+entry.mediaId);
          const collectionId=r.key.split("/")[1];
          const video={...v,id:online?"youtube/"+media.videoId:media.path,provider:media.provider,videoId:media.videoId,mediaId:entry.mediaId,entryId:entry.id,collectionId,title:entry.title,section:entry.section,
            position:resume?.position || 0,duration:resume?.duration || 0,updatedAt:resume?.updatedAt || "",done:this.get("completion/"+entry.id)?.done === true,
            resumeRevision:this.variants("resume/"+entry.mediaId)[0],active:resume?.entryId===entry.id && resume?.collectionId===collectionId,
            conflict:this.conflicted("resume/"+entry.mediaId),available:online||!!v};
          let section=sections[sections.length-1];
          if(!section || section.name!==entry.section){section={name:entry.section,videos:[]};sections.push(section);}
          section.videos.push(video);
        }
        return {id:r.key.split("/")[1],name:c.title,favorite:c.favorite,source:c.source,references:c.references || [],videos:c.entries.length,sections};
      });
    }
    addYouTube({title,videoIds,playlistId=null,target=null}) {
      if(!Array.isArray(videoIds)||!videoIds.length||videoIds.length>500||videoIds.some(id=>typeof id!=="string"||!/^[A-Za-z0-9_-]{11}$/.test(id)))throw Error("Choose between 1 and 500 valid YouTube videos.");
      if(playlistId!==null && (typeof playlistId!=="string"||!/^[A-Za-z0-9_-]{10,100}$/.test(playlistId)))throw Error("Invalid playlist reference");
      if(typeof title!=="string"||!title.trim()||title.length>500)throw Error("Give the collection a title.");
      const id=target||uuid(),key="collection/"+id;
      const existing=target?this.get(key):null;
      if(target && (!existing||this.conflicted(key)))throw Error("Choose an available collection without conflicts.");
      const collection=existing?copy(existing):{source:"youtube/"+id,title:title.trim(),favorite:false,entries:[]};
      const media=new Map(this.all("media").filter(r=>r.value?.provider==="youtube"&&!r.conflict).map(r=>[r.value.videoId,r.key.split("/")[1]]));
      const newMedia=[],entries=[];
      for(const videoId of new Set(videoIds)){
        let mediaId=media.get(videoId);
        if(!mediaId){mediaId=uuid();media.set(videoId,mediaId);newMedia.push(["media/"+mediaId,{provider:"youtube",videoId}]);}
        if(!collection.entries.some(e=>e.mediaId===mediaId))entries.push({id:uuid(),mediaId,title:"YouTube video "+videoId,section:"YouTube"});
      }
      collection.entries.push(...entries);
      if(playlistId){
        collection.references=collection.references||[];
        if(!collection.references.some(r=>r.playlistId===playlistId))collection.references.push({provider:"youtube",playlistId});
      }
      // Validate the whole batch before touching live state (including record/vector limits).
      const draft=new Library(this.state,this.device);
      for(const [k,v] of newMedia)draft.put(k,v);
      draft.put(key,collection);validate(draft.state);
      this.state=draft.state;
      return {id,added:entries.length};
    }
  }
  const api={empty,validate,merge,Library,uuid,safePath,newest};
  if (typeof module !== "undefined") module.exports=api;
  else root.PaceShelfLibrary=api;
})(globalThis);
