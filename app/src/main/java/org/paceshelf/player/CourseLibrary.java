package org.paceshelf.player;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** SAF access: videos remain on the USB drive; only progress and thumbnails are cached. */
final class CourseLibrary implements Closeable {
    static final long SHARED_SAVE_INTERVAL_MS = 15_000;
    static final String DIR = DocumentsContract.Document.MIME_TYPE_DIR;
    static final Set<String> EXTENSIONS = Set.of("mp4", "webm", "mkv", "mov", "m4v");
    final Context context;
    final ContentResolver resolver;
    private final ScheduledExecutorService sync = Executors.newSingleThreadScheduledExecutor();
    private final Object lock = new Object();
    private Uri tree, libraryRoot, metadata;
    private Map<String, Entry> videos = new HashMap<>();
    private JSONArray courses = new JSONArray();
    private JSONObject progress = new JSONObject();
    private JSONObject courseAliases = new JSONObject();
    private AtomicFile local;
    private PortableMetadata portable;
    private ScheduledFuture<?> pendingSync;
    private long nextSharedSaveAt;
    private boolean settingsDirty = true;
    private volatile boolean sharedWritable, dirty;
    private int nextSlot;
    private volatile String error = "";
    private volatile String syncStatus = "Choose your Courses folder on the SSD.";
    private volatile boolean ready, scanning;
    private volatile boolean removalPaused;
    private volatile String folderName = "";
    private volatile String syncError = "", verifiedAt = "";

    static final class Entry {
        final Uri uri;
        final String name, mime;
        final long size;
        Entry(Uri uri, String name, String mime, long size) {
            this.uri = uri; this.name = name; this.mime = mime; this.size = size;
        }
        boolean directory() { return DIR.equals(mime); }
    }

    CourseLibrary(Context context) { this.context = context; resolver = context.getContentResolver(); }

    JSONObject status() throws Exception {
        JSONObject result = new JSONObject().put("ready", ready).put("selected", tree != null)
            .put("scanning", scanning).put("error", error).put("folder", folderName)
            .put("removing", removalPaused)
            .put("sync", syncStatus).put("shared", sharedWritable)
            .put("pending", dirty).put("platform", "android")
            .put("syncError",syncError).put("verifiedAt",verifiedAt).put("historyEntries",progress.length())
            .put("sharedFolder",libraryRoot == null ? "" : DocumentsContract.getDocumentId(libraryRoot)+"/.paceshelf")
            .put("speed", context.getSharedPreferences("player", 0).getString("speed", "1"));
        if(portable!=null){JSONObject p=portable.status();for(Iterator<String> keys=p.keys();keys.hasNext();){String k=keys.next();result.put(k,p.get(k));}}
        return result;
    }

