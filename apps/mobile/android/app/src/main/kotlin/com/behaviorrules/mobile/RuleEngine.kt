package com.behaviorrules.mobile

import java.time.Instant
import java.time.ZoneId
import java.math.BigDecimal

/** This layer is Android-independent; all untrusted channel and backup data is checked here. */
data class RuleTarget(val platform: String, val id: String, val label: String)
data class RuleSchedule(val enabled: Boolean, val days: List<Int>, val start: String, val end: String)
data class BehaviorRule(val id: String, val name: String, val enabled: Boolean, val targets: List<RuleTarget>, val exceptions: List<RuleTarget>, val schedule: RuleSchedule, val quotaMinutes: Int, val action: String, val delaySeconds: Int, val message: String, val buttonText: String, val priority: Int, val createdAt: Long)
data class RuleConfig(val rules: List<BehaviorRule>)

object RuleCodec {
    const val MAX_BYTES = 2 * 1024 * 1024
    const val MAX_TIMESTAMP = 8640000000000000L
    private fun map(value: Any?): Map<*, *> = value as? Map<*, *> ?: error("需要对象")
    private fun error(text: String): Nothing = throw IllegalArgumentException(text)
    private fun str(m: Map<*, *>, key: String, min: Int, max: Int): String {
        val value = m[key] as? String ?: error("$key 必须是文字")
        require(value.length in min..max && (min == 0 || value.isNotBlank())) { "$key 长度不符合要求" }
        return value
    }
    private fun bool(m: Map<*, *>, key: String): Boolean = m[key] as? Boolean ?: error("$key 必须是布尔值")
    fun integer(value: Any?, min: Long, max: Long, name: String): Long {
        require(value is Number) { "$name 必须是整数" }
        val number = try { BigDecimal(value.toString()).longValueExact() } catch (_: Exception) { error("$name 必须是有限整数") }
        require(number in min..max) { "$name 超出允许范围" }
        return number
    }
    private fun list(m: Map<*, *>, key: String): List<*> = m[key] as? List<*> ?: error("$key 必须是列表")
    private fun targets(value: List<*>, minimum: Int, forbidden: Set<String>): List<RuleTarget> {
        require(value.size in minimum..100) { "应用数量不符合要求" }
        val result = value.map {
            val m = map(it)
            val platform = str(m, "platform", 1, 20)
            require(platform == "android") { "不能导入其他平台的应用标识" }
            val id = str(m, "id", 1, 255)
            require(id.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+"))) { "应用包名无效" }
            require(id !in forbidden) { "不能对本工具、桌面、设置、电话等必要组件设置规则" }
            RuleTarget(platform, id, str(m, "label", 1, 255))
        }
        require(result.map { it.id }.distinct().size == result.size) { "应用不可重复" }
        return result
    }
    fun decodeRule(value: Any?, forbidden: Set<String> = emptySet()): BehaviorRule {
        val m = map(value)
        val id = str(m, "id", 1, 80)
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,80}"))) { "规则编号无效" }
        val s = map(m["schedule"])
        val days = list(s, "days").map { integer(it, 0, 6, "星期").toInt() }
        require(days.isNotEmpty() && days.size <= 7 && days.distinct().size == days.size) { "星期不能为空或重复" }
        fun clock(key: String): String = str(s, key, 5, 5).also {
            require(it.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))) { "时间格式必须为 HH:mm" }
        }
        val action = str(m, "action", 1, 20)
        require(action in listOf("remind", "delay", "block")) { "不支持此动作" }
        return BehaviorRule(id, str(m, "name", 1, 80), bool(m, "enabled"), targets(list(m, "targets"), 1, forbidden), targets(list(m, "exceptions"), 0, forbidden),
            RuleSchedule(bool(s, "enabled"), days, clock("start"), clock("end")), integer(m["quotaMinutes"], 0, 1440, "分钟额度").toInt(), action,
            integer(m["delaySeconds"], 1, 3600, "等待秒数").toInt(), str(m, "message", 1, 1000), str(m, "buttonText", 1, 40),
            integer(m["priority"], -1000, 1000, "优先级").toInt(), integer(m["createdAt"], 0, MAX_TIMESTAMP, "创建时间"))
    }
    fun decodeConfig(value: Any?, forbidden: Set<String> = emptySet()): RuleConfig {
        val m = map(value)
        require(integer(m["version"], 1, 1, "版本") == 1L)
        require(m["platform"] == "android") { "备份不是 Android 平台配置" }
        val entries = list(m, "rules")
        require(entries.size <= 200) { "最多可保存 200 条规则" }
        val rules = entries.map { decodeRule(it, forbidden) }
        require(rules.map { it.id }.distinct().size == rules.size) { "规则编号不可重复" }
        return RuleConfig(rules)
    }
    fun encodeTarget(t: RuleTarget): Map<String, Any> = mapOf("platform" to t.platform, "id" to t.id, "label" to t.label)
    fun encodeRule(r: BehaviorRule): Map<String, Any> = mapOf("id" to r.id, "name" to r.name, "enabled" to r.enabled,
        "targets" to r.targets.map(::encodeTarget), "exceptions" to r.exceptions.map(::encodeTarget),
        "schedule" to mapOf("enabled" to r.schedule.enabled, "days" to r.schedule.days, "start" to r.schedule.start, "end" to r.schedule.end),
        "quotaMinutes" to r.quotaMinutes, "action" to r.action, "delaySeconds" to r.delaySeconds, "message" to r.message, "buttonText" to r.buttonText, "priority" to r.priority, "createdAt" to r.createdAt)
    fun encodeConfig(config: RuleConfig): Map<String, Any> = mapOf("version" to 1, "platform" to "android", "rules" to config.rules.map(::encodeRule))
}

