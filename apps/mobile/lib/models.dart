import 'dart:convert';

const maxConfigBytes = 2 * 1024 * 1024;

Map<String, dynamic> object(Object? value, String name) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw FormatException('$name 必须是对象');
  }
  return Map<String, dynamic>.from(value);
}

String stringField(
  Map<String, dynamic> map,
  String key,
  String name, {
  int min = 1,
  int max = 1000,
}) {
  final value = map[key];
  if (value is! String || value.trim().length < min || value.length > max) {
    throw FormatException('$name 需为 $min–$max 个字符');
  }
  return value;
}

int integerField(
  Map<String, dynamic> map,
  String key,
  String name, {
  int min = 0,
  int max = 9223372036854775807,
}) {
  final value = map[key];
  if (value is! num ||
      !value.isFinite ||
      value % 1 != 0 ||
      value < min ||
      value > max) {
    throw FormatException('$name 必须是 $min–$max 范围内的整数');
  }
  return value.toInt();
}

bool booleanField(Map<String, dynamic> map, String key, String name) {
  final value = map[key];
  if (value is! bool) throw FormatException('$name 必须是布尔值');
  return value;
}

List<dynamic> listField(
  Map<String, dynamic> map,
  String key,
  String name, {
  int min = 0,
  int max = 200,
}) {
  final value = map[key];
  if (value is! List || value.length < min || value.length > max) {
    throw FormatException('$name 数量需为 $min–$max');
  }
  return value;
}

enum RuleAction {
  remind('remind', '仅提醒', '显示提示，可继续使用'),
  delay('delay', '等待一下', '等待倒计时结束后继续'),
  block('block', '直接拦截', '遮住目标应用，并可返回桌面');

  const RuleAction(this.value, this.label, this.description);
  final String value;
  final String label;
  final String description;
  static RuleAction parse(Object? value) => values.firstWhere(
    (item) => item.value == value,
    orElse: () => throw const FormatException('不支持的规则动作'),
  );
}

class AppTarget {
  const AppTarget({
    required this.platform,
    required this.id,
    required this.label,
  });
  final String platform;
  final String id;
  final String label;
  factory AppTarget.fromJson(Object? value, {required String platform}) {
    final map = object(value, '应用目标');
    if (map['platform'] != platform)
      throw const FormatException('应用目标与当前平台不一致');
    return AppTarget(
      platform: platform,
      id: stringField(map, 'id', '目标标识', max: 255),
      label: stringField(map, 'label', '目标名称', max: 255),
    );
  }
  Map<String, dynamic> toJson() => {
    'platform': platform,
    'id': id,
    'label': label,
  };
}

class RuleSchedule {
  const RuleSchedule({
    required this.enabled,
    required this.days,
    required this.start,
    required this.end,
  });
  const RuleSchedule.always()
    : enabled = false,
      days = const [0, 1, 2, 3, 4, 5, 6],
      start = '00:00',
      end = '00:00';
  final bool enabled;
  final List<int> days;
  final String start;
  final String end;
  factory RuleSchedule.fromJson(Object? value) {
    final map = object(value, '生效时段');
    final enabled = booleanField(map, 'enabled', '时段开关');
    final rawDays = listField(map, 'days', '星期', min: 1, max: 7);
    final days = rawDays
        .map((day) => integerField({'day': day}, 'day', '星期', max: 6))
        .toList();
    if (days.toSet().length != days.length) {
      throw const FormatException('星期必须是 0–6 且不能重复');
    }
    final start = stringField(map, 'start', '开始时间', max: 5);
    final end = stringField(map, 'end', '结束时间', max: 5);
    final time = RegExp(r'^([01][0-9]|2[0-3]):[0-5][0-9]$');
    if (!time.hasMatch(start) || !time.hasMatch(end))
      throw const FormatException('时间格式必须为 HH:mm');
    return RuleSchedule(enabled: enabled, days: days, start: start, end: end);
  }
  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'days': days,
    'start': start,
    'end': end,
  };
  String get summary {
    if (!enabled) return '每天 · 全天';
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    final dayText = days.length == 7
        ? '每天'
        : '周${days.map((d) => names[d]).join('、')}';
    if (start == end) return '$dayText · 全天';
    return '$dayText · $start–$end${start.compareTo(end) > 0 ? '（次日）' : ''}';
  }
}

