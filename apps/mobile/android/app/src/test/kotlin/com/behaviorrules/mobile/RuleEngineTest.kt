package com.behaviorrules.mobile

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class RuleEngineTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private fun time(value: String) = Instant.parse(value).toEpochMilli()
    private fun rule(id: String = "r", action: String = "remind", priority: Int = 0, created: Long = 1) =
        BehaviorRule(id, "阅读", true, listOf(RuleTarget("android", "com.example.reader", "阅读器")), emptyList(),
            RuleSchedule(false, listOf(0,1,2,3,4,5,6), "00:00", "00:00"), 0, action, 5, "放慢一点", "继续", priority, created)
    private fun at(rule: BehaviorRule, instant: String) = RuleEngine.inSchedule(rule.schedule, time(instant), zone)

    @Test fun scheduleIncludesStartAndExcludesEnd() {
        val r = rule().copy(schedule = RuleSchedule(true, listOf(1), "09:00", "18:00"))
        assertTrue(at(r, "2026-10-12T01:00:00Z"))
        assertFalse(at(r, "2026-10-12T10:00:00Z"))
        assertFalse(at(r, "2026-10-13T01:00:00Z"))
    }
    @Test fun overnightBelongsToStartingDay() {
        val r = rule().copy(schedule = RuleSchedule(true, listOf(1), "22:00", "02:00"))
        assertTrue(at(r, "2026-10-12T15:00:00Z"))
        assertTrue(at(r, "2026-10-12T17:59:59Z"))
        assertFalse(at(r, "2026-10-12T18:00:00Z"))
        assertFalse(at(r, "2026-10-13T15:00:00Z"))
    }
    @Test fun equalTimeMeansWholeSelectedDay() {
        val r = rule().copy(schedule = RuleSchedule(true, listOf(1), "09:00", "09:00"))
        assertTrue(at(r, "2026-10-11T16:00:00Z"))
        assertTrue(at(r, "2026-10-12T15:59:59Z"))
        assertFalse(at(r, "2026-10-12T16:00:00Z"))
    }
    @Test fun precedenceActionThenPriorityThenCreatedThenId() {
        val now = time("2026-10-12T01:00:00Z")
        val rules = listOf(rule("rem", "remind", 1000), rule("del", "delay", 1000),
            rule("b", "block", 3, 2), rule("a", "block", 3, 2), rule("z", "block", 2, 0))
        assertEquals("a", RuleEngine.select(rules, "com.example.reader", now, zone, emptyMap(), emptyMap(), emptySet())?.id)
    }
    @Test fun exceptionAndDisabledRulesDoNotWin() {
        val r = rule("block", "block").copy(exceptions = rule().targets)
        val disabled = rule("disabled", "block").copy(enabled = false)
        assertEquals("r", RuleEngine.select(listOf(r, disabled, rule()), "com.example.reader", 0, zone, emptyMap(), emptyMap(), emptySet())?.id)
    }
    @Test fun quotaUsesMillisecondsAndGrantExpiresAtExactDeadline() {
        val r = rule().copy(quotaMinutes = 2)
        assertNull(RuleEngine.select(listOf(r), "com.example.reader", 5000, zone, mapOf("r" to 119999), emptyMap(), emptySet()))
        assertNull(RuleEngine.select(listOf(r), "com.example.reader", 5000, zone, mapOf("r" to 120000), mapOf("r" to 5001), emptySet()))
        assertEquals("r", RuleEngine.select(listOf(r), "com.example.reader", 5001, zone, mapOf("r" to 120000), mapOf("r" to 5001), emptySet())?.id)
    }
    @Test fun bypassOnlyExemptsItsOwnRule() {
        assertEquals("next", RuleEngine.select(listOf(rule("first", "block"), rule("next", "delay")), "com.example.reader", 1, zone, emptyMap(), mapOf("first" to 9000), emptySet())?.id)
    }
    @Test fun acknowledgedVisitDoesNotHideOtherRules() {
        assertEquals("next", RuleEngine.select(listOf(rule("first"), rule("next")), "com.example.reader", 1, zone, emptyMap(), emptyMap(), setOf("first"))?.id)
    }
    @Test fun usageSplitsAtMidnightWithoutMovingEarlierUsage() {
        val usage = mutableMapOf<String, MutableMap<String, Long>>()
        RuleEngine.accrue(listOf(rule()), "com.example.reader", time("2026-10-12T15:59:50Z"), time("2026-10-12T16:00:20Z"), zone, usage)
        assertEquals(10000L, usage["2026-10-12"]?.get("r"))
        assertEquals(20000L, usage["2026-10-13"]?.get("r"))
    }
    @Test fun usageCountsOnlyScheduledMinutesAndExcludesExceptions() {
        val usage = mutableMapOf<String, MutableMap<String, Long>>()
        val r = rule().copy(schedule = RuleSchedule(true, listOf(1), "09:00", "10:00"))
        RuleEngine.accrue(listOf(r, rule("except").copy(exceptions = rule().targets)), "com.example.reader", time("2026-10-12T00:59:30Z"), time("2026-10-12T01:00:30Z"), zone, usage)
        assertEquals(mapOf("r" to 30000L), usage["2026-10-12"])
    }
    @Test fun transientWindowsPreserveAcknowledgementButRealVisitClearsIt() {
        val session = ForegroundSession()
        session.enter("com.example.reader")
        session.acknowledged.add("r")
        session.enter("com.example.reader")
        assertTrue(session.acknowledged.contains("r"))
        session.enter("com.example.other")
        assertTrue(session.acknowledged.isEmpty())
    }
    @Test fun restartedSamplerAndSuspensionNeverBackfillUnknownTime() {
        val s = UsageSampler()
        assertNull(s.sample(1000, 1000, true))
        assertEquals(1000L..1999L, s.sample(2000, 2000, true))
        assertNull(s.sample(100000, 100000, true))
        s.reset()
        assertNull(s.sample(200000, 200000, true))
        assertNull(s.sample(201000, 201000, false))
        assertNull(s.sample(202000, 202000, true))
    }
    @Test fun wallClockChangesDoNotInventUsage() {
        val s = UsageSampler()
        s.sample(1000, 1000, true)
        assertNull(s.sample(500000, 2000, true))
    }
    @Test fun parserRejectsTrailingJsonDuplicateKeysAndInvalidNumbers() {
        listOf("{} {}", "{\"a\":1,\"a\":2}", "{\"a\":NaN}", "{\"a\":01}", "{'a':1}", "[1,]").forEach {
            assertThrows(IllegalArgumentException::class.java) { StrictJson.parse(it) }
        }
    }
    @Test fun parserReadsUtf8AndEscapes() {
        assertEquals(mapOf("text" to "中文\n\"好\"", "list" to listOf(true, null, 2L)), StrictJson.parse("{\"text\":\"中文\\n\\\"好\\\"\",\"list\":[true,null,2]}"))
    }
    @Test fun validationRejectsUnknownActionsNonIntegerQuotaAndDuplicateTargets() {
        val source = RuleCodec.encodeRule(rule()).toMutableMap()
        listOf(source + ("action" to "execute"), source + ("quotaMinutes" to 1.1), source + ("targets" to listOf(source["targets"].let { (it as List<*>)[0] }, (source["targets"] as List<*>)[0]))).forEach {
            assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(it) }
        }
    }
    @Test fun configRejectsWrongPlatformDuplicateIdsMissingFieldAndOversize() {
        val encoded = RuleCodec.encodeRule(rule())
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeConfig(mapOf("version" to 1, "platform" to "ios", "rules" to emptyList<Any>())) }
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeConfig(mapOf("version" to 1, "platform" to "android", "rules" to listOf(encoded, encoded))) }
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(encoded - "message") }
        assertThrows(IllegalArgumentException::class.java) { StrictJson.parse(" ".repeat(2 * 1024 * 1024 + 1)) }
    }
    @Test fun validationRejectsBooleanCoercionBadDaysAndUnsafeTargets() {
        val encoded = RuleCodec.encodeRule(rule())
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(encoded + ("enabled" to "true")) }
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(encoded + ("schedule" to mapOf("enabled" to true, "days" to listOf(1,1), "start" to "09:00", "end" to "18:00"))) }
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(encoded, setOf("com.example.reader")) }
        assertEquals(rule(), RuleCodec.decodeRule(encoded))
    }
    @Test fun smallWallClockAdjustmentDoesNotInflateMonotonicUsage() {
        val sampler = UsageSampler()
        sampler.sample(1000, 1000, true)
        val interval = sampler.sample(3000, 2000, true)!!
        assertEquals(1000L, interval.last - interval.first + 1)
    }    @Test fun retentionKeepsTodayAndSevenEarlierDaysOnly() {
        assertTrue(RuleEngine.retainsUsageDay("2026-10-14", "2026-10-14"))
        assertTrue(RuleEngine.retainsUsageDay("2026-10-07", "2026-10-14"))
        assertFalse(RuleEngine.retainsUsageDay("2026-10-06", "2026-10-14"))
        assertFalse(RuleEngine.retainsUsageDay("2026-10-15", "2026-10-14"))
        assertFalse(RuleEngine.retainsUsageDay("invalid", "2026-10-14"))
    }    @Test fun timestampsRemainInsideFlutterDateTimeRange() {
        val encoded = RuleCodec.encodeRule(rule())
        assertEquals(8640000000000000L, RuleCodec.decodeRule(encoded + ("createdAt" to 8640000000000000L)).createdAt)
        assertThrows(IllegalArgumentException::class.java) { RuleCodec.decodeRule(encoded + ("createdAt" to 8640000000000001L)) }
        assertEquals(1, RuleCodec.decodeRule(encoded + ("quotaMinutes" to 1.0)).quotaMinutes)
    }    @Test fun keyboardPopupPreservesPriorVisitAndAcknowledgement() {
        val session = ForegroundSession()
        session.enter("com.example.reader")
        session.acknowledged.add("r")
        val result = session.onWindow("com.example.keyboard", false, true, "com.behaviorrules.mobile",
            setOf("com.example.keyboard"), setOf("com.example.keyboard", "com.android.systemui"))
        assertEquals(ForegroundSession.WindowChange.IGNORED, result)
        assertEquals("com.example.reader", session.packageName)
        assertEquals(setOf("r"), session.acknowledged)
    }
    @Test fun imeSettingsActivityEndsPriorVisitAndStopsItsUsage() {
        val session = ForegroundSession()
        val usage = mutableMapOf<String, MutableMap<String, Long>>()
        val start = time("2026-10-12T01:00:00Z")
        session.enter("com.example.reader")
        session.acknowledged.add("r")
        RuleEngine.accrue(listOf(rule()), session.packageName!!, start, start + 1000, zone, usage)
        val result = session.onWindow("com.example.keyboard", true, true, "com.behaviorrules.mobile",
            setOf("com.example.keyboard"), setOf("com.example.keyboard", "com.android.systemui"))
        assertEquals(ForegroundSession.WindowChange.CHANGED, result)
        assertEquals("com.example.keyboard", session.packageName)
        assertTrue(session.acknowledged.isEmpty())
        RuleEngine.accrue(listOf(rule()), session.packageName!!, start + 1000, start + 6000, zone, usage)
        assertEquals(1000L, usage["2026-10-12"]?.get("r"))
    }}
