package org.paceshelf.player;

import org.json.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** Immutable catalog + small mutable checkpoint; activation verifies both digests. */
final class CheckpointCodec {
    interface Reader { byte[] read(String hash) throws Exception; }
    static final class Parts {
        final byte[] checkpoint,catalog;
        final String hash;
        Parts(byte[] checkpoint,byte[] catalog,String hash){this.checkpoint=checkpoint;this.catalog=catalog;this.hash=hash;}
    }
    static boolean staticRecord(String key){return key.startsWith("media/") || key.startsWith("collection/") || key.equals("preference/migration");}
    private static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
    static Parts split(String payload) throws Exception {
        JSONObject state=new JSONObject(payload),records=state.getJSONObject("records");
        if(bytes(payload).length>PortableMetadata.LIMIT || !state.optString("format").equals("paceshelf.library") || state.optInt("version")!=1 || !state.optString("id").matches("[a-zA-Z0-9_-]{1,80}") || records.length()>30000 || state.optJSONObject("vector")==null)
            throw new IOException("Unsupported or invalid PaceShelf library");
        JSONObject fixed=new JSONObject(),mutable=new JSONObject();
        for(Iterator<String> keys=records.keys();keys.hasNext();){String k=keys.next();(staticRecord(k)?fixed:mutable).put(k,records.get(k));}
        JSONObject catalog=new JSONObject().put("format","paceshelf.catalog").put("version",1).put("id",state.getString("id")).put("records",fixed);
        byte[] catalogBytes=bytes(catalog.toString());if(catalogBytes.length>PortableMetadata.LIMIT)throw new IOException("Catalog is too large");String hash=PortableMetadata.hash(catalogBytes);
        JSONObject checkpoint=new JSONObject().put("format","paceshelf.checkpoint").put("version",1).put("id",state.getString("id")).put("vector",state.getJSONObject("vector")).put("records",mutable).put("catalog",hash);
        String text=checkpoint.toString();if(bytes(text).length>PortableMetadata.LIMIT)throw new IOException("Checkpoint is too large");
        byte[] envelope=bytes(new JSONObject().put("format","paceshelf.snapshot").put("version",2).put("sha256",PortableMetadata.hash(bytes(text))).put("payload",text).toString());
        return new Parts(envelope,catalogBytes,hash);
    }
    static JSONObject checkpoint(String payload) throws Exception {
        JSONObject p=new JSONObject(payload);
        if(!p.optString("format").equals("paceshelf.checkpoint") || p.optInt("version")!=1 || !p.optString("catalog").matches("[a-f0-9]{64}") || !p.optString("id").matches("[a-zA-Z0-9_-]{1,80}") || p.optJSONObject("vector")==null || p.optJSONObject("records")==null)
            throw new IOException("Invalid checkpoint reference");
        return p;
    }
    static String hydrate(JSONObject g,Reader reader) throws Exception {
        if(g.getInt("version")==1)return g.getString("payload");
        JSONObject p=checkpoint(g.getString("payload"));String hash=p.getString("catalog");byte[] b=reader.read(hash);
        if(!PortableMetadata.hash(b).equals(hash))throw new IOException("Catalog checksum mismatch");
        JSONObject catalog=new JSONObject(new String(b,StandardCharsets.UTF_8));
        if(!catalog.optString("format").equals("paceshelf.catalog") || catalog.optInt("version")!=1)throw new IOException("Unsupported catalog version");
        if(!catalog.getString("id").equals(p.getString("id")))throw new IOException("Catalog identity mismatch");
        JSONObject records=p.getJSONObject("records"),fixed=catalog.getJSONObject("records");
        for(Iterator<String> keys=fixed.keys();keys.hasNext();){String k=keys.next();if(!staticRecord(k) || records.has(k))throw new IOException("Conflicting checkpoint records");records.put(k,fixed.get(k));}
        if(records.length()>30000)throw new IOException("Metadata is too large");
        return new JSONObject().put("format","paceshelf.library").put("version",1).put("id",p.getString("id")).put("vector",p.getJSONObject("vector")).put("records",records).toString();
    }
}
