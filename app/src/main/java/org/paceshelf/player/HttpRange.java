package org.paceshelf.player;

/** Inclusive single byte range, as used by Android's video player. */
final class HttpRange {
    final long start, end;
    final boolean partial;
    private HttpRange(long start, long end, boolean partial) {
        this.start = start; this.end = end; this.partial = partial;
    }
    long length() { return Math.max(0, end - start + 1); }
    static HttpRange parse(String header, long size) {
        if (size < 0) throw new IllegalArgumentException("Unknown file size");
        if (header == null) return new HttpRange(0, size - 1, false);
        if (!header.startsWith("bytes=") || header.contains(",") || size == 0)
            throw new IllegalArgumentException("Unsupported range");
        String[] parts = header.substring(6).split("-", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid range");
        long start, end;
        if (parts[0].isEmpty()) {
            long suffix = Long.parseLong(parts[1]);
            if (suffix <= 0) throw new IllegalArgumentException("Invalid suffix");
            start = Math.max(0, size - suffix); end = size - 1;
        } else {
            start = Long.parseLong(parts[0]);
            end = parts[1].isEmpty() ? size - 1 : Math.min(size - 1, Long.parseLong(parts[1]));
        }
        if (start < 0 || start >= size || end < start) throw new IllegalArgumentException("Unsatisfiable range");
        return new HttpRange(start, end, true);
    }
}
