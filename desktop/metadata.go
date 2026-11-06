package main

// A generation contains ALL metadata. Read-back verification and independent
// alternating copies recover incomplete writes; no filesystem-level guarantees
// are implied for a failing USB device. Legacy snapshots are never overwritten.
import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const metadataLimit = 16 * 1024 * 1024

var identityPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type generation struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	SHA256  string `json:"sha256"`
	Payload string `json:"payload"`
}

func encodeGeneration(payload string) ([]byte, error) {
	if len(payload) > metadataLimit {
		return nil, errors.New("Library metadata is too large")
	}
	var s struct {
		Format  string                     `json:"format"`
		Version int                        `json:"version"`
		ID      string                     `json:"id"`
		Records map[string]json.RawMessage `json:"records"`
		Vector  map[string]int64           `json:"vector"`
	}
	if json.Unmarshal([]byte(payload), &s) != nil || s.Format != "paceshelf.library" || s.Version != 1 || !identityPattern.MatchString(s.ID) || s.Records == nil || s.Vector == nil || len(s.Records) > 30000 {
		return nil, errors.New("Unsupported or invalid PaceShelf library")
	}
	sum := sha256.Sum256([]byte(payload))
	return json.Marshal(generation{"paceshelf.snapshot", 1, hex.EncodeToString(sum[:]), payload})
}

func decodeGeneration(b []byte) (generation, error) {
	var g generation
	if len(b) > metadataLimit*2 || json.Unmarshal(b, &g) != nil {
		return g, errors.New("Incomplete library snapshot")
	}
	if (g.Version != 1 && g.Version != 2) || g.Format != "paceshelf.snapshot" {
		return g, errors.New("Unsupported snapshot version; update PaceShelf before writing")
	}
	sum := sha256.Sum256([]byte(g.Payload))
	if g.SHA256 != hex.EncodeToString(sum[:]) {
		return g, errors.New("Library snapshot checksum mismatch")
	}
	if g.Version == 1 {
		_, err := encodeGeneration(g.Payload)
		return g, err
	}
	var p checkpointPayload
	if json.Unmarshal([]byte(g.Payload), &p) != nil || p.Format != "paceshelf.checkpoint" || p.Version != 1 || !catalogHashPattern.MatchString(p.Catalog) || !identityPattern.MatchString(p.ID) || p.Vector == nil || p.Records == nil {
		return g, errors.New("Invalid checkpoint reference")
	}
	return g, nil
}

type MetadataStore struct {
	mu                                  sync.Mutex
	local, root, directory, device      string
	current                             []byte
	seen                                map[string]bool
	next                                int
	dirty, shared, removing, deviceOnly bool
	problem, verified                   string
	blocked                             bool
	timer                               *time.Timer
	nextSave                            time.Time
	portableLock                        *os.File
	catalogHash, sharedCatalogHash      string
	catalogBytes                        []byte
}

func newMetadataStore(local, root string, deviceOnly bool) (*MetadataStore, error) {
	m := &MetadataStore{local: local, root: root, directory: filepath.Join(root, ".paceshelf"), seen: map[string]bool{}, deviceOnly: deviceOnly}
	identityFile := filepath.Join(filepath.Dir(local), "device-id")
	_, localError := os.Stat(local)
	if b, e := os.ReadFile(identityFile); e == nil && identityPattern.Match(b) && localError == nil {
		m.device = string(b)
	} else {
		b = make([]byte, 16)
		if _, e = rand.Read(b); e != nil {
			return nil, e
		}
		m.device = hex.EncodeToString(b)
		if e = durableWrite(identityFile, []byte(m.device), false); e != nil {
			return nil, e
		}
	}
	if b, e := os.ReadFile(local); e == nil {
		g, decodeError := decodeGeneration(b)
		if decodeError == nil {
			_, decodeError = m.hydrate(g, false)
		}
		if decodeError == nil {
			m.current = b
		} else {
			m.blocked = true
			m.problem = "Local metadata is damaged or newer than this app. Restore a backup before editing."
		}
	}
	return m, nil
}

