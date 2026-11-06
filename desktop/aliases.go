package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Logical course names remain stable when a physical folder must be renamed
// for exFAT. Android reads this same small mapping before constructing video IDs.
func loadCourseAliases(root string) (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(root, ".course-player", "course-aliases.json"))
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) > 65536 {
		return nil, fmt.Errorf("course alias map is too large")
	}
	aliases := map[string]string{}
	if err = json.Unmarshal(data, &aliases); err != nil {
		return nil, err
	}
	used := map[string]bool{}
	for physical, logical := range aliases {
		if physical == "" || logical == "" || logical == "." || logical == ".." || strings.ContainsAny(physical+logical, "/\\\n\r\x00") || used[logical] {
			return nil, fmt.Errorf("invalid course alias")
		}
		used[logical] = true
	}
	return aliases, nil
}

func canonicalHistoryID(id string, aliases map[string]string) string {
	id = strings.TrimPrefix(id, "Video Library/Courses/")
	id = strings.TrimPrefix(id, "Courses/")
	if slash := strings.IndexByte(id, '/'); slash > 0 {
		if logical, ok := aliases[id[:slash]]; ok {
			return logical + id[slash:]
		}
	}
	return id
}