class BehaviorRule {
  const BehaviorRule({
    required this.id,
    required this.name,
    required this.enabled,
    required this.targets,
    required this.exceptions,
    required this.schedule,
    required this.quotaMinutes,
    required this.action,
    required this.delaySeconds,
    required this.message,
    required this.buttonText,
    required this.priority,
    required this.createdAt,
  });
  final String id;
  final String name;
  final bool enabled;
  final List<AppTarget> targets;
  final List<AppTarget> exceptions;
  final RuleSchedule schedule;
  final int quotaMinutes;
  final RuleAction action;
  final int delaySeconds;
  final String message;
  final String buttonText;
  final int priority;
  final int createdAt;
  factory BehaviorRule.fromJson(Object? value, {required String platform}) {
    final map = object(value, '规则');
    final id = stringField(map, 'id', '规则标识', max: 80);
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,80}$').hasMatch(id))
      throw const FormatException('规则标识含非法字符');
    List<AppTarget> targets(String key, int min) {
      final items = listField(
        map,
        key,
        key == 'targets' ? '目标应用' : '例外应用',
        min: min,
        max: 100,
      ).map((item) => AppTarget.fromJson(item, platform: platform)).toList();
      if (items.map((item) => item.id).toSet().length != items.length)
        throw const FormatException('应用目标不能重复');
      return items;
    }

    return BehaviorRule(
      id: id,
      name: stringField(map, 'name', '规则名称', max: 80),
      enabled: booleanField(map, 'enabled', '规则开关'),
      targets: targets('targets', 1),
      exceptions: targets('exceptions', 0),
      schedule: RuleSchedule.fromJson(map['schedule']),
      quotaMinutes: integerField(map, 'quotaMinutes', '每日额度', max: 1440),
      action: RuleAction.parse(map['action']),
      delaySeconds: integerField(
        map,
        'delaySeconds',
        '等待秒数',
        min: 1,
        max: 3600,
      ),
      message: stringField(map, 'message', '提示内容'),
      buttonText: stringField(map, 'buttonText', '按钮文字', max: 40),
      priority: integerField(map, 'priority', '优先级', min: -1000, max: 1000),
      createdAt: integerField(map, 'createdAt', '创建时间', max: 8640000000000000),
    );
  }
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'enabled': enabled,
    'targets': targets.map((t) => t.toJson()).toList(),
    'exceptions': exceptions.map((t) => t.toJson()).toList(),
    'schedule': schedule.toJson(),
    'quotaMinutes': quotaMinutes,
    'action': action.value,
    'delaySeconds': delaySeconds,
    'message': message,
    'buttonText': buttonText,
    'priority': priority,
    'createdAt': createdAt,
  };
}

class Capabilities {
  const Capabilities({
    this.appSelection = false,
    this.remind = false,
    this.delay = false,
    this.block = false,
    this.schedules = false,
    this.quotas = false,
    this.exceptions = false,
  });
  final bool appSelection, remind, delay, block, schedules, quotas, exceptions;
  factory Capabilities.fromJson(Object? value) {
    final map = object(value, '平台能力');
    return Capabilities(
      appSelection: map['appSelection'] == true,
      remind: map['remind'] == true,
      delay: map['delay'] == true,
      block: map['block'] == true,
      schedules: map['schedules'] == true,
      quotas: map['quotas'] == true,
      exceptions: map['exceptions'] == true,
    );
  }
  bool supports(RuleAction action) => switch (action) {
    RuleAction.remind => remind,
    RuleAction.delay => delay,
    RuleAction.block => block,
  };
  void validate(BehaviorRule rule) {
    if (!supports(rule.action))
      throw FormatException('当前平台尚不支持「${rule.action.label}」');
    if (rule.schedule.enabled && !schedules)
      throw const FormatException('当前平台尚不支持自定义时段');
    if (rule.quotaMinutes > 0 && !quotas)
      throw const FormatException('当前平台尚不支持每日额度');
    if (rule.exceptions.isNotEmpty && !exceptions)
      throw const FormatException('当前平台尚不支持例外应用');
  }
}

class RuleConfig {
  const RuleConfig({required this.platform, required this.rules});
  final String platform;
  final List<BehaviorRule> rules;
  factory RuleConfig.parse(
    String text, {
    required String expectedPlatform,
    Capabilities? capabilities,
  }) {
    if (utf8.encode(text).length > maxConfigBytes)
      throw const FormatException('文件超过 2 MiB，无法导入');
    Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException {
      throw const FormatException('文件不是有效的 JSON');
    }
    return RuleConfig.fromJson(
      decoded,
      expectedPlatform: expectedPlatform,
      capabilities: capabilities,
    );
  }
  factory RuleConfig.fromJson(
    Object? value, {
    required String expectedPlatform,
    Capabilities? capabilities,
  }) {
    final map = object(value, '配置');
    if (integerField(map, 'version', '配置版本', min: 1, max: 1) != 1)
      throw const FormatException('不支持此配置版本');
    final platform = map['platform'];
    if ((platform != 'android' && platform != 'ios') ||
        platform != expectedPlatform) {
      throw const FormatException('配置平台不一致，Android 和 iOS 备份不能互相导入');
    }
    final rules = listField(map, 'rules', '规则')
        .map(
          (item) => BehaviorRule.fromJson(item, platform: platform as String),
        )
        .toList();
    if (rules.map((rule) => rule.id).toSet().length != rules.length)
      throw const FormatException('规则标识重复');
    if (capabilities != null) {
      for (final rule in rules) {
        capabilities.validate(rule);
      }
    }
    return RuleConfig(platform: platform as String, rules: rules);
  }
  Map<String, dynamic> toJson() => {
    'version': 1,
    'platform': platform,
    'rules': rules.map((r) => r.toJson()).toList(),
  };
}