func (m *MetadataStore) scanLocked() []generation {
	out := []generation{}
	for _, name := range []string{"library-a.json", "library-b.json"} {
		path := filepath.Join(m.directory, name)
		info, e := os.Lstat(path)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			m.problem = "Portable metadata is unavailable"
			continue
		}
		if !info.Mode().IsRegular() || info.Size() > metadataLimit*2 {
			m.blocked = true
			m.problem = "Cannot safely read portable metadata"
			continue
		}
		b, e := os.ReadFile(path)
		if e != nil {
			m.blocked = true
			m.problem = "Cannot read portable metadata"
			continue
		}
		g, e := decodeGeneration(b)
		if e != nil {
			// A malformed generation is recoverable from the other copy. A valid
			// JSON file with a newer version must NEVER be overwritten.
			var header struct {
				Version int `json:"version"`
			}
			if json.Unmarshal(b, &header) == nil {
				var raw generation
				json.Unmarshal(b, &raw)
				var payloadHeader struct {
					Version int `json:"version"`
				}
				json.Unmarshal([]byte(raw.Payload), &payloadHeader)
				if (header.Version != 1 && header.Version != 2) || payloadHeader.Version != 1 {
					m.blocked = true
					m.problem = e.Error()
				}
			}
			continue
		}
		out = append(out, g)
	}
	return out
}

func (m *MetadataStore) read() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	shared := []generation{}
	if !m.deviceOnly {
		shared = m.scanLocked()
	}
	states := []json.RawMessage{}
	m.seen = map[string]bool{}
	m.shared = false
	for _, g := range shared {
		m.seen[g.SHA256] = true
		payload, e := m.hydrate(g, true)
		if e != nil {
			m.problem = "A portable generation is incomplete or damaged. Using complete recovery copies."
			if errors.Is(e, errUnsupportedCatalog) {
				m.blocked = true
				m.problem = e.Error()
			}
			m.sharedCatalogHash = ""
			continue
		}
		states = append(states, json.RawMessage(payload))
		if len(m.current) > 0 {
			local, _ := decodeGeneration(m.current)
			if !m.dirty && local.SHA256 == g.SHA256 {
				m.shared = true
				m.verified = time.Now().UTC().Format(time.RFC3339)
			}
		}
	}
	if len(m.current) > 0 {
		g, e := decodeGeneration(m.current)
		if e == nil {
			payload, e := m.hydrate(g, false)
			if e == nil {
				states = append(states, json.RawMessage(payload))
			} else {
				m.blocked = true
				m.problem = "Local catalog is unavailable. Restore a library backup before editing."
			}
		}
	}
	if !m.deviceOnly && len(states) == 0 {
		if m.problem != "" {
			m.blocked = true
		}
		for _, name := range []string{"library-a.json", "library-b.json"} {
			if _, e := os.Lstat(filepath.Join(m.directory, name)); e == nil {
				m.blocked = true
				m.problem = "No complete snapshot is readable. Restore a library backup before editing."
			}
		}
	}
	return map[string]any{"states": states, "revision": m.revisionLocked(), "device": m.device, "blocked": m.blocked, "error": m.problem, "mode": map[bool]string{true: "device", false: "portable"}[m.deviceOnly]}
}
func (m *MetadataStore) revisionLocked() string {
	if len(m.current) == 0 {
		return ""
	}
	sum := sha256.Sum256(m.current)
	return hex.EncodeToString(sum[:])
}

func (m *MetadataStore) save(payload, expected string) error {
	return m.saveRequest(payload, expected, false)
}

type saveReceipt struct {
	Revision string `json:"revision"`
	Device   string `json:"device"`
}