object RuleEngine {
    fun retainsUsageDay(day: String, today: String): Boolean = runCatching {
        val entry = java.time.LocalDate.parse(day); val current = java.time.LocalDate.parse(today)
        !entry.isBefore(current.minusDays(7)) && !entry.isAfter(current)
    }.getOrDefault(false)
    fun date(now: Long, zone: ZoneId): String = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()
    fun inSchedule(s: RuleSchedule, now: Long, zone: ZoneId): Boolean {
        if (!s.enabled) return true
        val local = Instant.ofEpochMilli(now).atZone(zone)
        val minute = local.hour * 60 + local.minute
        fun mins(t: String) = t.substring(0, 2).toInt() * 60 + t.substring(3).toInt()
        val start = mins(s.start); val end = mins(s.end)
        val day = local.dayOfWeek.value % 7
        return when {
            start == end -> day in s.days
            start < end -> day in s.days && minute >= start && minute < end
            minute >= start -> day in s.days
            minute < end -> (day + 6) % 7 in s.days
            else -> false
        }
    }
    fun targets(r: BehaviorRule, pkg: String): Boolean = r.enabled && r.targets.any { it.id == pkg } && r.exceptions.none { it.id == pkg }
    fun select(rules: List<BehaviorRule>, pkg: String, now: Long, zone: ZoneId, todayUsage: Map<String, Long>, grants: Map<String, Long>, acknowledged: Set<String>): BehaviorRule? =
        rules.asSequence().filter { targets(it, pkg) && it.id !in acknowledged && (grants[it.id] ?: 0) <= now && inSchedule(it.schedule, now, zone) && (todayUsage[it.id] ?: 0) >= it.quotaMinutes * 60000L }
            .sortedWith(compareByDescending<BehaviorRule> { when (it.action) { "block" -> 3; "delay" -> 2; else -> 1 } }.thenByDescending { it.priority }.thenBy { it.createdAt }.thenBy { it.id }).firstOrNull()
    /** Minute boundaries capture schedule changes; local dates capture midnight and daylight-saving changes. */
    fun accrue(rules: List<BehaviorRule>, pkg: String, start: Long, end: Long, zone: ZoneId, usage: MutableMap<String, MutableMap<String, Long>>) {
        if (end <= start) return
        val applicable = rules.filter { targets(it, pkg) }
        var cursor = start
        while (cursor < end) {
            val local = Instant.ofEpochMilli(cursor).atZone(zone)
            val nextMinute = local.withSecond(0).withNano(0).plusMinutes(1).toInstant().toEpochMilli()
            val nextDay = local.toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            val until = minOf(end, nextMinute, nextDay)
            if (until <= cursor) break
            applicable.filter { inSchedule(it.schedule, cursor, zone) }.forEach { r ->
                val daily = usage.getOrPut(local.toLocalDate().toString()) { mutableMapOf() }
                daily[r.id] = minOf(86400000L, (daily[r.id] ?: 0) + until - cursor)
            }
            cursor = until
        }
    }
}

class ForegroundSession {
    enum class WindowChange { IGNORED, SUSPENDED, CHANGED, UNCHANGED }
    var packageName: String? = null; private set
    val acknowledged = mutableSetOf<String>()
    /** Package metadata classifies temporary windows without reading any UI nodes or text. */
    fun onWindow(pkg: String, activity: Boolean, fullScreen: Boolean, ownPackage: String,
                 imePackages: Set<String>, transientPackages: Set<String>): WindowChange {
        // A keyboard popup belongs to the current visit; its settings Activity is a real app switch.
        if (!activity && (pkg == ownPackage || pkg in imePackages)) return WindowChange.IGNORED
        if (pkg in transientPackages && !(activity && pkg in imePackages)) return WindowChange.SUSPENDED
        if (!activity && !fullScreen && pkg != packageName) return WindowChange.IGNORED
        return if (enter(pkg)) WindowChange.CHANGED else WindowChange.UNCHANGED
    }
    fun enter(pkg: String?): Boolean {
        if (pkg == packageName) return false
        packageName = pkg
        acknowledged.clear()
        return true
    }
}
/** Two clocks prevent wall-time changes or a suspended process from fabricating foreground use. */
class UsageSampler {
    private var wall: Long? = null
    private var elapsed: Long? = null
    private var counting = false
    fun reset() { wall = null; elapsed = null; counting = false }
    fun sample(now: Long, uptime: Long, shouldCount: Boolean): LongRange? {
        val priorWall = wall; val priorElapsed = elapsed; val priorCounting = counting
        wall = now; elapsed = uptime; counting = shouldCount
        if (!shouldCount || !priorCounting || priorWall == null || priorElapsed == null) return null
        val dt = uptime - priorElapsed
        if (dt !in 1..10000 || kotlin.math.abs((now - priorWall) - dt) > 2000) return null
        if (now <= priorWall) return null
        return (now - dt) until now
    }
}
