package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Kernel locks survive process crashes without a stale 'busy' flag. Portable
// storage is used by one device at a time; concurrent/network mounts are unsupported.
func acquireWriterLock(path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("This library is open in another PaceShelf process. Close it before continuing")
	}
	return f, nil
}