    void open(Uri selected) throws Exception {
        synchronized (lock) {
            if(portable!=null){portable.close();portable=null;}
            if (pendingSync != null) pendingSync.cancel(false);
            tree = selected; libraryRoot = null; metadata = null; dirty = false; sharedWritable = false; ready = false; removalPaused = false;
            nextSlot = 0; syncError = ""; verifiedAt = ""; settingsDirty = true;
            progress = new JSONObject(); videos = new HashMap<>(); courses = new JSONArray();
            error = ""; scanning = true;
            try {
            Uri selectedRoot = root();
            libraryRoot = resolveLibraryRoot(selectedRoot);
            folderName = document(tree,DocumentsContract.getDocumentId(libraryRoot)).name;
            String identity = tree.getAuthority() + ":" + DocumentsContract.getDocumentId(libraryRoot);
            String hash = hex(MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8)));
            local = new AtomicFile(new File(context.getFilesDir(), "progress-" + hash + ".json"));
            boolean hadCanonicalCache = local.getBaseFile().exists();
            if(hadCanonicalCache) {
                // Keep the pre-upgrade cache available for recovery while diagnosing phone history.
                File savedCache=new File(context.getFilesDir(),"history-before-1.2.1-"+hash+".json");
                if(!savedCache.exists()) try(InputStream in=local.openRead(); FileOutputStream out=new FileOutputStream(savedCache)) {
                    byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);out.getFD().sync();
                }
            }
            readLocal(local);
            // Preserve histories from earlier versions, which keyed the cache by picker URI.
            String legacyHash = hex(MessageDigest.getInstance("SHA-256").digest(selected.toString().getBytes(StandardCharsets.UTF_8)));
            if(!hadCanonicalCache) readLocal(new AtomicFile(new File(context.getFilesDir(), "progress-" + legacyHash + ".json")));
            try {
                // Older builds wrote metadata beside the selected folder. Read before migrating.
                if (!selectedRoot.equals(libraryRoot)) readSnapshots(child(selectedRoot, ".course-player"));
                metadata = child(libraryRoot, ".course-player");
                readSnapshots(metadata);
            } catch (Exception noSharedWrite) {
                syncError = noSharedWrite.getClass().getSimpleName()+": "+String.valueOf(noSharedWrite.getMessage());
                syncStatus = "Saved on this device only. SSD writing is unavailable; other devices cannot resume this progress.";
            }
            if (metadata != null) {
                try {
                    Uri settings = child(metadata, "settings.json");
                    if (settings != null) try (InputStream in = resolver.openInputStream(settings)) {
                        String speed = readJson(in).optString("speed", "1.7");
                        context.getSharedPreferences("player", 0).edit().putString("speed", speed).commit();
                    }
                } catch (Exception ignored) { }
            }
                rebuildLocked();
                JSONObject loaded=progress;progress=new JSONObject();
                for(Iterator<String> keys=loaded.keys();keys.hasNext();) {
                    String key=keys.next();merge(new JSONObject().put(canonicalHistoryId(key),loaded.get(key)));
                }
                writeLocal(); ready = true;
                portable = new PortableMetadata(context,libraryRoot,hash);
                context.getSharedPreferences("MainActivity",0).edit().putBoolean("removalPending",false).commit();
                // Give the first playback checkpoint a short path to the SSD.
                nextSharedSaveAt = 0;
            } catch (Exception failure) {
                error = "Connect the SSD, unlock your device, then tap Reconnect or choose the Courses folder again.";
                throw failure;
            } finally { scanning = false; }
        }
    }

    void refresh() throws Exception {
        synchronized (lock) {
            if (tree == null) throw new IOException("Choose your Courses folder first.");
            open(tree);
        }
    }

    private Uri resolveLibraryRoot(Uri selected) throws Exception {
        // All supported picker choices use the same Courses/.course-player directory and IDs.
        Uri coursesDir = child(selected, "Courses");
        if (coursesDir != null && DIR.equals(document(tree, DocumentsContract.getDocumentId(coursesDir)).mime)) return coursesDir;
        Uri parent = child(selected, "Video Library");
        if (parent != null) {
            Uri nested = child(parent, "Courses");
            if (nested != null) return nested;
        }
        return selected;
    }

    private void readLocal(AtomicFile file) {
        try (InputStream in = file.openRead()) { merge(readJson(in)); }
        catch (Exception ignored) { /* Independent local/SSD copies remain available. */ }
    }

    private void readSnapshots(Uri directory) throws Exception {
        if (directory == null) return;
        Instant newest = Instant.MIN;
        for (int i=0; i<2; i++) {
            Uri file = child(directory, i == 0 ? "progress-a.json" : "progress-b.json");
            if (file != null) try (InputStream in = resolver.openInputStream(file)) {
                JSONObject snapshot = readJson(in); merge(snapshot);
                Instant latest = latestUpdate(snapshot);
                if (latest.isAfter(newest)) { newest = latest; nextSlot = 1-i; }
            } catch (Exception badSnapshot) { /* Recover using the other snapshot and local copy. */ }
        }
    }

    private String canonicalHistoryId(String key) {
        String id=key.replaceFirst("^(Video Library/)?Courses/", "");
        int slash=id.indexOf('/');
        if(slash>0) {
            String course=id.substring(0,slash);
            return courseAliases.optString(course,course)+id.substring(slash);
        }
        return id;
    }

    private void recoverPreviousDeviceCaches() throws Exception {
        // Formatting changes the Android picker URI. Import only records matching
        // actual video IDs in this library; keep all prior cache files intact.
        File[] files=context.getFilesDir().listFiles((dir,name)->name.startsWith("progress-") && name.endsWith(".json"));
        if(files==null)return;
        for(File file:files) {
            if(file.equals(local.getBaseFile()))continue;
            try(InputStream in=new AtomicFile(file).openRead()) {
                JSONObject previous=readJson(in), matching=new JSONObject();
                for(Iterator<String> keys=previous.keys();keys.hasNext();) {
                    String key=keys.next();String canonical=canonicalHistoryId(key);
                    if(videos.containsKey(canonical))matching.put(canonical,previous.get(key));
                }
                merge(matching);
            } catch(Exception ignored) { /* Other valid device caches and SSD snapshots remain available. */ }
        }
    }

    private void rebuildLocked() throws Exception {
        Map<String, Entry> found = new HashMap<>();
        JSONArray list = new JSONArray();
        JSONObject aliases = new JSONObject();
        Uri aliasFile=metadata == null ? null : child(metadata,"course-aliases.json");
        if(aliasFile!=null) try(InputStream in=resolver.openInputStream(aliasFile)) {aliases=readJson(in);}
        courseAliases=aliases;
        Set<String> logicalNames=new HashSet<>();
        List<Entry> top = children(libraryRoot);
        top.sort((a,b) -> new NaturalOrder().compare(a.name, b.name));
        JSONArray direct=new JSONArray();
        for(Entry entry:top){
            int dot=entry.name.lastIndexOf('.');
            if(entry.directory() || dot<0 || !EXTENSIONS.contains(entry.name.substring(dot+1).toLowerCase(Locale.ROOT)))continue;
            found.put(entry.name,entry);direct.put(new JSONObject().put("id",entry.name).put("title",entry.name.substring(0,dot)).put("size",entry.size).put("section",""));
        }
        if(direct.length()>0)list.put(new JSONObject().put("id","__root__").put("name",folderName).put("videos",direct.length()).put("sections",new JSONArray().put(new JSONObject().put("name","").put("videos",direct))));
        for (Entry course : top) {
            if (!course.directory() || course.name.startsWith(".")) continue;
            String courseId=aliases.optString(course.name,course.name);
            if(courseId.isEmpty() || courseId.equals(".") || courseId.equals("..") || courseId.contains("/") || courseId.contains("\\") || !logicalNames.add(courseId))
                throw new IOException("Invalid or duplicate course history identity");
            Map<String, List<JSONObject>> sections = new TreeMap<>(new NaturalOrder());
            walk(course.uri, courseId, "", sections, found, 0);
            JSONArray sectionList = new JSONArray(); int count = 0;
            for (Map.Entry<String, List<JSONObject>> section : sections.entrySet()) {
                section.getValue().sort((a,b) -> new NaturalOrder().compare(a.optString("title"), b.optString("title")));
                JSONArray items = new JSONArray();
                for (JSONObject video : section.getValue()) { items.put(video); count++; }
                sectionList.put(new JSONObject().put("name", section.getKey()).put("videos", items));
            }
            if (count > 0) list.put(new JSONObject().put("id", courseId).put("name", courseId)
                .put("videos", count).put("sections", sectionList));
        }
        courses = list; videos = found;
    }

    private void walk(Uri dir, String rel, String sectionPath, Map<String,List<JSONObject>> sections,
                      Map<String,Entry> found, int depth) throws Exception {
        if (depth > 40) throw new IOException("Folder nesting is too deep.");
        for (Entry entry : children(dir)) {
            String id = rel + "/" + entry.name;
            if (entry.directory()) {
                if (!entry.name.startsWith(".")) walk(entry.uri, id,
                    sectionPath.isEmpty() ? entry.name : sectionPath + "/" + entry.name, sections, found, depth + 1);
            } else {
                int dot = entry.name.lastIndexOf('.');
                if (dot < 0 || !EXTENSIONS.contains(entry.name.substring(dot+1).toLowerCase(Locale.ROOT))) continue;
                String section = cleanSection(sectionPath);
                JSONObject video = new JSONObject().put("id", id).put("title", entry.name.substring(0,dot))
                    .put("size", entry.size).put("section", section);
                sections.computeIfAbsent(section, ignored -> new ArrayList<>()).add(video);
                found.put(id, entry);
            }
        }
    }

    static String cleanSection(String path) {
        List<String> keep = new ArrayList<>();
        for (String part : path.split("/")) if (!part.isEmpty() && !part.equals(".")) keep.add(part);
        return String.join(" / ", keep);
    }

    JSONArray courses() throws Exception {
        synchronized (lock) {
            if (!ready) throw new IOException(error.isEmpty() ? "Choose your Courses folder on the SSD." : error);
            JSONArray copy = new JSONArray(courses.toString());
            for (int i=0;i<copy.length();i++) {
                JSONArray sections = copy.getJSONObject(i).getJSONArray("sections");
                for (int j=0;j<sections.length();j++) {
                    JSONObject section = sections.getJSONObject(j);
                    JSONArray items = section.getJSONArray("videos"); int watched = 0;
                    for (int k=0;k<items.length();k++) {
                        JSONObject v = items.getJSONObject(k), p = progress.optJSONObject(v.getString("id"));
                        v.put("position", p == null ? 0 : p.optDouble("position"));
                        v.put("duration", p == null ? 0 : p.optDouble("duration"));
                        v.put("updatedAt", p == null ? "" : p.optString("updatedAt"));
                        if (v.optDouble("position") > 0) watched++;
                    }
                    section.put("watched", watched);
                }
            }
            return copy;
        }
    }

    Entry video(String id) throws IOException {
        synchronized (lock) {
            if (removalPaused) throw new IOException("Drive removal is in progress");
            Entry entry = videos.get(id);
            if (entry == null) throw new FileNotFoundException("Video not found.");
            return entry;
        }
    }

    void save(String body) throws Exception {
        JSONObject update = new JSONObject(body);
        String id = update.getString("id");
        double pos = update.getDouble("position"), duration = update.getDouble("duration");
        if (!Double.isFinite(pos) || !Double.isFinite(duration) || pos < 0 || duration <= 0)
            throw new IllegalArgumentException("Invalid progress");
        synchronized (lock) {
            if (removalPaused) throw new IOException("Reconnect the library before saving progress");
            if (!videos.containsKey(id)) throw new FileNotFoundException("Unknown video");
            Instant stamp = Instant.now();
            JSONObject previous = progress.optJSONObject(id);
            if (previous != null && previous.optDouble("position") == Math.min(pos,duration)
                    && previous.optDouble("duration") == duration) return;
            if (previous != null) {
                Instant old = Instant.parse(previous.getString("updatedAt"));
                if (!stamp.isAfter(old)) stamp = old.plusNanos(1);
            }
            progress.put(id, new JSONObject().put("position", Math.min(pos, duration)).put("duration", duration)
                .put("updatedAt", stamp.toString()));
            writeLocal(); dirty = true; scheduleSyncLocked();
        }
    }

    void setSpeed(String speed) {
        if (!Set.of("0.5","0.75","1","1.25","1.5","1.7","1.75","2").contains(speed)) return;
        synchronized (lock) {
            if (speed.equals(context.getSharedPreferences("player",0).getString("speed","1.7"))) return;
            context.getSharedPreferences("player", 0).edit().putString("speed", speed).commit();
        }
    }

    int importProgress(Uri file) throws Exception {
        try (InputStream in = resolver.openInputStream(file)) {
            JSONObject incoming = readJson(in);
            synchronized (lock) {
                if (!ready) throw new IOException("Choose the Courses folder before importing progress.");
                int count = merge(incoming); writeLocal(); dirty = true; scheduleSyncLocked(); return count;
            }
        }
    }

    private int merge(JSONObject incoming) throws Exception {
        int count = 0;
        for (Iterator<String> keys = incoming.keys(); keys.hasNext();) {
            String original = keys.next(); JSONObject item = incoming.optJSONObject(original);
            String id = canonicalHistoryId(original);
            if (item == null) continue;
            double position = item.optDouble("position", -1), duration = item.optDouble("duration", -1);
            if (!Double.isFinite(position) || !Double.isFinite(duration) || position < 0 || duration <= 0) continue;
            Instant time;
            try { time = Instant.parse(item.getString("updatedAt")); } catch (Exception malformed) { continue; }
            JSONObject existing = progress.optJSONObject(id);
            Instant existingTime = existing == null ? Instant.MIN : Instant.parse(existing.getString("updatedAt"));
            if (time.isAfter(existingTime)) {
                progress.put(id, new JSONObject().put("position", Math.min(position, duration))
                    .put("duration", duration).put("updatedAt", time.toString()));
                count++;
            }
        }
        return count;
    }

    String exportProgress() throws Exception {
        synchronized(lock) {
            if(portable!=null)return portable.exportPayload();
            if (progress.length()==0) throw new IOException("Connect your library first to load its saved history.");
            return progress.toString(2);
        }
    }

    private void writeLocal() throws Exception {
        if (local == null) return;
        FileOutputStream out = null;
        // AtomicFile.finishWrite already syncs and commits the file.
        try { out = local.startWrite(); out.write(progress.toString().getBytes(StandardCharsets.UTF_8)); local.finishWrite(out); }
        catch (Exception e) { if (out != null) local.failWrite(out); throw e; }
    }

    private void scheduleSyncLocked() {
        if (removalPaused) return;
        if (pendingSync == null || pendingSync.isDone()) pendingSync = sync.schedule(() -> {
            synchronized (lock) { pendingSync = null; if (!removalPaused && dirty) syncSharedLocked(); }
        }, Math.max(500, nextSharedSaveAt-SystemClock.elapsedRealtime()), TimeUnit.MILLISECONDS);
    }

    void flush() { synchronized (lock) {
        if(portable!=null){portable.flush();return;}
        if (pendingSync != null) pendingSync.cancel(false);
        pendingSync = null;
        if (!removalPaused && (dirty || !sharedWritable)) syncSharedLocked();
    } }

    boolean isRemovalPaused() { return removalPaused; }

    void holdForRemoval(Uri selected) {
        synchronized (lock) {
            tree = selected; ready = false; removalPaused = true;
            syncStatus = "Drive activity is stopped. Unmount USB storage in My Files before unplugging.";
        }
    }

    JSONObject prepareForRemoval() throws Exception {
        synchronized (lock) {
            removalPaused = true;
            context.getSharedPreferences("MainActivity",0).edit().putBoolean("removalPending",true).commit();
            if (pendingSync != null) pendingSync.cancel(false);
            pendingSync = null;
            boolean localSaved = portable!=null && portable.hasLocalSave();
            sharedWritable = false;
            if(portable!=null){portable.flush();sharedWritable=portable.status().getBoolean("shared");portable.close();}
            else if (localSaved) syncSharedLocked(true);
            ready = false;
            return new JSONObject().put("localSaved", localSaved).put("ssdSaved", sharedWritable);
        }
    }

    private void syncSharedLocked() {
        syncSharedLocked(true);
    }

    private void syncSharedLocked(boolean verify) {
        // Legacy histories are import sources only, including on error paths.
        if(portable!=null)portable.flush();
        else {
            sharedWritable=false;
            syncStatus="Legacy progress is read-only. Open a PaceShelf library to save new changes.";
        }
    }

    private static Instant latestUpdate(JSONObject snapshot) {
        Instant newest = Instant.MIN;
        for (Iterator<String> keys = snapshot.keys(); keys.hasNext();) {
            JSONObject item = snapshot.optJSONObject(keys.next());
            if (item != null) try {
                Instant time = Instant.parse(item.getString("updatedAt"));
                if (time.isAfter(newest)) newest = time;
            } catch (Exception ignored) { }
        }
        return newest;
    }

    private Uri root() { return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)); }
    private Entry document(Uri treeUri, String id) throws Exception {
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
        try (Cursor c = resolver.query(uri, projection(), null, null, null)) {
            if (c == null || !c.moveToFirst()) throw new IOException("SSD folder is unavailable");
            return entry(c, treeUri);
        }
    }
    private List<Entry> children(Uri dir) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(dir));
        List<Entry> result = new ArrayList<>();
        try (Cursor c = resolver.query(children, projection(), null, null, null)) {
            if (c == null) throw new IOException("SSD is unavailable");
            while (c.moveToNext()) result.add(entry(c, tree));
        }
        return result;
    }
    private Uri child(Uri dir, String name) throws Exception {
        for (Entry entry : children(dir)) if (entry.name.equals(name)) return entry.uri;
        return null;
    }
    private Entry entry(Cursor cursor, Uri treeUri) {
        return new Entry(DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0)),
            cursor.getString(1), cursor.getString(2), cursor.isNull(3) ? 0 : cursor.getLong(3));
    }
    private static String[] projection() { return new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE}; }
    private static JSONObject readJson(InputStream in) throws Exception {
        if (in == null) throw new IOException("Cannot open JSON file");
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
        while ((n=in.read(buf))!=-1) { out.write(buf,0,n); if (out.size()>16*1024*1024) throw new IOException("Progress file is too large"); }
        return new JSONObject(out.toString("UTF-8"));
    }
    static String hex(byte[] bytes) { StringBuilder s=new StringBuilder(); for(byte b:bytes)s.append(String.format("%02x",b)); return s.toString(); }
    JSONObject readLibrary() throws Exception {synchronized(lock){if(portable==null)throw new IOException("Choose a library first");return portable.readState();}}
    String saveLibrary(String request) throws Exception {synchronized(lock){if(portable==null || removalPaused)throw new IOException("Reconnect your library first");return portable.save(request);}}
    void setStorageMode(String mode) throws Exception {synchronized(lock){if(portable==null)throw new IOException("Choose a library first");portable.setMode(mode);}}
    @Override public void close() { flush();if(portable!=null)portable.close();sync.shutdown(); }
}
