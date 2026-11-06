package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func samplePayload(position int) string {
	b, _ := json.Marshal(map[string]any{"format": "paceshelf.library", "version": 1, "id": "demo-library", "vector": map[string]int{"writer": position}, "records": map[string]any{"resume/demo": []any{map[string]any{"device": "writer", "seq": position, "context": map[string]int{}, "value": map[string]any{"position": position, "duration": 120, "updatedAt": "2000-01-01T00:00:00Z"}}}}})
	return string(b)
}
func newTestMetadata(t *testing.T, root string, deviceOnly bool) *MetadataStore {
	t.Helper()
	m, e := newMetadataStore(filepath.Join(t.TempDir(), "library.json"), root, deviceOnly)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(m.close)
	return m
}
func saveTestMetadata(t *testing.T, m *MetadataStore, position int) {
	t.Helper()
	r := m.read()["revision"].(string)
	if e := m.save(samplePayload(position), r); e != nil {
		t.Fatal(e)
	}
}

func TestMetadataPortableHandoffAndIncompleteGeneration(t *testing.T) {
	root := t.TempDir()
	phone := newTestMetadata(t, root, false)
	saveTestMetadata(t, phone, 20)
	phone.flush()
	if !phone.status()["shared"].(bool) {
		t.Fatal(phone.status())
	}
	phone.close()
	tablet := newTestMetadata(t, root, false)
	view := tablet.read()
	if len(view["states"].([]json.RawMessage)) != 2 {
		t.Fatal("portable metadata unavailable on a new device")
	}
	// This test serializes devices as a physically moved USB drive would be.
	saveTestMetadata(t, tablet, 25)
	tablet.flush()
	if !tablet.status()["shared"].(bool) {
		t.Fatal(tablet.status())
	}
	if e := os.WriteFile(filepath.Join(root, ".paceshelf", "library-a.json"), []byte("{interrupted"), 0600); e != nil {
		t.Fatal(e)
	}
	tablet.close()
	laptop := newTestMetadata(t, root, false)
	view = laptop.read()
	if view["blocked"].(bool) || len(view["states"].([]json.RawMessage)) != 1 {
		t.Fatal("must recover from the independent complete generation")
	}
	saveTestMetadata(t, laptop, 30)
	laptop.flush()
	if !laptop.status()["shared"].(bool) {
		t.Fatal(laptop.status())
	}
}
func TestMetadataStaleWindowAndSharedWriterDetected(t *testing.T) {
	root := t.TempDir()
	a := newTestMetadata(t, root, false)
	a.read()
	saveTestMetadata(t, a, 10)
	if e := a.save(samplePayload(11), ""); e == nil {
		t.Fatal("stale browser revision accepted")
	}
	a.flush()
	a.mu.Lock()
	a.portableLock.Close()
	a.portableLock = nil
	a.mu.Unlock()
	b := newTestMetadata(t, root, false)
	b.read()
	saveTestMetadata(t, b, 30)
	b.flush()
	b.close()
	// Do not acknowledge another writer with GET before attempting the flush.
	a.mu.Lock()
	expected := a.revisionLocked()
	a.mu.Unlock()
	if e := a.save(samplePayload(15), expected); e != nil {
		t.Fatal(e)
	}
	a.flush()
	if a.status()["shared"].(bool) || !strings.Contains(a.status()["syncError"].(string), "Another writer") {
		t.Fatal("unseen portable edit overwritten", a.status())
	}
}
func TestMetadataDeviceOnlyAndCleanFlush(t *testing.T) {
	root := t.TempDir()
	m := newTestMetadata(t, root, true)
	saveTestMetadata(t, m, 7)
	m.flush()
	if _, e := os.Stat(filepath.Join(root, ".paceshelf")); !os.IsNotExist(e) {
		t.Fatal("device-only mode wrote to media storage")
	}
	if b, e := os.ReadFile(m.local); e != nil || len(b) == 0 {
		t.Fatal("device-only checkpoint missing")
	}
	root = t.TempDir()
	n := newTestMetadata(t, root, false)
	saveTestMetadata(t, n, 7)
	n.flush()
	path := filepath.Join(root, ".paceshelf", "library-a.json")
	before, _ := os.Stat(path)
	n.flush()
	after, _ := os.Stat(path)
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("clean flush rewrote the SSD")
	}
	if _, e := os.Stat(filepath.Join(root, ".paceshelf", "library-b.json")); e != nil {
		t.Fatal("initial commit needs two independent copies")
	}

}
func TestMetadataMissingDriveKeepsDurableLocalCheckpoint(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "Library")
	os.Mkdir(root, 0700)
	m := newTestMetadata(t, root, false)
	saveTestMetadata(t, m, 3)
	m.flush()
	os.Rename(root, root+"-disconnected")
	m.mu.Lock()
	revision := m.revisionLocked()
	m.mu.Unlock()
	if e := m.save(samplePayload(9), revision); e != nil {
		t.Fatal(e)
	}
	m.flush()
	if m.status()["shared"].(bool) {
		t.Fatal("false shared-save success")
	}
	if _, e := os.Stat(root); !os.IsNotExist(e) {
		t.Fatal("missing media root was recreated")
	}
	b, _ := os.ReadFile(m.local)
	g, e := decodeGeneration(b)
	if e != nil {
		t.Fatal(e)
	}
	full, e := m.hydrate(g, false)
	var actual, want any
	json.Unmarshal([]byte(full), &actual)
	json.Unmarshal([]byte(samplePayload(9)), &want)
	if e != nil || !reflect.DeepEqual(actual, want) {
		t.Fatal("local checkpoint lost")
	}

}
func TestMetadataFutureVersionsAreNeverOverwritten(t *testing.T) {
	for _, futurePayload := range []bool{false, true} {
		t.Run(map[bool]string{true: "payload", false: "envelope"}[futurePayload], func(t *testing.T) {
			root := t.TempDir()
			dir := filepath.Join(root, ".paceshelf")
			os.Mkdir(dir, 0700)
			b, _ := encodeGeneration(samplePayload(2))
			var g generation
			json.Unmarshal(b, &g)
			if futurePayload {
				g.Payload = strings.Replace(g.Payload, `"version":1`, `"version":99`, 1)
			} else {
				g.Version = 99
			}
			b, _ = json.Marshal(g)
			path := filepath.Join(dir, "library-a.json")
			os.WriteFile(path, b, 0600)
			m := newTestMetadata(t, root, false)
			if !m.read()["blocked"].(bool) {
				t.Fatal("future library must block writes")
			}
			if m.save(samplePayload(5), "") == nil {
				t.Fatal("future metadata replaced")
			}
			saved, _ := os.ReadFile(path)
			if string(b) != string(saved) {
				t.Fatal("source changed")
			}
		})
	}
}
func TestMetadataChecksumAndIdentityValidation(t *testing.T) {
	b, _ := encodeGeneration(samplePayload(5))
	b = []byte(strings.Replace(string(b), "demo-library", "different-library", 1))
	if _, e := decodeGeneration(b); e == nil {
		t.Fatal("checksum corruption accepted")
	}
	m := newTestMetadata(t, t.TempDir(), true)
	saveTestMetadata(t, m, 5)
	m.mu.Lock()
	r := m.revisionLocked()
	m.mu.Unlock()
	if e := m.save(strings.Replace(samplePayload(6), "demo-library", "other-library", 1), r); e == nil {
		t.Fatal("unrelated library replaced existing data")
	}
}
func TestPersistentDataHomeAndExclusiveWriter(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", base)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	path, e := durableDataHome()
	if e != nil || path != filepath.Join(base, "paceshelf") {
		t.Fatal(path, e)
	}
	lockPath := filepath.Join(t.TempDir(), "writer.lock")
	first, e := acquireWriterLock(lockPath)
	if e != nil {
		t.Fatal(e)
	}
	if second, e := acquireWriterLock(lockPath); e == nil {
		second.Close()
		t.Fatal("second process accepted")
	}
	first.Close()
	last, e := acquireWriterLock(lockPath)
	if e != nil {
		t.Fatal("lock did not recover after close")
	}
	last.Close()
}

