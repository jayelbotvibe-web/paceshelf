package org.paceshelf.player;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.DocumentsContract;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final int PICK_FOLDER=100, IMPORT_PROGRESS=101, EXPORT_PROGRESS=102;
    private final ExecutorService background=Executors.newSingleThreadExecutor();
    private WebView web;
    private FrameLayout container;
    private CourseLibrary library;
    private LocalServer server;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private int oldSystemUi;
    private boolean destroyed;
    private boolean paused;
    private boolean stopped, pauseSaveFinished;
    private int pauseGeneration;
    private boolean ejectInProgress;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        container=new FrameLayout(this); container.setBackgroundColor(Color.rgb(246,247,249));
        container.setOnApplyWindowInsetsListener((v,insets)-> {
            v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(container);
        library=new CourseLibrary(getApplicationContext());
        try { server=new LocalServer(getApplicationContext(),library); }
        catch(Exception failure) { showFatal("Could not start PaceShelf. Close and reopen the app."); return; }
        web=new WebView(this); web.setBackgroundColor(Color.rgb(246,247,249));
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(),"Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(server.url());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                if(!request.getUrl().toString().startsWith(server.url()))
                    return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                return null;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view,CustomViewCallback callback) {
                if(fullScreen!=null) { callback.onCustomViewHidden(); return; }
                fullScreen=view; fullScreenCallback=callback;
                oldSystemUi=getWindow().getDecorView().getSystemUiVisibility();
                web.setVisibility(View.GONE); container.addView(view,new FrameLayout.LayoutParams(-1,-1));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            @Override public void onHideCustomView() { exitFullScreen(); }
        });
        container.addView(web,new FrameLayout.LayoutParams(-1,-1));
        String saved=getPreferences(0).getString("tree",null);
        if(saved==null)web.loadUrl(server.url());
        else if(getPreferences(0).getBoolean("removalPending",false)) {
            library.holdForRemoval(Uri.parse(saved));
            web.loadUrl(server.url());
        }
        else {
            TextView loading=new TextView(this); loading.setText("PaceShelf\n\nConnecting to your course library…");
            loading.setTextColor(Color.rgb(32,36,43)); loading.setTextSize(20); loading.setGravity(Gravity.CENTER);
            container.addView(loading,new FrameLayout.LayoutParams(-1,-1));
            background.execute(()-> {
                try { library.open(Uri.parse(saved)); } catch(Exception ignored) { }
                runOnUiThread(()-> { if(!destroyed) { container.removeView(loading); web.loadUrl(server.url()); } });
            });
        }
    }

    private void pickFolder() {
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            |Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String saved=getPreferences(0).getString("tree",null);
        if(saved!=null)intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI,Uri.parse(saved));
        startActivityForResult(intent,PICK_FOLDER);
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(result!=RESULT_OK || data==null || data.getData()==null) { notifyWeb("Selection cancelled."); return; }
        Uri uri=data.getData();
        if(request==PICK_FOLDER) {
            try {
                if((data.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION)!=0)
                    getContentResolver().takePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                else getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch(Exception failure) { toast("Could not remember folder access. Please select it again."); return; }
            getPreferences(0).edit().putString("tree",uri.toString()).commit();
            notifyWeb("Scanning course folders…");
            background.execute(()-> {
                try { library.open(uri); runOnUiThread(()-> { if(!destroyed)web.reload(); }); }
                catch(Exception failure) { runOnUiThread(()-> { if(!destroyed) { web.reload(); toast("Folder unavailable. Connect the SSD and choose Courses again."); } }); }
            });
        } else if(request==EXPORT_PROGRESS) {
            background.execute(()-> {
                try {
                    byte[] bytes=library.exportProgress().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    try(java.io.OutputStream out=getContentResolver().openOutputStream(uri,"wt")) {
                        if(out==null)throw new java.io.IOException("Cannot create export");
                        out.write(bytes);out.flush();
                    }
                    runOnUiThread(()->toast("Progress backup exported."));
                } catch(Exception failure) {runOnUiThread(()->toast("Could not export progress: "+failure.getMessage()));}
            });
        } else if(request==IMPORT_PROGRESS) {
            background.execute(()-> {
                try(java.io.InputStream in=getContentResolver().openInputStream(uri)) {
                    if(in==null)throw new java.io.IOException("Cannot open backup");
                    java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
                    while((n=in.read(buffer))!=-1){out.write(buffer,0,n);if(out.size()>PortableMetadata.LIMIT)throw new java.io.IOException("Backup is too large");}
                    String payload=out.toString("UTF-8");
                    runOnUiThread(()->{if(!destroyed)web.evaluateJavascript("window.paceShelfImport && window.paceShelfImport("+JSONObject.quote(payload)+")",null);});
                }catch(Exception failure) { runOnUiThread(()->toast("Import failed. Choose a PaceShelf library backup.")); }
            });
        }
    }

    public final class Bridge {
        @JavascriptInterface public void chooseFolder() { runOnUiThread(()->pickFolder()); }
        @JavascriptInterface public void importProgress() { runOnUiThread(()-> {
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(intent,IMPORT_PROGRESS);
        }); }
        @JavascriptInterface public void exportProgress() { runOnUiThread(()-> {
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_TITLE,"paceshelf-library-"+java.time.LocalDate.now()+".json");
            startActivityForResult(intent,EXPORT_PROGRESS);
        }); }
        @JavascriptInterface public String getSpeed() { return getSharedPreferences("player",0).getString("speed","1"); }
        @JavascriptInterface public void setSpeed(String speed) { library.setSpeed(speed); }
        @JavascriptInterface public String saveProgress(String body) {
            return "Use PaceShelf library metadata to save progress.";
        }
        @JavascriptInterface public String saveLibrary(String body) {
            try{return library.saveLibrary(body);}catch(Exception failure){return "{\"error\":"+JSONObject.quote(failure.getMessage())+"}";}
        }
        @JavascriptInterface public String setStorageMode(String mode) {
            try{library.setStorageMode(mode);return library.status().toString();}catch(Exception failure){return "{\"error\":"+JSONObject.quote(failure.getMessage())+"}";}
        }
        @JavascriptInterface public String flushProgress() {
            library.flush();
            try { return library.status().toString(); }
            catch(Exception failure) { return "{}"; }
        }
        @JavascriptInterface public void keepAwake(boolean playing) { runOnUiThread(()-> {
            if(playing && !paused)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }); }
        @JavascriptInterface public void eject() {
            runOnUiThread(()-> {
                if(destroyed || ejectInProgress)return;
                ejectInProgress=true;
                web.evaluateJavascript("window.coursePlayerPrepareRemoval && window.coursePlayerPrepareRemoval()",ignored-> {
                    if(destroyed)return;
                    if(!"true".equals(ignored)){ejectInProgress=false;toast("The latest save failed. Reconnect and retry or export a backup before removing the drive.");return;}
                    background.execute(()-> {
                        boolean local=false, shared=false;
                        try {
                            JSONObject result=library.prepareForRemoval();
                            local=result.getBoolean("localSaved"); shared=result.getBoolean("ssdSaved");
                            server.stopDriveReads();
                        } catch(Exception failure) { }
                        final boolean localSaved=local, ssdSaved=shared;
                        String saved=ssdSaved ? "Your progress has been saved and checked on the SSD."
                            : localSaved ? "Your progress is saved on this device. The SSD save could not be verified. Reconnect and retry before moving the drive to another device."
                            : "The save could not be confirmed. Reconnect the drive and retry before continuing on another device.";
                        final String message=saved+"\n\nDrive activity in PaceShelf is stopped.\n\nIn Samsung My Files:\n1. Open the menu next to USB storage.\n2. Tap Unmount.\n3. Wait for confirmation, then unplug the SSD.";
                        runOnUiThread(()-> {
                            if(destroyed)return;
                            web.evaluateJavascript("window.coursePlayerRemovalPrepared && window.coursePlayerRemovalPrepared("+localSaved+","+ssdSaved+")",null);
                            AlertDialog dialog=new AlertDialog.Builder(MainActivity.this)
                                .setTitle(ssdSaved?"Finish safe removal":"SSD save not verified")
                                .setMessage(message)
                                .setPositiveButton("Open My Files",(d,which)-> {
                                    Intent files=getPackageManager().getLaunchIntentForPackage("com.sec.android.app.myfiles");
                                    if(files!=null)startActivity(files);
                                    else toast("Use the USB storage notification or your device's Files app to unmount the SSD.");
                                }).setNegativeButton("Return to app",null).create();
                            dialog.setOnDismissListener(d->ejectInProgress=false);
                            dialog.show();
                        });
                    });
                });
            });
        }
    }

    private void exitFullScreen() {
        if(fullScreen==null)return;
        container.removeView(fullScreen); fullScreen=null;
        getWindow().getDecorView().setSystemUiVisibility(oldSystemUi); web.setVisibility(View.VISIBLE);
        WebChromeClient.CustomViewCallback callback=fullScreenCallback; fullScreenCallback=null;
        if(callback!=null)callback.onCustomViewHidden();
    }
    private void notifyWeb(String message) {
        if(web!=null&&!destroyed)web.evaluateJavascript("window.coursePlayerNotice && window.coursePlayerNotice("+JSONObject.quote(message)+")",null);
    }
    private void toast(String message) { if(!destroyed)Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
    private void showFatal(String message) { new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Close",(d,w)->finish()).show(); }
    @Override public void onBackPressed() {
        if(fullScreen!=null) { exitFullScreen(); return; }
        if(web==null) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.coursePlayerBack ? window.coursePlayerBack() : false",result-> {
            if(!"true".equals(result))moveTaskToBack(true);
        });
    }
    @Override protected void onPause() {
        paused=true; pauseSaveFinished=false;
        final int generation=++pauseGeneration;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(web!=null)web.evaluateJavascript("window.coursePlayerSuspend ? window.coursePlayerSuspend() : window.coursePlayerPause && window.coursePlayerPause()",ignored-> {
            if(!destroyed)background.execute(()-> {
                library.flush();
                runOnUiThread(()-> {
                    if(!destroyed && paused && generation==pauseGeneration) {
                        pauseSaveFinished=true;
                        if(stopped)web.pauseTimers();
                    }
                });
            });
        });
        super.onPause();
    }
    @Override protected void onStop() {
        stopped=true;
        if(web!=null) {
            web.onPause();
            // Finish the last progress checkpoint before suspending JavaScript.
            if(pauseSaveFinished)web.pauseTimers();
        }
        super.onStop();
    }
    @Override protected void onResume() {
        super.onResume(); stopped=false; ++pauseGeneration;
        if(web!=null) { web.resumeTimers(); web.onResume(); }
        if(paused && server!=null) {
            paused=false;
            if(library.isRemovalPaused())return;
            String selected=getPreferences(0).getString("tree",null);
            if(selected!=null)background.execute(()-> {
                runOnUiThread(()-> {
                    if(!destroyed)web.evaluateJavascript("window.coursePlayerRefresh && window.coursePlayerRefresh()",null);
                });
            });
        }
    }
    @Override protected void onDestroy() {
        destroyed=true;
        if(web!=null) { web.removeJavascriptInterface("Android"); web.destroy(); }
        if(server!=null)try { server.close(); } catch(Exception ignored) { }
        background.execute(()->library.close()); background.shutdown();
        super.onDestroy();
    }
}
