package com.behaviorrules.mobile

import android.content.Context
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** Single-process, main-thread owner. A single preference value makes rule replacement atomic. */
class RuleStore private constructor(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("behavior_rules", Context.MODE_PRIVATE)
    var config = RuleConfig(emptyList()); private set
    var usage = mutableMapOf<String, MutableMap<String, Long>>(); private set
    var grants = mutableMapOf<String, Long>(); private set
    var waits = mutableMapOf<String, WaitState>(); private set
    var logs = mutableListOf<Map<String, Any>>(); private set
    var loadError: String? = null; private set
    data class WaitState(val packageName: String, val deadline: Long)

    init {
        prefs.getString("state", null)?.let { json ->
            try {
                val raw = StrictJson.parse(json, 8 * RuleCodec.MAX_BYTES) as? Map<*, *> ?: throw IllegalArgumentException("存档对象无效")
                config = RuleCodec.decodeConfig(raw["config"])
                (raw["usage"] as? Map<*, *>)?.forEach { (day, values) ->
                    if (day is String && runCatching { LocalDate.parse(day) }.isSuccess && values is Map<*, *>) {
                        usage[day] = values.entries.mapNotNull { (id, ms) ->
                            if (id is String && ms is Number && ms.toLong() in 0..86400000L) id to ms.toLong() else null
                        }.toMap().toMutableMap()
                    }
                }
                (raw["grants"] as? Map<*, *>)?.forEach { (id, until) -> if (id is String && until is Number && until.toLong() > 0) grants[id] = until.toLong() }
                (raw["waits"] as? Map<*, *>)?.forEach { (id, state) ->
                    val m = state as? Map<*, *>
                    val pkg = m?.get("packageName") as? String; val deadline = m?.get("deadline") as? Number
                    if (id is String && pkg != null && deadline != null) waits[id] = WaitState(pkg, deadline.toLong())
                }
                (raw["logs"] as? List<*>)?.take(300)?.forEach { item ->
                    if (item is Map<*, *> && item["at"] is Number && listOf("ruleId", "ruleName", "targetLabel", "action", "reason").all { item[it] is String }) {
                        logs.add(mapOf("at" to (item["at"] as Number).toLong(), "ruleId" to item["ruleId"]!!, "ruleName" to item["ruleName"]!!, "targetLabel" to item["targetLabel"]!!, "action" to item["action"]!!, "reason" to item["reason"]!!))
                    }
                }
                prune(System.currentTimeMillis())
            } catch (_: Exception) {
                config = RuleConfig(emptyList()); usage.clear(); grants.clear(); waits.clear(); logs.clear()
                loadError = "本地存档无法读取，已停止规则执行。原存档未覆盖，请先检查备份。"
            }
        }
    }
    private fun snapshot(c: RuleConfig = config, u: Map<String, Map<String, Long>> = usage, g: Map<String, Long> = grants, w: Map<String, WaitState> = waits, l: List<Map<String, Any>> = logs): String =
        JSONObject(mapOf("config" to RuleCodec.encodeConfig(c), "usage" to u, "grants" to g, "waits" to w.mapValues { mapOf("packageName" to it.value.packageName, "deadline" to it.value.deadline) }, "logs" to l)).toString()
    private fun write(value: String) { check(prefs.edit().putString("state", value).commit()) { "无法保存到本机存储" }; loadError = null }
    fun persist() { if (loadError == null) prefs.edit().putString("state", snapshot()).apply() }
    fun configJson(): String { val json = JSONObject(RuleCodec.encodeConfig(config)); val pretty = json.toString(2); return if (pretty.toByteArray(Charsets.UTF_8).size <= RuleCodec.MAX_BYTES) pretty else json.toString() }
    fun requireRule(id: String): BehaviorRule = config.rules.find { it.id == id } ?: throw IllegalArgumentException("找不到该规则")
    fun replace(next: RuleConfig, changedId: String? = null, reset: Boolean = false, delete: Boolean = false) {
        require(JSONObject(RuleCodec.encodeConfig(next)).toString().toByteArray(Charsets.UTF_8).size <= RuleCodec.MAX_BYTES) { "规则配置超过 2 MiB" }
        val newUsage = if (reset) mutableMapOf() else usage.mapValues { it.value.toMutableMap().also { m -> if (delete) m.remove(changedId) } }.toMutableMap()
        val newGrants = if (reset) mutableMapOf() else grants.toMutableMap().also { it.remove(changedId) }
        val newWaits = if (reset) mutableMapOf() else waits.toMutableMap().also { it.remove(changedId) }
        write(snapshot(next, newUsage, newGrants, newWaits))
        config = next; usage = newUsage; grants = newGrants; waits = newWaits
    }
    fun save(rule: BehaviorRule) {
        val rules = config.rules.filterNot { it.id == rule.id } + rule
        require(rules.size <= 200) { "最多可保存 200 条规则" }
        replace(RuleConfig(rules), rule.id)
    }
    fun delete(id: String) { requireRule(id); replace(RuleConfig(config.rules.filterNot { it.id == id }), id, delete = true) }
    fun bypass(id: String, minutes: Int, now: Long) {
        val rule = requireRule(id)
        require(minutes in 1..60) { "临时放行须为 1 至 60 分钟" }
        val updated = grants.toMutableMap().also { it[id] = now + minutes * 60000L }
        val newWaits = waits.toMutableMap().also { it.remove(id) }
        val newLogs = (listOf(logEntry(rule, rule.targets.take(3).joinToString("、") { it.label }.take(255) + if (rule.targets.size > 3) "等 ${rule.targets.size} 个应用" else "", "bypass", "临时放行 $minutes 分钟", now)) + logs).take(300).toMutableList()
        write(snapshot(g = updated, w = newWaits, l = newLogs)); grants = updated; waits = newWaits; logs = newLogs
    }
    fun revoke(id: String) { requireRule(id); val updated = grants.toMutableMap().also { it.remove(id) }; write(snapshot(g = updated)); grants = updated }
    fun clearLogs() { write(snapshot(l = emptyList())); logs.clear() }
    fun setWait(id: String, state: WaitState?) {
        val updated = waits.toMutableMap().also { if (state == null) it.remove(id) else it[id] = state }
        write(snapshot(w = updated)); waits = updated
    }
    fun keepWaitsFor(pkg: String?) { val changed = waits.entries.removeAll { it.value.packageName != pkg }; if (changed) persist() }
    fun clearWaits() { waits.clear(); persist() }
    private fun logEntry(rule: BehaviorRule, target: String, action: String, reason: String, now: Long): Map<String, Any> = mapOf("at" to now, "ruleId" to rule.id, "ruleName" to rule.name, "targetLabel" to target, "action" to action, "reason" to reason)
    fun log(rule: BehaviorRule, pkg: String, reason: String, now: Long) {
        logs.add(0, logEntry(rule, rule.targets.find { it.id == pkg }?.label ?: pkg, rule.action, reason, now))
        if (logs.size > 300) logs.subList(300, logs.size).clear()
        persist()
    }
    fun prune(now: Long) {
        val today = LocalDate.parse(RuleEngine.date(now, ZoneId.systemDefault()))
        usage.keys.removeAll { !RuleEngine.retainsUsageDay(it, today.toString()) }
        val ids = config.rules.map { it.id }.toSet()
        grants.entries.removeAll { it.key !in ids || it.value <= now }
        waits.keys.removeAll { it !in ids }
        usage.values.forEach { it.keys.retainAll(ids) }
    }
    companion object {
        @Volatile private var instance: RuleStore? = null
        fun get(context: Context): RuleStore = instance ?: synchronized(this) { instance ?: RuleStore(context).also { instance = it } }
    }
}
