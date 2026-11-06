const {test}=require('node:test');
const assert=require('node:assert/strict');
const {empty,Library,merge,validate,newest}=require('../desktop/static/library.js');
const base=()=>empty('demo-library');
const position=(position,updatedAt='2000-01-01T00:00:00Z')=>({position,duration:120,updatedAt});
const catalog=()=>[{id:'Sample',name:'Sample collection',sections:[{name:'Start',videos:[{id:'Sample/lesson.mp4',title:'Lesson',size:100,position:20,duration:120,updatedAt:'2000-01-01T00:00:00Z'}]}]}];

test('three-device handoff preserves deliberate rewind despite wrong clocks',()=>{
 const phone=new Library(base(),'phone');phone.put('resume/demo',position(80,'2099-01-01T00:00:00Z'));
 const tablet=new Library(merge(phone.state),'tablet');tablet.put('resume/demo',position(5,'1999-01-01T00:00:00Z'));
 const desktop=new Library(merge(phone.state,tablet.state),'desktop');
 assert.equal(desktop.get('resume/demo').position,5);assert.equal(desktop.conflicted('resume/demo'),false);
});
test('independent edits remain conflicts and converge after an explicit choice',()=>{
 const phone=new Library(base(),'phone');phone.put('resume/demo',position(20));
 const tablet=new Library(phone.state,'tablet');
 phone.put('resume/demo',position(70));tablet.put('resume/demo',position(10));
 const combined=merge(phone.state,tablet.state);
 assert.deepEqual(combined,merge(tablet.state,phone.state));assert.deepEqual(combined,merge(combined,combined));
 const choice=new Library(combined,'desktop');assert.equal(choice.get('resume/demo'),null);assert.equal(choice.variants('resume/demo').length,2);
 const index=choice.variants('resume/demo').findIndex(v=>v.value.position===10);choice.resolve('resume/demo',index);
 assert.equal(new Library(merge(choice.state,phone.state,tablet.state)).get('resume/demo').position,10);
});
test('deletion survives stale import and preserves independent conflicting edits',()=>{
 const a=new Library(base(),'phone');a.put('bookmark/demo',{mediaId:'media',position:5,title:'Review'});
 const stale=structuredClone(a.state);a.put('bookmark/demo',null);
 assert.equal(new Library(merge(stale,a.state)).get('bookmark/demo'),null);
 const b=new Library(stale,'tablet');b.put('bookmark/demo',{mediaId:'media',position:8,title:'New title'});
 assert.equal(new Library(merge(a.state,b.state)).variants('bookmark/demo').length,2);
});
test('same revision cannot be assigned two different values',()=>{
 const a=new Library(base(),'writer');a.put('resume/demo',position(5));
 const b=structuredClone(a.state);b.records['resume/demo'][0].value.position=9;
 assert.throws(()=>merge(a.state,b),/Inconsistent/);
});
test('completion is per collection entry while resume belongs to media',()=>{
 const a=new Library(base(),'writer');a.put('resume/media',position(55));a.put('completion/entryA',{done:true});a.put('completion/entryB',{done:false});
 assert.equal(a.get('completion/entryA').done,true);assert.equal(a.get('completion/entryB').done,false);
 a.put('resume/media',position(1));assert.equal(a.get('completion/entryA').done,true);
});
test('catalog refresh preserves identities, user names and ordering',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const c=a.all('collection')[0];
 const mediaId=c.value.entries[0].mediaId,entryId=c.value.entries[0].id;
 a.put(c.key,{...c.value,title:'My title',favorite:true});const before=JSON.stringify(a.state);a.reconcile(catalog());
 assert.equal(JSON.stringify(a.state),before);assert.equal(a.courses(catalog())[0].name,'My title');
 assert.equal(a.courses(catalog())[0].sections[0].videos[0].mediaId,mediaId);assert.equal(a.courses(catalog())[0].sections[0].videos[0].entryId,entryId);
});
test('legacy snapshots are read once and cannot overwrite a migrated rewind',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const media=a.all('media')[0].key.split('/')[1];
 a.put('resume/'+media,position(3));const old=catalog();old[0].sections[0].videos[0].position=90;a.reconcile(old);
 assert.equal(a.get('resume/'+media).position,3);
});
test('changed size gets a new identity and no inherited path-based legacy progress',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const old=a.all('media')[0].key;
 const changed=catalog();changed[0].sections[0].videos[0].size=101;a.reconcile(changed);
 const media=a.all('media').find(m=>m.key!==old);assert.ok(media);assert.equal(a.get(media.key.replace('media/','resume/')),null);
 assert.equal(a.courses(changed)[0].sections[0].videos.filter(v=>v.available).length,1);
});
test('unavailable media retain metadata without pretending they can play',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const result=a.courses([]);
 assert.equal(result.length,1);assert.equal(result[0].sections[0].videos[0].available,false);assert.equal(result[0].sections[0].videos[0].position,20);
});
test('unsafe paths, future formats and invalid revisions are rejected before import',()=>{
 assert.throws(()=>validate({...base(),version:99}),/Unsupported/);
 for(const path of ['../secret.mp4','/secret.mp4','A/../../secret.mp4','A\\secret.mp4','A//secret.mp4']){
  const a=new Library(base(),'writer');assert.throws(()=>a.put('media/demo',{path,size:1}),/Invalid media/);
 }
 const a=new Library(base(),'writer');assert.throws(()=>a.put('resume/demo',{position:NaN,duration:5,updatedAt:''}),/Invalid/);
 assert.throws(()=>merge(base(),empty('different-library')),/different libraries/);
});
test('collection conflict does not create a duplicate collection on refresh',()=>{
 const a=new Library(base(),'phone');a.reconcile(catalog());const c=a.all('collection')[0];const b=new Library(a.state,'tablet');
 a.put(c.key,{...c.value,title:'One'});b.put(c.key,{...c.value,title:'Two'});
 const result=new Library(merge(a.state,b.state),'desktop');result.reconcile(catalog());assert.equal(result.all('collection').length,1);assert.equal(result.conflicted(c.key),true);
});
test('unknown fields cannot be silently stripped or imported as credentials',()=>{
 assert.throws(()=>validate({...base(),future:true}),/Unknown library/);
 const a=new Library(base(),'writer');assert.throws(()=>a.put('preference/playback',{speed:1,token:'not-a-real-token'}),/Unknown metadata/);
 a.put('resume/demo',position(5));const bad=structuredClone(a.state);bad.records['resume/demo'][0].future={};assert.throws(()=>validate(bad),/Unknown revision/);
});
test('duplicate media in one collection retain independent entry completion',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const c=a.all('collection')[0],first=c.value.entries[0];
 a.put(c.key,{...c.value,entries:[first,{...first,id:'second-entry'}]});a.put('completion/'+first.id,{done:true});
 const lessons=a.courses(catalog())[0].sections[0].videos;
 assert.equal(lessons[0].mediaId,lessons[1].mediaId);assert.notEqual(lessons[0].entryId,lessons[1].entryId);assert.equal(lessons[0].done,true);assert.equal(lessons[1].done,false);
});
test('refresh does not recreate a deleted collection from its folder',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const c=a.all('collection')[0];const stale=structuredClone(a.state);
 a.put(c.key,null);const b=new Library(merge(stale,a.state),'other');b.reconcile(catalog());
 assert.equal(b.all('collection').length,1);assert.equal(b.get(c.key),null);assert.equal(b.courses(catalog()).length,0);
});
test('continue learning follows causal lesson activity despite skewed clocks',()=>{
 const a=new Library(base(),'phone');a.put('resume/first',position(80,'2099-01-01T00:00:00Z'));a.put('resume/second',position(7,'1999-01-01T00:00:00Z'));
 const videos=()=>['first','second'].map(id=>({id,mediaId:id,...a.get('resume/'+id),resumeRevision:a.variants('resume/'+id)[0]}));
 assert.equal(newest(videos()).id,'second');a.put('resume/first',position(2,'1998-01-01T00:00:00Z'));assert.equal(newest(videos()).id,'first');
});
test('continue learning retains the active collection entry for shared media',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const original=a.all('collection')[0],entry=original.value.entries[0];
 a.put('collection/second',{...original.value,source:'Other',title:'Second collection',entries:[{...entry,id:'second-entry'}]});
 a.put('resume/'+entry.mediaId,{...position(9),entryId:'second-entry',collectionId:'second'});
 const videos=a.courses(catalog()).flatMap(c=>c.sections.flatMap(s=>s.videos));assert.equal(newest(videos).collectionId,'second');
});
test('reordering across section boundaries preserves the exact edited lesson order',()=>{
 const a=new Library(base(),'writer');a.reconcile(catalog());const original=a.all('collection')[0],entry=original.value.entries[0];
 a.put(original.key,{...original.value,entries:[{...entry,id:'one',section:'First'},{...entry,id:'two',section:'Other'},{...entry,id:'three',section:'First'}]});
 assert.deepEqual(a.courses(catalog())[0].sections.flatMap(s=>s.videos.map(v=>v.entryId)),['one','two','three']);
});
test('first import preserves legacy recency rather than assigning scan-order recency',()=>{
 const a=new Library(base(),'writer'),files=catalog();files[0].sections[0].videos[0].updatedAt='2020-01-01T00:00:00Z';
 files[0].sections[0].videos.push({id:'Sample/later-name.mp4',title:'Later filename',size:100,position:5,duration:120,updatedAt:'2000-01-01T00:00:00Z'});
 a.reconcile(files);const videos=a.courses(files)[0].sections[0].videos;assert.equal(newest(videos).id,'Sample/lesson.mp4');
});
