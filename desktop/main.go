// Command course-player is a tiny local web server that streams a folder of
// course videos (mp4/webm) and remembers where you left off in each one.
package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

var videoExts = map[string]bool{
	".mp4":  true,
	".webm": true,
	".mkv":  true,
	".mov":  true,
	".m4v":  true,
}

// videoMime overrides Go's mime table (which wrongly reports .webm as audio/webm).
var videoMime = map[string]string{
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".m4v":  "video/mp4",
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

// Video is one playable file.
type Video struct {
	ID        string    `json:"id"`        // relative path from root (stable key)
	Title     string    `json:"title"`     // filename without extension
	Section   string    `json:"section"`   // cleaned relative directory path
	Size      int64     `json:"size"`      // bytes
	Position  float64   `json:"position"`  // last playback position (seconds), 0 if unknown
	Duration  float64   `json:"duration"`  // seconds, 0 if unknown
	UpdatedAt time.Time `json:"updatedAt"` // last time playback progress was saved
}

// Section groups videos under one (cleaned) directory.
type Section struct {
	Name    string  `json:"name"`
	Videos  []Video `json:"videos"`
	Watched int     `json:"watched"` // videos with saved position
}

// Course is a top-level directory under the root.
type Course struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Sections []Section `json:"sections"`
	Videos   int       `json:"videos"`
}

// ---------------------------------------------------------------------------
// Progress store
// ---------------------------------------------------------------------------