class PlatformStatus {
  const PlatformStatus({
    required this.platform,
    required this.permissionGranted,
    required this.monitoring,
    required this.availability,
    required this.message,
    required this.batteryOptimized,
    required this.lastEventAt,
    required this.capabilities,
  });
  final String platform, availability, message;
  final bool permissionGranted, monitoring, batteryOptimized;
  final int lastEventAt;
  final Capabilities capabilities;
  factory PlatformStatus.fromJson(Object? value) {
    final map = object(value, '运行状态');
    final platform = stringField(map, 'platform', '平台', max: 30);
    final availability = stringField(map, 'availability', '可用状态', max: 30);
    if (!['ready', 'permissionRequired', 'unavailable'].contains(availability))
      throw const FormatException('平台返回未知运行状态');
    return PlatformStatus(
      platform: platform,
      permissionGranted: booleanField(map, 'permissionGranted', '授权状态'),
      monitoring: booleanField(map, 'monitoring', '服务连接状态'),
      availability: availability,
      message: stringField(map, 'message', '状态说明', min: 0, max: 10000),
      batteryOptimized: booleanField(map, 'batteryOptimized', '电池优化状态'),
      lastEventAt: integerField(map, 'lastEventAt', '最近事件时间'),
      capabilities: Capabilities.fromJson(map['capabilities']),
    );
  }
  String get headline => availability == 'unavailable'
      ? '当前环境不可用'
      : !permissionGranted
      ? '尚未授权'
      : !monitoring
      ? '服务未连接'
      : '规则服务已连接';
}

class TriggerLog {
  const TriggerLog({
    required this.at,
    required this.ruleName,
    required this.targetLabel,
    required this.action,
    required this.reason,
  });
  final int at;
  final String ruleName, targetLabel, action, reason;
  factory TriggerLog.fromJson(Object? value) {
    final map = object(value, '触发记录');
    return TriggerLog(
      at: integerField(map, 'at', '记录时间'),
      ruleName: stringField(map, 'ruleName', '规则名称', min: 0, max: 1000),
      targetLabel: stringField(map, 'targetLabel', '应用名称', min: 0, max: 1000),
      action: stringField(map, 'action', '动作', max: 100),
      reason: stringField(map, 'reason', '原因', min: 0, max: 10000),
    );
  }
}

class AppState {
  const AppState({
    required this.config,
    required this.status,
    required this.usage,
    required this.grants,
    required this.logs,
    required this.today,
    required this.now,
  });
  final RuleConfig config;
  final PlatformStatus status;
  final Map<String, Map<String, int>> usage;
  final Map<String, int> grants;
  final List<TriggerLog> logs;
  final String today;
  final int now;
  factory AppState.fromJson(Object? value) {
    final map = object(value, '应用状态');
    final status = PlatformStatus.fromJson(map['status']);
    final rawUsage = object(map['usage'], '使用时间');
    final usage = <String, Map<String, int>>{};
    for (final entry in rawUsage.entries) {
      final day = object(entry.value, '每日用时');
      usage[entry.key] = {
        for (final key in day.keys) key: integerField(day, key, '使用毫秒数'),
      };
    }
    final rawGrants = object(map['grants'], '临时放行');
    return AppState(
      config: RuleConfig.fromJson(
        map['config'],
        expectedPlatform: status.platform,
      ),
      status: status,
      usage: usage,
      grants: {
        for (final key in rawGrants.keys)
          key: integerField(rawGrants, key, '放行截止时间'),
      },
      logs: listField(
        map,
        'logs',
        '触发记录',
        max: 300,
      ).map(TriggerLog.fromJson).toList(),
      today: stringField(map, 'today', '当前日期', max: 10),
      now: integerField(map, 'now', '当前时间'),
    );
  }
  int usedMilliseconds(String ruleId) => usage[today]?[ruleId] ?? 0;
  int bypassRemaining(String ruleId) =>
      ((grants[ruleId] ?? 0) - now).clamp(0, 9223372036854775807);
}