func (m *MetadataStore) saveRequest(payload, expected string, adopt bool) error {
	_, e := m.saveWithReceipt(payload, expected, adopt)
	return e
}
func (m *MetadataStore) saveWithReceipt(payload, expected string, adopt bool) (saveReceipt, error) {
	adopting := false
	b, catalog, catalogHash, e := splitCheckpoint(payload)
	if e != nil {
		return saveReceipt{}, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.removing || m.blocked {
		return saveReceipt{}, errors.New("Library is paused or requires recovery")
	}
	if expected != m.revisionLocked() {
		return saveReceipt{}, errors.New("Library changed in another window. Refresh before saving")
	}
	if bytes.Equal(b, m.current) {
		m.catalogHash = catalogHash
		m.catalogBytes = catalog
		if !m.shared && !m.deviceOnly {
			m.dirty = true
			m.scheduleLocked()
		}
		return saveReceipt{m.revisionLocked(), m.device}, nil
	}
	if len(m.current) > 0 {
		old, _ := decodeGeneration(m.current)
		var a, c struct {
			ID string `json:"id"`
		}
		json.Unmarshal([]byte(old.Payload), &a)
		json.Unmarshal([]byte(payload), &c)
		if a.ID != c.ID && !(adopt && m.deviceOnly) {
			return saveReceipt{}, errors.New("Library identity mismatch; refusing to replace existing history")
		}
		if a.ID != c.ID && adopt {
			adopting = true
			random := make([]byte, 8)
			if _, e = rand.Read(random); e != nil {
				return saveReceipt{}, e
			}
			if e = durableWrite(m.local+".before-restore-"+hex.EncodeToString(random)+".json", m.current, true); e != nil {
				return saveReceipt{}, e
			}
		}
		if e = durableWrite(m.local+".previous", m.current, false); e != nil {
			return saveReceipt{}, e
		}
	}
	if m.catalogHash != catalogHash {
		if _, e = readCatalogFile(filepath.Dir(m.local), catalogHash); e != nil {
			if e = durableWrite(filepath.Join(filepath.Dir(m.local), "catalog-"+catalogHash+".json"), catalog, true); e != nil {
				return saveReceipt{}, e
			}
		}
	}
	if adopting {
		identity := make([]byte, 16)
		if _, e = rand.Read(identity); e != nil {
			return saveReceipt{}, e
		}
		writer := hex.EncodeToString(identity)
		if e = durableWrite(filepath.Join(filepath.Dir(m.local), "device-id"), []byte(writer), true); e != nil {
			return saveReceipt{}, e
		}
		m.device = writer
	}
	if e = durableWrite(m.local, b, true); e != nil {
		return saveReceipt{}, e
	}
	m.catalogHash = catalogHash
	m.catalogBytes = catalog
	m.current = b
	m.dirty = true
	m.scheduleLocked()
	return saveReceipt{m.revisionLocked(), m.device}, nil
}
func (m *MetadataStore) scheduleLocked() {
	if m.timer == nil && !m.deviceOnly {
		delay := time.Until(m.nextSave)
		if delay < 500*time.Millisecond {
			delay = 500 * time.Millisecond
		}
		m.timer = time.AfterFunc(delay, func() { m.mu.Lock(); defer m.mu.Unlock(); m.timer = nil; m.flushLocked() })
	}
}

func (m *MetadataStore) flushLocked() {
	if m.deviceOnly || m.removing || !m.dirty || len(m.current) == 0 || m.blocked {
		return
	}
	m.shared = false
	defer func() { m.nextSave = time.Now().Add(15 * time.Second) }()
	if info, e := os.Stat(m.root); e != nil || !info.IsDir() {
		m.problem = "Library folder unavailable. Progress is saved on this device."
		return
	}
	if info, e := os.Lstat(m.directory); e == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		m.problem = "Unsafe portable metadata folder"
		return
	}
	if m.portableLock == nil {
		lock, e := acquireWriterLock(filepath.Join(m.directory, "writer.lock"))
		if e != nil {
			m.problem = "Portable storage is busy or read-only. Progress stays on this device."
			return
		}
		m.portableLock = lock
	}
	shared := m.scanLocked()
	if m.blocked {
		return
	}
	for _, g := range shared {
		var old, next struct {
			ID string `json:"id"`
		}
		json.Unmarshal([]byte(g.Payload), &old)
		current, _ := decodeGeneration(m.current)
		json.Unmarshal([]byte(current.Payload), &next)
		if old.ID != next.ID {
			m.problem = "This folder contains a different library. Use device mode or select its matching folder."
			return
		}
		if !m.seen[g.SHA256] {
			m.problem = "Another writer changed this library. Refresh to merge its changes before saving."
			return
		}
	}

	if m.catalogHash == "" {
		m.problem = "Local catalog is not loaded"
		return
	}
	if m.sharedCatalogHash != m.catalogHash {
		if _, e := readCatalogFile(m.directory, m.catalogHash); e != nil {
			if e = durableWrite(filepath.Join(m.directory, "catalog-"+m.catalogHash+".json"), m.catalogBytes, true); e != nil {
				m.problem = "Portable catalog save failed: " + e.Error()
				return
			}
		}
		m.sharedCatalogHash = m.catalogHash
	}
	name := []string{"library-a.json", "library-b.json"}[m.next]
	// Overwrite a damaged/absent slot first, preserving a valid generation.
	for i, n := range []string{"library-a.json", "library-b.json"} {
		b, e := os.ReadFile(filepath.Join(m.directory, n))
		if e != nil {
			m.next = i
			name = n
			break
		}
		if _, e = decodeGeneration(b); e != nil {
			m.next = i
			name = n
			break
		}
	}
	if e := durableWrite(filepath.Join(m.directory, name), m.current, true); e != nil {
		m.problem = "Portable save failed: " + e.Error()
		return
	}
	if len(shared) == 0 {
		other := "library-a.json"
		if name == other {
			other = "library-b.json"
		}
		if e := durableWrite(filepath.Join(m.directory, other), m.current, true); e != nil {
			m.problem = "Second portable copy failed: " + e.Error()
			return
		}
	}
	g, _ := decodeGeneration(m.current)
	m.seen = map[string]bool{}
	for _, previous := range shared {
		m.seen[previous.SHA256] = true
	}
	m.seen[g.SHA256] = true
	m.next = 1 - m.next
	m.dirty = false
	m.shared = true
	m.problem = ""
	m.verified = time.Now().UTC().Format(time.RFC3339)
}
func (m *MetadataStore) flush() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.timer != nil {
		m.timer.Stop()
		m.timer = nil
	}
	m.flushLocked()
}
func (m *MetadataStore) close() {
	m.flush()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.removing = true
	if m.portableLock != nil {
		m.portableLock.Close()
		m.portableLock = nil
	}
}
func (m *MetadataStore) hasLocalSave() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.current) == 0 {
		return false
	}
	b, e := os.ReadFile(m.local)
	if e != nil || !bytes.Equal(b, m.current) {
		return false
	}
	g, e := decodeGeneration(b)
	if e != nil {
		return false
	}
	_, e = m.hydrate(g, false)
	return e == nil
}
func (m *MetadataStore) setMode(mode string) error {
	if mode != "device" && mode != "portable" {
		return errors.New("Choose device or portable storage")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.removing {
		return errors.New("Reconnect the library first")
	}
	m.flushLocked()
	if e := durableWrite(filepath.Join(filepath.Dir(m.local), "storage-mode"), []byte(mode), false); e != nil {
		return e
	}
	m.deviceOnly = mode == "device"
	if m.deviceOnly && !m.blocked {
		m.problem = ""
	}
	if m.deviceOnly {
		m.shared = false
		if m.timer != nil {
			m.timer.Stop()
			m.timer = nil
		}
		if m.portableLock != nil {
			m.portableLock.Close()
			m.portableLock = nil
		}
	}
	if !m.deviceOnly && len(m.current) > 0 {
		m.dirty = true
		m.flushLocked()
	}
	return nil
}
func (m *MetadataStore) status() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	mode := "portable"
	msg := "Changes are saved on this device. Portable save is pending."
	if m.deviceOnly {
		mode = "device"
		msg = "Saved on this device. Export a library backup to continue on another device."
	} else if m.shared && !m.dirty {
		msg = "Library saved and checked on portable storage."
	} else if m.problem != "" {
		msg = m.problem
	}
	return map[string]any{"mode": mode, "shared": m.shared && !m.dirty, "pending": m.dirty && !m.deviceOnly, "sync": msg, "syncError": m.problem, "verifiedAt": m.verified, "metadataVersion": 1, "storageVersion": 2}
}