type Progress struct {
	Position  float64   `json:"position"`
	Duration  float64   `json:"duration"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ---------------------------------------------------------------------------
// Natural sort (so Day-10 > Day-2, 010 < 025, 2.x < 14.x)
// ---------------------------------------------------------------------------

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func naturalLess(a, b string) bool {
	ai, bi := 0, 0
	for ai < len(a) && bi < len(b) {
		ca, cb := a[ai], b[bi]
		if isDigit(ca) && isDigit(cb) {
			aj, bj := ai, bi
			for aj < len(a) && isDigit(a[aj]) {
				aj++
			}
			for bj < len(b) && isDigit(b[bj]) {
				bj++
			}
			// Skip leading zeros to compare numeric value.
			ai2, bi2 := ai, bi
			for ai2 < aj-1 && a[ai2] == '0' {
				ai2++
			}
			for bi2 < bj-1 && b[bi2] == '0' {
				bi2++
			}
			if aj-ai2 != bj-bi2 {
				return aj-ai2 < bj-bi2
			}
			for k := 0; k < aj-ai2; k++ {
				if a[ai2+k] != b[bi2+k] {
					return a[ai2+k] < b[bi2+k]
				}
			}
			ai, bi = aj, bj
		} else {
			if ca != cb {
				return ca < cb
			}
			ai++
			bi++
		}
	}
	return len(a) < len(b)
}

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

type Index struct {
	root     string
	mu       sync.Mutex
	courses  []Course
	pathMap  map[string]string // video id -> absolute path
	byCourse map[string]string // course id -> course name
}

func newIndex(root string) *Index {
	return &Index{
		root:     root,
		pathMap:  map[string]string{},
		byCourse: map[string]string{},
	}
}

// cleanDir removes Telegram attribution wrapper segments and normalises.
func cleanDir(rel string) string {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	kept := parts[:0]
	for _, p := range parts {
		if p == "" || p == "." {
			continue
		}
		kept = append(kept, p)
	}
	if len(kept) == 0 {
		return ""
	}
	return strings.Join(kept, " / ")
}

func (ix *Index) rebuild() error {
	ix.mu.Lock()
	defer ix.mu.Unlock()

	entries, err := os.ReadDir(ix.root)
	if err != nil {
		return err
	}

	aliases, err := loadCourseAliases(ix.root)
	if err != nil {
		return err
	}
	var courses []Course
	pathMap := map[string]string{}
	byCourse := map[string]string{}

	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		courseName := e.Name()
		courseRel := courseName
		if alias, ok := aliases[courseName]; ok {
			courseRel = alias
		}
		byCourse[courseRel] = courseName

		// Collect videos grouped by section (cleaned dir).
		sections := map[string][]Video{}
		err := filepath.WalkDir(filepath.Join(ix.root, courseName), func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // skip unreadable entries
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if !videoExts[ext] {
				return nil
			}
			rel, err := filepath.Rel(ix.root, p)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)
			if courseRel != courseName {
				rel = courseRel + strings.TrimPrefix(rel, courseName)
			}
			// Section is the video's directory relative to the course root,
			// with Telegram attribution wrapper folders stripped.
			dirRel, err := filepath.Rel(filepath.Join(ix.root, courseName), filepath.Dir(p))
			if err != nil {
				dirRel = "."
			}
			section := cleanDir(filepath.ToSlash(dirRel))
			info, err := d.Info()
			size := int64(0)
			if err == nil {
				size = info.Size()
			}
			title := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
			v := Video{
				ID:      rel,
				Title:   title,
				Section: section,
				Size:    size,
			}
			sections[section] = append(sections[section], v)
			pathMap[rel] = p
			return nil
		})
		if err != nil {
			return err
		}

		// Sort sections naturally, sort videos naturally within each.
		names := make([]string, 0, len(sections))
		for n := range sections {
			names = append(names, n)
		}
		sort.Slice(names, func(i, j int) bool { return naturalLess(names[i], names[j]) })

		var course Course
		course.ID = courseRel
		course.Name = courseRel
		total := 0
		for _, n := range names {
			vs := sections[n]
			sort.Slice(vs, func(i, j int) bool { return naturalLess(vs[i].Title, vs[j].Title) })
			sec := Section{Name: n, Videos: vs}
			course.Sections = append(course.Sections, sec)
			total += len(vs)
		}
		course.Videos = total
		if total > 0 {
			courses = append(courses, course)
		}
	}

	// A selected folder may contain videos directly as well as sub-collections.
	rootVideos := []Video{}
	for _, e := range entries {
		if e.IsDir() || !videoExts[strings.ToLower(filepath.Ext(e.Name()))] {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		id := e.Name()
		pathMap[id] = filepath.Join(ix.root, id)
		rootVideos = append(rootVideos, Video{ID: id, Title: strings.TrimSuffix(id, filepath.Ext(id)), Size: info.Size()})
	}
	if len(rootVideos) > 0 {
		sort.Slice(rootVideos, func(i, j int) bool { return naturalLess(rootVideos[i].Title, rootVideos[j].Title) })
		courses = append(courses, Course{ID: "__root__", Name: filepath.Base(ix.root), Videos: len(rootVideos), Sections: []Section{{Name: "", Videos: rootVideos}}})
	}
	sort.Slice(courses, func(i, j int) bool { return naturalLess(courses[i].Name, courses[j].Name) })

	ix.courses = courses
	ix.pathMap = pathMap
	ix.byCourse = byCourse
	return nil
}

// ---------------------------------------------------------------------------
// Battery (read from the phone via termux-api)
// ---------------------------------------------------------------------------

// batteryStatus is the subset of termux-battery-status we surface to the UI.
type batteryStatus struct {
	Available   bool    `json:"available"`
	Percentage  int     `json:"percentage"`
	Status      string  `json:"status"`  // CHARGING / DISCHARGING / FULL / NOT_CHARGING
	Plugged     string  `json:"plugged"` // PLUGGED_AC / PLUGGED_USB / UNPLUGGED
	Temperature float64 `json:"temperature"`
}

// readBattery reads battery.json, written periodically by the run-script
// background updater (which runs termux-battery-status outside the Go process
// — exec'ing it from Go crashes the runtime on Android/Termux). Returns an
// empty status with Available=false if the file is missing, which the UI uses
// to hide the indicator.
func (s *server) readBattery() batteryStatus {
	b, err := os.ReadFile(filepath.Join(s.dataDir, "battery.json"))
	if err != nil {
		return batteryStatus{}
	}
	var raw struct {
		Percentage  int     `json:"percentage"`
		Status      string  `json:"status"`
		Plugged     string  `json:"plugged"`
		Temperature float64 `json:"temperature"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return batteryStatus{}
	}
	return batteryStatus{
		Available:   true,
		Percentage:  raw.Percentage,
		Status:      raw.Status,
		Plugged:     raw.Plugged,
		Temperature: raw.Temperature,
	}
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

