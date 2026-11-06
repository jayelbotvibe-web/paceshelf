package org.paceshelf.player;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.ParcelFileDescriptor;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/** Private loopback transport so the existing HTML video player retains seeking support. */
final class LocalServer implements Closeable {
    final CourseLibrary library;
    private final Context context;
    private final ServerSocket listener;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 12, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(80), new ThreadPoolExecutor.AbortPolicy());
    private final Set<Socket> clients = ConcurrentHashMap.newKeySet();
    private final Set<Socket> mediaClients = ConcurrentHashMap.newKeySet();
    private final ReentrantReadWriteLock mediaAccess = new ReentrantReadWriteLock(true);
    private final Semaphore thumbnails = new Semaphore(2);
    private final String prefix = "/" + UUID.randomUUID().toString() + "/";
    private volatile boolean closed;

    LocalServer(Context context, CourseLibrary library) throws IOException {
        this.context = context; this.library = library;
        listener = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
        Thread accept = new Thread(() -> {
            while (!closed) {
                try {
                    Socket socket = listener.accept(); clients.add(socket);
                    try { workers.execute(() -> handle(socket)); }
                    catch (RejectedExecutionException full) { clients.remove(socket); socket.close(); }
                } catch (IOException ignored) { if (closed) break; }
            }
        }, "course-player-http");
        accept.setDaemon(true); accept.start();
    }

    String origin() { return "http://127.0.0.1:" + listener.getLocalPort(); }
    String url() { return origin() + prefix; }

    private void handle(Socket socket) {
        try (Socket connection = socket) {
            socket.setSoTimeout(15000);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());
            String requestLine = line(in);
            if (requestLine == null) return;
            String[] request = requestLine.split(" ");
            if (request.length != 3) { send(out,400,"text/plain","Invalid request"); return; }
            Map<String,String> headers = new HashMap<>(); String value; int size = requestLine.length();
            while ((value=line(in)) != null && !value.isEmpty()) {
                size += value.length();
                if (size > 32768) throw new IOException("Headers too large");
                int colon=value.indexOf(':');
                if(colon>0) headers.put(value.substring(0,colon).toLowerCase(Locale.ROOT),value.substring(colon+1).trim());
            }
            String host = headers.get("host");
            if (!("127.0.0.1:"+listener.getLocalPort()).equals(host) || !request[1].startsWith(prefix)) {
                send(out,403,"text/plain","Forbidden"); return;
            }
            if (headers.containsKey("origin") && !origin().equals(headers.get("origin"))) {
                send(out,403,"text/plain","Forbidden origin"); return;
            }
            if (!(request[0].equals("GET") || request[0].equals("HEAD") || request[0].equals("POST"))) {
                send(out,405,"text/plain","Method not allowed"); return;
            }
            Uri uri = Uri.parse(origin()+request[1]);
            String path = uri.getPath().substring(prefix.length());
            boolean head = request[0].equals("HEAD");
            try {
                switch (path) {
                    case "api/status": send(out,200,"application/json",library.status().toString()); break;
                    case "api/courses": send(out,200,"application/json",library.courses().toString()); break;
                    case "api/library": {
                        if(request[0].equals("GET"))send(out,200,"application/json",library.readLibrary().toString());
                        else if(request[0].equals("POST")){
                            int length=Integer.parseInt(headers.getOrDefault("content-length","0"));
                            if(length<=0 || length>PortableMetadata.LIMIT*2 || headers.containsKey("transfer-encoding"))throw new IOException("Invalid metadata body");
                            send(out,200,"application/json",library.saveLibrary(new String(readExactly(in,length),StandardCharsets.UTF_8)));
                        } else send(out,405,"text/plain","GET or POST required");
                        break;
                    }
                    case "api/course": {
                        JSONArray courses=library.courses(); JSONObject course=null;
                        for(int i=0;i<courses.length();i++) if(courses.getJSONObject(i).optString("id").equals(uri.getQueryParameter("path"))) course=courses.getJSONObject(i);
                        if(course==null) send(out,404,"text/plain","Course not found");
                        else send(out,200,"application/json",course.toString());
                        break;
                    }
                    case "api/progress": {
                        if(!request[0].equals("POST")) { send(out,405,"text/plain","POST required"); break; }
                        int length=Integer.parseInt(headers.getOrDefault("content-length","0"));
                        if(length<=0 || length>65536 || headers.containsKey("transfer-encoding")) { send(out,400,"text/plain","Invalid body"); break; }
                        byte[] body = readExactly(in,length);
                        send(out,409,"application/json",new JSONObject().put("error","Use PaceShelf library metadata").toString()); break;
                    }
                    case "api/refresh": library.refresh(); library.flush(); send(out,200,"application/json","{}"); break;
                    case "api/flush": library.flush(); send(out,200,"application/json",library.status().toString()); break;
                    case "api/battery": send(out,200,"application/json",battery().toString()); break;
                    case "api/video": case "api/thumb": {
                        mediaAccess.readLock().lock(); mediaClients.add(socket);
                        try {
                            if(path.equals("api/video")) video(out,uri.getQueryParameter("path"),headers.get("range"),head);
                            else thumb(out,uri.getQueryParameter("path"),head);
                        } finally {mediaClients.remove(socket);mediaAccess.readLock().unlock();}
                        break;
                    }
                    case "": case "index.html": asset(out,"index.html","text/html",head); break;
                    case "app.js": asset(out,"app.js","application/javascript",head); break;
                    case "library.js": asset(out,"library.js","application/javascript",head); break;
                    case "style.css": asset(out,"style.css","text/css",head); break;
                    case "fonts/InterVariable.woff2": asset(out,"fonts/InterVariable.woff2","font/woff2",head); break;
                    default: send(out,404,"text/plain","Not found");
                }
            } catch (Exception failure) {
                send(out,503,"application/json",new JSONObject().put("error","SSD unavailable or access denied. Reconnect it and choose the Courses folder again.").toString());
            }
        } catch(Exception ignored) { /* The player cancels requests when seeking or switching videos. */ }
        finally { clients.remove(socket); }
    }

    // Called after library.prepareForRemoval: reject new reads, cancel streams,
    // and wait until active thumbnail retrievers have released their drive handles.
    void stopDriveReads() {
        for(Socket client:mediaClients) try {client.close();} catch(IOException ignored) { }
        mediaAccess.writeLock().lock();
        try { /* Acquiring the exclusive lock drains all active media readers. */ }
        finally {mediaAccess.writeLock().unlock();}
    }

    private void video(OutputStream out,String id,String rangeHeader,boolean head) throws Exception {
        CourseLibrary.Entry entry=library.video(id);
        try (ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(entry.uri,"r")) {
            if(fd==null) throw new FileNotFoundException();
            long size=fd.getStatSize(); if(size<0)size=entry.size;
            HttpRange range;
            try { range=HttpRange.parse(rangeHeader,size); }
            catch(IllegalArgumentException invalid) {
                headers(out,416,"text/plain",0,Map.of("Content-Range","bytes */"+size)); out.flush(); return;
            }
            Map<String,String> extra=new LinkedHashMap<>(); extra.put("Accept-Ranges","bytes");
            if(range.partial)extra.put("Content-Range","bytes "+range.start+"-"+range.end+"/"+size);
            try(ParcelFileDescriptor.AutoCloseInputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
                in.getChannel().position(range.start);
                headers(out,range.partial?206:200,mime(entry.name),range.length(),extra); out.flush();
                if(!head)copy(in,out,range.length());
                out.flush();
            }
        }
    }

    private void thumb(OutputStream out,String id,boolean head) throws Exception {
        CourseLibrary.Entry entry=library.video(id);
        String key=CourseLibrary.hex(MessageDigest.getInstance("SHA-256").digest((entry.uri+":"+entry.size).getBytes(StandardCharsets.UTF_8)));
        File folder=new File(context.getCacheDir(),"thumbs"); folder.mkdirs();
        File cached=new File(folder,key+".jpg");
        if(!cached.exists() && thumbnails.tryAcquire()) {
            try {
                try(MediaMetadataRetriever retriever=new MediaMetadataRetriever()) {
                    retriever.setDataSource(context,entry.uri);
                    Bitmap frame=retriever.getScaledFrameAtTime(5_000_000,MediaMetadataRetriever.OPTION_CLOSEST_SYNC,320,180);
                    if(frame!=null) {
                        File temp=File.createTempFile(key,".tmp",folder);
                        try(OutputStream image=new FileOutputStream(temp)) { frame.compress(Bitmap.CompressFormat.JPEG,75,image); }
                        finally { frame.recycle(); }
                        if(!temp.renameTo(cached))temp.delete();
                    }
                }
            } catch(Exception ignored) { }
            finally { thumbnails.release(); }
        }
        if(cached.exists()) {
            headers(out,200,"image/jpeg",cached.length(),Map.of());
            if(!head)try(InputStream in=new FileInputStream(cached)) { copy(in,out,cached.length()); }
            out.flush();
        } else send(out,200,"image/svg+xml","<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='#222226'/><path d='M140 60L190 90L140 120Z' fill='#9a9aa2'/></svg>");
    }

    private JSONObject battery() throws Exception {
        Intent intent=context.registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if(intent==null)return new JSONObject().put("available",false);
        int level=intent.getIntExtra(BatteryManager.EXTRA_LEVEL,0), scale=intent.getIntExtra(BatteryManager.EXTRA_SCALE,100);
        int status=intent.getIntExtra(BatteryManager.EXTRA_STATUS,0);
        return new JSONObject().put("available",true).put("percentage",scale>0?Math.round(level*100f/scale):0)
            .put("status",status==BatteryManager.BATTERY_STATUS_CHARGING?"CHARGING":status==BatteryManager.BATTERY_STATUS_FULL?"FULL":"DISCHARGING")
            .put("temperature",intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE,0)/10.0);
    }

    private void asset(OutputStream out,String name,String mime,boolean head) throws Exception {
        try(InputStream in=context.getAssets().open(name)) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream(); copy(in,bytes,Long.MAX_VALUE);
            byte[] data=bytes.toByteArray(); headers(out,200,mime+"; charset=utf-8",data.length,Map.of());
            if(!head)out.write(data); out.flush();
        }
    }
    private static String mime(String name) {
        String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        return ext.equals("webm")?"video/webm":ext.equals("mkv")?"video/x-matroska":ext.equals("mov")?"video/quicktime":"video/mp4";
    }
    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream line=new ByteArrayOutputStream(); int c;
        while((c=in.read())!=-1) { if(c=='\n')break; if(c!='\r')line.write(c); if(line.size()>16384)throw new IOException("Line too long"); }
        return c==-1&&line.size()==0?null:line.toString("US-ASCII");
    }
    private static byte[] readExactly(InputStream in,int size) throws IOException {
        byte[] bytes=new byte[size]; int n=0,read;
        while(n<size && (read=in.read(bytes,n,size-n))!=-1)n+=read;
        if(n<size)throw new EOFException(); return bytes;
    }
    private static void copy(InputStream in,OutputStream out,long remaining) throws IOException {
        byte[] buffer=new byte[65536]; int n;
        while(remaining>0 && (n=in.read(buffer,0,(int)Math.min(buffer.length,remaining)))!=-1) { out.write(buffer,0,n); remaining-=n; }
    }
    private static void send(OutputStream out,int status,String mime,String text) throws IOException {
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8); headers(out,status,mime+"; charset=utf-8",bytes.length,Map.of()); out.write(bytes); out.flush();
    }
    private static void headers(OutputStream out,int status,String mime,long size,Map<String,String> extra) throws IOException {
        String reason=status==200?"OK":status==206?"Partial Content":status==416?"Range Not Satisfiable":status==403?"Forbidden":status==404?"Not Found":status==405?"Method Not Allowed":status==503?"Service Unavailable":"Bad Request";
        StringBuilder h=new StringBuilder("HTTP/1.1 "+status+" "+reason+"\r\nContent-Type: "+mime+"\r\nContent-Length: "+size+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
        h.append("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'\r\n");
        for(Map.Entry<String,String> entry:extra.entrySet())h.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
        h.append("\r\n"); out.write(h.toString().getBytes(StandardCharsets.US_ASCII));
    }
    @Override public void close() throws IOException {
        closed=true; listener.close();
        for(Socket client:clients)try { client.close(); }catch(IOException ignored) { }
        workers.shutdownNow();
    }
}
