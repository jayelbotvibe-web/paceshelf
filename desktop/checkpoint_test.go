package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestLargeCatalogDoesNotAmplifyPlaybackWrites(t *testing.T) {
	records := map[string]json.RawMessage{}
	for i := 1; i <= 10000; i++ {
		b, _ := json.Marshal([]any{map[string]any{"device": "synthetic", "seq": i, "context": map[string]int{}, "value": map[string]any{"path": fmt.Sprintf("Sample/Lesson %05d.mp4", i), "size": 100}}})
		records[fmt.Sprintf("media/sample%d", i)] = b
	}
	state := libraryPayload{"paceshelf.library", 1, "large-synthetic-library", map[string]int64{"synthetic": 10000}, records}
	payload, _ := json.Marshal(state)
	m := newTestMetadata(t, t.TempDir(), false)
	m.read()
	if e := m.save(string(payload), ""); e != nil {
		t.Fatal(e)
	}
	m.flush()
	catalogs, _ := filepath.Glob(filepath.Join(filepath.Dir(m.local), "catalog-*.json"))
	if len(catalogs) != 1 {
		t.Fatal("catalog was not retained")
	}
	before, _ := os.Stat(catalogs[0])
	if before.Size() < 1000000 {
		t.Fatal("fixture is too small to measure write amplification")
	}
	for i := 1; i <= 3; i++ {
		revision := m.read()["revision"].(string)
		state.Vector["synthetic"] = 10000 + int64(i)
		b, _ := json.Marshal([]any{map[string]any{"device": "synthetic", "seq": 10000 + i, "context": map[string]int{"synthetic": 9999 + i}, "value": map[string]any{"position": i, "duration": 60, "updatedAt": "2000-01-01T00:00:00Z"}}})
		state.Records["resume/sample1"] = b
		payload, _ = json.Marshal(state)
		if e := m.save(string(payload), revision); e != nil {
			t.Fatal(e)
		}
		m.flush()
		local, _ := os.Stat(m.local)
		if local.Size() > 2048 {
			t.Fatal("playback checkpoint contains the static catalog", local.Size())
		}
	}
	after, _ := os.Stat(catalogs[0])
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("unchanged catalog was rewritten")
	}
	sharedCats, _ := filepath.Glob(filepath.Join(m.directory, "catalog-*.json"))
	if len(sharedCats) != 1 {
		t.Fatal("playback generated duplicate catalogs")
	}
	t.Logf("10,000 synthetic media: catalog=%d bytes; checkpoint below 2 KiB; catalog unchanged", before.Size())
}
func TestCheckpointRequiresItsCompleteCatalog(t *testing.T) {
	b, catalog, hash, e := splitCheckpoint(samplePayload(5))
	if e != nil {
		t.Fatal(e)
	}
	g, e := decodeGeneration(b)
	if e != nil || g.Version != 2 {
		t.Fatal("storage version 2 not emitted", e)
	}
	if _, e = hydrateCheckpoint(g, func(string) ([]byte, error) { return nil, os.ErrNotExist }); e == nil {
		t.Fatal("checkpoint activated without its catalog")
	}
	if _, e = hydrateCheckpoint(g, func(string) ([]byte, error) { return []byte("damaged"), nil }); e == nil {
		t.Fatal("bad catalog accepted")
	}
	full, e := hydrateCheckpoint(g, func(key string) ([]byte, error) {
		if key != hash {
			t.Fatal("invalid digest lookup")
		}
		return catalog, nil
	})
	if e != nil || !json.Valid([]byte(full)) {
		t.Fatal(e)
	}
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, ".paceshelf"), 0700)
	os.WriteFile(filepath.Join(root, ".paceshelf", "library-a.json"), b, 0600)
	if !newTestMetadata(t, root, false).read()["blocked"].(bool) {
		t.Fatal("incomplete existing generation initialized as an empty library")
	}
}
func TestFailedCheckpointDoesNotSwitchCatalog(t *testing.T) {
	m := newTestMetadata(t, t.TempDir(), false)
	m.read()
	saveTestMetadata(t, m, 5)
	originalHash := m.catalogHash
	original := append([]byte(nil), m.current...)
	// A nonempty directory blocks the final rename while allowing the new catalog
	// to be saved first. This simulates an interrupted catalog upgrade.
	os.Remove(m.local)
	os.Mkdir(m.local, 0700)
	os.WriteFile(filepath.Join(m.local, "blocker"), []byte("keep"), 0600)
	var state libraryPayload
	json.Unmarshal([]byte(samplePayload(6)), &state)
	state.Records["media/new"] = json.RawMessage(`[{"device":"writer","seq":6,"context":{},"value":{"path":"Sample/new.mp4","size":1}}]`)
	payload, _ := json.Marshal(state)
	m.mu.Lock()
	revision := m.revisionLocked()
	m.mu.Unlock()
	if e := m.save(string(payload), revision); e == nil {
		t.Fatal("simulated checkpoint failure was not detected")
	}
	if m.catalogHash != originalHash || string(m.current) != string(original) {
		t.Fatal("failed checkpoint switched the active catalog")
	}
	os.RemoveAll(m.local)
	os.WriteFile(m.local, original, 0600)
	m.flush()
	if !m.status()["shared"].(bool) {
		t.Fatal(m.status())
	}
	// Ensure the inactive catalog never changes the complete generation selected.
	view := m.read()
	if view["blocked"].(bool) {
		t.Fatal(view)
	}
}
