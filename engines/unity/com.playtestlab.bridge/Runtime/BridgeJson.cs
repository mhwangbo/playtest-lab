using System.Collections.Generic;
using System.Text;

namespace PlaytestLab
{
    /// <summary>
    /// Minimal reader for the bridge's flat request objects: {"cmd":"step","n":6,"action":"{...}"}.
    /// Strings are unescaped; numbers/bools/null are returned raw; nested objects/arrays are returned as raw JSON.
    /// </summary>
    internal static class BridgeJson
    {
        public static Dictionary<string, string> ParseFlat(string json)
        {
            var result = new Dictionary<string, string>();
            int i = SkipWs(json, 0);
            if (i >= json.Length || json[i] != '{') return result;
            i++;
            while (true)
            {
                i = SkipWs(json, i);
                if (i >= json.Length || json[i] == '}') break;
                string key = ReadString(json, ref i);
                i = SkipWs(json, i);
                if (i < json.Length && json[i] == ':') i++;
                i = SkipWs(json, i);
                result[key] = ReadValue(json, ref i);
                i = SkipWs(json, i);
                if (i < json.Length && json[i] == ',') i++;
            }
            return result;
        }

        public static string Escape(string s)
        {
            var sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        private static int SkipWs(string s, int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            return i;
        }

        private static string ReadValue(string s, ref int i)
        {
            if (i >= s.Length) return "";
            char c = s[i];
            if (c == '"') return ReadString(s, ref i);
            if (c == '{' || c == '[') return ReadNested(s, ref i);
            int start = i;
            while (i < s.Length && s[i] != ',' && s[i] != '}' && !char.IsWhiteSpace(s[i])) i++;
            return s.Substring(start, i - start);
        }

        private static string ReadNested(string s, ref int i)
        {
            int start = i;
            int depth = 0;
            bool inString = false;
            for (; i < s.Length; i++)
            {
                char c = s[i];
                if (inString)
                {
                    if (c == '\\') i++;
                    else if (c == '"') inString = false;
                    continue;
                }
                if (c == '"') inString = true;
                else if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']')
                {
                    depth--;
                    if (depth == 0) { i++; break; }
                }
            }
            return s.Substring(start, i - start);
        }

        private static string ReadString(string s, ref int i)
        {
            var sb = new StringBuilder();
            i++; // opening quote
            while (i < s.Length && s[i] != '"')
            {
                char c = s[i++];
                if (c != '\\' || i >= s.Length) { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 <= s.Length) { sb.Append((char)System.Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; }
                        break;
                    default: sb.Append(e); break;
                }
            }
            i++; // closing quote
            return sb.ToString();
        }
    }
}
