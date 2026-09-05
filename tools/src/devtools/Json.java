package devtools;

import java.util.ArrayList;
import java.util.List;

/** 极简 JSON 写出器。真值导出只需要 String / int / 数组 / 对象，不引第三方依赖。 */
public final class Json {
    private Json() {}

    public static String str(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n");  break;
                case '\r': b.append("\\r");  break;
                case '\t': b.append("\\t");  break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    public static String arrStr(List<String> xs) {
        if (xs == null) return "null";
        List<String> out = new ArrayList<>();
        for (String x : xs) out.add(str(x));
        return "[" + String.join(",", out) + "]";
    }

    public static String arrStrArr(List<String[]> xs) {
        if (xs == null) return "null";
        List<String> out = new ArrayList<>();
        for (String[] x : xs) {
            List<String> inner = new ArrayList<>();
            for (String s : x) inner.add(str(s));
            out.add("[" + String.join(",", inner) + "]");
        }
        return "[" + String.join(",", out) + "]";
    }

    public static String arrArrStr(List<ArrayList<String>> xs) {
        if (xs == null) return "null";
        List<String> out = new ArrayList<>();
        for (ArrayList<String> x : xs) out.add(arrStr(x));
        return "[" + String.join(",", out) + "]";
    }

    public static String arrArrStrArr(List<ArrayList<String[]>> xs) {
        if (xs == null) return "null";
        List<String> out = new ArrayList<>();
        for (ArrayList<String[]> x : xs) out.add(arrStrArr(x));
        return "[" + String.join(",", out) + "]";
    }

    public static String grid(int[][] g) {
        if (g == null) return "null";
        List<String> rows = new ArrayList<>();
        for (int[] row : g) {
            List<String> cells = new ArrayList<>();
            for (int c : row) cells.add(String.valueOf(c));
            rows.add("[" + String.join(",", cells) + "]");
        }
        return "[" + String.join(",", rows) + "]";
    }

    public static String plainArr(String[] xs) {
        if (xs == null) return "null";
        List<String> out = new ArrayList<>();
        for (String x : xs) out.add(str(x));
        return "[" + String.join(",", out) + "]";
    }
}
