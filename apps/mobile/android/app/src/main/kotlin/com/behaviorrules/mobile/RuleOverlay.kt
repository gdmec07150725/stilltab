package com.behaviorrules.mobile

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** All intervention UI belongs to the accessibility service, never to Flutter's lifetime. */
class RuleOverlay(private val context: Context) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var view: View? = null
    private var countdown: TextView? = null
    private var continueButton: Button? = null
    var ruleId: String? = null; private set
    var blocking: Boolean = false; private set
    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float, color: Int = Color.rgb(240, 243, 241)) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); setPadding(0, dp(8), 0, dp(8))
    }
    fun show(rule: BehaviorRule, deadline: Long?, acknowledge: () -> Unit, home: () -> Unit, manage: () -> Unit): Boolean {
        hide()
        val full = rule.action != "remind"
        val shell = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (full) Gravity.CENTER else Gravity.TOP
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply { setColor(Color.rgb(22, 34, 30)); if (!full) cornerRadius = dp(20).toFloat() }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        body.addView(text(when (rule.action) { "block" -> "现在，换件事做"; "delay" -> "先等一会儿"; else -> "给自己一个提醒" }, 24f).apply { setTypeface(typeface, Typeface.BOLD) })
        body.addView(text(rule.name, 14f, Color.rgb(163, 199, 181)))
        body.addView(text(rule.message, 18f))
        if (rule.action == "delay") {
            countdown = text("", 16f)
            body.addView(countdown)
        }
        val primary = Button(context).apply {
            text = rule.buttonText
            isAllCaps = false
            setOnClickListener { if (rule.action == "block") home() else if (deadline == null || System.currentTimeMillis() >= deadline) acknowledge() }
        }
        if (rule.action == "delay") continueButton = primary
        body.addView(primary, LinearLayout.LayoutParams(-1, -2))
        if (rule.action != "block") body.addView(Button(context).apply { text = "返回桌面"; isAllCaps = false; setOnClickListener { home() } }, LinearLayout.LayoutParams(-1, -2))
        body.addView(Button(context).apply { text = "管理规则"; isAllCaps = false; setOnClickListener { manage() } }, LinearLayout.LayoutParams(-1, -2))
        shell.addView(ScrollView(context).apply { isFillViewport = false; addView(body) }, LinearLayout.LayoutParams(-1, -2))
        val params = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, if (full) WindowManager.LayoutParams.MATCH_PARENT else (context.resources.displayMetrics.heightPixels * 0.48).toInt(),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply {
            gravity = if (full) Gravity.CENTER else Gravity.BOTTOM
            title = "行为规则提示"
        }
        return try {
            wm.addView(shell, params); view = shell; ruleId = rule.id; blocking = full
            if (deadline != null) updateCountdown(deadline)
            true
        } catch (_: RuntimeException) { hide(); false }
    }
    fun updateCountdown(deadline: Long) {
        val seconds = ((deadline - System.currentTimeMillis()).coerceAtLeast(0) + 999) / 1000
        countdown?.text = if (seconds == 0L) "等待结束，你可以继续了" else "再等 $seconds 秒"
        continueButton?.isEnabled = seconds == 0L
    }
    fun hide() {
        view?.let { runCatching { wm.removeViewImmediate(it) } }
        view = null; ruleId = null; blocking = false; countdown = null; continueButton = null
    }
}
