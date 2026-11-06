package org.paceshelf.player;

import java.util.Comparator;

/** Same numeric ordering as the desktop player, without numeric overflow. */
final class NaturalOrder implements Comparator<String> {
    @Override public int compare(String a, String b) {
        int ai = 0, bi = 0;
        while (ai < a.length() && bi < b.length()) {
            char ac = a.charAt(ai), bc = b.charAt(bi);
            if (digit(ac) && digit(bc)) {
                int ae = ai, be = bi;
                while (ae < a.length() && digit(a.charAt(ae))) ae++;
                while (be < b.length() && digit(b.charAt(be))) be++;
                while (ai < ae - 1 && a.charAt(ai) == '0') ai++;
                while (bi < be - 1 && b.charAt(bi) == '0') bi++;
                if (ae - ai != be - bi) return Integer.compare(ae - ai, be - bi);
                while (ai < ae) {
                    int c = Character.compare(a.charAt(ai++), b.charAt(bi++));
                    if (c != 0) return c;
                }
            } else {
                int c = Character.compare(ac, bc);
                if (c != 0) return c;
                ai++; bi++;
            }
        }
        return Integer.compare(a.length(), b.length());
    }
    private boolean digit(char c) { return c >= '0' && c <= '9'; }
}
