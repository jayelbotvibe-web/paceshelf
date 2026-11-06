package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestThreeDevicesAndRecovery(t *testing.T) {
	root := t.TempDir()
	shared := filepath.Join(root, "Courses", ".course-player")
	if err := os.MkdirAll(filepath.Dir(shared), 0700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(root, "old-desktop.json")
	id := "DEMO101/Day 1/Lesson.mp4"
	old := map[string]Progress{id: {Position: 8, Duration: 60, UpdatedAt: time.Now().Add(-time.Hour)}}
	b, _ := json.Marshal(old)
	os.WriteFile(legacy, b, 0600)
	device := func(name string) *ProgressStore {
		ps, err := newProgressStore(filepath.Join(root, name, "progress.json"), shared, legacy)
		if err != nil {
			t.Fatal(err)
		}
		return ps
	}
	phone := device("phone")
	if phone.get(id).Position != 8 || !phone.shared {
		t.Fatal("existing desktop progress must migrate")
	}
	if err := phone.set(id, Progress{Position: 2.5, Duration: 60, UpdatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	tab := device("tablet")
	if tab.get(id).Position != 2.5 {
		t.Fatal("brief phone playback must reach tablet without local cache")
	}
	tab.set(id, Progress{Position: 3.75, Duration: 60, UpdatedAt: time.Now()})
	laptop := device("laptop")
	if laptop.get(id).Position != 3.75 {
		t.Fatal("tablet progress must reach laptop")
	}
	laptop.set(id, Progress{Position: 22, Duration: 60, UpdatedAt: time.Now()})
	if err := phone.refresh(); err != nil {
		t.Fatal(err)
	}
	if phone.get(id).Position != 22 {
		t.Fatal("new SSD progress must replace older local position")
	}
	// Rewinding intentionally is a newer position, even when its number is smaller.
	phone.set(id, Progress{Position: 5, Duration: 60, UpdatedAt: time.Now()})
	tab.refresh()
	if tab.get(id).Position != 5 {
		t.Fatal("intentional rewind must sync")
	}
	// Preserve a complete independent snapshot when one copy becomes corrupt.
	tab.flush()
	laptop.refresh()
	laptop.flush()
	os.WriteFile(filepath.Join(shared, "progress-a.json"), []byte("{truncated"), 0600)
	recovered := device("fresh-device")
	if recovered.get(id).Position != 5 || !recovered.shared {
		t.Fatal("other SSD snapshot must recover corrupted copy")
	}
	saved, _ := os.ReadFile(legacy)
	if string(saved) != string(b) {
		t.Fatal("legacy backup changed")
	}
}
func TestUnavailableSharedStoreAndRemoval(t *testing.T) {
	root := t.TempDir()
	blocker := filepath.Join(root, "not-a-directory")
	os.WriteFile(blocker, []byte("keep"), 0600)
	ps, err := newProgressStore(filepath.Join(root, "local", "progress.json"), filepath.Join(blocker, ".course-player"), "")
	if err != nil {
		t.Fatal(err)
	}
	if ps.shared {
		t.Fatal("must not claim SSD save when writing fails")
	}
	id := "TEST/clip.mp4"
	p := Progress{Position: 1.2, Duration: 12, UpdatedAt: time.Now()}
	if err = ps.set(id, p); err != nil {
		t.Fatal(err)
	}
	restored, err := newProgressStore(ps.path, ps.directory, "")
	if err != nil || restored.get(id).Position != 1.2 {
		t.Fatal("local fallback lost")
	}
	ps.removing = true
	if ps.set(id, p) == nil {
		t.Fatal("late writes after removal must be rejected")
	}
}
func TestHTTPTransportAndIsolation(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "TEST"), 0700)
	os.WriteFile(filepath.Join(root, "TEST", "clip.mp4"), []byte("0123456789"), 0600)
	os.WriteFile(filepath.Join(root, "private.json"), []byte("private"), 0600)
	ps, err := newProgressStore(filepath.Join(t.TempDir(), "progress.json"), filepath.Join(root, ".course-player"), "")
	if err != nil {
		t.Fatal(err)
	}
	ix := newIndex(root)
	ix.rebuild()
	s := &server{root: root, ix: ix, progress: ps}
	handler := s.handler()
	request := func(method, path, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:8378"+path, strings.NewReader(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if request("GET", "/api/status", "", "").Code != 200 {
		t.Fatal("status unavailable")
	}
	if request("POST", "/api/progress", `{"id":"TEST/clip.mp4","position":2,"duration":12}`, "").Code != 200 {
		t.Fatal("save failed")
	}
	for i := 0; i < 3; i++ {
		b := request("GET", "/api/courses", "", "")
		var list []Course
		json.Unmarshal(b.Body.Bytes(), &list)
		if list[0].Sections[0].Watched != 1 {
			t.Fatal("watched count accumulates between requests")
		}
	}
	if request("GET", "/api/video?path=private.json", "", "").Code == 200 {
		t.Fatal("nonvideo file exposure")
	}
	if request("POST", "/api/progress", `{"id":"TEST/clip.mp4","position":0,"duration":0}`, "").Code != 400 {
		t.Fatal("invalid progress accepted")
	}
	if request("POST", "/api/progress", `{}`, "http://example.org").Code != 403 {
		t.Fatal("cross-origin write accepted")
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8378/api/video?path=TEST/clip.mp4", nil)
	r.Header.Set("Range", "bytes=2-4")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Body.String() != "234" {
		t.Fatal("range seek failed")
	}
	if request("GET", "/fonts/InterVariable.woff2", "", "").Code != 200 {
		t.Fatal("offline font missing")
	}
	if request("POST", "/api/eject", "", "").Code != 200 || !ps.removing {
		t.Fatal("removal preparation failed")
	}
	if request("GET", "/api/video?path=TEST/clip.mp4", "", "").Code == 200 {
		t.Fatal("new reads allowed during removal")
	}
	if request("POST", "/api/progress", `{"id":"TEST/clip.mp4","position":4,"duration":12}`, "").Code == 200 {
		t.Fatal("late writes allowed")
	}
}

func TestMissingLibraryDoesNotReappearOnLocalDisk(t *testing.T) {
	base := t.TempDir()
	library := filepath.Join(base, "Courses")
	if err := os.Mkdir(library, 0700); err != nil {
		t.Fatal(err)
	}
	ps, err := newProgressStore(filepath.Join(base, "cache", "progress.json"), filepath.Join(library, ".course-player"), "")
	if err != nil || !ps.shared {
		t.Fatal("initial shared save failed", err)
	}
	if err = os.RemoveAll(library); err != nil {
		t.Fatal(err)
	}
	if err = ps.set("TEST/clip.mp4", Progress{Position: 9, Duration: 60, UpdatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if ps.shared || ps.syncError == "" {
		t.Fatal("missing drive must report detailed local-only save")
	}
	if _, err = os.Stat(library); !os.IsNotExist(err) {
		t.Fatal("must not recreate library path after drive removal")
	}
	if ps.get("TEST/clip.mp4").Position != 9 {
		t.Fatal("local position lost")
	}
}
func TestUnmountRefusesInternalFilesystem(t *testing.T) {
	ok, _ := unmountUSB(t.TempDir())
	if ok {
		t.Fatal("must never automatically unmount an internal filesystem")
	}
}

func TestPortableFolderNamesRetainVideoHistory(t *testing.T) {
	root := t.TempDir()
	physical := "DEMO100 - Sample Course - Introduction"
	logical := "DEMO100 - Sample Course: Introduction"
	if err := os.MkdirAll(filepath.Join(root, physical), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, physical, "lesson.mp4"), []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".course-player"), 0700); err != nil {
		t.Fatal(err)
	}
	aliases, _ := json.Marshal(map[string]string{physical: logical})
	if err := os.WriteFile(filepath.Join(root, ".course-player", "course-aliases.json"), aliases, 0600); err != nil {
		t.Fatal(err)
	}
	ix := newIndex(root)
	if err := ix.rebuild(); err != nil {
		t.Fatal(err)
	}
	id := logical + "/lesson.mp4"
	if len(ix.courses) != 1 || ix.courses[0].ID != logical || ix.pathMap[id] != filepath.Join(root, physical, "lesson.mp4") {
		t.Fatal("portable rename changed stable history IDs")
	}
	if _, exists := ix.pathMap[physical+"/lesson.mp4"]; exists {
		t.Fatal("physical folder leaked into history ID")
	}
}

func TestRenamedFolderCacheMergesIntoCanonicalVideoID(t *testing.T) {
	physical := "DEMO100 - Sample Course - Introduction"
	logical := "DEMO100 - Sample Course: Introduction"
	if actual := canonicalHistoryID("Video Library/Courses/"+physical+"/lesson.mp4", map[string]string{physical: logical}); actual != logical+"/lesson.mp4" {
		t.Fatal("old physical cache ID failed to migrate", actual)
	}
}
