package main

// The provider origin serves only an unprivileged, fixed player wrapper. It has
// no route to local files, metadata, drive operations or the application's assets.
import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"
)

type onlineServer struct {
	server *http.Server
	origin string
}

func onlineHandler(parent string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Read only", 405)
			return
		}
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || host != "127.0.0.1" {
			http.Error(w, "Forbidden host", 403)
			return
		}
		assets := map[string]string{"/player": "provider.html", "/provider.js": "provider.js", "/provider.css": "provider.css", "/youtube.js": "youtube.js"}
		name, ok := assets[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		data, err := frontend.ReadFile("static/" + name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		mime := map[string]string{"provider.html": "text/html; charset=utf-8", "provider.js": "application/javascript; charset=utf-8", "youtube.js": "application/javascript; charset=utf-8", "provider.css": "text/css; charset=utf-8"}[name]
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self' https://www.youtube.com; style-src 'self'; frame-src https://www.youtube.com; connect-src https://www.youtube.com; img-src https://i.ytimg.com data:; base-uri 'none'; form-action 'none'; frame-ancestors "+parent)
		if r.Method != "HEAD" {
			w.Write(data)
		}
	})
}

func startOnline(parent string) (*onlineServer, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &http.Server{Handler: onlineHandler(parent), ReadHeaderTimeout: 5 * time.Second}
	go s.Serve(listener)
	return &onlineServer{s, fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)}, nil
}
func (s *onlineServer) close() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s.server.Shutdown(ctx)
}
