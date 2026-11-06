package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestConcurrentReceiptsAcknowledgeOnlyTheirOwnCheckpoint(t *testing.T) {
	m := newTestMetadata(t, t.TempDir(), true)
	s := &server{metadata: m}
	httpServer := httptest.NewServer(s.handler())
	defer httpServer.Close()
	var group sync.WaitGroup
	var successes atomic.Int64
	for i := 1; i <= 24; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			response, e := http.Get(httpServer.URL + "/api/library")
			if e != nil {
				t.Error(e)
				return
			}
			var read struct {
				Revision string `json:"revision"`
			}
			e = json.NewDecoder(response.Body).Decode(&read)
			response.Body.Close()
			if e != nil {
				t.Error(e)
				return
			}
			payload := samplePayload(i)
			body, _ := json.Marshal(map[string]string{"expected": read.Revision, "payload": payload})
			response, e = http.Post(httpServer.URL+"/api/library", "application/json", strings.NewReader(string(body)))
			if e != nil {
				t.Error(e)
				return
			}
			defer response.Body.Close()
			if response.StatusCode == 409 {
				return
			}
			if response.StatusCode != 200 {
				t.Errorf("unexpected save status %d", response.StatusCode)
				return
			}
			var receipt saveReceipt
			if e = json.NewDecoder(response.Body).Decode(&receipt); e != nil {
				t.Error(e)
				return
			}
			checkpoint, _, _, _ := splitCheckpoint(payload)
			sum := sha256.Sum256(checkpoint)
			if receipt.Revision != hex.EncodeToString(sum[:]) {
				t.Error("response acknowledged another writer's checkpoint")
			}
			successes.Add(1)
		}(i)
	}
	group.Wait()
	if successes.Load() == 0 {
		t.Fatal("no checkpoint was committed")
	}
}
