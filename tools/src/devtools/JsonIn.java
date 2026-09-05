package devtools;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 极简 JSON 读入器。剧本文件是 UTF-8 JSON，只需要对象/数组/字符串/数字/布尔/null，
 * 不引第三方依赖（devtools.Json 是配套的写出器）。
 *
 * 刻意严格：任何不认识的字节都抛异常并带上偏移量。剧本写错时应当当场炸，
 * 而不是解析成一个"什么都没有"的空剧本、再导出一份看上去正常的空 trace。
 */
public final class JsonIn {

    private final String src;
    private int pos;

    private JsonIn(String src) { this.src = src; }

    public static Object parse(String text) {
        JsonIn p = new JsonIn(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.pos != text.length()) throw p.err("末尾有多余内容");
        return v;
    }

    // ---- 取值辅助：类型不对就抛，不做静默兜底 ----

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object o, String what) {
        if (!(o instanceof Map)) throw new IllegalArgumentException(what + " 应当是对象，实际是 " + kind(o));
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object o, String what) {
        if (!(o instanceof List)) throw new IllegalArgumentException(what + " 应当是数组，实际是 " + kind(o));
        return (List<Object>) o;
    }

    public static String str(Map<String, Object> m, String key) {
        Object o = m.get(key);
        if (o == null) throw new IllegalArgumentException("缺少字符串字段 " + key);
        if (!(o instanceof String)) throw new IllegalArgumentException(key + " 应当是字符串，实际是 " + kind(o));
        return (String) o;
    }

    public static String strOr(Map<String, Object> m, String key, String dflt) {
        Object o = m.get(key);
        if (o == null) return dflt;
        if (!(o instanceof String)) throw new IllegalArgumentException(key + " 应当是字符串，实际是 " + kind(o));
        return (String) o;
    }

    public static int i(Map<String, Object> m, String key) {
        Object o = m.get(key);
        if (o == null) throw new IllegalArgumentException("缺少整数字段 " + key);
        return toInt(o, key);
    }

    public static int iOr(Map<String, Object> m, String key, int dflt) {
        Object o = m.get(key);
        return o == null ? dflt : toInt(o, key);
    }

    public static boolean boolOr(Map<String, Object> m, String key, boolean dflt) {
        Object o = m.get(key);
        if (o == null) return dflt;
        if (!(o instanceof Boolean)) throw new IllegalArgumentException(key + " 应当是布尔，实际是 " + kind(o));
        return (Boolean) o;
    }

    private static int toInt(Object o, String key) {
        if (!(o instanceof Double)) throw new IllegalArgumentException(key + " 应当是数字，实际是 " + kind(o));
        double d = (Double) o;
        if (d != Math.rint(d)) throw new IllegalArgumentException(key + " 应当是整数，实际是 " + d);
        return (int) d;
    }

    private static String kind(Object o) {
        if (o == null) return "null";
        if (o instanceof Map) return "对象";
        if (o instanceof List) return "数组";
        if (o instanceof String) return "字符串";
        if (o instanceof Double) return "数字";
        return "布尔";
    }

    // ---- 扫描 ----

    private Object value() {
        if (pos >= src.length()) throw err("内容提前结束");
        char c = src.charAt(pos);
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': expect("true");  return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null");  return null;
            default:  return number();
        }
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        pos++; ws();
        if (peek() == '}') { pos++; return m; }
        while (true) {
            ws();
            if (peek() != '"') throw err("对象的键必须是字符串");
            String k = string();
            ws();
            if (peek() != ':') throw err("键之后应当是 ':'");
            pos++; ws();
            if (m.put(k, value()) != null) throw err("重复的键 " + k);
            ws();
            char c = peek();
            if (c == ',') { pos++; continue; }
            if (c == '}') { pos++; return m; }
            throw err("对象里应当是 ',' 或 '}'");
        }
    }

    private List<Object> array() {
        List<Object> xs = new ArrayList<>();
        pos++; ws();
        if (peek() == ']') { pos++; return xs; }
        while (true) {
            ws();
            xs.add(value());
            ws();
            char c = peek();
            if (c == ',') { pos++; continue; }
            if (c == ']') { pos++; return xs; }
            throw err("数组里应当是 ',' 或 ']'");
        }
    }

    private String string() {
        pos++; // 开引号
        StringBuilder b = new StringBuilder();
        while (true) {
            if (pos >= src.length()) throw err("字符串没有闭合");
            char c = src.charAt(pos++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            if (pos >= src.length()) throw err("转义没有闭合");
            char e = src.charAt(pos++);
            switch (e) {
                case '"':  b.append('"');  break;
                case '\\': b.append('\\'); break;
                case '/':  b.append('/');  break;
                case 'b':  b.append('\b'); break;
                case 'f':  b.append('\f'); break;
                case 'n':  b.append('\n'); break;
                case 'r':  b.append('\r'); break;
                case 't':  b.append('\t'); break;
                case 'u':
                    if (pos + 4 > src.length()) throw err("\\u 转义不完整");
                    b.append((char) Integer.parseInt(src.substring(pos, pos + 4), 16));
                    pos += 4;
                    break;
                default: throw err("不认识的转义 \\" + e);
            }
        }
    }

    private Double number() {
        int s = pos;
        if (peek() == '-') pos++;
        while (pos < src.length() && "0123456789+-.eE".indexOf(src.charAt(pos)) >= 0) pos++;
        if (pos == s) throw err("不是一个值");
        try {
            return Double.valueOf(src.substring(s, pos));
        } catch (NumberFormatException ex) {
            throw err("数字格式错误: " + src.substring(s, pos));
        }
    }

    private void expect(String lit) {
        if (!src.startsWith(lit, pos)) throw err("期待 " + lit);
        pos += lit.length();
    }

    private char peek() {
        if (pos >= src.length()) throw err("内容提前结束");
        return src.charAt(pos);
    }

    private void ws() {
        while (pos < src.length()) {
            char c = src.charAt(pos);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
            else break;
        }
    }

    private IllegalArgumentException err(String msg) {
        return new IllegalArgumentException("JSON 偏移 " + pos + ": " + msg);
    }
}
