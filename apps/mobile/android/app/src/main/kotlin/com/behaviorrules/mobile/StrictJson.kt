package com.behaviorrules.mobile

/** Small strict JSON reader, avoiding Android JSONObject's permissive syntax and JVM stubs. */
object StrictJson {
    fun parse(text: String, maxBytes: Int = RuleCodec.MAX_BYTES): Any? {
        require(text.toByteArray(Charsets.UTF_8).size <= maxBytes) { "文件超过 2 MiB" }
        return Reader(text).read()
    }
    private class Reader(private val source: String) {
        private var pos = 0
        private fun bad(): Nothing = throw IllegalArgumentException("JSON 格式无效（位置 $pos）")
        private fun skip() { while (pos < source.length && source[pos] in " \r\n\t") pos++ }
        private fun take(c: Char): Boolean { skip(); if (pos < source.length && source[pos] == c) { pos++; return true }; return false }
        fun read(): Any? { val value = value(0); skip(); if (pos != source.length) bad(); return value }
        private fun value(depth: Int): Any? {
            if (depth > 32) bad()
            skip(); if (pos >= source.length) bad()
            return when (source[pos]) {
                '{' -> {
                    pos++; val map = linkedMapOf<String, Any?>()
                    if (!take('}')) do {
                        skip(); if (pos >= source.length || source[pos] != '"') bad()
                        val key = string(); if (map.containsKey(key) || !take(':')) bad()
                        map[key] = value(depth + 1)
                        if (take('}')) break
                        if (!take(',')) bad()
                    } while (true)
                    map
                }
                '[' -> {
                    pos++; val list = mutableListOf<Any?>()
                    if (!take(']')) do {
                        list.add(value(depth + 1))
                        if (take(']')) break
                        if (!take(',')) bad()
                    } while (true)
                    list
                }
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                '-', in '0'..'9' -> number()
                else -> bad()
            }
        }
        private fun literal(token: String, result: Any?): Any? {
            if (!source.startsWith(token, pos)) bad()
            pos += token.length; return result
        }
        private fun string(): String {
            if (source[pos++] != '"') bad()
            val out = StringBuilder()
            while (pos < source.length) {
                val c = source[pos++]
                if (c == '"') return out.toString()
                if (c < ' ') bad()
                if (c != '\\') { out.append(c); continue }
                if (pos >= source.length) bad()
                when (val e = source[pos++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > source.length) bad()
                        val hex = source.substring(pos, pos + 4)
                        if (hex.any { it !in "0123456789abcdefABCDEF" }) bad()
                        out.append(hex.toInt(16).toChar()); pos += 4
                    }
                    else -> bad()
                }
            }
            bad()
        }
        private fun number(): Number {
            val start = pos
            if (source[pos] == '-') pos++
            if (pos >= source.length) bad()
            if (source[pos] == '0') pos++ else {
                if (source[pos] !in '1'..'9') bad()
                while (pos < source.length && source[pos] in '0'..'9') pos++
            }
            if (pos < source.length && source[pos] == '.') {
                pos++; val before = pos
                while (pos < source.length && source[pos] in '0'..'9') pos++
                if (pos == before) bad()
            }
            if (pos < source.length && source[pos] in "eE") {
                pos++; if (pos < source.length && source[pos] in "+-") pos++
                val before = pos
                while (pos < source.length && source[pos] in '0'..'9') pos++
                if (pos == before) bad()
            }
            val token = source.substring(start, pos)
            return token.toLongOrNull() ?: try { java.math.BigDecimal(token) } catch (_: Exception) { bad() }
        }
    }
}