func TestDeviceBackupAdoptionRequiresExplicitDeviceMode(t *testing.T) {
	m := newTestMetadata(t, t.TempDir(), true)
	previousWriter := m.device
	saveTestMetadata(t, m, 4)
	m.mu.Lock()
	revision := m.revisionLocked()
	m.mu.Unlock()
	other := strings.Replace(samplePayload(7), "demo-library", "restored-library", 1)
	if e := m.saveRequest(other, revision, false); e == nil {
		t.Fatal("adoption happened without an explicit restore")
	}
	if e := m.saveRequest(other, revision, true); e != nil {
		t.Fatal(e)
	}
	if m.device == previousWriter {
		t.Fatal("restoring a different library reused its old writer identity")
	}
	reopened, e := newMetadataStore(m.local, m.root, true)
	if e != nil || reopened.device != m.device {
		t.Fatal("new restore writer identity was not retained")
	}
	reopened.close()
	backups, _ := filepath.Glob(m.local + ".before-restore-*.json")
	if len(backups) != 1 {
		t.Fatal("pre-restore recovery copy missing")
	}
	b, _ := os.ReadFile(backups[0])
	g, e := decodeGeneration(b)
	if e != nil || !strings.Contains(g.Payload, "demo-library") {
		t.Fatal("old library was not retained")
	}
	p := newTestMetadata(t, t.TempDir(), false)
	saveTestMetadata(t, p, 4)
	p.mu.Lock()
	r := p.revisionLocked()
	p.mu.Unlock()
	if p.saveRequest(other, r, true) == nil {
		t.Fatal("portable identity replaced by an unrelated backup")
	}
}

func TestDirectVideoFolderAndHiddenDirectories(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "Lesson 2.mp4"), []byte("video"), 0600)
	os.Mkdir(filepath.Join(root, ".hidden"), 0700)
	os.WriteFile(filepath.Join(root, ".hidden", "secret.mp4"), []byte("video"), 0600)
	ix := newIndex(root)
	if e := ix.rebuild(); e != nil {
		t.Fatal(e)
	}
	if len(ix.courses) != 1 || ix.courses[0].ID != "__root__" || len(ix.pathMap) != 1 {
		t.Fatal("direct folder playback is not generic")
	}
}
func TestLocalRemovalAssuranceRequiresVerifiedCurrentGeneration(t *testing.T) {
	m := newTestMetadata(t, t.TempDir(), true)
	if m.hasLocalSave() {
		t.Fatal("empty store claimed a local checkpoint")
	}
	saveTestMetadata(t, m, 5)
	if !m.hasLocalSave() {
		t.Fatal("valid local checkpoint not recognized")
	}
	os.WriteFile(m.local, []byte("{damaged"), 0600)
	if m.hasLocalSave() {
		t.Fatal("damaged local file reported safe")
	}
}
