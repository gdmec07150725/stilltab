import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:behavior_rules_mobile/models.dart';

Map<String, dynamic> fixtureRule() => {
  'id': 'focus_1',
  'name': '专注',
  'enabled': false,
  'targets': [
    {'platform': 'android', 'id': 'com.example.app', 'label': '示例'},
  ],
  'exceptions': [],
  'schedule': {
    'enabled': true,
    'days': [1, 2, 3, 4, 5],
    'start': '22:00',
    'end': '06:00',
  },
  'quotaMinutes': 30,
  'action': 'delay',
  'delaySeconds': 10,
  'message': '先停一下',
  'buttonText': '继续',
  'priority': 0,
  'createdAt': 1720000000000,
};
String configText(
  List<Map<String, dynamic>> rules, {
  String platform = 'android',
}) => jsonEncode({'version': 1, 'platform': platform, 'rules': rules});

void main() {
  test(
    'valid cross-midnight configuration survives a round trip without changing fields',
    () {
      final config = RuleConfig.parse(
        configText([fixtureRule()]),
        expectedPlatform: 'android',
      );
      expect(config.rules.single.schedule.end, '06:00');
      expect(config.rules.single.enabled, false);
      expect(config.toJson()['rules'], [fixtureRule()]);
    },
  );
  test('configuration rejects another platform before importing any rule', () {
    expect(
      () => RuleConfig.parse(
        configText([], platform: 'ios'),
        expectedPlatform: 'android',
      ),
      throwsFormatException,
    );
  });
  test(
    'rejects missing fields, wrong types, unknown actions and duplicate IDs',
    () {
      for (final field in fixtureRule().keys) {
        final rule = fixtureRule()..remove(field);
        expect(
          () =>
              RuleConfig.parse(configText([rule]), expectedPlatform: 'android'),
          throwsFormatException,
          reason: field,
        );
      }
      for (final update in [
        {'quotaMinutes': 1.5},
        {'quotaMinutes': '30'},
        {'quotaMinutes': -1},
        {'delaySeconds': 0},
        {'delaySeconds': 3601},
        {'enabled': 1},
        {'action': 'shell'},
        {'createdAt': -1},
        {'priority': 1001},
        {'name': '   '},
      ]) {
        expect(
          () => RuleConfig.parse(
            configText([fixtureRule()..addAll(update)]),
            expectedPlatform: 'android',
          ),
          throwsFormatException,
        );
      }
      expect(
        () => RuleConfig.parse(
          configText([fixtureRule(), fixtureRule()]),
          expectedPlatform: 'android',
        ),
        throwsFormatException,
      );
    },
  );
  test(
    'rejects wrong target platform, duplicate targets, invalid time and weekdays',
    () {
      final target = {
        'platform': 'android',
        'id': 'com.example.app',
        'label': '示例',
      };
      for (final update in [
        {'targets': []},
        {
          'targets': [target, target],
        },
        {
          'targets': [
            {'platform': 'ios', 'id': 'opaque', 'label': '集合'},
          ],
        },
        {
          'schedule': {
            'enabled': false,
            'days': [],
            'start': '00:00',
            'end': '00:00',
          },
        },
        {
          'schedule': {
            'enabled': true,
            'days': [1, 1],
            'start': '09:00',
            'end': '18:00',
          },
        },
        {
          'schedule': {
            'enabled': true,
            'days': [7],
            'start': '09:00',
            'end': '18:00',
          },
        },
        {
          'schedule': {
            'enabled': true,
            'days': [1],
            'start': '24:00',
            'end': '18:00',
          },
        },
      ]) {
        expect(
          () => RuleConfig.parse(
            configText([fixtureRule()..addAll(update)]),
            expectedPlatform: 'android',
          ),
          throwsFormatException,
        );
      }
    },
  );
  test('rejects excessive rules, targets and UTF8 bytes', () {
    expect(
      () => RuleConfig.parse(
        configText(List.generate(201, (i) => fixtureRule()..['id'] = 'id_$i')),
        expectedPlatform: 'android',
      ),
      throwsFormatException,
    );
    final rule = fixtureRule()
      ..['targets'] = List.generate(
        101,
        (i) => {'platform': 'android', 'id': 'app.$i', 'label': '应用'},
      );
    expect(
      () => RuleConfig.parse(configText([rule]), expectedPlatform: 'android'),
      throwsFormatException,
    );
    expect(
      () => RuleConfig.parse(
        ' ' * (2 * 1024 * 1024 + 1),
        expectedPlatform: 'android',
      ),
      throwsFormatException,
    );
  });
  test(
    'UTF8 size, config version and scalar roots are rejected before replacement',
    () {
      final unicode = jsonEncode({
        'version': 1,
        'platform': 'android',
        'rules': [],
        'padding': '中' * 700000,
      });
      expect(
        () => RuleConfig.parse(unicode, expectedPlatform: 'android'),
        throwsFormatException,
      );
      for (final text in [
        '[]',
        'null',
        '12',
        '{"version":2,"platform":"android","rules":[]}',
      ]) {
        expect(
          () => RuleConfig.parse(text, expectedPlatform: 'android'),
          throwsFormatException,
        );
      }
    },
  );
  test(
    'mathematical integers normalize while fractional and nonfinite values are rejected',
    () {
      final rule = fixtureRule()
        ..addAll({
          'quotaMinutes': 30.0,
          'delaySeconds': 10.0,
          'priority': -3.0,
          'createdAt': 0.0,
          'schedule': {
            'enabled': true,
            'days': [1.0, 2.0],
            'start': '09:00',
            'end': '18:00',
          },
        });
      final text = jsonEncode({
        'version': 1.0,
        'platform': 'android',
        'rules': [rule],
      });
      final parsed = RuleConfig.parse(
        text,
        expectedPlatform: 'android',
      ).rules.single;
      expect(parsed.quotaMinutes, 30);
      expect(parsed.createdAt, 0);
      expect(parsed.schedule.days, [1, 2]);
      for (final value in [
        double.nan,
        double.infinity,
        double.negativeInfinity,
        1.5,
      ]) {
        expect(
          () => BehaviorRule.fromJson(
            fixtureRule()..['quotaMinutes'] = value,
            platform: 'android',
          ),
          throwsFormatException,
        );
      }
      expect(
        () => RuleConfig.parse(
          configText([fixtureRule()..['createdAt'] = 8640000000000001]),
          expectedPlatform: 'android',
        ),
        throwsFormatException,
      );
    },
  );
  test('inclusive limits remain usable and exceptions cannot repeat', () {
    final rule = fixtureRule()
      ..addAll({
        'quotaMinutes': 1440,
        'delaySeconds': 3600,
        'priority': -1000,
        'createdAt': 0,
      });
    expect(
      RuleConfig.parse(
        configText([rule]),
        expectedPlatform: 'android',
      ).rules.single.quotaMinutes,
      1440,
    );
    final target = {
      'platform': 'android',
      'id': 'com.example.app',
      'label': '示例',
    };
    rule['exceptions'] = [target, target];
    expect(
      () => RuleConfig.parse(configText([rule]), expectedPlatform: 'android'),
      throwsFormatException,
    );
  });
  test('unimplemented iOS features are rejected on import', () {
    final rule = fixtureRule()
      ..['targets'] = [
        {'platform': 'ios', 'id': 'opaque_selection', 'label': '系统选择'},
      ];
    const caps = Capabilities(appSelection: true, block: true);
    expect(
      () => RuleConfig.parse(
        configText([rule], platform: 'ios'),
        expectedPlatform: 'ios',
        capabilities: caps,
      ),
      throwsFormatException,
    );
    rule.addAll({
      'action': 'block',
      'quotaMinutes': 0,
      'schedule': {
        'enabled': false,
        'days': [0, 1, 2, 3, 4, 5, 6],
        'start': '00:00',
        'end': '00:00',
      },
    });
    expect(
      RuleConfig.parse(
        configText([rule], platform: 'ios'),
        expectedPlatform: 'ios',
        capabilities: caps,
      ).rules.single.action,
      RuleAction.block,
    );
  });
}
