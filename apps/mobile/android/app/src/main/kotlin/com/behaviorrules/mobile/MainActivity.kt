package com.behaviorrules.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.ZoneId
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val fileWorker = Executors.newSingleThreadExecutor()
    private var pendingFileResult: MethodChannel.Result? = null
    private var pendingExport: ByteArray? = null
    private val store get() = RuleStore.get(this)
    private val policy get() = AppPolicy(this)
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "behavior_rules/platform").setMethodCallHandler(::handle)
    }
    private fun state(): Map<String, Any> {
        RuleService.instance?.checkpoint()
        val now = System.currentTimeMillis()
        store.prune(now)
        return mapOf("config" to RuleCodec.encodeConfig(store.config), "usage" to store.usage.mapValues { it.value.toMap() }, "grants" to store.grants.toMap(),
            "logs" to store.logs.toList(), "status" to RuleService.status(this), "today" to RuleEngine.date(now, ZoneId.systemDefault()), "now" to now)
    }
    private fun args(call: MethodCall): Map<*, *> = call.arguments as? Map<*, *> ?: throw IllegalArgumentException("参数必须为对象")
    private fun id(call: MethodCall): String = (args(call)["id"] as? String)?.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{1,80}")) } ?: throw IllegalArgumentException("规则编号无效")
    private fun mutation(changedId: String? = null, reset: Boolean = false, action: () -> Unit): Map<String, Any> {
        RuleService.instance?.checkpoint()
        action()
        RuleService.instance?.refresh(changedId, reset)
        return state()
    }
    private fun open(intent: Intent) { if (intent.resolveActivity(packageManager) == null) throw IllegalStateException("此设备没有对应的系统设置页面"); startActivity(intent) }
    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "getState" -> result.success(state())
                "listApps" -> result.success(policy.listApps().map(RuleCodec::encodeTarget))
                "saveRule" -> {
                    val rule = RuleCodec.decodeRule(args(call)["rule"], policy.forbidden())
                    result.success(mutation(rule.id) { store.save(rule) })
                }
                "deleteRule" -> { val ruleId = id(call); result.success(mutation(ruleId) { store.delete(ruleId) }) }
                "toggleRule" -> {
                    val ruleId = id(call); val enabled = args(call)["enabled"] as? Boolean ?: throw IllegalArgumentException("启停值必须为布尔值")
                    result.success(mutation(ruleId) { store.save(store.requireRule(ruleId).copy(enabled = enabled)) })
                }
                "bypassRule" -> {
                    val ruleId = id(call); val minutes = RuleCodec.integer(args(call)["minutes"], 1, 60, "临时放行分钟数").toInt()
                    result.success(mutation(ruleId) { store.bypass(ruleId, minutes, System.currentTimeMillis()) })
                }
                "revokeBypass" -> { val ruleId = id(call); result.success(mutation(ruleId) { store.revoke(ruleId) }) }
                "clearLogs" -> { store.clearLogs(); result.success(state()) }
                "getConfigJson" -> result.success(store.configJson())
                "importConfig" -> {
                    val json = args(call)["json"] as? String ?: throw IllegalArgumentException("需要 JSON 文字")
                    val config = RuleCodec.decodeConfig(StrictJson.parse(json), policy.forbidden())
                    result.success(mutation(reset = true) { store.replace(config, reset = true) })
                }
                "exportConfig" -> {
                    check(pendingFileResult == null) { "另一个文件操作尚未结束" }
                    pendingExport = store.configJson().toByteArray(Charsets.UTF_8)
                    pendingFileResult = result
                    try {
                        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"; putExtra(Intent.EXTRA_TITLE, "行为规则-Android-${RuleEngine.date(System.currentTimeMillis(), ZoneId.systemDefault())}.json") }, EXPORT)
                    } catch (e: Exception) { finishFile(result, errorCode = "file_error", errorMessage = e.message ?: "无法打开文件保存器") }
                }
                "readImportFile" -> {
                    check(pendingFileResult == null) { "另一个文件操作尚未结束" }
                    pendingFileResult = result
                    try {
                        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream")) }, IMPORT)
                    } catch (e: Exception) { finishFile(result, errorCode = "file_error", errorMessage = e.message ?: "无法打开文件选择器") }
                }
                "openAccessibilitySettings" -> { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); result.success(null) }
                "openAppSettings" -> { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))); result.success(null) }
                "openBatterySettings" -> { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); result.success(null) }
                else -> result.notImplemented()
            }
        } catch (e: IllegalArgumentException) { result.error("invalid_config", e.message ?: "配置无效", null) }
        catch (e: SecurityException) { result.error("permission_denied", "系统拒绝了此操作，请检查授权", null) }
        catch (e: Exception) { result.error("operation_failed", e.message ?: "操作失败，请重试", null) }
    }
    /** Main-thread-only terminal gate: a cancelled or superseded worker must never reply twice. */
    private fun finishFile(result: MethodChannel.Result, response: String? = null,
                           errorCode: String? = null, errorMessage: String? = null) {
        if (pendingFileResult !== result) return
        // Clear before replying so a later completion cannot clear or reply to a newer operation.
        pendingFileResult = null
        pendingExport = null
        if (errorCode == null) result.success(response) else result.error(errorCode, errorMessage, null)
    }
    @Deprecated("The FlutterActivity result callback remains compatible with Android's document picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != IMPORT && requestCode != EXPORT) return
        val result = pendingFileResult ?: return
        val bytes = pendingExport
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) { finishFile(result); return }
        try {
            fileWorker.execute {
                try {
                    val response: String = if (requestCode == EXPORT) {
                        val output = bytes ?: throw IllegalStateException("导出内容已失效，请重试")
                        contentResolver.openOutputStream(uri, "wt")?.use { it.write(output) } ?: throw IllegalStateException("无法写入选择的位置")
                        "规则已导出（不含用时、记录或临时放行）"
                    } else {
                        val output = ByteArrayOutputStream()
                        contentResolver.openInputStream(uri)?.use { input ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                if (output.size() + count > RuleCodec.MAX_BYTES) throw IllegalArgumentException("文件超过 2 MiB，未导入")
                                output.write(buffer, 0, count)
                            }
                        } ?: throw IllegalStateException("无法读取选择的文件")
                        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
                    }
                    runOnUiThread { finishFile(result, response) }
                } catch (e: Exception) {
                    runOnUiThread { finishFile(result, errorCode = "file_error", errorMessage = e.message ?: "无法读取或保存文件") }
                }
            }
        } catch (e: Exception) {
            // The executor may already be shut down while an old picker result is being delivered.
            finishFile(result, errorCode = "file_error", errorMessage = e.message ?: "文件操作已结束，请重试")
        }
    }
    override fun onDestroy() {
        pendingFileResult?.let { finishFile(it, errorCode = "cancelled", errorMessage = "文件操作已取消") }
        fileWorker.shutdown()
        super.onDestroy()
    }
    companion object { private const val IMPORT = 801; private const val EXPORT = 802 }
}