type server struct {
	root         string
	ix           *Index
	progress     *ProgressStore
	metadata     *MetadataStore
	onlineOrigin string

	dataDir   string
	thumbsDir string
	thumbSem  chan struct{}
	thumbMu   sync.Mutex
	thumbLk   map[string]*sync.Mutex
	stop      func()
	unmount   func(string) (bool, string)
}

func (s *server) courses() []Course {
	s.ix.mu.Lock()
	defer s.ix.mu.Unlock()
	var out []Course
	b, _ := json.Marshal(s.ix.courses)
	json.Unmarshal(b, &out)
	if out == nil {
		out = []Course{}
	}
	return out
}

func (s *server) writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

// decorate fills saved progress into course/video structures.
func (s *server) decorate(courses []Course) {
	for ci := range courses {
		for si := range courses[ci].Sections {
			sec := &courses[ci].Sections[si]
			sec.Watched = 0
			for vi := range sec.Videos {
				v := &sec.Videos[vi]
				p := s.progress.get(v.ID)
				v.Position = p.Position
				v.Duration = p.Duration
				v.UpdatedAt = p.UpdatedAt
				if p.Position > 0 {
					sec.Watched++
				}
			}
		}
	}
}

func (s *server) handleCourses(w http.ResponseWriter, r *http.Request) {
	courses := s.courses()
	s.decorate(courses)
	s.writeJSON(w, courses)
}

func (s *server) handleCourse(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("path")
	if id == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	courses := s.courses()
	for _, c := range courses {
		if c.ID == id {
			s.decorate([]Course{c})
			s.writeJSON(w, c)
			return
		}
	}
	http.NotFound(w, r)
}

// resolvePath safely maps a relative id to an absolute path inside root.
func (s *server) resolvePath(id string) (string, bool) {
	if s.progress.isRemoving() {
		return "", false
	}
	s.ix.mu.Lock()
	full, indexed := s.ix.pathMap[id]
	s.ix.mu.Unlock()
	if !indexed {
		return "", false
	}
	real, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(s.root, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", false
	}
	return full, true
}

