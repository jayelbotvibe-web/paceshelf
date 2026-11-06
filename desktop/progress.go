package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The Android and Linux players share two independent snapshots on the SSD.
// Device-local backups remain separate and are merged by each video's timestamp.
type ProgressStore struct {
	mu               sync.Mutex
	path, directory  string
	data             map[string]Progress
	next             int
	shared, removing bool
	speed            string
	aliases          map[string]string
	syncError        string
	verifiedAt       string
}

func validSpeed(speed string) bool {
	switch speed {
	case "0.5", "0.75", "1", "1.25", "1.5", "1.7", "1.75", "2":
		return true
	}
	return false
}

func newProgressStore(path, directory, legacy string) (*ProgressStore, error) {
	ps := &ProgressStore{path: path, directory: directory, data: map[string]Progress{}, speed: "1.7"}
	ps.aliases, _ = loadCourseAliases(filepath.Dir(directory))
	ps.mergeFile(path)
	if legacy != "" {
		ps.mergeFile(legacy)
	}
	ps.readSharedLocked()
	if err := ps.persistLocalLocked(); err != nil {
		return nil, err
	}
	ps.syncLocked()
	return ps, nil
}

func (ps *ProgressStore) mergeFile(path string) time.Time {
	b, err := os.ReadFile(path)
	if err != nil || len(b) > 16*1024*1024 {
		return time.Time{}
	}
	var incoming map[string]Progress
	if json.Unmarshal(b, &incoming) != nil {
		return time.Time{}
	}
	var newest time.Time
	for original, p := range incoming {
		id := canonicalHistoryID(original, ps.aliases)
		if p.UpdatedAt.IsZero() || math.IsNaN(p.Position) || math.IsInf(p.Position, 0) || math.IsNaN(p.Duration) || math.IsInf(p.Duration, 0) || p.Position < 0 || p.Duration <= 0 {
			continue
		}
		p.Position = math.Min(p.Position, p.Duration)
		if p.UpdatedAt.After(newest) {
			newest = p.UpdatedAt
		}
		if p.UpdatedAt.After(ps.data[id].UpdatedAt) {
			ps.data[id] = p
		}
	}
	return newest
}

func (ps *ProgressStore) readSharedLocked() {
	newest := time.Time{}
	for i, name := range []string{"progress-a.json", "progress-b.json"} {
		t := ps.mergeFile(filepath.Join(ps.directory, name))
		if t.After(newest) {
			newest = t
			ps.next = 1 - i
		}
	}
	b, err := os.ReadFile(filepath.Join(ps.directory, "settings.json"))
	if err == nil {
		var settings struct {
			Speed string `json:"speed"`
		}
		if json.Unmarshal(b, &settings) == nil && validSpeed(settings.Speed) {
			ps.speed = settings.Speed
		}
	}
}

// A temporary sibling, fsync and rename protect the previous complete file.
// The alternating SSD snapshot survives even a filesystem-level interrupted write.
func durableWrite(path string, b []byte, verify bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".save-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		return err
	}
	if verify {
		saved, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if !bytes.Equal(saved, b) {
			return fmt.Errorf("SSD verification failed")
		}
	}
	return nil
}
func (ps *ProgressStore) persistLocalLocked() error {
	b, err := json.Marshal(ps.data)
	if err != nil {
		return err
	}
	return durableWrite(ps.path, b, false)
}
func (ps *ProgressStore) syncLocked() {
	b, err := json.Marshal(ps.data)
	if err == nil {
		// Never recreate a missing library tree on the laptop after unplugging USB.
		var info os.FileInfo
		info, err = os.Stat(filepath.Dir(ps.directory))
		if err == nil && !info.IsDir() {
			err = fmt.Errorf("library folder unavailable")
		}
	}
	if err == nil {
		err = os.Mkdir(ps.directory, 0700)
		if os.IsExist(err) {
			err = nil
		}
	}
	if err == nil {
		err = durableWrite(filepath.Join(ps.directory, []string{"progress-a.json", "progress-b.json"}[ps.next]), b, true)
	}
	if err == nil {
		ps.next = 1 - ps.next
		settings, _ := json.Marshal(map[string]string{"speed": ps.speed})
		err = durableWrite(filepath.Join(ps.directory, "settings.json"), settings, true)
	}
	ps.shared = err == nil
	if err != nil {
		detail := err.Error()
		if detail != ps.syncError {
			log.Printf("SSD progress save failed: %s", detail)
		}
		ps.syncError = detail
	} else {
		ps.syncError = ""
		ps.verifiedAt = time.Now().Format(time.RFC3339)
	}
}
func (ps *ProgressStore) get(id string) Progress {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return ps.data[id]
}
func (ps *ProgressStore) set(id string, p Progress) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.removing {
		return fmt.Errorf("drive removal in progress")
	}
	if previous := ps.data[id]; !p.UpdatedAt.After(previous.UpdatedAt) {
		p.UpdatedAt = previous.UpdatedAt.Add(time.Nanosecond)
	}
	ps.data[id] = p
	if err := ps.persistLocalLocked(); err != nil {
		return err
	}
	ps.syncLocked()
	return nil // The response status distinguishes an SSD save from a local-only save.
}
func (ps *ProgressStore) flush() {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if !ps.removing {
		ps.syncLocked()
	}
}
func (ps *ProgressStore) refresh() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if _, err := os.Stat(filepath.Dir(ps.directory)); err != nil {
		return err
	}
	ps.removing = false
	ps.readSharedLocked()
	if err := ps.persistLocalLocked(); err != nil {
		return err
	}
	ps.syncLocked()
	return nil
}
func (ps *ProgressStore) isRemoving() bool { ps.mu.Lock(); defer ps.mu.Unlock(); return ps.removing }
