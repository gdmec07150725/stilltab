package com.behaviorrules.mobile

import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.content.pm.PackageManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager
import java.text.Collator
import java.util.Locale

class AppPolicy(private val context: Context) {
    private val pm = context.packageManager
    val transientPackages: Set<String> get() {
        val ime = (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).inputMethodList.map { it.packageName }
        return ime.toSet() + setOf("com.android.systemui", "com.android.permissioncontroller", "com.google.android.permissioncontroller", "com.android.packageinstaller", "com.google.android.packageinstaller", "android")
    }
    fun forbidden(): Set<String> {
        val blocked = mutableSetOf(context.packageName, "android", "com.android.settings", "com.android.phone", "com.android.server.telecom", "com.android.emergency", "com.android.incallui", "com.samsung.android.incallui", "com.samsung.android.app.telephonyui", "com.google.android.dialer", "com.android.dialer")
        blocked.addAll(transientPackages)
        val intents = listOf(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), Intent(Settings.ACTION_SETTINGS), Intent(Intent.ACTION_DIAL), Intent(Intent.ACTION_CALL_BUTTON))
        intents.forEach { intent ->
            pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).forEach { blocked.add(it.activityInfo.packageName) }
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.let(blocked::add)
        }
        (context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage?.let(blocked::add)
        return blocked
    }
    fun listApps(): List<RuleTarget> {
        val blocked = forbidden()
        val collator = Collator.getInstance(Locale.CHINA)
        return pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo.enabled && it.activityInfo.applicationInfo.enabled && it.activityInfo.packageName !in blocked }
            .map { RuleTarget("android", it.activityInfo.packageName, it.loadLabel(pm).toString().take(255).ifBlank { it.activityInfo.packageName }) }
            .distinctBy { it.id }.sortedWith { a, b -> collator.compare(a.label, b.label).let { if (it == 0) a.id.compareTo(b.id) else it } }
    }
    fun isActivity(pkg: String, name: String?): Boolean {
        if (name.isNullOrBlank()) return false
        return try { pm.getActivityInfo(ComponentName(pkg, name), 0); true } catch (_: PackageManager.NameNotFoundException) { false }
    }
}
