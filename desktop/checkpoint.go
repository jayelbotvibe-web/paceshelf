package main

// A checkpoint commits small, mutable records and the digest of an immutable
// catalog. A catalog is saved and verified BEFORE any checkpoint references it.
// Readers activate a generation only when both checksums and identities match.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var catalogHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errUnsupportedCatalog = errors.New("Unsupported catalog version; update PaceShelf before editing")

type libraryPayload struct {
	Format  string                     `json:"format"`
	Version int                        `json:"version"`
	ID      string                     `json:"id"`
	Vector  map[string]int64           `json:"vector"`
	Records map[string]json.RawMessage `json:"records"`
}
type catalogPayload struct {
	Format  string                     `json:"format"`
	Version int                        `json:"version"`
	ID      string                     `json:"id"`
	Records map[string]json.RawMessage `json:"records"`
}
type checkpointPayload struct {
	Format  string                     `json:"format"`
	Version int                        `json:"version"`
	ID      string                     `json:"id"`
	Vector  map[string]int64           `json:"vector"`
	Records map[string]json.RawMessage `json:"records"`
	Catalog string                     `json:"catalog"`
}

func staticRecord(key string) bool {
	return strings.HasPrefix(key, "media/") || strings.HasPrefix(key, "collection/") || key == "preference/migration"
}
func splitCheckpoint(payload string) (checkpoint []byte, catalog []byte, hash string, err error) {
	if _, err = encodeGeneration(payload); err != nil {
		return
	}
	var state libraryPayload
	json.Unmarshal([]byte(payload), &state)
	base := catalogPayload{"paceshelf.catalog", 1, state.ID, map[string]json.RawMessage{}}
	mutable := map[string]json.RawMessage{}
	for k, v := range state.Records {
		if staticRecord(k) {
			base.Records[k] = v
		} else {
			mutable[k] = v
		}
	}
	catalog, err = json.Marshal(base)
	if err != nil {
		return
	}
	if len(catalog) > metadataLimit {
		err = errors.New("Catalog is too large")
		return
	}
	sum := sha256.Sum256(catalog)
	hash = hex.EncodeToString(sum[:])
	var b []byte
	b, err = json.Marshal(checkpointPayload{"paceshelf.checkpoint", 1, state.ID, state.Vector, mutable, hash})
	if err != nil {
		return
	}
	if len(b) > metadataLimit {
		err = errors.New("Checkpoint is too large")
		return
	}
	sum = sha256.Sum256(b)
	checkpoint, err = json.Marshal(generation{"paceshelf.snapshot", 2, hex.EncodeToString(sum[:]), string(b)})
	return
}
func hydrateCheckpoint(g generation, readCatalog func(string) ([]byte, error)) (string, error) {
	if g.Version == 1 {
		return g.Payload, nil
	}
	var checkpoint checkpointPayload
	if json.Unmarshal([]byte(g.Payload), &checkpoint) != nil || checkpoint.Format != "paceshelf.checkpoint" || checkpoint.Version != 1 || !catalogHashPattern.MatchString(checkpoint.Catalog) || checkpoint.Vector == nil || checkpoint.Records == nil {
		return "", errors.New("Invalid checkpoint reference")
	}
	b, e := readCatalog(checkpoint.Catalog)
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != checkpoint.Catalog {
		return "", errors.New("Catalog checksum mismatch")
	}
	var catalog catalogPayload
	if json.Unmarshal(b, &catalog) == nil && (catalog.Format != "paceshelf.catalog" || catalog.Version != 1) {
		return "", errUnsupportedCatalog
	}
	if catalog.ID != checkpoint.ID || catalog.Records == nil {
		return "", errors.New("Invalid catalog identity or version")
	}
	for k, v := range catalog.Records {
		if !staticRecord(k) {
			return "", errors.New("Invalid static catalog record")
		}
		if _, exists := checkpoint.Records[k]; exists {
			return "", errors.New("Conflicting checkpoint records")
		}
		checkpoint.Records[k] = v
	}
	state := libraryPayload{"paceshelf.library", 1, checkpoint.ID, checkpoint.Vector, checkpoint.Records}
	b, e = json.Marshal(state)
	if e != nil {
		return "", e
	}
	if _, e = encodeGeneration(string(b)); e != nil {
		return "", e
	}
	return string(b), nil
}
func readCatalogFile(directory, hash string) ([]byte, error) {
	if !catalogHashPattern.MatchString(hash) {
		return nil, errors.New("Invalid catalog reference")
	}
	path := filepath.Join(directory, "catalog-"+hash+".json")
	info, e := os.Lstat(path)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() || info.Size() > metadataLimit {
		return nil, errors.New("Unsafe catalog file")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != hash {
		return nil, errors.New("Catalog checksum mismatch")
	}
	return b, nil
}
func (m *MetadataStore) hydrate(g generation, shared bool) (string, error) {
	dir := filepath.Dir(m.local)
	if shared {
		dir = m.directory
	}
	return hydrateCheckpoint(g, func(hash string) ([]byte, error) {
		b, e := readCatalogFile(dir, hash)
		if e != nil && !shared && !m.deviceOnly {
			b, e = readCatalogFile(m.directory, hash)
			if e == nil {
				e = durableWrite(filepath.Join(dir, "catalog-"+hash+".json"), b, true)
			}
		}
		if e != nil {
			return nil, e
		}
		if shared {
			if _, e = readCatalogFile(filepath.Dir(m.local), hash); e != nil {
				e = durableWrite(filepath.Join(filepath.Dir(m.local), "catalog-"+hash+".json"), b, true)
				if e != nil {
					return nil, e
				}
			}
		}
		if shared {
			m.sharedCatalogHash = hash
		}
		return b, nil
	})
}
