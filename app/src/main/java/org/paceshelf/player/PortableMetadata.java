package org.paceshelf.player;

import android.content.Context;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Complete, checksummed generations; the legacy .course-player folder is read-only. */
final class PortableMetadata implements AutoCloseable {
    static final int LIMIT=16*1024*1024;
    private final Context context;
    private final ContentResolver resolver;
    private final Uri root;
    private final AtomicFile local;
    private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor();
    private final Set<String> seen=new HashSet<>();
    private ScheduledFuture<?> pending;
    private byte[] current;
    private int next;
    private long nextSave;
    private boolean dirty, shared, blocked, closed;
    private boolean deviceOnly;
    private boolean newIdentity;
    private String problem="",verified="",catalogHash="",sharedCatalogHash="";
    private byte[] catalogBytes;

    PortableMetadata(Context context,Uri root,String key) throws Exception {
        this.context=context;resolver=context.getContentResolver();this.root=root;
        deviceOnly=root==null || context.getSharedPreferences("paceshelf",0).getBoolean("deviceOnly",false);
        local=new AtomicFile(new File(context.getFilesDir(),"library-"+key+".json"));
        newIdentity=!local.getBaseFile().exists();
        if(local.getBaseFile().exists())try(InputStream in=local.openRead()){current=read(in);hydrate(decode(current),false);}
        catch(Exception e){blocked=true;problem="Local metadata is damaged or newer than this app. Restore a backup before editing.";current=null;}
    }
    private static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
    static String hash(byte[] b) throws Exception {return CourseLibrary.hex(MessageDigest.getInstance("SHA-256").digest(b));}
    private static byte[] read(InputStream in) throws Exception {
        if(in==null)throw new IOException("Cannot open metadata");
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
        while((n=in.read(buffer))!=-1){out.write(buffer,0,n);if(out.size()>LIMIT*2)throw new IOException("Metadata is too large");}
        return out.toByteArray();
    }
    private static byte[] encode(String payload) throws Exception {
        JSONObject s=new JSONObject(payload);
        if(bytes(payload).length>LIMIT || !"paceshelf.library".equals(s.optString("format")) || s.optInt("version")!=1 || !s.optString("id").matches("[a-zA-Z0-9_-]{1,80}") || s.optJSONObject("records")==null || s.getJSONObject("records").length()>30000 || s.optJSONObject("vector")==null)
            throw new IOException("Unsupported or invalid PaceShelf library");
        return bytes(new JSONObject().put("format","paceshelf.snapshot").put("version",1).put("sha256",hash(bytes(payload))).put("payload",payload).toString());
    }
    private static JSONObject decode(byte[] b) throws Exception {
        JSONObject g=new JSONObject(new String(b,StandardCharsets.UTF_8));
        if((g.optInt("version")!=1 && g.optInt("version")!=2) || !"paceshelf.snapshot".equals(g.optString("format")))throw new IOException("Unsupported snapshot version; update PaceShelf before writing");
        if(!hash(bytes(g.getString("payload"))).equals(g.optString("sha256")))throw new IOException("Snapshot checksum mismatch");
        if(g.getInt("version")==1)encode(g.getString("payload"));else CheckpointCodec.checkpoint(g.getString("payload"));return g;
    }
    private Uri child(Uri dir,String name) throws Exception {
        Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(root,DocumentsContract.getDocumentId(dir));
        try(Cursor c=resolver.query(query,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(c==null)throw new IOException("Library folder unavailable");
            while(c.moveToNext())if(name.equals(c.getString(1)))return DocumentsContract.buildDocumentUriUsingTree(root,c.getString(0));
        }
        return null;
    }
    private List<JSONObject> scan() throws Exception {
        List<JSONObject> out=new ArrayList<>();Uri dir=child(root,".paceshelf");
        if(dir==null)return out;
        boolean existed=false;
        for(String name:List.of("library-a.json","library-b.json")) {
            Uri file=child(dir,name);if(file==null)continue;existed=true;byte[] b;
            try(InputStream in=resolver.openInputStream(file)){b=read(in);}
            try{out.add(decode(b));}
            catch(Exception e){
                try{JSONObject g=new JSONObject(new String(b,StandardCharsets.UTF_8));
                    JSONObject p=new JSONObject(g.optString("payload","{}"));
                    if((g.optInt("version")!=1 && g.optInt("version")!=2) || p.optInt("version")!=1){blocked=true;problem="Unsupported library version. Update PaceShelf before editing.";}
                }catch(JSONException incomplete){/* Retain the previous complete generation. */}
            }
        }
        if(existed && out.isEmpty() && current==null){blocked=true;problem="No complete portable snapshot is readable. Restore a library backup before editing.";}
        return out;
    }
    synchronized JSONObject readState() throws Exception {
        JSONArray states=new JSONArray();seen.clear();shared=false;
        try{if(!deviceOnly)for(JSONObject g:scan()){
            seen.add(g.getString("sha256"));
            try{states.put(new JSONObject(hydrate(g,true)));
                if(current!=null && !dirty && decode(current).getString("sha256").equals(g.getString("sha256"))){shared=true;verified=Instant.now().toString();}
            }catch(Exception e){problem="A portable generation is incomplete or damaged. Using complete recovery copies.";sharedCatalogHash="";if(String.valueOf(e.getMessage()).startsWith("Unsupported"))blocked=true;}
        }}catch(Exception e){problem="Portable metadata unavailable. Progress stays on this device.";if(current==null)blocked=true;}
        if(current!=null)try{states.put(new JSONObject(hydrate(decode(current),false)));}catch(Exception e){blocked=true;problem="Local catalog is unavailable. Restore a library backup before editing.";}
        if(states.length()==0 && !problem.isEmpty())blocked=true;
        String deviceKey="deviceId-"+local.getBaseFile().getName();
        String device=context.getSharedPreferences("paceshelf",0).getString(deviceKey,null);
        if(device==null || newIdentity){device=UUID.randomUUID().toString();context.getSharedPreferences("paceshelf",0).edit().putString(deviceKey,device).commit();newIdentity=false;}
        return new JSONObject().put("states",states).put("revision",revision()).put("device",device).put("blocked",blocked).put("error",problem).put("mode",deviceOnly?"device":"portable");
    }
    private byte[] catalog(String hash,boolean portable) throws Exception {
        if(!hash.matches("[a-f0-9]{64}"))throw new IOException("Invalid catalog reference");
        byte[] b=null;boolean cacheValid=false;File cache=new File(context.getFilesDir(),"catalog-"+hash+".json");
        try(InputStream in=new FileInputStream(cache)){byte[] candidate=read(in);if(hash(candidate).equals(hash)){cacheValid=true;if(!portable)b=candidate;}}catch(Exception ignored){}
        if(b==null && (portable || !deviceOnly)){
            Uri dir=child(root,".paceshelf"),file=dir==null?null:child(dir,"catalog-"+hash+".json");
            if(file!=null)try(InputStream in=resolver.openInputStream(file)){b=read(in);}
        }
        if(b==null || b.length>LIMIT || !hash(b).equals(hash))throw new IOException("Catalog missing or checksum mismatch");
        if(!cacheValid)atomic(new AtomicFile(cache),b);
        if(portable)sharedCatalogHash=hash;
        return b;
    }
    private String hydrate(JSONObject g,boolean portable)throws Exception {return CheckpointCodec.hydrate(g,hash->catalog(hash,portable));}
    private String receipt()throws Exception{return new JSONObject().put("revision",revision()).put("device",context.getSharedPreferences("paceshelf",0).getString("deviceId-"+local.getBaseFile().getName(),"")).toString();}
    private String revision() throws Exception {return current==null?"":hash(current);}
    synchronized String save(String request) throws Exception {
        JSONObject body=new JSONObject(request);CheckpointCodec.Parts parts=CheckpointCodec.split(body.getString("payload"));byte[] b=parts.checkpoint;
        if(closed || blocked)throw new IOException("Library is paused or requires recovery");
        if(!revision().equals(body.getString("expected")))throw new IOException("Library changed in another window. Refresh before saving");
        if(Arrays.equals(b,current)){catalogHash=parts.hash;catalogBytes=parts.catalog;if(!shared && !deviceOnly){dirty=true;schedule();}return receipt();}
        boolean adopting=false;
        if(current!=null){
            String oldId=new JSONObject(decode(current).getString("payload")).getString("id");
            if(!oldId.equals(new JSONObject(body.getString("payload")).getString("id")) && !(deviceOnly && body.optBoolean("adopt")))throw new IOException("Library identity mismatch; refusing to replace existing history");
            if(!oldId.equals(new JSONObject(body.getString("payload")).getString("id")) && body.optBoolean("adopt")){adopting=true;atomic(new AtomicFile(new File(context.getFilesDir(),"before-restore-"+UUID.randomUUID()+".json")),current);}
            atomic(new AtomicFile(new File(local.getBaseFile()+".previous")),current);
        }
        if(!catalogHash.equals(parts.hash)){
            AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"catalog-"+parts.hash+".json"));
            boolean valid=false;try(InputStream in=file.openRead()){valid=hash(read(in)).equals(parts.hash);}catch(Exception ignored){}
            if(!valid)atomic(file,parts.catalog);
        }
        if(adopting && !context.getSharedPreferences("paceshelf",0).edit().putString("deviceId-"+local.getBaseFile().getName(),UUID.randomUUID().toString()).commit())throw new IOException("Could not retain a new restore writer identity");
        atomic(local,b);catalogHash=parts.hash;catalogBytes=parts.catalog;current=b;dirty=true;
        schedule();
        return receipt();
    }
    private void schedule(){if(!deviceOnly && pending==null)pending=executor.schedule(()->{synchronized(this){pending=null;flushLocked();}},Math.max(500,nextSave-SystemClock.elapsedRealtime()),TimeUnit.MILLISECONDS);}
    private void atomic(AtomicFile file,byte[] b) throws Exception {
        FileOutputStream out=null;
        try{out=file.startWrite();out.write(b);out.getFD().sync();file.finishWrite(out);out=null;try(InputStream in=file.openRead()){if(!Arrays.equals(read(in),b))throw new IOException("Device checkpoint verification failed");}}
        catch(Exception e){if(out!=null)file.failWrite(out);throw e;}
    }
    private void flushLocked(){
        if(deviceOnly || closed || !dirty || current==null || blocked)return;
        shared=false;
        try{
            List<JSONObject> previous=scan();
            for(JSONObject g:previous){
                if(!new JSONObject(g.getString("payload")).getString("id").equals(new JSONObject(decode(current).getString("payload")).getString("id")))throw new IOException("This folder contains a different library. Use device mode or select its matching folder.");
                if(!seen.contains(g.getString("sha256")))throw new IOException("Another writer changed this library. Refresh to merge its changes before saving.");
            }
            if(blocked)return;
            Uri dir=child(root,".paceshelf");
            if(dir==null)dir=DocumentsContract.createDocument(resolver,root,DocumentsContract.Document.MIME_TYPE_DIR,".paceshelf");
            if(dir==null)throw new IOException("Cannot create portable metadata folder");
            if(catalogBytes==null || catalogHash.isEmpty())throw new IOException("Local catalog is not loaded");
            if(!catalogHash.equals(sharedCatalogHash)){
                Uri cat=child(dir,"catalog-"+catalogHash+".json");boolean valid=false;
                if(cat!=null)try(InputStream in=resolver.openInputStream(cat)){valid=hash(read(in)).equals(catalogHash);}catch(Exception ignored){}
                if(!valid){if(cat==null)cat=DocumentsContract.createDocument(resolver,dir,"application/json","catalog-"+catalogHash+".json");writeVerified(cat,catalogBytes);}
                sharedCatalogHash=catalogHash;
            }
            // Preserve a valid copy by replacing a missing/damaged slot first.
            for(int i=0;i<2;i++){
                Uri f=child(dir,i==0?"library-a.json":"library-b.json");
                if(f==null){next=i;break;}
                try(InputStream in=resolver.openInputStream(f)){decode(read(in));}catch(Exception e){next=i;break;}
            }
            String name=next==0?"library-a.json":"library-b.json";Uri f=child(dir,name);
            if(f==null)f=DocumentsContract.createDocument(resolver,dir,"application/json",name);
            if(f==null)throw new IOException("Cannot create library snapshot");
            writeVerified(f,current);
            if(previous.isEmpty()){
                String other=next==0?"library-b.json":"library-a.json";Uri duplicate=child(dir,other);
                if(duplicate==null)duplicate=DocumentsContract.createDocument(resolver,dir,"application/json",other);
                writeVerified(duplicate,current);
            }
            seen.clear();for(JSONObject g:previous)seen.add(g.getString("sha256"));
            seen.add(decode(current).getString("sha256"));next=1-next;dirty=false;shared=true;problem="";verified=Instant.now().toString();
        }catch(Exception e){problem="Portable save failed: "+e.getMessage();}
        finally{nextSave=SystemClock.elapsedRealtime()+15_000;}
    }
    private void writeVerified(Uri file,byte[] b)throws Exception{
        if(file==null)throw new IOException("Cannot create metadata file");
        try(ParcelFileDescriptor fd=resolver.openFileDescriptor(file,"rwt")){
            if(fd==null)throw new IOException("Cannot save metadata");
            try(ParcelFileDescriptor.AutoCloseOutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(fd)){out.write(b);out.flush();out.getFD().sync();}
        }
        try(InputStream in=resolver.openInputStream(file)){if(!Arrays.equals(read(in),b))throw new IOException("Portable read-back verification failed");}
    }
    synchronized void flush(){if(pending!=null)pending.cancel(false);pending=null;flushLocked();}
    synchronized String exportPayload() throws Exception {if(current==null)throw new IOException("Open a library first");return hydrate(decode(current),false);}
    synchronized boolean hasLocalSave(){if(current==null)return false;try(InputStream in=local.openRead()){if(!Arrays.equals(current,read(in)))return false;hydrate(decode(current),false);return true;}catch(Exception e){return false;}}
    synchronized void setMode(String mode) throws Exception {
        if(!mode.equals("device") && !mode.equals("portable"))throw new IOException("Choose device or portable storage");
        if(closed)throw new IOException("Reconnect your library first");
        if(mode.equals("portable")&&root==null)throw new IOException("Select a folder before using portable storage. Export a backup to transfer this device library.");
        flush();deviceOnly=mode.equals("device");context.getSharedPreferences("paceshelf",0).edit().putBoolean("deviceOnly",deviceOnly).commit();
        if(deviceOnly){shared=false;if(!blocked)problem="";if(pending!=null)pending.cancel(false);pending=null;}
        else if(current!=null){dirty=true;flushLocked();}
    }
    synchronized JSONObject status() throws Exception {
        String message=deviceOnly?"Saved on this device. Export a library backup to continue on another device.":shared&&!dirty?"Library saved and checked on portable storage.":!problem.isEmpty()?problem:"Changes are saved on this device. Portable save is pending.";
        return new JSONObject().put("mode",deviceOnly?"device":"portable").put("shared",shared&&!dirty).put("pending",dirty&&!deviceOnly).put("sync",message).put("syncError",problem).put("verifiedAt",verified).put("metadataVersion",1).put("storageVersion",2);
    }
    @Override public synchronized void close(){flush();closed=true;executor.shutdown();}
}
