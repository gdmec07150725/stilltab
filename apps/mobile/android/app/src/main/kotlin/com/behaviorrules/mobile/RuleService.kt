package com.behaviorrules.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import java.time.ZoneId

class RuleService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val session = ForegroundSession()
    private val sampler = UsageSampler()
    private val logged = mutableSetOf<String>()
    private lateinit var store: RuleStore
    private lateinit var overlay: RuleOverlay
    private lateinit var policy: AppPolicy
    private var suspended = false
    private var pausedForLock = false
    private var lastPersist = 0L
    private var registered = false
    private var blockedPackages = emptySet<String>()
    private var imePackages = emptySet<String>()
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> pauseForLock()
                Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> { sampler.reset(); evaluate() }
                Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON -> resumeScreen()
                Intent.ACTION_PACKAGE_ADDED, Intent.ACTION_PACKAGE_REMOVED, Intent.ACTION_PACKAGE_CHANGED -> refreshPolicy()
            }
        }
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (instance !== this@RuleService) return
            if (!permissionGranted(this@RuleService)) { stopMonitoring(); return }
            if (!screenAvailable()) { pauseForLock(); return }
            checkpoint(); evaluate()
            val now = System.currentTimeMillis()
            if (now - lastPersist >= 5000) { store.prune(now); store.persist(); lastPersist = now }
            handler.postDelayed(this, 1000)
        }
    }
    override fun onServiceConnected() {
        super.onServiceConnected()
        store = RuleStore.get(this); overlay = RuleOverlay(this); policy = AppPolicy(this)
        instance = this
        lastEventAt = 0
        runtimeError = null
        refreshPolicy()
        val filter = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT); addAction(Intent.ACTION_TIME_CHANGED); addAction(Intent.ACTION_TIMEZONE_CHANGED) }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)
        val packages = IntentFilter().apply { addAction(Intent.ACTION_PACKAGE_ADDED); addAction(Intent.ACTION_PACKAGE_REMOVED); addAction(Intent.ACTION_PACKAGE_CHANGED); addDataScheme("package") }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, packages, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, packages)
        registered = true
        sampler.reset()
        handler.post(ticker)
    }
    private fun refreshPolicy() {
        blockedPackages = policy.forbidden()
        imePackages = (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).inputMethodList.map { it.packageName }.toSet()
    }
    private fun screenAvailable(): Boolean = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive && !(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (instance !== this || event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        lastEventAt = System.currentTimeMillis()
        checkpoint()
        if (!screenAvailable()) { pauseForLock(); return }
        if (pausedForLock) resumeScreen()
        val pkg = event.packageName?.toString() ?: return
        val activity = policy.isActivity(pkg, event.className?.toString())
        val transition = session.onWindow(pkg, activity, event.isFullScreen, packageName, imePackages, policy.transientPackages)
        if (transition == ForegroundSession.WindowChange.IGNORED) return
        if (transition == ForegroundSession.WindowChange.SUSPENDED) {
            suspended = true; overlay.hide(); sampler.reset(); return
        }
        if (transition == ForegroundSession.WindowChange.CHANGED) {
            overlay.hide(); logged.clear(); store.keepWaitsFor(pkg); sampler.reset()
        }
        if (suspended) { suspended = false; sampler.reset() }
        evaluate()
        checkpoint()
    }
    fun checkpoint() {
        if (!::store.isInitialized || !::overlay.isInitialized) return
        val pkg = session.packageName
        val interval = sampler.sample(System.currentTimeMillis(), SystemClock.elapsedRealtime(), pkg != null && pkg !in blockedPackages && !suspended && screenAvailable() && !overlay.blocking)
        if (pkg != null && interval != null) RuleEngine.accrue(store.config.rules, pkg, interval.first, interval.last + 1, ZoneId.systemDefault(), store.usage)
    }
    private fun evaluate() {
        if (!::store.isInitialized || suspended || !screenAvailable()) return
        val pkg = session.packageName
        if (pkg == null || pkg in blockedPackages || store.loadError != null) { overlay.hide(); return }
        val now = System.currentTimeMillis(); val zone = ZoneId.systemDefault()
        val rule = RuleEngine.select(store.config.rules, pkg, now, zone, store.usage[RuleEngine.date(now, zone)] ?: emptyMap(), store.grants, session.acknowledged)
        if (rule == null) { overlay.hide(); runtimeError = null; return }
        if (overlay.ruleId == rule.id) {
            store.waits[rule.id]?.let { overlay.updateCountdown(it.deadline) }
            return
        }
        val deadline = if (rule.action == "delay") {
            val prior = store.waits[rule.id]?.takeIf { it.packageName == pkg }
            if (prior != null) prior.deadline else (now + rule.delaySeconds * 1000L).also { value ->
                try { store.setWait(rule.id, RuleStore.WaitState(pkg, value)) } catch (_: Exception) { runtimeError = "等待状态保存失败，请检查本机存储"; return }
            }
        } else null
        val shown = overlay.show(rule, deadline, acknowledge = {
            if (session.packageName == pkg && overlay.ruleId == rule.id) {
                checkpoint(); session.acknowledged.add(rule.id)
                runCatching { store.setWait(rule.id, null) }
                overlay.hide(); evaluate(); checkpoint()
            }
        }, home = {
            if (performGlobalAction(GLOBAL_ACTION_HOME)) {
                checkpoint(); session.enter(null); logged.clear(); overlay.hide(); store.keepWaitsFor(null); sampler.reset()
            } else Toast.makeText(this, "无法返回桌面，请使用系统主页手势", Toast.LENGTH_SHORT).show()
        }, manage = {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        })
        if (shown) {
            runtimeError = null
            if (logged.add(rule.id)) store.log(rule, pkg, if (rule.quotaMinutes == 0) "进入规则时段内的目标应用" else "已达到今日 ${rule.quotaMinutes} 分钟额度", now)
        } else runtimeError = "系统未能显示提示，请重新连接无障碍服务"
        // Freeze or restart the sampling anchor at the intervention transition.
        sampler.reset(); checkpoint()
    }
    fun refresh(changedId: String? = null, resetAll: Boolean = false) {
        if (resetAll) { session.acknowledged.clear(); logged.clear(); overlay.hide() }
        else if (changedId != null) { session.acknowledged.remove(changedId); logged.remove(changedId); if (overlay.ruleId == changedId) overlay.hide() }
        sampler.reset(); refreshPolicy(); evaluate(); checkpoint()
    }
    private fun resumeScreen() {
        if (!screenAvailable() || instance !== this) return
        pausedForLock = false; sampler.reset()
        handler.removeCallbacks(ticker); handler.post(ticker)
    }
    private fun pauseForLock() {
        if (!::overlay.isInitialized || pausedForLock) return
        pausedForLock = true; handler.removeCallbacks(ticker)
        overlay.hide(); session.enter(null); logged.clear(); sampler.reset(); suspended = false
        // Absolute wait deadlines may be restored only when a matching application is observed again.
        store.persist()
    }
    override fun onInterrupt() { if (::overlay.isInitialized) { checkpoint(); suspended = true; overlay.hide(); sampler.reset() } }
    private fun stopMonitoring() {
        handler.removeCallbacksAndMessages(null)
        if (::overlay.isInitialized) overlay.hide()
        sampler.reset(); session.enter(null)
        if (::store.isInitialized) store.persist()
        if (instance === this) instance = null
        if (registered) { runCatching { unregisterReceiver(receiver) }; registered = false }
    }
    override fun onUnbind(intent: Intent?): Boolean { checkpoint(); stopMonitoring(); return super.onUnbind(intent) }
    override fun onDestroy() { checkpoint(); stopMonitoring(); super.onDestroy() }
    companion object {
        @Volatile var instance: RuleService? = null; private set
        @Volatile var lastEventAt: Long = 0; private set
        @Volatile var runtimeError: String? = null; private set
        fun permissionGranted(context: Context): Boolean {
            val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            return manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any { it.resolveInfo.serviceInfo.packageName == context.packageName && it.resolveInfo.serviceInfo.name == RuleService::class.java.name }
        }
        fun status(context: Context): Map<String, Any> {
            val granted = permissionGranted(context); val monitoring = granted && instance != null
            val error = RuleStore.get(context).loadError ?: runtimeError
            return mapOf("platform" to "android", "permissionGranted" to granted, "monitoring" to monitoring,
                "availability" to if (!granted) "permissionRequired" else if (error != null) "unavailable" else "ready",
                "message" to (error ?: if (!granted) "请阅读用途说明后，亲自开启行为规则无障碍服务" else if (!monitoring) "已授权，正在等待系统连接服务；可在无障碍设置中重新开关" else "服务已连接。仅识别前台应用包名，不读取屏幕文字。厂商后台限制仍可能影响运行。"),
                "batteryOptimized" to !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName),
                "lastEventAt" to lastEventAt,
                "capabilities" to mapOf("appSelection" to true, "remind" to true, "delay" to true, "block" to true, "schedules" to true, "quotas" to true, "exceptions" to true))
        }
    }
}
