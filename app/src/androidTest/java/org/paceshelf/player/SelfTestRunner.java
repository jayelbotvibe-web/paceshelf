package org.paceshelf.player;

import android.app.Instrumentation;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Synthetic SAF fixture only. Never run against a personal library. */
public final class SelfTestRunner extends Instrumentation {
    private int checks;
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    private void check(boolean ok,String label) throws Exception {if(!ok)throw new Exception(label);checks++;System.out.println("PASS: "+label);}
    @Override public void onStart(){
        Bundle result=new Bundle();int resultCode=-1;Context context=getTargetContext();Uri created=null;
        boolean previousMode=context.getSharedPreferences("paceshelf",0).getBoolean("deviceOnly",false);
        try{
            String selected=context.getSharedPreferences("MainActivity",0).getString("tree","");
            if(!selected.contains("PaceShelfFixtures"))throw new Exception("Choose the synthetic Documents/PaceShelfFixtures folder before running instrumentation");
            Uri tree=Uri.parse(selected),parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            created=DocumentsContract.createDocument(context.getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,".native-tests-"+UUID.randomUUID());
            if(created==null)throw new IOException("Cannot create synthetic test folder");
            context.getSharedPreferences("paceshelf",0).edit().putBoolean("deviceOnly",false).commit();
            String cacheKey="native-test-"+UUID.randomUUID();
            PortableMetadata first=new PortableMetadata(context,created,cacheKey);
            JSONObject read=first.readState();check(read.getJSONArray("states").length()==0,"new fixture has no history");
            String payload=payload(12);
            CheckpointCodec.Parts parts=CheckpointCodec.split(payload);
            boolean missingCatalog=false;try{CheckpointCodec.hydrate(new JSONObject(new String(parts.checkpoint,StandardCharsets.UTF_8)),hash->{throw new IOException("Missing fixture catalog");});}catch(Exception expected){missingCatalog=true;}
            check(missingCatalog,"checkpoint cannot activate without its complete catalog");
            JSONObject large=new JSONObject(payload),largeRecords=large.getJSONObject("records");large.getJSONObject("vector").put("native",1001);
            for(int i=1;i<=1000;i++)largeRecords.put("media/sample"+i,new JSONArray().put(new JSONObject().put("device","native").put("seq",i).put("context",new JSONObject()).put("value",new JSONObject().put("path","Sample/Lesson "+i+".mp4").put("size",100))));
            CheckpointCodec.Parts compact=CheckpointCodec.split(large.toString());
            check(compact.catalog.length>100000 && compact.checkpoint.length<2048,"native playback checkpoint excludes a large static catalog");
            check(new JSONObject(CheckpointCodec.hydrate(new JSONObject(new String(compact.checkpoint,StandardCharsets.UTF_8)),hash->compact.catalog)).getJSONObject("records").length()==1001,"native catalog and checkpoint reconstruct every record");
            String reply=first.save(new JSONObject().put("payload",payload).put("expected",read.getString("revision")).toString());
            String revision=new JSONObject(reply).getString("revision");check(!revision.isEmpty(),"native checkpoint returns a revision");
            check(first.exportPayload().equals(payload),"complete local generation exports unchanged");
            first.flush();check(first.status().getBoolean("shared"),"SAF flush is read-back verified");
            String repeat=first.save(new JSONObject().put("payload",payload).put("expected",revision).toString());
            check(new JSONObject(repeat).getString("revision").equals(revision),"unchanged checkpoint preserves its revision");
            boolean rejected=false;try{first.save(new JSONObject().put("payload",payload(30)).put("expected","").toString());}catch(Exception expected){rejected=true;}
            check(rejected,"stale native writer rejected");
            first.close();
            PortableMetadata second=new PortableMetadata(context,created,"native-test-"+UUID.randomUUID());
            read=second.readState();check(read.getJSONArray("states").length()>0,"new device reads a portable generation");
            check(read.getJSONArray("states").getJSONObject(0).getString("id").equals("native-demo"),"portable library identity preserved");
            second.save(new JSONObject().put("payload",payload(30)).put("expected",read.getString("revision")).toString());second.flush();second.close();
            Uri dir=child(context,tree,created,".paceshelf");Uri a=child(context,tree,dir,"library-a.json");
            try(OutputStream out=context.getContentResolver().openOutputStream(a,"wt")){out.write("{interrupted".getBytes(StandardCharsets.UTF_8));}
            PortableMetadata recovered=new PortableMetadata(context,created,"native-test-"+UUID.randomUUID());
            read=recovered.readState();check(!read.getBoolean("blocked") && read.getJSONArray("states").length()>0,"complete alternate generation survives an interrupted write");recovered.close();
            try(OutputStream out=context.getContentResolver().openOutputStream(a,"wt")){out.write("{\"format\":\"paceshelf.snapshot\",\"version\":99,\"payload\":\"{}\"}".getBytes(StandardCharsets.UTF_8));}
            PortableMetadata future=new PortableMetadata(context,created,"native-test-"+UUID.randomUUID());
            read=future.readState();check(read.getBoolean("blocked"),"future portable version blocks editing");future.close();
            Uri deviceDir=DocumentsContract.createDocument(context.getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,".native-device-"+UUID.randomUUID());
            try{
                context.getSharedPreferences("paceshelf",0).edit().putBoolean("deviceOnly",true).commit();
                PortableMetadata local=new PortableMetadata(context,deviceDir,"native-test-"+UUID.randomUUID());read=local.readState();
                local.save(new JSONObject().put("payload",payload(7)).put("expected",read.getString("revision")).toString());local.flush();
                check(!local.status().getBoolean("shared") && child(context,tree,deviceDir,".paceshelf")==null,"device mode never creates portable metadata");
                JSONObject beforeRestore=local.readState();
                JSONObject restoreReceipt=new JSONObject(local.save(new JSONObject().put("payload",payload(8).replace("native-demo","native-restored")).put("expected",beforeRestore.getString("revision")).put("adopt",true).toString()));
                check(!restoreReceipt.getString("device").equals(beforeRestore.getString("device")),"restoring another library establishes a fresh writer identity");
                check(local.readState().getString("device").equals(restoreReceipt.getString("device")),"restore receipt and retained writer identity agree");local.close();
            }finally{DocumentsContract.deleteDocument(context.getContentResolver(),deviceDir);}
            String onlineKey="native-test-"+UUID.randomUUID();
            PortableMetadata online=new PortableMetadata(context,null,onlineKey);
            JSONObject onlineRead=online.readState(),onlinePayload=new JSONObject(payload(15));
            JSONObject syntheticMedia=new JSONObject().put("device","native").put("seq",14).put("context",new JSONObject()).put("value",new JSONObject().put("provider","youtube").put("videoId","AAAAAAAAAAA"));
            onlinePayload.getJSONObject("records").put("media/demo",new JSONArray().put(syntheticMedia));
            online.save(new JSONObject().put("payload",onlinePayload.toString()).put("expected",onlineRead.getString("revision")).toString());online.flush();
            check(online.status().getString("mode").equals("device")&&!online.status().getBoolean("shared"),"online-only library needs no document provider or SSD");
            check(new JSONObject(online.exportPayload()).getJSONObject("records").getJSONArray("media/demo").getJSONObject(0).getJSONObject("value").getString("provider").equals("youtube"),"native checkpoints preserve typed YouTube references");
            boolean portableDenied=false;try{online.setMode("portable");}catch(Exception expected){portableDenied=true;}
            check(portableDenied,"device-only online library cannot claim a portable save");online.close();
            PortableMetadata reopenedOnline=new PortableMetadata(context,null,onlineKey);check(reopenedOnline.readState().getJSONArray("states").length()==1,"online-only history survives reopening");reopenedOnline.close();
            check(OnlinePlayer.validateConfig("{\"mode\":\"play\",\"session\":\"synthetic_session_0123456789\",\"videoId\":\"AAAAAAAAAAA\"}").getString("videoId").equals("AAAAAAAAAAA"),"isolated player accepts a stable video identity");
            boolean urlDenied=false;try{OnlinePlayer.validateConfig("{\"mode\":\"play\",\"session\":\"synthetic_session_0123456789\",\"videoId\":\"file:///sample.mp4\"}");}catch(Exception expected){urlDenied=true;}
            check(urlDenied,"isolated player rejects file URLs as video identities");
            check(HttpRange.parse("bytes=2-4",10).length()==3,"video range seek remains available");
            check(new NaturalOrder().compare("Lesson 2","Lesson 10")<0,"natural lesson ordering remains available");
            result.putString("stream","PASS: "+checks+" native checks\n");
        }catch(Exception e){result.putString("stream","FAIL: "+e.getMessage()+"\n");resultCode=1;}
        finally{
            context.getSharedPreferences("paceshelf",0).edit().putBoolean("deviceOnly",previousMode).commit();
            if(created!=null)try{DocumentsContract.deleteDocument(context.getContentResolver(),created);}catch(Exception ignored){}
            File[] tests=context.getFilesDir().listFiles((d,n)->n.startsWith("library-native-test-"));if(tests!=null)for(File f:tests)f.delete();
        }
        finish(resultCode,result);
    }
    private static String payload(int position)throws Exception{
        return new JSONObject().put("format","paceshelf.library").put("version",1).put("id","native-demo").put("vector",new JSONObject().put("native",position))
            .put("records",new JSONObject().put("resume/demo",new JSONArray().put(new JSONObject().put("device","native").put("seq",position).put("context",new JSONObject())
                .put("value",new JSONObject().put("position",position).put("duration",120).put("updatedAt","2000-01-01T00:00:00Z"))))).toString();
    }
    private static Uri child(Context context,Uri tree,Uri directory,String name)throws Exception{
        Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(directory));
        try(Cursor c=context.getContentResolver().query(query,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(c==null)return null;while(c.moveToNext())if(name.equals(c.getString(1)))return DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0));
        }return null;
    }
}