func (s *server) handleVideo(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("path")
	full, ok := s.resolvePath(id)
	if !ok {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if mt, ok := videoMime[strings.ToLower(filepath.Ext(full))]; ok {
		w.Header().Set("Content-Type", mt)
	}
	http.ServeContent(w, r, filepath.Base(full), st.ModTime(), f)
}

// handleThumb serves a cached thumbnail, generating it on first request.
func (s *server) handleThumb(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("path")
	full, ok := s.resolvePath(id)
	if !ok {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	sum := sha256.Sum256([]byte(id))
	cachePath := filepath.Join(s.thumbsDir, hex.EncodeToString(sum[:])+".jpg")

	if st, err := os.Stat(cachePath); err == nil && st.Size() > 0 {
		s.serveThumb(w, r, cachePath)
		return
	}

	// Per-key lock: avoid generating the same thumbnail twice concurrently.
	s.thumbMu.Lock()
	if s.thumbLk == nil {
		s.thumbLk = map[string]*sync.Mutex{}
	}
	lk, ok := s.thumbLk[id]
	if !ok {
		lk = &sync.Mutex{}
		s.thumbLk[id] = lk
	}
	s.thumbMu.Unlock()

	lk.Lock()
	defer lk.Unlock()

	if st, err := os.Stat(cachePath); err == nil && st.Size() > 0 {
		s.serveThumb(w, r, cachePath)
		return
	}

	// Global concurrency limit.
	select {
	case s.thumbSem <- struct{}{}:
		defer func() { <-s.thumbSem }()
	case <-r.Context().Done():
		return
	}

	if err := s.generateThumb(r.Context(), full, cachePath); err != nil {
		http.Error(w, "thumbnail unavailable", http.StatusNotFound)
		return
	}
	s.serveThumb(w, r, cachePath)
}

func (s *server) serveThumb(w http.ResponseWriter, r *http.Request, path string) {
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

// generateThumb extracts a 400px-wide JPEG frame with ffmpeg, trying a few
// timestamps in case the video is short or seeking lands past the end.
func (s *server) generateThumb(parent context.Context, videoPath, outPath string) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	for _, t := range []string{"5", "1", "0"} {
		cmd := exec.CommandContext(ctx, "ffmpeg",
			"-y", "-v", "error", "-ss", t, "-i", videoPath,
			"-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "4", outPath)
		if err := cmd.Run(); err == nil {
			if st, e := os.Stat(outPath); e == nil && st.Size() > 0 {
				return nil
			}
		}
		os.Remove(outPath)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return errors.New("could not extract a frame")
}

func (s *server) handleProgressGet(w http.ResponseWriter, r *http.Request) {
	s.progress.mu.Lock()
	out := make(map[string]Progress, len(s.progress.data))
	for k, v := range s.progress.data {
		out[k] = v
	}
	s.progress.mu.Unlock()
	s.writeJSON(w, out)
}

func (s *server) handleProgressSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       string  `json:"id"`
		Position float64 `json:"position"`
		Duration float64 `json:"duration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if body.ID == "" || math.IsNaN(body.Position) || math.IsInf(body.Position, 0) || math.IsNaN(body.Duration) || math.IsInf(body.Duration, 0) || body.Position < 0 || body.Duration <= 0 {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if _, ok := s.resolvePath(body.ID); !ok {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	if err := s.progress.set(body.ID, Progress{
		Position:  math.Min(body.Position, body.Duration),
		Duration:  body.Duration,
		UpdatedAt: time.Now(),
	}); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	s.writeJSON(w, s.status())
}

func (s *server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if s.metadata != nil {
		s.metadata.flush()
		s.progress.mu.Lock()
		s.progress.removing = false
		s.progress.readSharedLocked()
		s.progress.mu.Unlock()
	} else if err := s.progress.refresh(); err != nil {
		http.Error(w, "Reconnect the SSD and retry.", 503)
		return
	}
	if err := s.ix.rebuild(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.writeJSON(w, map[string]any{"ok": true, "courses": len(s.ix.courses)})
}

func (s *server) handleBattery(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, s.readBattery())
}

//go:embed static
var frontend embed.FS

func (s *server) status() map[string]any {
	s.progress.mu.Lock()
	defer s.progress.mu.Unlock()
	msg := "Progress saved on this laptop and the SSD. Use Safely remove before unplugging."
	if !s.progress.shared {
		msg = "Saved on this laptop only. SSD save could not be verified. " + s.progress.syncError
	}
	result := map[string]any{"protocol": 3, "version": "0.2.0", "platform": "linux", "root": s.root, "ready": !s.progress.removing, "selected": true, "removing": s.progress.removing, "scanning": false, "error": "", "folder": filepath.Base(s.root), "shared": s.progress.shared, "pending": false, "sync": msg, "speed": s.progress.speed, "syncError": s.progress.syncError, "verifiedAt": s.progress.verifiedAt, "historyEntries": len(s.progress.data), "sharedFolder": s.progress.directory}
	if s.metadata != nil {
		for k, v := range s.metadata.status() {
			result[k] = v
		}
		result["sharedFolder"] = s.metadata.directory
	}
	return result
}

func (s *server) handler() http.Handler {
	assets, _ := fs.Sub(frontend, "static")
	files := http.FileServer(http.FS(assets))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/online", func(w http.ResponseWriter, r *http.Request) {
		s.writeJSON(w, map[string]string{"origin": s.onlineOrigin})
	})
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) { s.writeJSON(w, s.status()) })
	mux.HandleFunc("/api/courses", s.handleCourses)
	mux.HandleFunc("/api/course", s.handleCourse)
	mux.HandleFunc("/api/library", s.handleLibrary)
	mux.HandleFunc("/api/mode", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || s.metadata == nil {
			http.Error(w, "POST required", 405)
			return
		}
		var body struct {
			Mode string `json:"mode"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "Invalid mode", 400)
			return
		}
		if e := s.metadata.setMode(body.Mode); e != nil {
			s.writeJSONError(w, 409, e.Error())
			return
		}
		s.writeJSON(w, s.status())
	})
	mux.HandleFunc("/api/video", s.handleVideo)
	mux.HandleFunc("/api/thumb", s.handleThumb)
	mux.HandleFunc("/api/progress", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			s.handleProgressGet(w, r)
		} else if r.Method == "POST" {
			if s.metadata != nil {
				s.writeJSONError(w, 409, "Use PaceShelf library metadata to save progress")
			} else {
				s.handleProgressSet(w, r)
			}
		} else {
			http.Error(w, "POST required", 405)
		}
	})
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if s.metadata != nil {
			s.writeJSONError(w, 409, "Use PaceShelf library preferences")
			return
		}
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var body struct {
			Speed string `json:"speed"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || !validSpeed(body.Speed) {
			http.Error(w, "Invalid speed", 400)
			return
		}
		s.progress.mu.Lock()
		if s.progress.removing {
			s.progress.mu.Unlock()
			http.Error(w, "Drive removal in progress", 409)
			return
		}
		s.progress.speed = body.Speed
		s.progress.syncLocked()
		s.progress.mu.Unlock()
		s.writeJSON(w, s.status())
	})
	mux.HandleFunc("/api/flush", func(w http.ResponseWriter, r *http.Request) {
		if s.metadata != nil {
			s.metadata.flush()
		} else {
			s.progress.flush()
		}
		s.writeJSON(w, s.status())
	})
	mux.HandleFunc("/api/eject", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		s.progress.mu.Lock()
		var err error
		if s.metadata == nil {
			err = s.progress.persistLocalLocked()
		}
		if s.metadata == nil {
			s.progress.syncLocked()
		}
		s.progress.removing = true
		shared := s.progress.shared
		s.progress.mu.Unlock()
		localSaved := err == nil
		if s.metadata != nil {
			s.metadata.flush()
			shared = s.metadata.status()["shared"].(bool)
			localSaved = s.metadata.hasLocalSave()
			s.metadata.close()
		}
		unmounted, unmountError := false, ""
		if shared && s.unmount != nil {
			unmounted, unmountError = s.unmount(s.root)
		}
		result := map[string]any{"localSaved": localSaved, "ssdSaved": shared, "unmounted": unmounted, "unmountError": unmountError}
		s.writeJSON(w, result)
		if s.stop != nil {
			go func() { time.Sleep(500 * time.Millisecond); s.stop() }()
		}
	})
	mux.HandleFunc("/api/refresh", s.handleRefresh)
	mux.Handle("/", files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only loopback clients and same-origin browser requests may access the library.
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || !(host == "127.0.0.1" || host == "localhost" || host == "::1") {
			http.Error(w, "Forbidden host", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Scheme != "http" || u.Host != r.Host {
				http.Error(w, "Forbidden origin", 403)
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Cross-site request denied", 403)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "POST" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if r.Method == "POST" {
			limit := int64(65536)
			if r.URL.Path == "/api/library" {
				limit = metadataLimit * 2
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		if s.onlineOrigin != "" {
			w.Header().Set("Content-Security-Policy", w.Header().Get("Content-Security-Policy")+"; frame-src "+s.onlineOrigin)
		}
		if r.URL.Path == "/provider.html" || r.URL.Path == "/provider.js" || r.URL.Path == "/provider.css" {
			http.NotFound(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func main() {
	defaultRoot := "Courses"
	if exe, err := os.Executable(); err == nil {
		defaultRoot = filepath.Join(filepath.Dir(exe), "..", "Courses")
	}
	root := flag.String("root", defaultRoot, "directory containing course folders")
	addr := flag.String("addr", "127.0.0.1:8378", "loopback listen address")
	dataDir := flag.String("data", "", "persistent local data directory")
	deviceOnly := flag.Bool("device-only", false, "keep new library metadata on this device; do not write to media storage")
	legacy := flag.String("legacy", "", "previous desktop progress.json to merge")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("Use a loopback listen address, such as 127.0.0.1:8378")
	}
	*root, err = filepath.Abs(*root)
	if err != nil {
		log.Fatal(err)
	}
	*root, err = filepath.EvalSymlinks(*root)
	if err != nil {
		log.Fatal("Connect the SSD first: ", err)
	}
	var cacheLegacy string
	if *dataDir == "" {
		base, e := durableDataHome()
		if e != nil {
			log.Fatal(e)
		}
		id := sha256.Sum256([]byte(*root))
		*dataDir = filepath.Join(base, hex.EncodeToString(id[:8]))
		if cache, e := os.UserCacheDir(); e == nil {
			cacheLegacy = filepath.Join(cache, "course-player", hex.EncodeToString(id[:8]), "progress.json")
		}
	}
	if err = os.MkdirAll(*dataDir, 0700); err != nil {
		log.Fatal(err)
	}
	localLock, err := acquireWriterLock(filepath.Join(*dataDir, "writer.lock"))
	if err != nil {
		log.Fatal(err)
	}
	defer localLock.Close()
	if mode, e := os.ReadFile(filepath.Join(*dataDir, "storage-mode")); e == nil && string(mode) == "device" {
		*deviceOnly = true
	}

	// Legacy histories are an import source only. New applications never alter
	// 1.2.x snapshots or merge their subsequent writes back into migrated records.
	ps := &ProgressStore{path: filepath.Join(*dataDir, "legacy-progress.json"), directory: filepath.Join(*root, ".course-player"), data: map[string]Progress{}, speed: "1"}
	ps.aliases, _ = loadCourseAliases(*root)
	ps.mergeFile(ps.path)
	if *legacy != "" {
		ps.mergeFile(*legacy)
	}
	if cacheLegacy != "" {
		ps.mergeFile(cacheLegacy)
	}
	ps.readSharedLocked()
	if err = ps.persistLocalLocked(); err != nil {
		log.Fatal(err)
	}
	metadata, err := newMetadataStore(filepath.Join(*dataDir, "library.json"), *root, *deviceOnly)
	if err != nil {
		log.Fatal(err)
	}
	defer metadata.close()
	ix := newIndex(*root)
	if err = ix.rebuild(); err != nil {
		log.Fatal(err)
	}
	thumbs := filepath.Join(*dataDir, "thumbs")
	if err = os.MkdirAll(thumbs, 0700); err != nil {
		log.Fatal(err)
	}
	s := &server{root: *root, ix: ix, progress: ps, metadata: metadata, dataDir: *dataDir, thumbsDir: thumbs, thumbSem: make(chan struct{}, 2), thumbLk: map[string]*sync.Mutex{}}
	if online, e := startOnline("http://" + *addr); e == nil {
		s.onlineOrigin = online.origin
		defer online.close()
	}
	httpServer := &http.Server{Addr: *addr, ReadHeaderTimeout: 5 * time.Second}
	s.stop = func() { httpServer.Close() }
	s.unmount = unmountUSB
	httpServer.Handler = s.handler()
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupts)
	go func() { <-interrupts; metadata.flush(); httpServer.Close() }()
	log.Printf("PaceShelf 0.2.0: %d collections; http://%s", len(ix.courses), *addr)
	if err = httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
