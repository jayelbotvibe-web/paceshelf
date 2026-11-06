package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Ask the operating system to finish removal. Restrict this operation to the
// USB filesystem that contains this library; never force an unmount.
func unmountUSB(root string) (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	query := func(field string) (string, error) {
		b, e := exec.CommandContext(ctx, "findmnt", "-n", "-T", root, "-o", field).Output()
		return strings.TrimSpace(string(b)), e
	}
	target, err := query("TARGET")
	if err != nil || target == "" || target == "/" {
		return false, "Use Eject in Files for this library."
	}
	device, err := query("SOURCE")
	if err != nil || !strings.HasPrefix(device, "/dev/") {
		return false, "USB volume could not be identified."
	}
	transport, err := exec.CommandContext(ctx, "lsblk", "-s", "-n", "-r", "-o", "TRAN", device).Output()
	if err != nil || !containsWord(string(transport), "usb") {
		return false, "Automatic removal applies to USB storage only."
	}
	uuid, err := query("UUID")
	if err != nil || uuid == "" || strings.ContainsAny(uuid, "/ \t\n") {
		return false, "USB volume identity unavailable."
	}
	output, err := exec.CommandContext(ctx, "udisksctl", "unmount", "--block-device", "/dev/disk/by-uuid/"+uuid, "--no-user-interaction").CombinedOutput()
	if err != nil {
		return false, fmt.Sprintf("Finish with Eject in Files: %s", strings.TrimSpace(string(output)))
	}
	return true, ""
}
func containsWord(text, word string) bool {
	for _, value := range strings.Fields(text) {
		if value == word {
			return true
		}
	}
	return false
}