func (s *server) handleLibrary(w http.ResponseWriter, r *http.Request) {
	if s.metadata == nil {
		http.Error(w, "Metadata unavailable", 503)
		return
	}
	if r.Method == "POST" {
		var body struct {
			Payload  string `json:"payload"`
			Expected string `json:"expected"`
			Adopt    bool   `json:"adopt"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "Invalid library request", 400)
			return
		}
		receipt, e := s.metadata.saveWithReceipt(body.Payload, body.Expected, body.Adopt)
		if e != nil {
			s.writeJSONError(w, 409, e.Error())
			return
		}
		s.writeJSON(w, receipt)
		return
	} else if r.Method != "GET" {
		http.Error(w, "GET or POST required", 405)
		return
	}
	s.writeJSON(w, s.metadata.read())
}
func (s *server) writeJSONError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	s.writeJSON(w, map[string]string{"error": message})
}

// Persistent data must never live in an OS cache directory.
func durableDataHome() (string, error) {
	if base := os.Getenv("XDG_DATA_HOME"); filepath.IsAbs(base) {
		return filepath.Join(base, "paceshelf"), nil
	}
	home, e := os.UserHomeDir()
	if e != nil {
		return "", fmt.Errorf("Cannot locate persistent app data: %w", e)
	}
	return filepath.Join(home, ".local", "share", "paceshelf"), nil
}
