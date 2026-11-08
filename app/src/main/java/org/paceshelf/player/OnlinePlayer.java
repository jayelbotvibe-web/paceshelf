package org.paceshelf.player;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Separate, bridge-free WebView. Only bounded player snapshots return to trusted code. */
final class OnlinePlayer {
    static final String BASE="https://org.paceshelf.player/";
    private final Activity activity;
    private final FrameLayout container;
    private final Consumer<String> receive;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private LinearLayout panel;
    private WebView web;
    private String session;
    private JSONObject config;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private boolean paused,closing;
    private final Runnable poll=new Runnable(){public void run(){
        if(web==null||paused||closing)return;
        snapshot(()->{if(web!=null&&!paused&&!closing)handler.postDelayed(this,1000);});
    }};

    OnlinePlayer(Activity activity,FrameLayout container,Consumer<String> receive){this.activity=activity;this.container=container;this.receive=receive;}
    static JSONObject validateConfig(String text)throws Exception{
        if(text.length()>4096)throw new IOException("Invalid player request");
        JSONObject p=new JSONObject(text);String mode=p.optString("mode"),id=p.optString("session");
        if(!id.matches("[A-Za-z0-9_-]{20,80}") || !(mode.equals("play")&&p.optString("videoId").matches("[A-Za-z0-9_-]{11}") || mode.equals("inspect")&&p.optString("playlistId").matches("[A-Za-z0-9_-]{10,100}")))throw new IOException("Invalid YouTube reference");
        double start=p.optDouble("start",0);if(!Double.isFinite(start)||start<0||start>1e8)throw new IOException("Invalid starting position");
        return new JSONObject().put("session",id).put("mode",mode).put("videoId",p.optString("videoId")).put("playlistId",p.optString("playlistId")).put("start",start);
    }
    void open(JSONObject request){
        destroy(false);config=request;session=request.optString("session");paused=false;closing=false;
        panel=new LinearLayout(activity);panel.setOrientation(LinearLayout.VERTICAL);panel.setBackgroundColor(Color.rgb(246,247,249));
        Button back=new Button(activity);back.setText("Back to PaceShelf");back.setOnClickListener(v->close());panel.addView(back,new LinearLayout.LayoutParams(-1,-2));
        web=new WebView(activity);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onShowCustomView(View view,CustomViewCallback callback){
                if(fullScreen!=null){callback.onCustomViewHidden();return;}fullScreen=view;fullScreenCallback=callback;
                panel.setVisibility(View.GONE);container.addView(view,new FrameLayout.LayoutParams(-1,-1));
            }
            @Override public void onHideCustomView(){exitFullScreen();}
        });
        // Never add a JavaScript interface to this WebView: interfaces reach every iframe.
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){
                Uri uri=r.getUrl();
                if(!r.isForMainFrame())return !"https".equals(uri.getScheme());
                if(uri.toString().equals(BASE+"player"))return false;
                if(r.hasGesture()&&"https".equals(uri.getScheme())&&("www.youtube.com".equals(uri.getHost())||"youtube.com".equals(uri.getHost())||"youtu.be".equals(uri.getHost())))external(uri);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                Uri uri=r.getUrl();
                if("org.paceshelf.player".equals(uri.getHost())){
                    String path=uri.getPath();String name=path==null?"":path.substring(1);
                    if(!"https".equals(uri.getScheme())||!r.getMethod().equals("GET")||!(name.equals("provider.js")||name.equals("provider.css")||name.equals("youtube.js")))return blocked();
                    try{return new WebResourceResponse(name.endsWith("css")?"text/css":"application/javascript","UTF-8",activity.getAssets().open(name));}catch(Exception e){return blocked();}
                }
                if(!"https".equals(uri.getScheme())||"localhost".equals(uri.getHost())||"127.0.0.1".equals(uri.getHost())||"::1".equals(uri.getHost()))return blocked();
                return null;
            }
            @Override public void onPageFinished(WebView view,String url){
                if(web!=view||!url.equals(BASE+"player"))return;
                view.evaluateJavascript("window.PaceShelfProvider && window.PaceShelfProvider.start("+config+")",ignored->{handler.removeCallbacks(poll);handler.post(poll);});
            }
        });
        panel.addView(web,new LinearLayout.LayoutParams(-1,0,1));container.addView(panel,new FrameLayout.LayoutParams(-1,-1));
        try(InputStream in=activity.getAssets().open("provider.html")){
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
            while((count=in.read(buffer))!=-1){bytes.write(buffer,0,count);if(bytes.size()>65536)throw new IOException("Player page is too large");}
            web.loadDataWithBaseURL(BASE+"player",bytes.toString("UTF-8"),"text/html","UTF-8",null);
        }catch(Exception e){receive.accept("{\"kind\":\"state\",\"session\":"+JSONObject.quote(session)+",\"error\":\"Could not load the YouTube player.\"}");destroy(false);}
    }
    private static WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
    private void external(Uri uri){try{activity.startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}}
    boolean isOpen(){return web!=null;}
    void back(){if(fullScreen!=null)exitFullScreen();else close();}
    private void exitFullScreen(){if(fullScreen!=null){container.removeView(fullScreen);fullScreen=null;if(panel!=null)panel.setVisibility(View.VISIBLE);if(fullScreenCallback!=null)fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}}
    void command(String text){
        if(web==null||text.length()>2048)return;
        try{JSONObject p=new JSONObject(text);if(!session.equals(p.optString("session")))return;
            String action=p.optString("action");if(action.equals("dispose")){destroy(false);return;}
            if(!java.util.Set.of("load","play","pause","seek","speed","volume","mute").contains(action))return;
            if(action.equals("load")){
                JSONObject next=p.optJSONObject("value");if(next==null||!next.optString("videoId").matches("[A-Za-z0-9_-]{11}"))return;
                double start=next.optDouble("start",-1);if(!Double.isFinite(start)||start<0||start>1e8)return;
                config.put("videoId",next.getString("videoId")).put("start",start);
            }
            web.evaluateJavascript("window.PaceShelfProvider && window.PaceShelfProvider.command("+p+")",null);
        }catch(Exception ignored){}
    }
    private void snapshot(Runnable done){
        if(web==null){done.run();return;}
        final WebView selected=web;final String selectedSession=session;
        selected.evaluateJavascript("window.PaceShelfProvider && JSON.stringify(window.PaceShelfProvider.snapshot())",value->{
            if(web==selected&&value!=null&&value.length()<32768)try{
                Object raw=new JSONTokener(value).nextValue();JSONObject p=raw instanceof String?new JSONObject((String)raw):raw instanceof JSONObject?(JSONObject)raw:null;
                if(p!=null&&selectedSession.equals(p.optString("session")))receive.accept(p.toString());
            }catch(Exception ignored){}
            done.run();
        });
    }
    void close(){
        if(web==null||closing)return;closing=true;handler.removeCallbacks(poll);
        AtomicBoolean finished=new AtomicBoolean();Runnable finish=()->{if(finished.compareAndSet(false,true))destroy(true);};
        snapshot(finish);handler.postDelayed(finish,500);
    }
    void pause(Runnable done){
        if(web==null){done.run();return;}paused=true;handler.removeCallbacks(poll);
        AtomicBoolean finished=new AtomicBoolean();Runnable finish=()->{if(!finished.compareAndSet(false,true))return;
            if(web!=null){web.evaluateJavascript("window.PaceShelfProvider && window.PaceShelfProvider.command({session:"+JSONObject.quote(session)+",action:'pause'})",null);web.onPause();}done.run();};
        snapshot(finish);handler.postDelayed(finish,500);
    }
    void resume(){paused=false;if(web!=null){web.onResume();handler.removeCallbacks(poll);handler.post(poll);}}
    void close(String expected){if(expected.equals(session))destroy(false);}
    void destroy(boolean notify){
        exitFullScreen();
        handler.removeCallbacksAndMessages(null);String previous=session;
        if(web!=null){web.stopLoading();web.loadUrl("about:blank");web.destroy();web=null;}
        if(panel!=null){container.removeView(panel);panel=null;}
        session=null;closing=false;
        if(notify&&previous!=null)receive.accept("{\"kind\":\"state\",\"closed\":true,\"session\":"+JSONObject.quote(previous)+"}");
    }
}
