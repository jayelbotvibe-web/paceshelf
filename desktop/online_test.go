package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOnlineOriginHasNoLibraryCapabilities(t *testing.T) {
	h := onlineHandler("http://127.0.0.1:8378")
	for _, path := range []string{"/api/library", "/api/video", "/api/eject", "/app.js", "/library.js", "/../main.go"} {
		req := httptest.NewRequest("GET", "http://127.0.0.1:9000"+path, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 404 {
			t.Fatalf("provider exposed %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/player", "/provider.js", "/provider.css", "/youtube.js"} {
		req := httptest.NewRequest("GET", "http://127.0.0.1:9000"+path, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("missing provider asset %s", path)
		}
		if w.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
			t.Fatal("provider identity suppressed")
		}
		csp := w.Header().Get("Content-Security-Policy")
		if !strings.Contains(csp, "frame-ancestors http://127.0.0.1:8378") || !strings.Contains(csp, "default-src 'none'") {
			t.Fatal("provider policy weakened")
		}
	}
	for _, fixture := range []struct {
		method, url string
		code        int
	}{{"POST", "http://127.0.0.1:9000/player", 405}, {"GET", "http://evil.invalid:9000/player", 403}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(fixture.method, fixture.url, nil))
		if w.Code != fixture.code {
			t.Fatal("provider accepted an unauthorized request")
		}
	}
}
